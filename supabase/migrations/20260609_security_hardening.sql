-- ════════════════════════════════════════════════════════════════════
-- DURCISSEMENT SÉCURITÉ — audit 2026-06
-- ════════════════════════════════════════════════════════════════════

-- ── 1. CRITIQUE : empêcher l'auto-upgrade du plan (contournement paiement) ──
-- La policy profiles_update (auth.uid() = id) sans WITH CHECK permettait à un
-- utilisateur de faire UPDATE profiles SET plan='pro'. Le plan ne doit changer
-- QUE via le webhook Lemon Squeezy (service_role). On bloque toute modification
-- de `plan` provenant d'un rôle non-service via un trigger BEFORE UPDATE.

CREATE OR REPLACE FUNCTION public.protect_profile_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- auth.role() = 'service_role' uniquement quand on utilise la clé service role
  IF COALESCE(auth.role(), 'anon') <> 'service_role' THEN
    -- Un client ne peut pas modifier son plan : on restaure l'ancienne valeur
    IF NEW.plan IS DISTINCT FROM OLD.plan THEN
      NEW.plan := OLD.plan;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_plan ON public.profiles;
CREATE TRIGGER trg_protect_profile_plan
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_plan();

-- ── 2. HAUTE : ne plus exposer l'email/profil de TOUS les utilisateurs ──
-- profiles_select avait qual = true → n'importe quel utilisateur authentifié
-- lisait full_name + email + plan de tout le monde. On restreint la lecture :
--   - son propre profil
--   - les propriétaires des shows dont on est membre
--   - les membres des shows qu'on possède
-- (get_my_member_show_ids() est SECURITY DEFINER → pas de récursion RLS)

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT
  USING (
    id = auth.uid()
    OR id IN (
      SELECT owner_id FROM public.shows
      WHERE id IN (SELECT public.get_my_member_show_ids())
    )
    OR id IN (
      SELECT user_id FROM public.show_members
      WHERE show_id IN (SELECT id FROM public.shows WHERE owner_id = auth.uid())
    )
  );

-- ── 3. MOYENNE : WITH CHECK manquant sur les policies FOR ALL ──
-- show_invites_owner_all et show_members_owner_all ont USING mais pas WITH CHECK
-- → un INSERT n'était pas contraint (on pouvait insérer avec un show_id non possédé).

DROP POLICY IF EXISTS show_invites_owner_all ON public.show_invites;
CREATE POLICY show_invites_owner_all ON public.show_invites
  USING      (show_id IN (SELECT id FROM public.shows WHERE owner_id = auth.uid()))
  WITH CHECK (show_id IN (SELECT id FROM public.shows WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS show_members_owner_all ON public.show_members;
CREATE POLICY show_members_owner_all ON public.show_members
  USING      (show_id IN (SELECT id FROM public.shows WHERE owner_id = auth.uid()))
  WITH CHECK (show_id IN (SELECT id FROM public.shows WHERE owner_id = auth.uid()));
