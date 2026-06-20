import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from 'npm:@aws-sdk/client-s3@3.490.0';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.490.0';

// ── B2 configuration from environment ──
// Ensure the endpoint always starts with https:// (common mistake to omit it)
const _rawEndpoint = Deno.env.get('B2_ENDPOINT') || '';
const B2_ENDPOINT = _rawEndpoint.startsWith('http') ? _rawEndpoint : 'https://' + _rawEndpoint;
const B2_REGION   = Deno.env.get('B2_REGION')!;     // e.g. us-east-005
const B2_BUCKET   = Deno.env.get('B2_BUCKET')!;     // e.g. patchflow-files
const B2_KEY_ID   = Deno.env.get('B2_KEY_ID')!;     // Application Key ID
const B2_APP_KEY  = Deno.env.get('B2_APP_KEY')!;    // Application Key (secret)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const s3 = new S3Client({
  endpoint: B2_ENDPOINT,
  region: B2_REGION,
  credentials: { accessKeyId: B2_KEY_ID, secretAccessKey: B2_APP_KEY },
  forcePathStyle: true, // required for Backblaze B2
});

const SKIP = new Set(['.keep', '.emptyFolderPlaceholder']);

// UUID strict (les showId sont des UUID v4)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ════════════════════════════════════════════════════════════════════
   SÉCURITÉ UPLOAD — large mais sûr.
   - On accepte un très large éventail de formats (images, audio, vidéo,
     docs bureautiques, archives, sessions DAW/console…).
   - On REFUSE les exécutables / scripts (jamais hébergés sur le bucket).
   - On ne fait JAMAIS confiance au Content-Type fourni par le client :
     on impose un type sûr déterminé par l'extension.
   - Les formats prévisualisables (image/pdf/audio/vidéo/texte) sont servis
     "inline" ; TOUT le reste est forcé en téléchargement (Content-Disposition
     attachment) et neutralisé en application/octet-stream → un HTML/SVG/script
     uploadé ne peut jamais s'exécuter depuis le bucket (anti-XSS / anti-abus).
   ════════════════════════════════════════════════════════════════════ */
const INLINE_SAFE_EXT = new Set([
  'png','jpg','jpeg','gif','webp','bmp','pdf',
  'mp4','webm','mov','m4v','mp3','wav','ogg','m4a','aac','flac',
  'txt','csv',
]);
const INLINE_MIME: Record<string, string> = {
  png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', bmp:'image/bmp',
  pdf:'application/pdf',
  mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime', m4v:'video/mp4',
  mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', m4a:'audio/mp4', aac:'audio/aac', flac:'audio/flac',
  txt:'text/plain; charset=utf-8', csv:'text/csv; charset=utf-8',
};
const BLOCKED_EXT = new Set([
  'exe','dll','com','bat','cmd','msi','scr','cpl','jar','app','apk','deb','rpm','dmg','pkg','bin',
  'sh','bash','zsh','ps1','psm1','vbs','vbe','wsf','wsh','js','mjs','cjs','jse',
  'php','phtml','phar','asp','aspx','jsp','jspx','cgi','pl','py','rb','lnk','reg','hta','gadget','htaccess',
]);
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 Go / fichier (garde-fou serveur)

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}
function baseName(path: string): string {
  return path.split('/').pop() || '';
}
/* Nom de fichier sûr : longueur, pas de caractères de contrôle, pas de séparateur */
function safeFilename(name: string): boolean {
  if (!name || name.length > 255) return false;
  if (/[\x00-\x1f\x7f]/.test(name)) return false; // caractères de contrôle
  if (name.includes('/') || name.includes('\\')) return false;
  if (name === '.' || name === '..') return false;
  return true;
}
/* Paramètres GET sécurisés : inline pour les formats prévisualisables, sinon
   téléchargement forcé + Content-Type neutralisé → un fichier actif (html/svg/…)
   ne peut jamais s'exécuter en s'ouvrant depuis le bucket. */
