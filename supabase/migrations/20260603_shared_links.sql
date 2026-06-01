-- ── Suivi des liens de partage créés (pour la limite du plan Gratuit) ──
-- Stocke un tableau de clés "showId:section" (il, out, syno, stage, site, rider)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS shared_links jsonb NOT NULL DEFAULT '[]'::jsonb;
