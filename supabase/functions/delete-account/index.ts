/**
 * delete-account — Suppression du compte de l'appelant et de ses données.
 *
 * Appelée depuis Paramètres > Compte et sécurité, avec le jeton de l'utilisateur. Corps :
 *   { confirm: "<adresse e-mail du compte>" }   — doit correspondre, sinon refus.
 *
 * Ordre (relançable : une exécution interrompue se termine à l'appel suivant) :
 *  1. refuse si un abonnement payant est encore actif (à résilier d'abord : l'abonnement
 *     reste chez le prestataire de paiement, que cette fonction n'appelle pas) ;
 *  2. supprime dans B2 les fichiers de chaque session dont il est propriétaire ;
 *  3. supprime ses sessions (les lignes liées partent en cascade), ses appartenances à
 *     d'autres sessions, les invitations reçues, sa photo de profil et son profil ;
 *  4. supprime l'utilisateur d'authentification.
 * Les sessions dont il est propriétaire disparaissent pour leurs membres : l'interface le dit.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from 'npm:@aws-sdk/client-s3@3.490.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const _rawEndpoint = Deno.env.get('B2_ENDPOINT') || '';
const B2_ENDPOINT  = _rawEndpoint.startsWith('http') ? _rawEndpoint : 'https://' + _rawEndpoint;
const B2_BUCKET    = Deno.env.get('B2_BUCKET')!;
const s3 = new S3Client({
  endpoint: B2_ENDPOINT,
  region: Deno.env.get('B2_REGION')!,
  credentials: { accessKeyId: Deno.env.get('B2_KEY_ID')!, secretAccessKey: Deno.env.get('B2_APP_KEY')! },
  forcePathStyle: true,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* Statuts d'un abonnement qui facture encore (Lemon Squeezy aujourd'hui, Stripe demain) */
const LIVE = ['active', 'on_trial', 'trialing', 'past_due', 'unpaid', 'paused'];

/* Supprime tous les objets B2 d'un préfixe ; renvoie le nombre supprimé */
async function wipePrefix(prefix: string): Promise<number> {
  let n = 0, token: string | undefined;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: B2_BUCKET, Prefix: prefix, ContinuationToken: token }));
    const keys = (r.Contents ?? []).map((o) => o.Key).filter((k): k is string => !!k);
    for (let i = 0; i < keys.length; i += 1000) {
      const part = keys.slice(i, i + 1000);
      await s3.send(new DeleteObjectsCommand({ Bucket: B2_BUCKET, Delete: { Objects: part.map((Key) => ({ Key })), Quiet: true } }));
      n += part.length;
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return n;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'unauthorized' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: { user }, error: uerr } = await createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: auth } }, auth: { persistSession: false },
    }).auth.getUser();
    if (uerr || !user) return json({ error: 'unauthorized' }, 401);

    let body: { confirm?: string } = {};
    try { body = await req.json(); } catch { /* corps vide */ }
    const email = String(user.email ?? '').toLowerCase();
    if (!email || String(body.confirm ?? '').trim().toLowerCase() !== email) return json({ error: 'confirm_mismatch' }, 400);

    /* 1. Abonnement en cours */
    const { data: subs } = await admin.from('subscriptions').select('status').eq('user_id', user.id);
    if ((subs ?? []).some((s: { status?: string }) => LIVE.includes(String(s.status ?? '').toLowerCase()))) {
      return json({ error: 'active_subscription' }, 409);
    }

    /* 2. Fichiers de ses sessions */
    const { data: shows, error: serr } = await admin.from('shows').select('id').eq('owner_id', user.id);
    if (serr) return json({ error: 'shows_read_failed' }, 500);
    const ids = (shows ?? []).map((s: { id: string }) => s.id);
    let files = 0;
    for (const id of ids) files += await wipePrefix(id + '/');

    /* 3. Lignes de la base */
    if (ids.length) {
      const { error } = await admin.from('shows').delete().in('id', ids);
      if (error) return json({ error: 'shows_delete_failed', detail: error.message }, 500);
    }
    await admin.from('show_members').delete().eq('user_id', user.id);
    /* ilike sans jokers : « _ » et « % » d'une adresse ne doivent pas toucher les invitations d'autres personnes */
    await admin.from('show_invites').delete().ilike('invited_email', email.replace(/[\\%_]/g, (m) => '\\' + m));
    try { await admin.storage.from('avatars').remove([user.id + '/avatar.jpg']); } catch { /* pas de photo */ }
    await admin.from('profiles').delete().eq('id', user.id);

    /* 4. Compte d'authentification */
    const { error: derr } = await admin.auth.admin.deleteUser(user.id);
    if (derr) return json({ error: 'user_delete_failed', detail: derr.message }, 500);

    return json({ ok: true, shows: ids.length, files });
  } catch (e) {
    return json({ error: 'server_error', detail: String((e as Error)?.message ?? e) }, 500);
  }
});
