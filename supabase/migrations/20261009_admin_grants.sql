-- ══════════════════════════════════════════════════════════════════
-- Administration : offrir le plan Pro, avec ou sans date de fin
--
-- Un octroi est une ligne de admin_grants (qui, jusqu'à quand, pourquoi, par
-- quel administrateur). Tant qu'il court, profiles.plan = 'pro' et
-- plan_override = true : le webhook de paiement ne touche pas au plan.
--
-- Fin d'un octroi (date passée ou retrait) :
--   - le compte a un abonnement payant en cours → il reste Pro, l'octroi
--     disparaît et le webhook reprend la main ;
--   - sinon → retour au plan gratuit.
-- Les octrois échus sont soldés à trois moments : chaque nuit si pg_cron est
-- installé, à l'ouverture du tableau de bord, et à la connexion du compte
-- concerné (refresh_my_plan).
--
-- Le trigger protect_profile_plan interdit à l'application de modifier
-- profiles.plan. Les fonctions ci-dessous posent, pour la durée de leur
-- transaction, le drapeau « patchflow.plan_write » que le trigger accepte.
-- L'API n'expose aucun moyen de poser ce drapeau : seules ces fonctions,
-- qui vérifient is_app_admin(), le font.
-- À appliquer APRÈS 20261008_admin_dashboard.sql.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.admin_grants (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan       text NOT NULL DEFAULT 'pro',
  expires_at timestamptz,                 -- NULL : sans date de fin
  note       text NOT NULL DEFAULT '',
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_grants_expires_idx ON public.admin_grants (expires_at);

-- RLS activée sans policy : lue et écrite uniquement par les fonctions ci-dessous.
ALTER TABLE public.admin_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_grants FROM PUBLIC, anon, authenticated;

-- ── Trigger de protection : même règle qu'avant, plus le drapeau des fonctions d'administration ──
CREATE OR REPLACE FUNCTION public.protect_profile_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  -- service_role (webhook), connexions directes privilégiées (dashboard,
  -- CLI), écritures faites par un autre trigger et fonctions d'administration
  -- restent libres ; l'application est bridée.
  IF COALESCE(auth.role(), 'anon') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND pg_trigger_depth() <= 1
     AND COALESCE(current_setting('patchflow.plan_write', true), '') <> 'on' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.plan := 'free';
      NEW.plan_override := false;
    ELSE
      NEW.plan := OLD.plan;
      NEW.plan_override := OLD.plan_override;
    END IF;
    SELECT email INTO v_email FROM auth.users WHERE id = NEW.id;
    IF v_email IS NOT NULL THEN
      NEW.email := v_email;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Fin d'un octroi : interne, jamais appelée par l'API ──
CREATE OR REPLACE FUNCTION public._admin_end_grant(p_user uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_paid boolean;
  v_plan text;
BEGIN
  DELETE FROM public.admin_grants WHERE user_id = p_user;
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = p_user
      AND (s.status IN ('active', 'on_trial') OR (s.status = 'cancelled' AND s.ends_at > now()))
  ) INTO v_paid;
  v_plan := CASE WHEN v_paid THEN 'pro' ELSE 'free' END;
  PERFORM set_config('patchflow.plan_write', 'on', true);
  UPDATE public.profiles SET plan = v_plan, plan_override = false WHERE id = p_user;
  PERFORM set_config('patchflow.plan_write', '', true);
  RETURN v_plan;
END;
$$;

-- ── Solde tous les octrois échus : interne (pg_cron, tableau de bord) ──
CREATE OR REPLACE FUNCTION public._admin_expire_grants()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_n  int := 0;
BEGIN
  FOR v_id IN SELECT user_id FROM public.admin_grants WHERE expires_at IS NOT NULL AND expires_at <= now() LOOP
    PERFORM public._admin_end_grant(v_id);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ── Offrir le Pro (ou prolonger) : p_until NULL = sans date de fin ──
CREATE OR REPLACE FUNCTION public.admin_grant_pro(p_user uuid, p_until timestamptz DEFAULT NULL, p_note text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_until IS NOT NULL AND p_until <= now() THEN
    RAISE EXCEPTION 'date_passee' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user) THEN
    RAISE EXCEPTION 'compte_introuvable' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.admin_grants (user_id, plan, expires_at, note, granted_by, granted_at)
  VALUES (p_user, 'pro', p_until, left(COALESCE(p_note, ''), 300), auth.uid(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET expires_at = EXCLUDED.expires_at, note = EXCLUDED.note,
        granted_by = EXCLUDED.granted_by, granted_at = EXCLUDED.granted_at;

  PERFORM set_config('patchflow.plan_write', 'on', true);
  UPDATE public.profiles SET plan = 'pro', plan_override = true WHERE id = p_user;
  PERFORM set_config('patchflow.plan_write', '', true);

  RETURN jsonb_build_object('ok', true, 'plan', 'pro', 'expires_at', p_until);
END;
$$;

-- ── Retirer le Pro offert ──
CREATE OR REPLACE FUNCTION public.admin_revoke_pro(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('ok', true, 'plan', public._admin_end_grant(p_user));
END;
$$;

-- ── Octrois et échéances : pour le tableau de bord ──
--   grants   : tous les octrois en cours, avec leur date de fin
--   upcoming : ce qui arrive dans les 60 jours (fins d'octroi, fins d'abonnements résiliés, renouvellements)
CREATE OR REPLACE FUNCTION public.admin_grants_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r jsonb;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public._admin_expire_grants();

  SELECT jsonb_build_object(
    'grants', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.expires_at NULLS LAST)
      FROM (
        SELECT g.user_id, u.email, p.full_name, g.expires_at, g.note, g.granted_at, a.email AS granted_by
        FROM public.admin_grants g
        LEFT JOIN auth.users u ON u.id = g.user_id
        LEFT JOIN public.profiles p ON p.id = g.user_id
        LEFT JOIN auth.users a ON a.id = g.granted_by
      ) x
    ), '[]'::jsonb),
    'upcoming', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.at)
      FROM (
        SELECT 'grant_end' AS kind, g.user_id, u.email, p.full_name, g.expires_at AS at
          FROM public.admin_grants g
          LEFT JOIN auth.users u ON u.id = g.user_id
          LEFT JOIN public.profiles p ON p.id = g.user_id
         WHERE g.expires_at BETWEEN now() AND now() + interval '60 days'
        UNION ALL
        SELECT 'sub_end', s.user_id, u.email, p.full_name, s.ends_at
          FROM public.subscriptions s
          LEFT JOIN auth.users u ON u.id = s.user_id
          LEFT JOIN public.profiles p ON p.id = s.user_id
         WHERE s.status = 'cancelled' AND s.ends_at BETWEEN now() AND now() + interval '60 days'
        UNION ALL
        SELECT 'sub_renew', s.user_id, u.email, p.full_name, s.renews_at
          FROM public.subscriptions s
          LEFT JOIN auth.users u ON u.id = s.user_id
          LEFT JOIN public.profiles p ON p.id = s.user_id
         WHERE s.status IN ('active', 'on_trial') AND s.renews_at BETWEEN now() AND now() + interval '60 days'
        ORDER BY 5
        LIMIT 300
      ) x
    ), '[]'::jsonb)
  ) INTO r;
  RETURN r;
