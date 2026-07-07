-- ── Autoriser l'octroi manuel du plan en connexion directe privilégiée ──
-- Le trigger protect_profile_plan() (20260609_security_hardening) restaurait
-- l'ancien plan dès que auth.role() <> 'service_role'. But : empêcher un
-- utilisateur de l'app (PostgREST, rôle JWT 'authenticated') de s'auto-passer
-- Pro. EFFET DE BORD : une modification manuelle depuis le dashboard Supabase
-- (SQL Editor, connexion directe SANS JWT → auth.role() NULL) était elle aussi
-- annulée — impossible d'offrir un accès Pro à la main.
--
-- Correction : on autorise également les connexions directes par un rôle
-- Postgres privilégié (session_user = postgres/supabase_admin), c'est-à-dire
-- le dashboard SQL Editor et la CLI. Un client PostgREST garde session_user =
-- 'authenticator' et reste soumis au contrôle auth.role() — la protection
-- anti-auto-upgrade côté application est donc intacte.

CREATE OR REPLACE FUNCTION public.protect_profile_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), 'anon') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    -- Ni service_role (webhook) ni connexion directe privilégiée
    -- (dashboard/CLI) : on restaure l'ancien plan.
    IF NEW.plan IS DISTINCT FROM OLD.plan THEN
      NEW.plan := OLD.plan;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
