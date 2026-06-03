-- ── Active RLS sur pending_data_deletions (table interne, accès service role uniquement) ──
-- Cette table est gérée uniquement par les edge functions :
--   - lemonsqueezy-webhook (création / annulation)
--   - purge-expired-data   (exécution)
-- Aucun utilisateur normal n'a besoin d'y accéder. Pas de policy = aucun
-- accès via PostgREST. Le service role bypasse RLS automatiquement.

ALTER TABLE public.pending_data_deletions ENABLE ROW LEVEL SECURITY;
