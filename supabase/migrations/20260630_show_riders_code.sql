-- ── Code court pour les liens de partage ──
-- Les liens Pro (show_riders) sont envoyés dans des groupes WhatsApp : on veut
-- une URL courte (?link=k7m3p9q) plutôt que l'UUID complet de 36 caractères.
-- Le resolver (get-shared-show) accepte soit ce code court, soit l'ancien UUID,
-- donc les liens déjà partagés continuent de fonctionner.

ALTER TABLE public.show_riders
  ADD COLUMN IF NOT EXISTS code TEXT;

-- Backfill des liens existants avec un code court unique (8 caractères hex).
UPDATE public.show_riders
   SET code = substr(md5(id::text || random()::text), 1, 8)
 WHERE code IS NULL;

-- Unicité + recherche rapide par code.
CREATE UNIQUE INDEX IF NOT EXISTS show_riders_code_idx
  ON public.show_riders(code);
