-- ── Limites du plan Gratuit appliquées par la base ──
-- Jusqu'ici, ces limites n'étaient vérifiées que dans l'interface : un appel direct de l'API
-- (console du navigateur) permettait de les dépasser. Elles reprennent exactement PLAN_PERMS.free
-- de pf-app.js : 3 shows actifs, 26 canaux par show, 1 membre par show, 5 liens nommés.
-- Le plan pris en compte est celui du PROPRIÉTAIRE du show. Les comptes Pro ne sont pas limités.
-- Les connexions directes (tableau de bord, CLI : rôle « none ») et le service_role (fonctions)
-- restent libres. Les lignes existantes ne sont pas touchées : seules les nouvelles insertions
-- au-delà de la limite sont refusées (check_violation, message « plan_limit:… »).

CREATE OR REPLACE FUNCTION public.pf_is_privileged()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(current_setting('role', true), 'none') IN ('none', 'service_role');
$$;

CREATE OR REPLACE FUNCTION public.pf_limit_shows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan text;
  v_n    int;
BEGIN
  IF public.pf_is_privileged() THEN RETURN NEW; END IF;
  SELECT plan INTO v_plan FROM public.profiles WHERE id = NEW.owner_id;
  IF COALESCE(v_plan, 'free') = 'pro' THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_n FROM public.shows WHERE owner_id = NEW.owner_id AND deleted_at IS NULL;
  IF v_n >= 3 THEN
    RAISE EXCEPTION 'plan_limit:max_shows' USING ERRCODE = 'check_violation',
      HINT = 'Le plan Gratuit est limité à 3 shows.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.pf_limit_channels()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan text;
  v_n    int;
BEGIN
  IF public.pf_is_privileged() THEN RETURN NEW; END IF;
  SELECT p.plan INTO v_plan FROM public.shows s JOIN public.profiles p ON p.id = s.owner_id WHERE s.id = NEW.show_id;
  IF COALESCE(v_plan, 'free') = 'pro' THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_n FROM public.channels WHERE show_id = NEW.show_id;
  IF v_n >= 26 THEN
    RAISE EXCEPTION 'plan_limit:max_channels' USING ERRCODE = 'check_violation',
      HINT = 'Le plan Gratuit est limité à 26 canaux par show.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.pf_limit_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan text;
  v_n    int;
BEGIN
  IF public.pf_is_privileged() THEN RETURN NEW; END IF;
  -- Ré-acceptation d'une invitation par un membre déjà présent (ON CONFLICT … DO UPDATE) : pas un ajout
  IF EXISTS (SELECT 1 FROM public.show_members WHERE show_id = NEW.show_id AND user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;
  SELECT p.plan INTO v_plan FROM public.shows s JOIN public.profiles p ON p.id = s.owner_id WHERE s.id = NEW.show_id;
  IF COALESCE(v_plan, 'free') = 'pro' THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_n FROM public.show_members WHERE show_id = NEW.show_id;
  IF v_n >= 1 THEN
    RAISE EXCEPTION 'plan_limit:max_members' USING ERRCODE = 'check_violation',
      HINT = 'Le plan Gratuit est limité à 1 membre par show.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.pf_limit_riders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_plan  text;
  v_n     int;
BEGIN
  IF public.pf_is_privileged() THEN RETURN NEW; END IF;
  SELECT s.owner_id, p.plan INTO v_owner, v_plan
    FROM public.shows s LEFT JOIN public.profiles p ON p.id = s.owner_id WHERE s.id = NEW.show_id;
  IF COALESCE(v_plan, 'free') = 'pro' THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_n FROM public.show_riders r JOIN public.shows s ON s.id = r.show_id WHERE s.owner_id = v_owner;
  IF v_n >= 5 THEN
    RAISE EXCEPTION 'plan_limit:max_share_links' USING ERRCODE = 'check_violation',
      HINT = 'Le plan Gratuit est limité à 5 liens de partage.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pf_limit_shows ON public.shows;
CREATE TRIGGER trg_pf_limit_shows BEFORE INSERT ON public.shows
  FOR EACH ROW EXECUTE FUNCTION public.pf_limit_shows();
DROP TRIGGER IF EXISTS trg_pf_limit_channels ON public.channels;
CREATE TRIGGER trg_pf_limit_channels BEFORE INSERT ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.pf_limit_channels();
DROP TRIGGER IF EXISTS trg_pf_limit_members ON public.show_members;
CREATE TRIGGER trg_pf_limit_members BEFORE INSERT ON public.show_members
  FOR EACH ROW EXECUTE FUNCTION public.pf_limit_members();
DROP TRIGGER IF EXISTS trg_pf_limit_riders ON public.show_riders;
CREATE TRIGGER trg_pf_limit_riders BEFORE INSERT ON public.show_riders
  FOR EACH ROW EXECUTE FUNCTION public.pf_limit_riders();

REVOKE EXECUTE ON FUNCTION public.pf_limit_shows(), public.pf_limit_channels(), public.pf_limit_members(), public.pf_limit_riders()
  FROM PUBLIC, anon, authenticated;

-- ── Plafond quotidien des appels IA (inputlist-ai, stage-ai) ──
-- Chaque appel coûte des jetons facturés au compte PatchFlow : 40 lectures par compte et par 24 h,
-- toutes fonctions IA confondues. Compté par les fonctions (service_role), jamais par le navigateur.
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id      bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fn      text NOT NULL,
  at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_user_at ON public.ai_usage (user_id, at DESC);
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage FROM PUBLIC, anon, authenticated;

/* Réserve un appel : true si le compte est sous le plafond (l'appel est alors compté), false sinon.
   Un verrou par compte évite que des appels simultanés passent tous sous le plafond. */
CREATE OR REPLACE FUNCTION public.ai_take(p_user uuid, p_fn text, p_limit int DEFAULT 40)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ai_take:' || p_user::text));
  SELECT count(*) INTO v_n FROM public.ai_usage WHERE user_id = p_user AND at > now() - interval '24 hours';
  IF v_n >= p_limit THEN RETURN false; END IF;
  INSERT INTO public.ai_usage (user_id, fn) VALUES (p_user, left(p_fn, 40));
  DELETE FROM public.ai_usage WHERE at < now() - interval '30 days';
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ai_take(uuid, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_take(uuid, text, int) TO service_role;
