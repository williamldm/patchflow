-- ── Parcours d'inscription et d'activation (onglet « Parcours » de l'administration) ──
-- Uniquement des chiffres agrégés, calculés à partir des données déjà nécessaires au service.
-- Aucune nouvelle collecte sur les visiteurs ; seule l'origine de l'inscription (un mot :
-- landing, rider, pdf, direct) est enregistrée dans les métadonnées du compte à sa création.

-- Date d'ajout d'un canal : sert à mesurer l'activation dans les 7 jours suivant l'inscription.
-- Les canaux existants restent sans date (inconnue) ; seuls les nouveaux sont datés.
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE public.channels ALTER COLUMN created_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION public.admin_funnel(p_weeks int DEFAULT 12)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from timestamptz;
  v_out  jsonb;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_from := date_trunc('week', now()) - make_interval(weeks => GREATEST(1, LEAST(p_weeks, 52)) - 1);

  WITH u AS (
    SELECT au.id, au.created_at, au.email_confirmed_at, au.last_sign_in_at,
           date_trunc('week', au.created_at) AS wk,
           COALESCE(au.raw_app_meta_data->>'provider', 'email') AS provider,
           CASE WHEN au.raw_user_meta_data->>'signup_source' IN ('landing', 'rider', 'pdf', 'direct')
                THEN au.raw_user_meta_data->>'signup_source' ELSE 'inconnue' END AS source
      FROM auth.users au
     WHERE au.created_at >= v_from
  ), f AS (
    SELECT u.*,
      (u.email_confirmed_at IS NOT NULL) AS confirmed,
      (u.last_sign_in_at IS NOT NULL) AS logged,
      /* Activation : au moins 5 canaux dans un de ses shows, ajoutés dans les 7 jours (canaux non datés comptés) */
      EXISTS (
        SELECT 1 FROM public.shows s
         WHERE s.owner_id = u.id
           AND (SELECT count(*) FROM public.channels c
                 WHERE c.show_id = s.id AND (c.created_at IS NULL OR c.created_at <= u.created_at + interval '7 days')) >= 5
      ) AS activated,
      /* Activation forte : un lien de partage créé ou un collègue invité dans les 7 jours, ou un membre présent */
      (EXISTS (SELECT 1 FROM public.show_riders r JOIN public.shows s ON s.id = r.show_id
                WHERE s.owner_id = u.id AND r.created_at <= u.created_at + interval '7 days')
       OR EXISTS (SELECT 1 FROM public.show_invites i WHERE i.invited_by = u.id AND i.created_at <= u.created_at + interval '7 days')
       OR EXISTS (SELECT 1 FROM public.show_members m JOIN public.shows s ON s.id = m.show_id WHERE s.owner_id = u.id)
      ) AS strong,
      (u.last_sign_in_at > u.created_at + interval '7 days') AS returned,
      EXISTS (SELECT 1 FROM public.subscriptions sb WHERE sb.user_id = u.id) AS paid,
      CASE WHEN u.provider = 'email' AND u.email_confirmed_at IS NOT NULL
           THEN extract(epoch FROM u.email_confirmed_at - u.created_at) / 3600.0 END AS confirm_h
    FROM u
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'from', v_from,
    'weeks', COALESCE((
      SELECT jsonb_agg(w ORDER BY w->>'week' DESC) FROM (
        SELECT jsonb_build_object(
          'week', to_char(wk, 'YYYY-MM-DD'),
          'mature', wk + interval '14 days' <= now(),
          'signups', count(*),
          'google', count(*) FILTER (WHERE provider = 'google'),
          'confirmed', count(*) FILTER (WHERE confirmed),
          'confirm_med_h', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY confirm_h))::numeric, 1),
          'logged', count(*) FILTER (WHERE logged),
          'activated', count(*) FILTER (WHERE activated),
          'strong', count(*) FILTER (WHERE strong),
          'returned', count(*) FILTER (WHERE returned),
          'paid', count(*) FILTER (WHERE paid)
        ) AS w
        FROM f GROUP BY wk
      ) x), '[]'::jsonb),
    'sources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source', source, 'signups', n, 'confirmed', c, 'activated', a, 'strong', s, 'paid', p) ORDER BY n DESC)
      FROM (SELECT source, count(*) n, count(*) FILTER (WHERE confirmed) c, count(*) FILTER (WHERE activated) a,
                   count(*) FILTER (WHERE strong) s, count(*) FILTER (WHERE paid) p
              FROM f GROUP BY source) y), '[]'::jsonb),
    'total', (SELECT jsonb_build_object(
        'signups', count(*), 'google', count(*) FILTER (WHERE provider = 'google'),
        'confirmed', count(*) FILTER (WHERE confirmed), 'logged', count(*) FILTER (WHERE logged),
        'activated', count(*) FILTER (WHERE activated), 'strong', count(*) FILTER (WHERE strong),
        'returned', count(*) FILTER (WHERE returned), 'paid', count(*) FILTER (WHERE paid),
        'confirm_med_h', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY confirm_h))::numeric, 1))
      FROM f)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_funnel(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_funnel(int) TO authenticated, service_role;
