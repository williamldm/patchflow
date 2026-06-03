import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* Retourne les données publiques d'un show partagé (rider actif requis).
   Utilise le service role pour bypasser les RLS — mais ne retourne
   que les champs nécessaires à la vue de lecture seule. */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { showId } = await req.json() as { showId?: string };

    if (!showId || !/^[0-9a-f-]{36}$/i.test(showId)) {
      return json({ error: 'showId invalide' }, 400);
    }

    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Vérifier que le show existe ET qu'il a un rider actif
    const { data: show } = await sbAdmin
      .from('shows')
      .select('id, name, venue, show_date, stage_data, synoptique_data')
      .eq('id', showId)
      .maybeSingle();

    if (!show) return json({ error: 'Show introuvable' }, 404);

    // Un rider doit exister pour que le show soit partageable
    const rider = show.stage_data?.rider;
    if (!rider) return json({ error: 'Ce show n\'a pas de lien de partage actif' }, 403);

    // Récupérer les canaux
    const { data: channels } = await sbAdmin
      .from('channels')
      .select('*')
      .eq('show_id', showId)
      .order('ch');

    return json({ data: { show, channels: channels || [] }, error: null });

  } catch (e) {
    console.error('[get-shared-show]', e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