END;
$$;

-- ── À la connexion : solde son propre octroi s'il est échu, et renvoie le plan à jour ──
CREATE OR REPLACE FUNCTION public.refresh_my_plan()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'free';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_grants
              WHERE user_id = auth.uid() AND expires_at IS NOT NULL AND expires_at <= now()) THEN
    PERFORM public._admin_end_grant(auth.uid());
  END IF;
  SELECT plan INTO v_plan FROM public.profiles WHERE id = auth.uid();
  RETURN COALESCE(v_plan, 'free');
END;
$$;

REVOKE EXECUTE ON FUNCTION public._admin_end_grant(uuid)                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._admin_expire_grants()                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_grant_pro(uuid, timestamptz, text)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_pro(uuid)                     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_grants_overview()                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.refresh_my_plan()                          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_grant_pro(uuid, timestamptz, text)   TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.admin_revoke_pro(uuid)                     TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.admin_grants_overview()                    TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.refresh_my_plan()                          TO authenticated, service_role;

-- Solde nocturne des octrois échus, si pg_cron est installé (sinon : tableau de bord et connexion suffisent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'patchflow_expire_grants';
    PERFORM cron.schedule('patchflow_expire_grants', '15 3 * * *', 'SELECT public._admin_expire_grants()');
  END IF;
END $$;
