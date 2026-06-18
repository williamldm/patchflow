-- Colonne out_data manquante sur shows : la liste des sorties (Output List)
-- y est stockée par patch ({ [patch_id]: [...sorties] }). Sans cette colonne,
-- saveOutData() faisait un UPDATE qui échouait silencieusement et les sorties
-- (créées notamment depuis le plan de scène) n'étaient jamais persistées —
-- d'où les liens de sortie cassés ("?" sur les nœuds) après rechargement.

ALTER TABLE public.shows ADD COLUMN IF NOT EXISTS out_data jsonb;
