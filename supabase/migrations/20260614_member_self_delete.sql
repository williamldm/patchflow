-- ── Permettre à un membre de QUITTER un show (supprimer sa propre adhésion) ──
-- BUG : les seules policies DELETE sur show_members (members_delete +
-- show_members_owner_all) sont réservées au PROPRIÉTAIRE du show. Aucun droit
-- ne permettait à un membre invité de supprimer sa propre ligne.
-- Résultat : leaveShow() faisait un DELETE qui ne matchait aucune ligne (RLS),
-- SANS erreur → l'app affichait "✓ quitté" mais la ligne restait en base, et
-- le show réapparaissait au rechargement → "impossible de quitter un show".
--
-- Fix : autoriser explicitement chaque utilisateur à supprimer SA PROPRE
-- adhésion (user_id = auth.uid()). Aucun risque : on ne peut retirer que
-- soi-même, jamais un autre membre.

DROP POLICY IF EXISTS members_self_delete ON public.show_members;
CREATE POLICY members_self_delete ON public.show_members
  FOR DELETE
  USING (user_id = auth.uid());
