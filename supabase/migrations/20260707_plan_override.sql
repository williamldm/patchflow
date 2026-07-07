-- ── Octroi manuel du plan (bypass webhook) ──
-- profiles.plan est normalement resynchronisé par lemonsqueezy-webhook à
-- chaque événement d'abonnement (renouvellement, relance, retry LS...). Une
-- modification manuelle de "plan" dans Supabase ne "tenait" donc pas : le
-- prochain événement webhook la réécrasait avec le vrai statut d'abonnement.
--
-- plan_override permet d'offrir un accès Pro (ou Free forcé) qui survit à
-- ces resynchronisations : le webhook ignore les users avec override=true.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan_override BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.plan_override IS
  'Si true, le webhook LemonSqueezy ne touche plus profiles.plan pour cet utilisateur (octroi manuel, compte partenaire/test, etc.)';
