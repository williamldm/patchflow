-- Tournées (regroupements de dates) : enregistrées sur le compte pour suivre
-- l'utilisateur d'un appareil à l'autre, au lieu du stockage du navigateur.
-- Forme : { "folders": [{ "id", "name", "color" }], "assign": { "<show_id>": "<folder_id>" } }
-- La policy profiles_update existante (id = auth.uid()) couvre déjà cette colonne.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tours jsonb NOT NULL DEFAULT '{}'::jsonb;
