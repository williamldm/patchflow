-- ── Vérification matérielle directement sur un fichier ──
-- Permet à n'importe quel membre du show (pas seulement le propriétaire) de
-- marquer un fichier (ex: fiche technique / rider PDF envoyé par un groupe)
-- comme "vérifié" : confirmation que le document a bien été consulté et que
-- le matériel demandé sera disponible / préparé.
--
-- show_files n'autorise en écriture QUE le propriétaire (show_files_owner_all)
-- et les membres en LECTURE seule (show_files_members_read) — on ne touche
-- pas à ces policies (la sécurité sur path/size/contenu reste inchangée).
-- On expose une fonction RPC restreinte (SECURITY DEFINER) qui ne peut QUE
-- basculer verified_at/verified_by/verified_by_name, jamais les autres
-- colonnes — même pattern que accept_show_invite.

ALTER TABLE public.show_files
  ADD COLUMN IF NOT EXISTS verified_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_by_name TEXT;

CREATE OR REPLACE FUNCTION public.set_file_verified(p_file_id uuid, p_verified boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_show_id uuid;
  v_can     boolean;
  v_name    text;
  v_now     timestamptz := now();
BEGIN
  SELECT show_id INTO v_show_id FROM public.show_files WHERE id = p_file_id AND is_folder = false;
  IF v_show_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'file_not_found');
  END IF;

  -- Accès : propriétaire OU membre du show (même portée que la lecture)
  SELECT EXISTS(
    SELECT 1 FROM public.shows WHERE id = v_show_id AND owner_id = auth.uid()
  ) OR EXISTS(
    SELECT 1 FROM public.show_members WHERE show_id = v_show_id AND user_id = auth.uid()
  ) INTO v_can;
  IF NOT v_can THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_verified THEN
    SELECT COALESCE(full_name, email) INTO v_name FROM public.profiles WHERE id = auth.uid();
    v_name := COALESCE(v_name, 'Quelqu''un');
    UPDATE public.show_files
      SET verified_at = v_now, verified_by = auth.uid(), verified_by_name = v_name
      WHERE id = p_file_id;
    RETURN jsonb_build_object('ok', true, 'verified_at', v_now, 'verified_by_name', v_name);
  ELSE
    UPDATE public.show_files
      SET verified_at = NULL, verified_by = NULL, verified_by_name = NULL
      WHERE id = p_file_id;
    RETURN jsonb_build_object('ok', true, 'verified_at', NULL);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_file_verified(uuid, boolean) TO authenticated;
