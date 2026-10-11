-- ── Abonnements Stripe ──
-- La table subscriptions est celle de Lemon Squeezy (colonnes ls_*). Les abonnements Stripe y sont
-- ajoutés avec leurs propres colonnes ; les anciens abonnés gardent leurs lignes telles quelles.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_customer_id     text,
  ADD COLUMN IF NOT EXISTS stripe_price_id        text;

CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_idx ON public.subscriptions (stripe_customer_id);

COMMENT ON COLUMN public.subscriptions.stripe_subscription_id IS 'sub_… (Stripe). Nul pour les abonnements Lemon Squeezy.';
COMMENT ON COLUMN public.subscriptions.stripe_customer_id     IS 'cus_… (Stripe) : sert à ouvrir le portail client.';
