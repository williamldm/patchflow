import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// UUID v4 strict (évite d'accepter "36 tirets" ou des formats arbitraires)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ── Anti-énumération des codes courts ──
   Les anciens codes (7-8 caractères) pourraient être devinés par force brute.
   On compte les codes inconnus par IP hachée : au-delà de FAIL_LIMIT échecs en
   une heure, l'IP est bloquée. Table absente (migration non appliquée) ou IP
   inconnue → on laisse passer plutôt que de bloquer tout le monde. */
const FAIL_LIMIT = 30;
function clientIp(req: Request): string {
  return (req.headers.get('cf-connecting-ip')
    || req.headers.get('x-real-ip')
    || (req.headers.get('x-forwarded-for') || '').split(',')[0]
    || '').trim().slice(0, 64);
}
async function ipKey(ip: string): Promise<string> {
  const pepper = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pepper + '|' + ip));
  return Array.from(new Uint8Array(buf)).slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function isBlocked(sb: ReturnType<typeof createClient>, key: string): Promise<boolean> {
  if (!key) return false;
  try {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count, error } = await sb.from('share_lookup_failures')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', key).gte('created_at', since);
    if (error) return false;
    return (count ?? 0) >= FAIL_LIMIT;
  } catch { return false; }
}
async function recordFailure(sb: ReturnType<typeof createClient>, key: string) {
  if (!key) return;
  try {
    await sb.from('share_lookup_failures').insert({ ip_hash: key });
    if (Math.random() < 0.05) {
      await sb.from('share_lookup_failures').delete()
        .lt('created_at', new Date(Date.now() - 86400_000).toISOString());
    }
  } catch { /* table absente : ignoré */ }
}

/* Récupère le show, ses canaux, ses patches et ses scènes */
async function fetchShowData(sbAdmin: ReturnType<typeof createClient>, showId: string) {
  const [showRes, channelsRes, scenesRes] = await Promise.all([
    sbAdmin
      .from('shows')
      .select('id, name, venue, show_date, stage_data, synoptique_data, il_patches, out_data')
      .eq('id', showId)
      .maybeSingle(),
    sbAdmin
      .from('channels')
      .select('*')
      .eq('show_id', showId)
      .order('ch'),
    sbAdmin
      .from('show_scenes')
      .select('id, type, name, position, data')
      .eq('show_id', showId)
      .order('position'),
  ]);

  return {
    show: showRes.data,
    channels: channelsRes.data || [],
    scenes: scenesRes.data || [],
  };
}

/* ── Ne renvoyer QUE les sections partagées ──
   Avant, la réponse contenait tout le show (tous les canaux, plans, synoptique,
   sorties) quelles que soient les sections cochées : le filtrage n'était fait
   qu'à l'affichage, donc un lien « Input List seule » exposait l'intégralité du
   show à qui lisait la réponse réseau. */
const ALL_SECTIONS = ['il', 'out', 'syno', 'stage', 'site'];
function scopeToSections(
  show: Record<string, any>,
  channels: unknown[],
  scenes: Array<{ type?: string }>,
  sectionsIn: unknown,
) {
  const list = Array.isArray(sectionsIn) && sectionsIn.length ? sectionsIn : ALL_SECTIONS;
  const sec = new Set(list.map((x) => String(x)));
  const sd = (show.stage_data && typeof show.stage_data === 'object') ? show.stage_data : {};
  const stage_data: Record<string, unknown> = { v: sd.v, planMode: sd.planMode };
  if (sd.rider) stage_data.rider = sd.rider;
  if (sec.has('stage') && sd.band) stage_data.band = sd.band;
  if (sec.has('site') && sd.site) stage_data.site = sd.site;
  // Le plan de scène affiche les numéros/noms de canaux liés aux éléments.
  const needChannels = sec.has('il') || sec.has('stage');
  if (needChannels && sd.chs) stage_data.chs = sd.chs;
  return {
    show: {
      id: show.id, name: show.name, venue: show.venue, show_date: show.show_date,
      stage_data,
      synoptique_data: sec.has('syno') ? show.synoptique_data : null,
      il_patches: needChannels ? show.il_patches : null,
      out_data: sec.has('out') ? show.out_data : null,
    },
    channels: needChannels ? channels : [],
    scenes: (scenes || []).filter((s) => sec.has(String(s.type))),
  };
}

