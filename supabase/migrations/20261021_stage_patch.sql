-- ── Enregistrement par rubrique de shows.stage_data ──
-- Avant : chaque module (racks, HF, feuille de route, plans, rider…) renvoyait TOUT stage_data
-- tel que chargé sur l'appareil. Deux membres (ou deux appareils) qui travaillaient sur des
-- rubriques différentes s'effaçaient mutuellement leurs modifications, sans message.
-- Désormais l'app n'envoie que les rubriques modifiées ; la base les fusionne avec l'existant.
-- SECURITY INVOKER : les règles RLS de shows s'appliquent telles quelles (qui peut modifier quoi).
-- Une rubrique envoyée à null est retirée.

CREATE OR REPLACE FUNCTION public.pf_stage_patch(p_show uuid, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'stage_patch: objet attendu' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shows
     SET stage_data = (COALESCE(stage_data, '{}'::jsonb) || p_patch)
                      - COALESCE((SELECT array_agg(key) FROM jsonb_each(p_patch) WHERE jsonb_typeof(value) = 'null'), '{}'::text[])
   WHERE id = p_show;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stage_patch: show introuvable ou non modifiable' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.pf_stage_patch(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pf_stage_patch(uuid, jsonb) TO authenticated;
