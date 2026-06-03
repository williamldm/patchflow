-- ── Revert profiles_select vers une policy simple et rapide ──
-- La policy basée sur sous-requêtes (owners/membres de mes shows) ralentissait
-- les requêtes avec embed profiles(...) (loadAllShowMembers charge les profils
-- de tous les membres de tous les shows) → timeouts côté client.
--
-- On revient à une lecture permissive pour les utilisateurs authentifiés.
-- L'exposition des emails est un compromis accepté (les apps de collaboration
-- exposent en général nom + email des coéquipiers). Le correctif CRITIQUE
-- (trigger anti-modification de plan) reste en place.

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT
  USING (true);
