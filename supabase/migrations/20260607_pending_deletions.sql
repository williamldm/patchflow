-- ── Suppressions de données différées après annulation d'abonnement Pro ──
-- Quand un utilisateur passe de Pro à Free, une entrée est créée ici.
-- La suppression effective se fait 20 jours plus tard si le plan est
-- toujours "free". Si l'utilisateur resubscrit, l'entrée est annulée.

CREATE TABLE IF NOT EXISTS public.pending_data_deletions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scheduled_at    TIMESTAMPTZ NOT NULL,  -- quand la suppression doit avoir lieu
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at     TIMESTAMPTZ,           -- quand l'email d'avertissement a été envoyé
  executed_at     TIMESTAMPTZ,           -- quand la suppression a été exécutée
  cancelled_at    TIMESTAMPTZ,           -- annulée (l'user a resubscrit)
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS pending_deletions_scheduled ON public.pending_data_deletions (scheduled_at)
  WHERE executed_at IS NULL AND cancelled_at IS NULL;
