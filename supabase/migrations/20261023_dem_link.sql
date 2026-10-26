-- ── Lien de demande pour le loueur ──
-- L'app publie la demande de matériel dans shows.stage_data.demlink = {token, snap} (règles RLS habituelles :
-- seul un membre qui peut modifier le show le fait). Le loueur, sans compte, ouvre demande.html#jeton :
--   pf_dem_get(jeton)          -> la demande publiée (rien d'autre du show) et la réponse déjà envoyée
--   pf_dem_reply(jeton, rép.)  -> enregistre sa réponse dans stage_data.demreply, nettoyée et bornée
-- Sans jeton valide, rien n'est lu ni écrit. Désactiver le lien (demlink retiré) ferme l'accès.

CREATE INDEX IF NOT EXISTS shows_demlink_token_idx ON public.shows ((stage_data->'demlink'->>'token'));

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
  SELECT stage_data->'demlink'->'snap' AS snap, stage_data->'demreply' AS reply INTO r
    FROM public.shows WHERE stage_data->'demlink'->>'token' = p_token LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('snap', r.snap, 'reply', r.reply);
END;
$$;

CREATE OR REPLACE FUNCTION public.pf_dem_reply(p_token text, p_reply jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid; v_snap jsonb; v_lines jsonb := '{}'::jsonb; l jsonb; x jsonb; k text; s text; out jsonb;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'dem_reply: lien invalide' USING ERRCODE = '22023';
  END IF;
  IF p_reply IS NULL OR jsonb_typeof(p_reply) <> 'object' OR length(p_reply::text) > 120000 THEN
    RAISE EXCEPTION 'dem_reply: réponse invalide' USING ERRCODE = '22023';
  END IF;
  SELECT id, stage_data->'demlink'->'snap' INTO v_id, v_snap
    FROM public.shows WHERE stage_data->'demlink'->>'token' = p_token LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dem_reply: lien inconnu ou désactivé' USING ERRCODE = '42501'; END IF;
  -- Seules les lignes de la demande publiée sont gardées, avec des valeurs bornées
  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(v_snap->'lines', '[]'::jsonb)) LOOP
    k := l->>'k';
    x := p_reply->'lines'->k;
    IF k IS NULL OR x IS NULL OR jsonb_typeof(x) <> 'object' THEN CONTINUE; END IF;
    s := x->>'s';
    IF s NOT IN ('ok','alt','part','no') THEN CONTINUE; END IF;
    v_lines := v_lines || jsonb_build_object(k, jsonb_strip_nulls(jsonb_build_object(
      's', s,
      'q', CASE WHEN s = 'part' AND (x->>'q') ~ '^\d{1,4}$' THEN (x->>'q')::int END,
      'alt', CASE WHEN s = 'alt' THEN NULLIF(left(btrim(COALESCE(x->>'alt','')), 120), '') END,
      'c', NULLIF(left(btrim(COALESCE(x->>'c','')), 300), ''))));
  END LOOP;
  out := jsonb_strip_nulls(jsonb_build_object(
    'lines', v_lines,
    'name', NULLIF(left(btrim(COALESCE(p_reply->>'name','')), 80), ''),
    'contact', NULLIF(left(btrim(COALESCE(p_reply->>'contact','')), 120), ''),
    'note', NULLIF(left(btrim(COALESCE(p_reply->>'note','')), 2000), ''),
    'v', CASE WHEN (v_snap->>'v') ~ '^\d{1,6}$' THEN (v_snap->>'v')::int END,
    'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
  UPDATE public.shows SET stage_data = COALESCE(stage_data, '{}'::jsonb) || jsonb_build_object('demreply', out) WHERE id = v_id;
  RETURN out;
END;
$$;

REVOKE ALL ON FUNCTION public.pf_dem_get(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pf_dem_reply(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pf_dem_get(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pf_dem_reply(text, jsonb) TO anon, authenticated;
