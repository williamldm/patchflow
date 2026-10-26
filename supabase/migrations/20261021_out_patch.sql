-- ── Enregistrement par input list de shows.out_data ──
-- out_data = { <id de l'input list> : [sorties] }. Avant, l'app renvoyait l'objet entier : deux membres
-- qui modifiaient les sorties de deux groupes différents (mode festival) s'effaçaient mutuellement.
-- Désormais seules les listes modifiées sont envoyées et fusionnées. Même principe que pf_stage_patch :
-- SECURITY INVOKER (règles RLS de shows inchangées), une clé envoyée à null est retirée.

CREATE OR REPLACE FUNCTION public.pf_out_patch(p_show uuid, p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'out_patch: objet attendu' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shows
     SET out_data = (CASE WHEN jsonb_typeof(out_data) = 'object' THEN out_data ELSE '{}'::jsonb END || p_patch)
                    - COALESCE((SELECT array_agg(key) FROM jsonb_each(p_patch) WHERE jsonb_typeof(value) = 'null'), '{}'::text[])
   WHERE id = p_show;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'out_patch: show introuvable ou non modifiable' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.pf_out_patch(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pf_out_patch(uuid, jsonb) TO authenticated;
