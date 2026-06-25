-- ── Accès en lecture des scènes (show_scenes) pour les membres invités ──
-- Bug : un membre invité d'un show créé par un propriétaire Studio voyait le
-- plan de site / scène / synoptique VIDE. Les canaux (channels) s'affichaient
-- bien car leur RLS autorise déjà la lecture par les membres, mais show_scenes
-- n'avait qu'une policy propriétaire → le membre ne pouvait pas lire les plans
-- (qui, en mode Studio, sont stockés dans show_scenes, pas dans shows.stage_data).
--
-- On réplique le pattern de show_files : propriétaire = accès complet,
-- membres invités = lecture seule, basé sur l'appartenance via show_members.

ALTER TABLE public.show_scenes ENABLE ROW LEVEL SECURITY;

-- Propriétaire : accès complet (idempotent — recrée proprement)
DROP POLICY IF EXISTS show_scenes_owner_all ON public.show_scenes;
CREATE POLICY show_scenes_owner_all ON public.show_scenes
  USING      (show_id IN (SELECT id FROM public.shows WHERE owner_id = auth.uid()))
  WITH CHECK (show_id IN (SELECT id FROM public.shows WHERE owner_id = auth.uid()));

-- Membres invités : LECTURE seule (le correctif de ce bug)
DROP POLICY IF EXISTS show_scenes_members_read ON public.show_scenes;
CREATE POLICY show_scenes_members_read ON public.show_scenes
  FOR SELECT
  USING (show_id IN (
    SELECT show_id FROM public.show_members WHERE user_id = auth.uid()
  ));