function buildGetParams(path: string) {
  const fname = baseName(path);
  const ext = extOf(fname);
  if (INLINE_SAFE_EXT.has(ext)) {
    return {
      Bucket: B2_BUCKET, Key: path,
      ResponseContentType: INLINE_MIME[ext] || 'application/octet-stream',
      ResponseContentDisposition: 'inline',
    };
  }
  const safeName = fname.replace(/[\r\n"\\]/g, '_');
  return {
    Bucket: B2_BUCKET, Key: path,
    ResponseContentType: 'application/octet-stream',
    ResponseContentDisposition: 'attachment; filename="' + safeName + '"',
  };
}

// ── Auth helper ──
async function getUser(req: Request) {
  const auth = req.headers.get('Authorization');
  if (!auth) { console.error('[b2-auth] No Authorization header'); return null; }
  // Use service role key so getUser() always has full access to verify any JWT
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!;
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    serviceKey,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false } }
  );
  const { data: { user }, error } = await sb.auth.getUser();
  if (error) console.error('[b2-auth] getUser error:', error.message, '| status:', error.status);
  return error ? null : user;
}

/* Vérifie que l'utilisateur a accès à ce show (propriétaire OU membre).
   Cache le résultat dans une Map pour éviter de re-requêter à chaque appel. */
async function userCanAccessShow(userId: string, showId: string, _cache: Map<string, boolean>): Promise<boolean> {
  if (!showId || typeof showId !== 'string') return false;
  // Validation UUID basique (évite injection SQL via showId malformé)
  if (!UUID_RE.test(showId)) return false;
  const key = userId + ':' + showId;
  if (_cache.has(key)) return _cache.get(key)!;
  const sbAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  // Propriétaire ?
  const { data: ownerRow } = await sbAdmin
    .from('shows').select('id').eq('id', showId).eq('owner_id', userId).maybeSingle();
  if (ownerRow) { _cache.set(key, true); return true; }
  // Membre ?
  const { data: memberRow } = await sbAdmin
    .from('show_members').select('show_id').eq('show_id', showId).eq('user_id', userId).maybeSingle();
  const ok = !!memberRow;
  _cache.set(key, ok);
  return ok;
}

/* Extrait le showId du début d'une clé B2 (format: "showId/...") */
function extractShowId(path: string): string | null {
  if (!path || typeof path !== 'string') return null;
  const m = path.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i);
  return m ? m[1] : null;
}

