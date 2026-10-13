-- ── Plafonds de taille côté serveur ──
-- L'application borne déjà ce qu'elle écrit (images à 800 Ko, imports limités). Ces garde-fous valent
-- aussi pour quelqu'un qui appellerait l'API directement : ils étendent à d'autres colonnes ce que
-- 20260624_data_size_guard.sql fait pour stage_data, synoptique_data et show_scenes.data (40 Mo).
-- Les images de fichiers vont chez Backblaze et ne sont pas concernées.
--
-- Un plafond par colonne JSON ou par ligne ; la valeur de TG_ARGV[0] est la colonne, '*' la ligne entière,
-- TG_ARGV[1] le plafond en octets. Toute écriture au-dessus est refusée (check_violation).

CREATE OR REPLACE FUNCTION public.pf_enforce_size()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_col  text := TG_ARGV[0];
  v_max  int  := TG_ARGV[1]::int;
  v_size int;
BEGIN
  IF v_col = '*' THEN
    v_size := octet_length(to_jsonb(NEW)::text);
  ELSE
    v_size := octet_length(COALESCE((to_jsonb(NEW) -> v_col)::text, ''));
  END IF;
  IF v_size > v_max THEN
    RAISE EXCEPTION '% trop volumineux (% Ko au maximum)', v_col, (v_max / 1024)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Liste des sorties (Output list) : du texte, jamais d'image
DROP TRIGGER IF EXISTS trg_pf_size_shows_out ON public.shows;
CREATE TRIGGER trg_pf_size_shows_out BEFORE INSERT OR UPDATE ON public.shows
  FOR EACH ROW EXECUTE FUNCTION public.pf_enforce_size('out_data', '10485760');            -- 10 Mo

-- Une ligne de patch : quelques centaines d'octets en usage normal
DROP TRIGGER IF EXISTS trg_pf_size_channels ON public.channels;
CREATE TRIGGER trg_pf_size_channels BEFORE INSERT OR UPDATE ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.pf_enforce_size('*', '131072');                     -- 128 Ko

-- Modèles d'utilisateur : des lignes de patch
DROP TRIGGER IF EXISTS trg_pf_size_templates ON public.templates;
CREATE TRIGGER trg_pf_size_templates BEFORE INSERT OR UPDATE ON public.templates
  FOR EACH ROW EXECUTE FUNCTION public.pf_enforce_size('*', '3145728');                    -- 3 Mo

-- Riders partagés : plafond selon le plan du propriétaire, voir 20261014_rider_size_by_plan.sql

-- Profil : dossiers de sessions, parcs de matériel (profiles.tours)
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_pf_size_profiles ON public.profiles;
    CREATE TRIGGER trg_pf_size_profiles BEFORE INSERT OR UPDATE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.pf_enforce_size('tours', '1048576');            -- 1 Mo
  END IF;
  IF to_regclass('public.coda_amps') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_pf_size_coda ON public.coda_amps;
    CREATE TRIGGER trg_pf_size_coda BEFORE INSERT OR UPDATE ON public.coda_amps
      FOR EACH ROW EXECUTE FUNCTION public.pf_enforce_size('*', '262144');                 -- 256 Ko
  END IF;
END $$;

-- Photo de profil : l'application envoie un JPEG de 400 px (quelques dizaines de Ko). Plafond du dépôt
-- direct, sinon n'importe quel fichier jusqu'à la limite globale du projet.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    UPDATE storage.buckets
       SET file_size_limit = 1048576,
           allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
     WHERE id = 'avatars';
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'storage.buckets : à régler depuis le dashboard (Storage > avatars > limite de 1 Mo)';
END $$;
