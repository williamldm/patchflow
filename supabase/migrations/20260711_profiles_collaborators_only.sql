-- ── Ne voir que les profils de ses COLLABORATEURS ──────────────────────
-- Étape précédente (20260710) : profiles lisible par tout utilisateur
-- authentifié. On resserre : un utilisateur ne doit voir que les profils des
-- personnes avec qui il partage réellement un show (impossible de récupérer
-- l'email de quelqu'un qu'on ne connaît pas).
--
-- Perf : la variante restrictive de 20260609 (plusieurs sous-requêtes OR
-- corrélées, ré-évaluées par ligne) causait des timeouts sur les embeds
-- profiles(...). Ici on passe par UNE fonction SECURITY DEFINER + STABLE qui
-- renvoie l'ensemble des ids visibles, évalué une seule fois par requête ;
-- SECURITY DEFINER contourne la RLS à l'intérieur → pas de récursion.

CREATE OR REPLACE FUNCTION public.get_visible_profile_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH my_shows AS (
    -- Shows que je possède ou dont je suis membre
    SELECT id       AS show_id FROM public.shows        WHERE owner_id = auth.uid()
    UNION
    SELECT show_id            FROM public.show_members  WHERE user_id  = auth.uid()
  )
  SELECT auth.uid()                                    -- moi-même
  UNION
  SELECT s.owner_id  FROM public.shows s        WHERE s.id      IN (SELECT show_id FROM my_shows)
  UNION
  SELECT m.user_id   FROM public.show_members m WHERE m.show_id IN (SELECT show_id FROM my_shows);
$$;

GRANT EXECUTE ON FUNCTION public.get_visible_profile_ids() TO authenticated;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id IN (SELECT public.get_visible_profile_ids()));
