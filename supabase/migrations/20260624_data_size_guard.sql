-- ── Garde-fou anti-abus : plafond de taille des données JSON par ligne ──
-- Les sauvegardes de plans (stage_data / synoptique_data sur shows, data sur
-- show_scenes) sont des écritures directes protégées uniquement par la RLS :
-- rien n'empêchait, côté serveur, d'y écrire des centaines de Mo de base64
-- (images géantes) en appelant l'API directement, contournant le quota client.
--
-- Ce trigger rejette toute écriture dont un champ JSON dépasse un plafond
-- absolu généreux (40 Mo) — assez large pour un plan riche (fond + nombreuses
-- images compressées côté client à ~2 Mo chacune), mais qui bloque l'abus
-- évident (un seul blob de plusieurs centaines de Mo).
--
-- Le quota TOTAL par compte (500 Mo gratuit / 50 Go Pro) reste vérifié côté
-- client + edge function user-storage ; ce trigger est la barrière serveur
-- non contournable contre le gonflement d'une seule ligne.

-- 40 Mo en octets
-- (octet_length sur le texte JSON ≈ longueur de JSON.stringify côté client,
--  le base64 étant de l'ASCII)

CREATE OR REPLACE FUNCTION enforce_show_data_size()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  max_field constant int := 40 * 1024 * 1024; -- 40 Mo par champ
BEGIN
  IF NEW.stage_data IS NOT NULL
     AND octet_length(NEW.stage_data::text) > max_field THEN
    RAISE EXCEPTION 'stage_data trop volumineux (max 40 Mo par plan)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.synoptique_data IS NOT NULL
     AND octet_length(NEW.synoptique_data::text) > max_field THEN
    RAISE EXCEPTION 'synoptique_data trop volumineux (max 40 Mo par plan)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shows_data_size ON shows;
CREATE TRIGGER trg_shows_data_size
  BEFORE INSERT OR UPDATE ON shows
  FOR EACH ROW
  EXECUTE FUNCTION enforce_show_data_size();

CREATE OR REPLACE FUNCTION enforce_scene_data_size()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  max_field constant int := 40 * 1024 * 1024; -- 40 Mo par scène
BEGIN
  IF NEW.data IS NOT NULL
     AND octet_length(NEW.data::text) > max_field THEN
    RAISE EXCEPTION 'data de scène trop volumineux (max 40 Mo par scène)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scenes_data_size ON show_scenes;
CREATE TRIGGER trg_scenes_data_size
  BEFORE INSERT OR UPDATE ON show_scenes
  FOR EACH ROW
  EXECUTE FUNCTION enforce_scene_data_size();
