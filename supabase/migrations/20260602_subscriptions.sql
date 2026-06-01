-- ── Table des abonnements Lemon Squeezy ──
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ls_subscription_id text UNIQUE,          -- ID abonnement Lemon Squeezy
  ls_customer_id text,                     -- ID client Lemon Squeezy
  ls_order_id text,                        -- ID commande
  ls_variant_id text,                      -- variante (mensuel/annuel)
  status text NOT NULL DEFAULT 'none',     -- active, on_trial, paused, cancelled, expired, unpaid
  plan text NOT NULL DEFAULT 'free',       -- free | pro
  card_brand text,
  card_last_four text,
  renews_at timestamptz,                   -- prochaine facturation
  ends_at timestamptz,                     -- fin si annulé
  customer_portal_url text,                -- lien portail client LS
  update_payment_url text,                 -- lien MAJ moyen de paiement
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS subscriptions_ls_sub_idx ON public.subscriptions(ls_subscription_id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- L'utilisateur peut lire son propre abonnement (écritures réservées au service role via webhook)
DROP POLICY IF EXISTS "subscriptions_read_own" ON public.subscriptions;
CREATE POLICY "subscriptions_read_own" ON public.subscriptions
  FOR SELECT USING (user_id = auth.uid());

GRANT SELECT ON public.subscriptions TO authenticated;

-- S'assurer que profiles a bien une colonne plan (déjà présente normalement)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free';
