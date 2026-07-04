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
      const isUuid = UUID_RE.test(linkId);
      // Code court : alphanumérique, 4 à 32 caractères. Sinon on rejette.
      if (!isUuid && !/^[A-Za-z0-9]{4,32}$/.test(linkId)) {
        return json({ error: 'linkId invalide' }, 400);
      }

      let q = sbAdmin
        .from('show_riders')
        .select('id, show_id, name, sections, config');
      q = isUuid ? q.eq('id', linkId) : q.eq('code', linkId);
      const { data: rider } = await q.maybeSingle();

      if (!rider) return json({ error: 'Lien introuvable ou expiré' }, 404);

      const { show, channels, scenes } = await fetchShowData(sbAdmin, rider.show_id);
      if (!show) return json({ error: 'Show introuvable' }, 404);

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

    const { show, channels, scenes } = await fetchShowData(sbAdmin, showId);
    if (!show) return json({ error: 'Show introuvable' }, 404);

    const rider = show.stage_data?.rider;
    if (!rider) return json({ error: "Ce show n'a pas de lien de partage actif" }, 403);

    // Alléger : retirer les snapshots redondants du rider legacy (cf. supra).
    stripHeavySnapshots(rider, scenes);

    return json({ data: { show, channels, scenes }, error: null });

  } catch (e) {
    console.error('[get-shared-show]', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
