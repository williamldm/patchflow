-- ── Les membres d'un show partagé doivent pouvoir importer des fichiers ──
-- Bug : show_files n'avait que deux policies —
--   show_files_owner_all   (ALL)    → réservé au PROPRIÉTAIRE
--   show_files_members_read (SELECT) → membres en lecture seule
-- Un membre d'un show partagé pouvait donc uploader le binaire vers B2
-- (l'edge function b2-storage autorise owner ET membres) mais l'INSERT de la
-- ligne correspondante dans show_files était refusé par la RLS. Côté client
-- l'erreur était avalée (.catch(() => {})) → toast « ✓ Fichier importé » alors
-- que le fichier n'apparaissait jamais dans la liste. La réconciliation B2 ne
-- pouvait pas non plus le rattraper (elle fait aussi un INSERT).
--
-- On aligne show_files sur le modèle de rôles déjà utilisé par channels :
--   lecture  = can_access_show (propriétaire + tous les membres, viewers inclus)
--   écriture = can_edit_show   (propriétaire + membres admin/editor)
-- Les viewers restent en lecture seule.

DROP POLICY IF EXISTS show_files_owner_all    ON public.show_files;
DROP POLICY IF EXISTS show_files_members_read ON public.show_files;

CREATE POLICY show_files_select ON public.show_files
  FOR SELECT USING (public.can_access_show(show_id));

CREATE POLICY show_files_insert ON public.show_files
  FOR INSERT WITH CHECK (public.can_edit_show(show_id));

CREATE POLICY show_files_update ON public.show_files
  FOR UPDATE USING (public.can_edit_show(show_id))
              WITH CHECK (public.can_edit_show(show_id));

CREATE POLICY show_files_delete ON public.show_files
  FOR DELETE USING (public.can_edit_show(show_id));
