-- ── « Supprimés récemment » pour les shows (corbeille, fonction Pro) ──
-- Au lieu de supprimer définitivement un show, le propriétaire Pro le marque
-- comme supprimé (deleted_at). Il disparaît de la liste active mais reste
-- restaurable pendant 30 jours, puis il est purgé.
--
-- Ajout idempotent : la colonne peut déjà exister sur certains environnements.
-- Aucune nouvelle policy RLS : les policies propriétaire existantes couvrent
-- déjà UPDATE (marquer/restaurer) et DELETE (purge définitive).

ALTER TABLE public.shows
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Filtrage rapide de la liste active et de la corbeille par propriétaire.
CREATE INDEX IF NOT EXISTS shows_owner_deleted_idx
  ON public.shows (owner_id, deleted_at);
