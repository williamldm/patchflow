-- ── Offre Gratuite élargie (22/10/2026) ──
-- Nouvelles limites du plan Gratuit, décidées avec le propriétaire du service :
--   8 shows actifs, 48 canaux par show, 3 collaborateurs par show, 10 liens nommés,
--   3 exports par mois (consoles et Wireless Workbench), 3 sessions contrôlées par mois (bon du loueur).
-- Les comptes Pro ne sont pas limités. Les fonctions de 20261020_plan_limits.sql sont remplacées
-- avec les nouveaux chiffres (mêmes noms, mêmes déclencheurs).

CREATE OR REPLACE FUNCTION public.pf_limit_shows()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_plan text; v_n int;
BEGIN
  IF public.pf_is_privileged() THEN RETURN NEW; END IF;
  SELECT plan INTO v_plan FROM public.profiles WHERE id = NEW.owner_id;
  IF COALESCE(v_plan, 'free') = 'pro' THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_n FROM public.shows WHERE owner_id = NEW.owner_id AND deleted_at IS NULL;
  IF v_n >= 8 THEN
    RAISE EXCEPTION 'plan_limit:max_shows' USING ERRCODE = 'check_violation', HINT = 'Le plan Gratuit est limité à 8 shows actifs.';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.pf_limit_channels()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_plan text; v_n int;
BEGIN
  IF public.pf_is_privileged() THEN RETURN NEW; END IF;
  SELECT p.plan INTO v_plan FROM public.shows s JOIN public.profiles p ON p.id = s.owner_id WHERE s.id = NEW.show_id;
  IF COALESCE(v_plan, 'free') = 'pro' THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_n FROM public.channels WHERE show_id = NEW.show_id;
  IF v_n >= 48 THEN
    RAISE EXCEPTION 'plan_limit:max_channels' USING ERRCODE = 'check_violation', HINT = 'Le plan Gratuit est limité à 48 canaux par show.';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.pf_limit_members()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_plan text; v_n int;
BEGIN
  IF public.pf_is_privileged() THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.show_members WHERE show_id = NEW.show_id AND user_id = NEW.user_id) THEN RETURN NEW; END IF;
  SELECT p.plan INTO v_plan FROM public.shows s JOIN public.profiles p ON p.id = s.owner_id WHERE s.id = NEW.show_id;
  IF COALESCE(v_plan, 'free') = 'pro' THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_n FROM public.show_members WHERE show_id = NEW.show_id;
  IF v_n >= 3 THEN
    RAISE EXCEPTION 'plan_limit:max_members' USING ERRCODE = 'check_violation', HINT = 'Le plan Gratuit est limité à 3 collaborateurs par show.';
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.pf_limit_riders()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_owner uuid; v_plan text; v_n int;
BEGIN
  IF public.pf_is_privileged() THEN RETURN NEW; END IF;
  SELECT s.owner_id, p.plan INTO v_owner, v_plan FROM public.shows s LEFT JOIN public.profiles p ON p.id = s.owner_id WHERE s.id = NEW.show_id;
  IF COALESCE(v_plan, 'free') = 'pro' THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_n FROM public.show_riders r JOIN public.shows s ON s.id = r.show_id WHERE s.owner_id = v_owner;
  IF v_n >= 10 THEN
    RAISE EXCEPTION 'plan_limit:max_share_links' USING ERRCODE = 'check_violation', HINT = 'Le plan Gratuit est limité à 10 liens de partage.';
  END IF;
  RETURN NEW;
END; $$;

-- ── Quotas mensuels du plan Gratuit : exports (consoles, Wireless Workbench) et bon du loueur ──
-- Compté par show : 3 shows différents par mois et par type. Un show déjà compté ce mois-ci
-- ne recompte pas (re-télécharger, changer de format ou remplacer un bon reste libre).
CREATE TABLE IF NOT EXISTS public.usage_events (
  id      bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind    text NOT NULL,
  ref     text NOT NULL,
  month   text NOT NULL,
  at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, ref, month)
);
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.usage_events FROM PUBLIC, anon, authenticated;

/* État du quota sans rien consommer : { pro, used, limit, refs } */
CREATE OR REPLACE FUNCTION public.usage_status(p_kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_plan text; v_month text := to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM');
BEGIN
  IF auth.uid() IS NULL OR p_kind NOT IN ('export', 'bon') THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT plan INTO v_plan FROM public.profiles WHERE id = auth.uid();
  RETURN jsonb_build_object(
    'pro', COALESCE(v_plan, 'free') = 'pro', 'limit', 3,
    'used', (SELECT count(*) FROM public.usage_events WHERE user_id = auth.uid() AND kind = p_kind AND month = v_month),
    'refs', COALESCE((SELECT jsonb_agg(ref) FROM public.usage_events WHERE user_id = auth.uid() AND kind = p_kind AND month = v_month), '[]'::jsonb));
END; $$;

/* Consomme le quota pour ce show : ok si Pro, si le show est déjà compté ce mois-ci, ou s'il reste de la place */
CREATE OR REPLACE FUNCTION public.usage_take(p_kind text, p_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_plan text; v_n int; v_month text := to_char(now() AT TIME ZONE 'Europe/Paris', 'YYYY-MM');
BEGIN
  IF auth.uid() IS NULL OR p_kind NOT IN ('export', 'bon') OR COALESCE(p_ref, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;
  SELECT plan INTO v_plan FROM public.profiles WHERE id = auth.uid();
  IF COALESCE(v_plan, 'free') = 'pro' THEN RETURN jsonb_build_object('ok', true, 'pro', true); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('usage:' || auth.uid()::text || ':' || p_kind));
  IF EXISTS (SELECT 1 FROM public.usage_events WHERE user_id = auth.uid() AND kind = p_kind AND ref = left(p_ref, 80) AND month = v_month) THEN
    SELECT count(*) INTO v_n FROM public.usage_events WHERE user_id = auth.uid() AND kind = p_kind AND month = v_month;
    RETURN jsonb_build_object('ok', true, 'used', v_n, 'limit', 3, 'again', true);
  END IF;
  SELECT count(*) INTO v_n FROM public.usage_events WHERE user_id = auth.uid() AND kind = p_kind AND month = v_month;
  IF v_n >= 3 THEN RETURN jsonb_build_object('ok', false, 'used', v_n, 'limit', 3); END IF;
  INSERT INTO public.usage_events (user_id, kind, ref, month) VALUES (auth.uid(), p_kind, left(p_ref, 80), v_month);
  RETURN jsonb_build_object('ok', true, 'used', v_n + 1, 'limit', 3);
END; $$;
REVOKE EXECUTE ON FUNCTION public.usage_status(text), public.usage_take(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usage_status(text), public.usage_take(text, text) TO authenticated, service_role;

-- ── Options de stockage (abonnements Stripe séparés, métadonnée kind = storage) ──
-- Tenue à jour par stripe-webhook ; lue par b2-storage (quota) et par l'app (affichage).
CREATE TABLE IF NOT EXISTS public.storage_addons (
  stripe_subscription_id text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gb         int  NOT NULL CHECK (gb > 0),
  status     text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS storage_addons_user ON public.storage_addons (user_id);
ALTER TABLE public.storage_addons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storage_addons FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.storage_addons TO authenticated;
DROP POLICY IF EXISTS storage_addons_read_own ON public.storage_addons;
CREATE POLICY storage_addons_read_own ON public.storage_addons FOR SELECT TO authenticated USING (user_id = auth.uid());
