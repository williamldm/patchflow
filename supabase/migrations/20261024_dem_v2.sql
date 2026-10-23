-- ── Demande au loueur, v2 : suivi de l'échange et réponse complète ──
-- Clés de stage_data utilisées (écrites par l'app sauf mention) :
--   demlink  {token, snap, ok}      demande publiée ; ok = {v, at} quand le technicien a validé la réponse
--   demreply                         réponse du loueur (pf_dem_reply)
--   demseen  {v, at}                 première consultation de la version en cours (pf_dem_seen)
--   demconf  {v, at, name}           réservation confirmée par le loueur (pf_dem_confirm), après validation
-- Toutes les fonctions publiques exigent un jeton de lien valide et ne lisent ni n'écrivent rien d'autre.

CREATE OR REPLACE FUNCTION public.pf_dem_get(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE r record;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
  SELECT stage_data->'demlink' AS link, stage_data->'demreply' AS reply, stage_data->'demconf' AS conf INTO r
    FROM public.shows WHERE stage_data->'demlink'->>'token' = p_token LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('snap', r.link->'snap', 'ok', r.link->'ok', 'reply', r.reply, 'conf', r.conf);
END;
$$;

CREATE OR REPLACE FUNCTION public.pf_dem_seen(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid; v_v jsonb; v_seen jsonb;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN; END IF;
  SELECT id, stage_data->'demlink'->'snap'->'v', stage_data->'demseen' INTO v_id, v_v, v_seen
    FROM public.shows WHERE stage_data->'demlink'->>'token' = p_token LIMIT 1;
  IF NOT FOUND OR (v_seen IS NOT NULL AND v_seen->'v' = v_v) THEN RETURN; END IF;
  UPDATE public.shows SET stage_data = stage_data || jsonb_build_object('demseen',
    jsonb_build_object('v', v_v, 'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))) WHERE id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.pf_dem_reply(p_token text, p_reply jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid; v_snap jsonb; v_lines jsonb := '{}'::jsonb; v_extra jsonb := '[]'::jsonb; l jsonb; x jsonb; k text; s text; out jsonb; n int := 0;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'dem_reply: lien invalide' USING ERRCODE = '22023';
  END IF;
  IF p_reply IS NULL OR jsonb_typeof(p_reply) <> 'object' OR length(p_reply::text) > 150000 THEN
    RAISE EXCEPTION 'dem_reply: réponse invalide' USING ERRCODE = '22023';
  END IF;
  SELECT id, stage_data->'demlink'->'snap' INTO v_id, v_snap
    FROM public.shows WHERE stage_data->'demlink'->>'token' = p_token LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dem_reply: lien inconnu ou désactivé' USING ERRCODE = '42501'; END IF;
  -- Une réponse par ligne de la demande publiée ; qa = quantité demandée au moment de la réponse
  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(v_snap->'lines', '[]'::jsonb)) LOOP
    k := l->>'k';
    x := p_reply->'lines'->k;
    IF k IS NULL OR x IS NULL OR jsonb_typeof(x) <> 'object' THEN CONTINUE; END IF;
    s := x->>'s';
    IF s NOT IN ('ok','alt','part','no','tbc') THEN CONTINUE; END IF;
    v_lines := v_lines || jsonb_build_object(k, jsonb_strip_nulls(jsonb_build_object(
      's', s,
      'q', CASE WHEN (x->>'q') ~ '^\d{1,4}$' THEN (x->>'q')::int END,
      'qa', CASE WHEN (l->>'qty') ~ '^\d{1,5}$' THEN (l->>'qty')::int END,
      'alt', CASE WHEN s = 'alt' THEN NULLIF(left(btrim(COALESCE(x->>'alt','')), 120), '') END,
      'c', NULLIF(left(btrim(COALESCE(x->>'c','')), 300), ''))));
  END LOOP;
  -- Lignes ajoutées par le loueur (câblage, spares…)
  IF jsonb_typeof(p_reply->'extra') = 'array' THEN
    FOR x IN SELECT * FROM jsonb_array_elements(p_reply->'extra') LOOP
      EXIT WHEN n >= 40;
      IF jsonb_typeof(x) <> 'object' OR btrim(COALESCE(x->>'n','')) = '' THEN CONTINUE; END IF;
      v_extra := v_extra || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'n', left(btrim(x->>'n'), 120),
        'q', CASE WHEN (x->>'q') ~ '^\d{1,4}$' AND (x->>'q')::int > 0 THEN (x->>'q')::int ELSE 1 END,
        'c', NULLIF(left(btrim(COALESCE(x->>'c','')), 200), ''))));
      n := n + 1;
    END LOOP;
  END IF;
  out := jsonb_strip_nulls(jsonb_build_object(
    'lines', v_lines,
    'extra', CASE WHEN jsonb_array_length(v_extra) > 0 THEN v_extra END,
    'name', NULLIF(left(btrim(COALESCE(p_reply->>'name','')), 80), ''),
    'contact', NULLIF(left(btrim(COALESCE(p_reply->>'contact','')), 120), ''),
    'quote', NULLIF(left(btrim(COALESCE(p_reply->>'quote','')), 60), ''),
    'note', NULLIF(left(btrim(COALESCE(p_reply->>'note','')), 2000), ''),
    'v', CASE WHEN (v_snap->>'v') ~ '^\d{1,6}$' THEN (v_snap->>'v')::int END,
    'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  UPDATE public.shows SET stage_data = COALESCE(stage_data, '{}'::jsonb) || jsonb_build_object('demreply', out) WHERE id = v_id;
  RETURN out;
END;
$$;

-- Réservation confirmée par le loueur : seulement quand le technicien a validé la réponse de la version en cours
CREATE OR REPLACE FUNCTION public.pf_dem_confirm(p_token text, p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid; v_link jsonb; out jsonb;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'dem_confirm: lien invalide' USING ERRCODE = '22023';
  END IF;
  SELECT id, stage_data->'demlink' INTO v_id, v_link
    FROM public.shows WHERE stage_data->'demlink'->>'token' = p_token LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dem_confirm: lien inconnu ou désactivé' USING ERRCODE = '42501'; END IF;
  IF v_link->'ok' IS NULL OR v_link->'ok'->'v' IS DISTINCT FROM v_link->'snap'->'v' THEN
    RAISE EXCEPTION 'dem_confirm: la demande n''est pas encore validée par le technicien' USING ERRCODE = '42501';
  END IF;
  out := jsonb_strip_nulls(jsonb_build_object('v', v_link->'snap'->'v', 'name', NULLIF(left(btrim(COALESCE(p_name,'')), 80), ''),
    'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  UPDATE public.shows SET stage_data = stage_data || jsonb_build_object('demconf', out) WHERE id = v_id;
  RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public.pf_dem_seen(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pf_dem_confirm(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pf_dem_get(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pf_dem_reply(text, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pf_dem_seen(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pf_dem_confirm(text, text) TO anon, authenticated;
