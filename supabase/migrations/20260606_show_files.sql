-- ── Table des fichiers B2 (métadonnées, Supabase comme source de vérité pour listings) ──
-- Synchronisée à chaque upload/delete/move côté client.
-- Remplace les appels B2Storage.list() pour le listing des fichiers.

CREATE TABLE IF NOT EXISTS public.show_files (
  id           UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id      UUID    NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  path         TEXT    NOT NULL,          -- chemin complet dans le bucket : showId/folder/prefix_name.pdf
  name         TEXT    NOT NULL,          -- nom stocké (avec préfixe horodatage pour les fichiers)
  folder       TEXT    NOT NULL DEFAULT '', -- dossier parent, sans slash : '' | 'Logos' | 'Logos/Sub'
  size         BIGINT  NOT NULL DEFAULT 0,
  content_type TEXT    NOT NULL DEFAULT '',
  is_folder    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT now(),
  created_by   UUID    REFERENCES auth.users(id),
  UNIQUE (show_id, path)
);

CREATE INDEX IF NOT EXISTS show_files_show_folder ON public.show_files (show_id, folder);
CREATE INDEX IF NOT EXISTS show_files_show_id     ON public.show_files (show_id);

ALTER TABLE public.show_files ENABLE ROW LEVEL SECURITY;

-- Propriétaire : accès complet
CREATE POLICY "show_files_owner_all" ON public.show_files
  USING  (show_id IN (SELECT id FROM public.shows WHERE owner_id = auth.uid()))
  WITH CHECK (show_id IN (SELECT id FROM public.shows WHERE owner_id = auth.uid()));

-- Membres invités : lecture seule
CREATE POLICY "show_files_members_read" ON public.show_files
  FOR SELECT
  USING (show_id IN (
    SELECT show_id FROM public.show_members WHERE user_id = auth.uid()
  ));