// ── Response helpers ──
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json();
    const { action } = body;

    /* ── Action publique : signed URL pour les fichiers d'un rider partagé ──
       Pas d'authentification requise, mais on vérifie que :
       1. Le showId fourni a bien un rider actif (stage_data.rider existe)
       2. Le path demandé fait partie des fichiers autorisés du rider
       Cela permet aux destinataires d'un lien partagé de télécharger
       les pièces jointes sans avoir de compte. */
    if (action === 'public-rider-file') {
      const { path, showId, linkId } = body as { path: string; showId: string; linkId?: string };
      if (!path || !showId || !UUID_RE.test(showId)) {
        return json({ error: 'Paramètres invalides' }, 400);
      }
      // Vérifier que le path commence bien par showId/
      if (!path.startsWith(showId + '/')) {
        return json({ error: 'Chemin non autorisé' }, 403);
      }
      const sbAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      // Autorisation : soit via un lien Pro nommé (show_riders.id = linkId), soit
      // via le rider legacy stocké dans shows.stage_data.rider. Dans les deux cas,
      // le fichier est autorisé si la section "cloud" est partagée OU si le path
      // figure explicitement dans la liste des fichiers du lien.
      let fileAllowed = false;
      if (linkId && UUID_RE.test(linkId)) {
        const { data: rider } = await sbAdmin
          .from('show_riders').select('show_id, sections, config').eq('id', linkId).maybeSingle();
        if (rider && rider.show_id === showId) {
          const cloudShared = (rider.sections || []).includes('cloud');
          const allowedFiles: string[] = rider.config?.files || [];
          const stageImg: string = rider.config?.stage_image || '';
          fileAllowed = cloudShared || allowedFiles.includes(path) || stageImg === path;
        }
      } else {
        const { data: showRow } = await sbAdmin
          .from('shows').select('stage_data').eq('id', showId).maybeSingle();
        const rider = showRow?.stage_data?.rider;
        if (rider) {
          const cloudShared = (rider.sections || []).includes('cloud');
          fileAllowed = cloudShared || (rider.files || []).includes(path) || rider.stage_image === path;
        }
      }
      if (!fileAllowed) return json({ error: 'Fichier non autorisé' }, 403);
      // GET sécurisé (inline pour images/pdf/av, téléchargement forcé sinon).
      // Important côté public : un destinataire non authentifié ne doit jamais
      // pouvoir exécuter un html/svg piégé hébergé sur le bucket.
      const cmd = new GetObjectCommand(buildGetParams(path));
      const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
      return json({ data: { signedUrl: url }, error: null });
    }

    /* ── Action publique : lister les fichiers d'un show partagé avec cloud:true ── */
    /* ── public-cloud-list : lecture depuis Supabase (vue partagée, sans auth) ── */
    if (action === 'public-cloud-list') {
      const { prefix, showId, linkId } = body as { prefix: string; showId: string; linkId?: string };
      if (!showId || !UUID_RE.test(showId)) return json({ error: 'showId invalide' }, 400);
      if (!prefix.startsWith(showId + '/')) return json({ error: 'Préfixe non autorisé' }, 403);
      const sbAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      // Vérifier que le cloud est bien partagé : soit via un lien Pro nommé
      // (show_riders.id = linkId avec "cloud" dans ses sections), soit via le
      // rider legacy (shows.stage_data.rider.sections).
      let cloudOk = false;
      if (linkId && UUID_RE.test(linkId)) {
        const { data: rider } = await sbAdmin
          .from('show_riders').select('show_id, sections').eq('id', linkId).maybeSingle();
        cloudOk = !!rider && rider.show_id === showId && (rider.sections || []).includes('cloud');
      } else {
        const { data: showRow } = await sbAdmin
          .from('shows').select('stage_data').eq('id', showId).maybeSingle();
        cloudOk = (showRow?.stage_data?.rider?.sections || []).includes('cloud');
      }
      if (!cloudOk) return json({ error: 'Accès cloud non autorisé pour ce show' }, 403);
      // Lire depuis show_files — dossier courant + sous-dossiers dérivés
      const folder = prefix.slice(showId.length + 1).replace(/\/$/, '');
      // 1. Fichiers directs + lignes de dossiers explicites
      const { data: directRows, error: e1 } = await sbAdmin
        .from('show_files')
        .select('id, name, folder, size, is_folder, created_at, path')
        .eq('show_id', showId)
        .eq('folder', folder)
        .order('name', { ascending: true });
      if (e1) return json({ error: e1.message }, 500);
      const directFiles = (directRows ?? []).filter((r) => !r.is_folder);
      const explicitFolders: string[] = (directRows ?? []).filter((r) => r.is_folder).map((r) => r.name);
      // 2. Descendants → dériver sous-dossiers immédiats
      const childPrefix = folder ? folder + '/' : '';
      let q = sbAdmin.from('show_files').select('folder').eq('show_id', showId).eq('is_folder', false);
      q = childPrefix ? q.like('folder', childPrefix + '%') : q.neq('folder', '');
      const { data: descRows } = await q;
      const subSet = new Set<string>(explicitFolders);
      (descRows ?? []).forEach((r) => {
        if (!r.folder) return;
        const seg = r.folder.slice(childPrefix.length).split('/')[0];
        if (seg) subSet.add(seg);
      });
      const folders = [...subSet].sort().map((name) => ({
        name, id: null, metadata: { size: 0 }, created_at: null,
        _path: showId + '/' + childPrefix + name, _isFolder: true,
      }));
      const files = directFiles.map((r) => ({
        name: r.name, id: r.id, metadata: { size: r.size ?? 0 },
        created_at: r.created_at, _path: r.path, _isFolder: false,
      }));
      return json({ data: [...folders, ...files], error: null });
    }

    const user = await getUser(req);
    if (!user) return json({ error: 'Unauthorized — session token invalid or missing' }, 401);

    // Cache de validation d'accès pour réduire les requêtes DB sur les actions multi-paths
    const accessCache = new Map<string, boolean>();
    const deny = () => json({ error: 'Forbidden — access denied to this show' }, 403);
    const checkPath = async (p: string): Promise<boolean> => {
      const sid = extractShowId(p);
      if (!sid) return false;
      return userCanAccessShow(user.id, sid, accessCache);
    };

    // ── list : lecture depuis Supabase show_files (plus rapide que B2) ──
    if (action === 'list') {
      const { prefix } = body as { prefix: string };
      if (!prefix || !(await checkPath(prefix))) return deny();
      const showId = extractShowId(prefix);
      if (!showId) return deny();
      // Dossier courant = partie après showId/ sans slash final
      const folder = prefix.slice(showId.length + 1).replace(/\/$/, '');
      const sbAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      const { data: rows, error: sfErr } = await sbAdmin
        .from('show_files')
        .select('id, path, name, folder, size, content_type, is_folder, created_at')
        .eq('show_id', showId)
        .eq('folder', folder)
        .not('path', 'like', '%/node-icons/%')   // exclure les assets internes
        .order('is_folder', { ascending: false })
        .order('name', { ascending: true });
      if (sfErr) return json({ error: sfErr.message }, 500);
      const data = (rows ?? []).map((r) => ({
        name:       r.name,
        id:         r.is_folder ? null : r.id,
        metadata:   { size: r.size ?? 0 },
        created_at: r.created_at,
        _path:      r.path,
        _isFolder:  r.is_folder,
      }));
      return json({ data, error: null });
    }

    // ── list-b2-raw : vrai listing S3 (fallback/backfill des fichiers pré-migration) ──
    if (action === 'list-b2-raw') {
      const { prefix } = body as { prefix: string };
      if (!prefix || !(await checkPath(prefix))) return deny();
      const cmd = new ListObjectsV2Command({
        Bucket: B2_BUCKET,
        Prefix: prefix,
        Delimiter: '/',
      });
      const resp = await s3.send(cmd);
      const folders = (resp.CommonPrefixes ?? []).map((p) => ({
        name: p.Prefix!.slice(prefix.length).replace(/\/$/, ''),
        id: null,
        metadata: null,
        created_at: null,
      }));
      const files = (resp.Contents ?? [])
        .filter((o) => {
          const name = o.Key!.slice(prefix.length);
          return name && !SKIP.has(name);
        })
        .map((o) => ({
          name: o.Key!.slice(prefix.length),
          id: o.ETag ?? o.Key,
          metadata: { size: o.Size ?? 0 },
          created_at: o.LastModified?.toISOString() ?? null,
        }));
      return json({ data: [...folders, ...files], error: null });
    }

    // ── upload-presigned : return a presigned PUT URL ──
    if (action === 'upload-presigned') {
      const { path, size } = body as { path: string; contentType?: string; size?: number };
      if (!path || !(await checkPath(path))) return deny();
      // Validation chemin / nom de fichier (anti-traversal, anti caractères de contrôle)
      if (path.includes('..') || path.includes('\\') || path.includes('//')) {
        return json({ error: 'Chemin invalide' }, 400);
      }
      const fname = baseName(path);
      if (!safeFilename(fname)) return json({ error: 'Nom de fichier invalide' }, 400);
      const ext = extOf(fname);
      // Bloquer les exécutables / scripts (jamais hébergés)
      if (BLOCKED_EXT.has(ext)) {
        return json({ error: 'Type de fichier non autorisé pour des raisons de sécurité (exécutable ou script).' }, 415);
      }
      // Garde-fou taille
      if (typeof size === 'number' && size > MAX_UPLOAD_BYTES) {
        return json({ error: 'Fichier trop volumineux (max 1 Go par fichier).' }, 413);
      }
      // On IGNORE le content-type client : type sûr imposé par l'extension.
      // (inline pour les formats prévisualisables, octet-stream sinon)
      const safeType = INLINE_MIME[ext] || 'application/octet-stream';
      const cmd = new PutObjectCommand({
        Bucket: B2_BUCKET,
        Key: path,
        ContentType: safeType,
      });
      const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
      // contentType renvoyé : le client DOIT l'utiliser pour le PUT (sinon mismatch de signature)
      return json({ data: { uploadUrl: url, key: path, contentType: safeType }, error: null });
    }

    // ── signed-url : presigned GET for download / view ──
    if (action === 'signed-url') {
      const { path, expiresIn } = body as { path: string; expiresIn?: number };
      if (!path || !(await checkPath(path))) return deny();
      const cmd = new GetObjectCommand(buildGetParams(path));
      // Limiter la durée maximale d'un lien signé à 7 jours
      const exp = Math.min(Math.max(60, expiresIn ?? 3600), 604800);
      const url = await getSignedUrl(s3, cmd, { expiresIn: exp });
      return json({ data: { signedUrl: url }, error: null });
    }

    // ── move (copy + delete) ──
    if (action === 'move') {
      const { fromPath, toPath } = body as { fromPath: string; toPath: string };
      if (!fromPath || !toPath) return deny();
      // Le from ET le to doivent appartenir au même show et au user
      const fromSid = extractShowId(fromPath);
      const toSid = extractShowId(toPath);
      if (!fromSid || fromSid !== toSid) return deny();
      if (!(await userCanAccessShow(user.id, fromSid, accessCache))) return deny();
      await s3.send(new CopyObjectCommand({
        Bucket: B2_BUCKET,
        CopySource: encodeURIComponent(B2_BUCKET + '/' + fromPath),
        Key: toPath,
      }));
      await s3.send(new DeleteObjectCommand({ Bucket: B2_BUCKET, Key: fromPath }));
      return json({ data: {}, error: null });
    }

    // ── delete one or many objects ──
    if (action === 'delete') {
      const { paths } = body as { paths: string[] };
      if (!paths?.length) return json({ data: {}, error: null });
      // Vérifier que chaque path appartient à un show auquel l'user a accès
      for (const p of paths) {
        if (!(await checkPath(p))) return deny();
      }
      if (paths.length === 1) {
        await s3.send(new DeleteObjectCommand({ Bucket: B2_BUCKET, Key: paths[0] }));
      } else {
        await s3.send(new DeleteObjectsCommand({
          Bucket: B2_BUCKET,
          Delete: { Objects: paths.map((k) => ({ Key: k })) },
        }));
      }
      return json({ data: {}, error: null });
    }

    // ── storage-used : total bytes for a show (for storage bar) ──
    if (action === 'storage-used') {
      const { showId } = body as { showId: string };
      if (!showId || !(await userCanAccessShow(user.id, showId, accessCache))) return deny();
      let total = 0;
      let continuationToken: string | undefined;
      do {
        const cmd = new ListObjectsV2Command({
          Bucket: B2_BUCKET,
          Prefix: showId + '/',
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        });
        const resp = await s3.send(cmd);
        (resp.Contents ?? []).forEach((o) => { total += o.Size ?? 0; });
        continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
      } while (continuationToken);
      return json({ data: { bytes: total }, error: null });
    }

    // ── user-storage : total B2 + DB storage for the authenticated user ──
    if (action === 'user-storage') {
      // SÉCURITÉ : ignorer les showIds fournis par le client et requêter
      // uniquement les shows que l'utilisateur POSSÈDE (pas seulement membre).
      const sbAdmin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      const { data: ownedShows } = await sbAdmin
        .from('shows').select('id').eq('owner_id', user.id);
      const showIds = (ownedShows ?? []).map((s: { id: string }) => s.id);
      if (!showIds.length) return json({ data: { b2_bytes: 0, db_bytes: 0, total_bytes: 0 }, error: null });

      // 1. B2 — scan all shows in parallel (max 10 concurrent)
      let b2Bytes = 0;
      const chunkSize = 10;
      for (let i = 0; i < showIds.length; i += chunkSize) {
        const chunk = showIds.slice(i, i + chunkSize);
        const counts = await Promise.all(chunk.map(async (sid) => {
          let bytes = 0;
          let token: string | undefined;
          do {
            const cmd = new ListObjectsV2Command({
              Bucket: B2_BUCKET, Prefix: sid + '/',
              ContinuationToken: token, MaxKeys: 1000,
            });
            const r = await s3.send(cmd);
            (r.Contents ?? []).forEach((o) => { bytes += o.Size ?? 0; });
            token = r.IsTruncated ? r.NextContinuationToken : undefined;
          } while (token);
          return bytes;
        }));
        counts.forEach((n) => { b2Bytes += n; });
      }

      // 2. DB — réutiliser le sbAdmin déjà créé pour la liste des shows

      // shows.synoptique_data + shows.stage_data
      const { data: showsData } = await sbAdmin
        .from('shows')
        .select('synoptique_data, stage_data')
        .in('id', showIds);

      let dbBytes = 0;
      (showsData ?? []).forEach((s: Record<string, unknown>) => {
        if (s.synoptique_data) dbBytes += JSON.stringify(s.synoptique_data).length;
        if (s.stage_data)      dbBytes += JSON.stringify(s.stage_data).length;
      });

      // show_scenes.data
      const { data: scenesData } = await sbAdmin
        .from('show_scenes')
        .select('data')
        .in('show_id', showIds);
      (scenesData ?? []).forEach((sc: Record<string, unknown>) => {
        if (sc.data) dbBytes += JSON.stringify(sc.data).length;
      });

      // channels (estimate 400 bytes each)
      const { count: chCount } = await sbAdmin
        .from('channels')
        .select('id', { count: 'exact', head: true })
        .in('show_id', showIds);
      dbBytes += (chCount ?? 0) * 400;

      return json({ data: { b2_bytes: b2Bytes, db_bytes: dbBytes, total_bytes: b2Bytes + dbBytes }, error: null });
    }

    return json({ error: 'Unknown action: ' + action }, 400);

  } catch (err) {
    console.error('[b2-storage]', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
