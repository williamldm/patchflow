import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const UUID_RE = /^[0-9a-f-]{36}$/i;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json() as { showId?: string; linkId?: string };
    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    /* ── Mode Pro : lien nommé depuis show_riders (?link=uuid) ── */
    if (body.linkId) {
      const { linkId } = body;
      if (!UUID_RE.test(linkId)) return json({ error: 'linkId invalide' }, 400);

      const { data: rider } = await sbAdmin
        .from('show_riders')
        .select('id, show_id, name, sections, config')
        .eq('id', linkId)
        .maybeSingle();

      if (!rider) return json({ error: 'Lien introuvable ou expiré' }, 404);

      const { data: show } = await sbAdmin
        .from('shows')
        .select('id, name, venue, show_date, stage_data, synoptique_data')
        .eq('id', rider.show_id)
        .maybeSingle();

      if (!show) return json({ error: 'Show introuvable' }, 404);

      const { data: channels } = await sbAdmin
        .from('channels').select('*').eq('show_id', rider.show_id).order('ch');

      return json({
        data: {
          show,
          channels: channels || [],
          riderName: rider.name,
          /* Le config du lien nommé prime sur stage_data.rider */
          overrideRider: {
            sections: rider.sections,
            ...(rider.config || {}),
          },
        },
        error: null,
      });
    }

    /* ── Mode legacy : lien unique (?rider=showId) ── */
    const { showId } = body;
    if (!showId || !UUID_RE.test(showId)) return json({ error: 'showId invalide' }, 400);

    const { data: show } = await sbAdmin
      .from('shows')
      .select('id, name, venue, show_date, stage_data, synoptique_data')
      .eq('id', showId)
      .maybeSingle();

    if (!show) return json({ error: 'Show introuvable' }, 404);

    const rider = show.stage_data?.rider;
    if (!rider) return json({ error: "Ce show n'a pas de lien de partage actif" }, 403);

    const { data: channels } = await sbAdmin
      .from('channels').select('*').eq('show_id', showId).order('ch');

    return json({ data: { show, channels: channels || [] }, error: null });

  } catch (e) {
    console.error('[get-shared-show]', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
