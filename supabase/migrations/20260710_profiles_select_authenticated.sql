-- ── Fermer la lecture publique de profiles (fuite emails via clé anon) ──
-- profiles_select était `USING (true)` pour le rôle public (anon inclus) :
-- n'importe qui, avec la seule clé anon publique, pouvait lire TOUS les emails
-- + noms + plans (GET /rest/v1/profiles). Fuite de données personnelles
-- (récupération d'emails en masse / énumération d'utilisateurs / RGPD).
--
-- La policy avait été remise permissive en 20260610 pour éviter des timeouts
-- causés par une variante à sous-requêtes (embed profiles(...) sur tous les
-- membres de tous les shows). On garde donc un prédicat rapide SANS sous-
-- requête, mais on restreint la policy au rôle `authenticated` : les visiteurs
-- anonymes n'obtiennent plus aucune ligne, les utilisateurs connectés
-- continuent de lire les profils (compromis assumé pour la collaboration).
--
-- La vue rider partagée n'est pas affectée : elle passe par la fonction
-- get-shared-show en service_role, qui contourne entièrement la RLS.

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);
