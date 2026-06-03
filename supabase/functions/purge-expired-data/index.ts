/**
 * purge-expired-data — Suppression des données B2 excédentaires
 * Appelée quotidiennement via pg_cron ou un scheduler externe.
 *
 * Logique :
 *  1. Récupère tous les pending_data_deletions dont scheduled_at <= now()
 *     et qui ne sont ni executed ni cancelled.
 *  2. Pour chaque user, vérifie que son plan est TOUJOURS free (sécurité).
 *  3. Calcule la taille totale B2 de l'user. Si <= 500 Mo → rien à faire.
 *  4. Sinon : supprime les fichiers les plus anciens jusqu'à revenir sous 500 Mo.
 *     (on préserve autant de données que possible)
 *  5. Supprime aussi les lignes show_files correspondantes.
 *  6. Marque la ligne pending_data_deletions comme executed.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from 'npm:@aws-sdk/client-s3@3.490.0';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET      = Deno.env.get('CRON_SECRET') ?? '';

const _rawEndpoint = Deno.env.get('B2_ENDPOINT') || '';
const B2_ENDPOINT  = _rawEndpoint.startsWith('http') ? _rawEndpoint : 'https://' + _rawEndpoint;
const B2_REGION    = Deno.env.get('B2_REGION')!;
const B2_BUCKET    = Deno.env.get('B2_BUCKET')!;
const B2_KEY_ID    = Deno.env.get('B2_KEY_ID')!;
const B2_APP_KEY   = Deno.env.get('B2_APP_KEY')!;

const FREE_QUOTA_BYTES = 500 * 1024 * 1024; // 500 Mo

const s3 = new S3Client({
  endpoint: B2_ENDPOINT,
  region: B2_REGION,
  credentials: { accessKeyId: B2_KEY_ID, secretAccessKey: B2_APP_KEY },
  forcePathStyle: true,
});

/* Liste récursivement tous les objets B2 d'un préfixe */
async function listAllObjects(prefix: string): Promise<Array<{ key: string; size: number; lastModified: Date }>> {
  const objects: Array<{ key: string; size: number; lastModified: Date }> = [];
  let continuationToken: string | undefined;
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: B2_BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    const resp = await s3.send(cmd);
    for (const obj of resp.Contents ?? []) {
      if (obj.Key && obj.Size !== undefined) {
        objects.push({ key: obj.Key, size: obj.Size, lastModified: obj.LastModified ?? new Date(0) });
      }
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

/* Supprime des objets B2 par batch de 1000 */
async function deleteObjects(keys: string[]) {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await s3.send(new DeleteObjectsCommand({
      Bucket: B2_BUCKET,
      Delete: { Objects: batch.map(k => ({ Key: k })), Quiet: true },
    }));
  }
}

serve(async (req) => {
  // Sécurité : cron secret pour éviter les appels non autorisés
  const auth = req.headers.get('Authorization') ?? '';
  if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const results: Array<{ userId: string; status: string; deletedFiles?: number; freedBytes?: number }> = [];

  try {
    // 1. Récupérer les suppressions dues
    const { data: pendingRows, error: fetchErr } = await sb
      .from('pending_data_deletions')
      .select('id, user_id')
      .lte('scheduled_at', new Date().toISOString())
      .is('executed_at', null)
      .is('cancelled_at', null);

    if (fetchErr) throw fetchErr;
    if (!pendingRows?.length) {
      console.log('[purge] Rien à supprimer.');
      return new Response(JSON.stringify({ ok: true, purged: 0 }), { status: 200 });
    }

    for (const row of pendingRows) {
      const userId = row.user_id;
      try {
        // 2. Vérifier que l'user est TOUJOURS free (sécurité anti-race condition)
        const { data: profile } = await sb
          .from('profiles')
          .select('plan')
          .eq('id', userId)
          .maybeSingle();

        if (profile?.plan === 'pro') {
          // L'user a resubscrit entre-temps → annuler silencieusement
          await sb.from('pending_data_deletions')
            .update({ cancelled_at: new Date().toISOString() })
            .eq('id', row.id);
          results.push({ userId, status: 'cancelled_resubscribed' });
          continue;
        }

        // 3. Lister tous les fichiers B2 de cet user (tous ses shows)
        const { data: shows } = await sb
          .from('shows')
          .select('id')
          .eq('owner_id', userId);

        if (!shows?.length) {
          await sb.from('pending_data_deletions')
            .update({ executed_at: new Date().toISOString() })
            .eq('id', row.id);
          results.push({ userId, status: 'no_shows' });
          continue;
        }

        // Lister tous les objets B2 de cet user (tous ses shows)
        let allObjects: Array<{ key: string; size: number; lastModified: Date }> = [];
        for (const show of shows) {
          const objs = await listAllObjects(show.id + '/');
          allObjects = allObjects.concat(objs);
        }

        const totalBytes = allObjects.reduce((sum, o) => sum + o.size, 0);

        if (totalBytes <= FREE_QUOTA_BYTES) {
          // Sous le quota → rien à supprimer
          await sb.from('pending_data_deletions')
            .update({ executed_at: new Date().toISOString() })
            .eq('id', row.id);
          results.push({ userId, status: 'under_quota', freedBytes: 0 });
          continue;
        }

        // 4. Trier par date (les plus anciens en premier) et supprimer jusqu'à quota
        allObjects.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());

        const toDelete: string[] = [];
        let runningTotal = totalBytes;
        for (const obj of allObjects) {
          if (runningTotal <= FREE_QUOTA_BYTES) break;
          toDelete.push(obj.key);
          runningTotal -= obj.size;
        }

        const freedBytes = totalBytes - runningTotal;

        // 5. Supprimer de B2
        await deleteObjects(toDelete);

        // 6. Supprimer les lignes show_files correspondantes
        if (toDelete.length) {
          // Batch delete par chemin
          for (let i = 0; i < toDelete.length; i += 500) {
            const batch = toDelete.slice(i, i + 500);
            await sb.from('show_files')
              .delete()
              .in('path', batch);
          }
        }

        // 7. Marquer comme exécuté
        await sb.from('pending_data_deletions')
          .update({ executed_at: new Date().toISOString() })
          .eq('id', row.id);

        console.log(`[purge] ${userId}: supprimé ${toDelete.length} fichiers, libéré ${(freedBytes / 1024 / 1024).toFixed(1)} Mo`);
        results.push({ userId, status: 'purged', deletedFiles: toDelete.length, freedBytes });

      } catch (userErr) {
        console.error(`[purge] Erreur pour user ${userId}:`, userErr);
        results.push({ userId, status: 'error' });
      }
    }

    return new Response(JSON.stringify({ ok: true, purged: results.length, results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[purge] Erreur globale:', err);
    return new Response('Error: ' + (err instanceof Error ? err.message : String(err)), { status: 500 });
  }
});