/* Retire les snapshots d'image redondants de la config du lien. Ces snapshots
   (PNG base64, souvent plusieurs Mo) ne sont qu'un SECOURS : quand les données
   de scène existent, la vue rider redessine le plan à partir d'elles. Les
   envoyer alourdit énormément la réponse (ex. site_snapshot de 10 Mo). */
function stripHeavySnapshots(cfg: Record<string, unknown> | null | undefined,
                            scenes: Array<{ type?: string; data?: unknown }>) {
  if (!cfg) return cfg;
  const hasData = (type: string) =>
    (scenes || []).some((s) => s.type === type && s.data && typeof s.data === 'object'
      && Object.keys(s.data as Record<string, unknown>).length > 0);
  if (hasData('site'))  delete cfg.site_snapshot;
  if (hasData('syno'))  delete cfg.syn_snapshot;
  if (hasData('stage')) delete cfg.stage_image;
  return cfg;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json() as { showId?: string; linkId?: string };
    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    /* ── Mode Pro : lien nommé depuis show_riders ──
       Accepte soit un code court (?link=k7m3p9q), soit un UUID complet
       (?link=uuid) pour rester compatible avec les liens déjà partagés. */
    if (body.linkId) {
      const { linkId } = body;
      if (typeof linkId !== 'string') return json({ error: 'linkId invalide' }, 400);
      const isUuid = UUID_RE.test(linkId);
      // Code court : alphanumérique, 4 à 32 caractères. Sinon on rejette.
      if (!isUuid && !/^[A-Za-z0-9]{4,32}$/.test(linkId)) {
        return json({ error: 'linkId invalide' }, 400);
      }
      // Pas d'IP exploitable → pas de limite (sinon toutes les requêtes sans IP partageraient un même compteur).
      const ip = clientIp(req);
      const ipK = (isUuid || !ip) ? '' : await ipKey(ip).catch(() => '');
      if (await isBlocked(sbAdmin, ipK)) {
        return json({ error: 'Trop de tentatives. Réessayez dans une heure.' }, 429);
      }

      let q = sbAdmin
        .from('show_riders')
        .select('id, show_id, name, sections, config');
      q = isUuid ? q.eq('id', linkId) : q.eq('code', linkId);
      const { data: rider } = await q.maybeSingle();

      if (!rider) {
        await recordFailure(sbAdmin, ipK);
        return json({ error: 'Lien introuvable ou expiré' }, 404);
      }

      const full = await fetchShowData(sbAdmin, rider.show_id);
      if (!full.show) return json({ error: 'Show introuvable' }, 404);
      const { show, channels, scenes } = scopeToSections(full.show, full.channels, full.scenes, rider.sections);

      return json({
        data: {
          show,
          channels,
          scenes,
          riderName: rider.name,
          overrideRider: {
            sections: rider.sections,
            ...(stripHeavySnapshots({ ...(rider.config || {}) }, scenes) || {}),
          },
        },
        error: null,
      });
    }

    /* ── Mode legacy : lien unique (?rider=showId) ── */
    const { showId } = body;
    if (!showId || !UUID_RE.test(showId)) return json({ error: 'showId invalide' }, 400);

    const full = await fetchShowData(sbAdmin, showId);
    if (!full.show) return json({ error: 'Show introuvable' }, 404);

    const rider = full.show.stage_data?.rider;
    if (!rider) return json({ error: "Ce show n'a pas de lien de partage actif" }, 403);

    const { show, channels, scenes } = scopeToSections(full.show, full.channels, full.scenes, rider.sections);
    // Alléger : retirer les snapshots redondants du rider legacy (cf. supra).
    stripHeavySnapshots(show.stage_data.rider as Record<string, unknown>, scenes);

    return json({ data: { show, channels, scenes }, error: null });

  } catch (e) {
    console.error('[get-shared-show]', e);
    return json({ error: 'Erreur serveur' }, 500);  // détail dans les logs, pas dans la réponse publique
  }
});
