-- ── Colonnes personnalisées pour l'Input List (Pro) ──
-- custom_data stocke les valeurs des colonnes custom sous forme JSON
-- ex: {"col_abc123": "valeur", "col_xyz456": 42}
ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}'::jsonb;
