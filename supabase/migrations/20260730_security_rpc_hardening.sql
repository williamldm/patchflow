-- ════════════════════════════════════════════════════════════════════
-- DURCISSEMENT SÉCURITÉ — audit 2026-09
-- ════════════════════════════════════════════════════════════════════
-- Script idempotent : peut être rejoué sans risque.
--
-- 1. Par défaut, PostgreSQL donne EXECUTE à PUBLIC sur toute fonction :
--    les fonctions SECURITY DEFINER « d'action » ci-dessous étaient donc
--    appelables par un visiteur anonyme (clé anon publique). Elles
--    renvoyaient une erreur faute d'utilisateur, mais n'ont aucune raison
--    d'être exposées. Les fonctions utilisées DANS les policies RLS
--    (can_access_show, can_edit_show, get_my_member_show_ids…) restent
--    exécutables : les retirer ferait échouer les requêtes au lieu de
--    renvoyer « pas d'accès ».
-- 2. set_file_verified : un membre « Lecture seule » pouvait marquer un
--    fichier comme vérifié. Réservé désormais au propriétaire et aux
--    membres admin/éditeur (même règle que can_edit_show).

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.set_file_verified(uuid, boolean)',
    'public.accept_show_invite(uuid)',
    'public.get_user_storage_stats()'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
    END IF;
  END LOOP;
END $$;

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
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  SELECT show_id INTO v_show_id FROM public.show_files WHERE id = p_file_id AND is_folder = false;
  IF v_show_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'file_not_found');
  END IF;
  -- Écriture : propriétaire, ou membre admin/éditeur (pas « Lecture seule »)
  SELECT EXISTS(
    SELECT 1 FROM public.shows WHERE id = v_show_id AND owner_id = auth.uid()
  ) OR EXISTS(
    SELECT 1 FROM public.show_members
    WHERE show_id = v_show_id AND user_id = auth.uid() AND role IN ('admin','editor')
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
REVOKE EXECUTE ON FUNCTION public.set_file_verified(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_file_verified(uuid, boolean) TO authenticated, service_role;

-- 3. Anti-énumération des liens de partage (get-shared-show).
--    Les anciens codes courts (7-8 caractères) pourraient être devinés par
--    force brute : l'edge function note chaque code inconnu, par IP hachée
--    (jamais l'IP en clair), et bloque une IP après 30 échecs en une heure.
--    Lignes purgées après 24 h. Aucune policy : seule la service role y accède.
CREATE TABLE IF NOT EXISTS public.share_lookup_failures (
  id         bigserial PRIMARY KEY,
  ip_hash    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS share_lookup_failures_ip_idx
  ON public.share_lookup_failures (ip_hash, created_at);
ALTER TABLE public.share_lookup_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.share_lookup_failures FROM PUBLIC, anon, authenticated;

-- 4. CRITIQUE : colonnes sensibles du profil.
--    La policy profiles_update ne filtre pas les colonnes et le trigger ne
--    protégeait que « plan » :
--      - plan_override (octroi manuel du Pro) était modifiable par
--        l'utilisateur : un abonné le passait à true puis résiliait, le
--        webhook l'ignorait ensuite → Pro gratuit à vie ;
--      - email : un utilisateur pouvait afficher l'adresse de quelqu'un
--        d'autre à ses collaborateurs (usurpation dans l'équipe).
--    Le trigger protège désormais plan, plan_override et email, à la création
--    comme à la modification. L'email est toujours celui, vérifié, du compte.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plan_override boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.protect_profile_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  -- service_role (webhook), connexions directes privilégiées (dashboard,
  -- CLI) et écritures faites par un autre trigger (clés étrangères, synchro
  -- depuis auth.users) restent libres ; l'application est bridée.
  IF COALESCE(auth.role(), 'anon') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND pg_trigger_depth() <= 1 THEN
    IF TG_OP = 'INSERT' THEN
      NEW.plan := 'free';
      NEW.plan_override := false;
    ELSE
      NEW.plan := OLD.plan;
      NEW.plan_override := OLD.plan_override;
    END IF;
    SELECT email INTO v_email FROM auth.users WHERE id = NEW.id;
    IF v_email IS NOT NULL THEN
      NEW.email := v_email;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_plan ON public.profiles;
CREATE TRIGGER trg_protect_profile_plan
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_plan();

-- 5. HAUTE : propriété d'un show.
--    Selon les policies UPDATE en place, un membre éditeur pouvait réécrire
--    owner_id pour s'approprier le show, ou le mettre à la corbeille.
--    owner_id devient immuable depuis l'application, deleted_at (corbeille)
--    est réservé au propriétaire, et à la création le propriétaire est
--    toujours l'utilisateur connecté.
ALTER TABLE public.shows ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE OR REPLACE FUNCTION public.protect_show_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Même exemptions que protect_profile_plan (dont les actions ON DELETE
  -- SET NULL des clés étrangères, qui passent par un trigger interne).
  IF COALESCE(auth.role(), 'anon') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND pg_trigger_depth() <= 1 THEN
    IF TG_OP = 'INSERT' THEN
      IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Connexion requise' USING ERRCODE = '42501';
      END IF;
      NEW.owner_id := auth.uid();
    ELSE
      IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
        RAISE EXCEPTION 'Le propriétaire d''un show ne peut pas être modifié' USING ERRCODE = '42501';
      END IF;
      IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
         AND OLD.owner_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Seul le propriétaire peut supprimer ou restaurer ce show' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_show_owner ON public.shows;
CREATE TRIGGER trg_protect_show_owner
  BEFORE INSERT OR UPDATE ON public.shows
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_show_owner();

-- 6. Garde-fous RLS « RESTRICTIVE ».
--    Une partie des policies a été créée depuis le dashboard, hors
--    migrations : impossible de garantir qu'aucune n'est trop large (ex. une
--    policy FOR ALL basée sur can_access_show laisse un membre « Lecture
--    seule » modifier ou supprimer les plans). Les policies RESTRICTIVE
--    s'appliquent en ET logique avec les autres : elles ne peuvent QUE
--    restreindre, et garantissent le modèle d'accès quelles que soient les
--    policies existantes :
--      lecture  = propriétaire + membres (lecture seule inclus)
--      écriture = propriétaire + membres admin/éditeur
--      show     = création / suppression par le propriétaire uniquement
--      équipe   = gérée par le propriétaire (chacun peut se retirer)
--    Les edge functions (service_role) et les fonctions SECURITY DEFINER
--    (accept_show_invite, set_file_verified…) ne sont pas concernées.

-- Shows accessibles par l'utilisateur courant (propriétaire ou membre).
-- SECURITY DEFINER : pas de récursion RLS ; évalué une fois par requête.
CREATE OR REPLACE FUNCTION public.my_accessible_show_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.shows WHERE owner_id = auth.uid()
  UNION
  SELECT show_id FROM public.show_members WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_show_owner(p_show_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.shows WHERE id = p_show_id AND owner_id = auth.uid());
$$;

-- 6a. shows
--     « owner_id = auth.uid() » en premier : un show tout juste créé n'est pas
--     encore visible par my_accessible_show_ids() (instantané de la requête),
--     or l'app relit la ligne insérée (INSERT … RETURNING).
DROP POLICY IF EXISTS pf_guard_select ON public.shows;
CREATE POLICY pf_guard_select ON public.shows AS RESTRICTIVE FOR SELECT
  USING (owner_id = auth.uid() OR id IN (SELECT public.my_accessible_show_ids()));
DROP POLICY IF EXISTS pf_guard_insert ON public.shows;
CREATE POLICY pf_guard_insert ON public.shows AS RESTRICTIVE FOR INSERT
  WITH CHECK (owner_id = auth.uid());
DROP POLICY IF EXISTS pf_guard_update ON public.shows;
CREATE POLICY pf_guard_update ON public.shows AS RESTRICTIVE FOR UPDATE
  USING (public.can_edit_show(id)) WITH CHECK (public.can_edit_show(id));
DROP POLICY IF EXISTS pf_guard_delete ON public.shows;
CREATE POLICY pf_guard_delete ON public.shows AS RESTRICTIVE FOR DELETE
  USING (owner_id = auth.uid());

-- 6b. Tables rattachées à un show (colonne show_id).
--     Si une table n'avait PAS la RLS activée, elle était ouverte à tous :
--     on l'active avec le modèle d'accès standard.
DO $$
DECLARE
  t     text;
  v_rls boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['channels', 'show_scenes', 'show_riders', 'show_files', 'coda_amps'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'show_id');

    SELECT c.relrowsecurity INTO v_rls FROM pg_class c WHERE c.oid = to_regclass('public.' || t);
    IF NOT v_rls THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('CREATE POLICY pf_base_select ON public.%I FOR SELECT USING (show_id IN (SELECT public.my_accessible_show_ids()))', t);
      EXECUTE format('CREATE POLICY pf_base_insert ON public.%I FOR INSERT WITH CHECK (public.can_edit_show(show_id))', t);
      EXECUTE format('CREATE POLICY pf_base_update ON public.%I FOR UPDATE USING (public.can_edit_show(show_id)) WITH CHECK (public.can_edit_show(show_id))', t);
      EXECUTE format('CREATE POLICY pf_base_delete ON public.%I FOR DELETE USING (public.can_edit_show(show_id))', t);
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS pf_guard_select ON public.%I', t);
    EXECUTE format('CREATE POLICY pf_guard_select ON public.%I AS RESTRICTIVE FOR SELECT USING (show_id IN (SELECT public.my_accessible_show_ids()))', t);
    EXECUTE format('DROP POLICY IF EXISTS pf_guard_insert ON public.%I', t);
    EXECUTE format('CREATE POLICY pf_guard_insert ON public.%I AS RESTRICTIVE FOR INSERT WITH CHECK (public.can_edit_show(show_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS pf_guard_update ON public.%I', t);
    EXECUTE format('CREATE POLICY pf_guard_update ON public.%I AS RESTRICTIVE FOR UPDATE USING (public.can_edit_show(show_id)) WITH CHECK (public.can_edit_show(show_id))', t);
    EXECUTE format('DROP POLICY IF EXISTS pf_guard_delete ON public.%I', t);
    EXECUTE format('CREATE POLICY pf_guard_delete ON public.%I AS RESTRICTIVE FOR DELETE USING (public.can_edit_show(show_id))', t);
  END LOOP;
END $$;

-- 6c. Équipe : seul le propriétaire ajoute ou modifie un membre ; chacun
--     peut se retirer. Les invitations restent visibles par leur destinataire
--     (email vérifié du compte) et gérées par le propriétaire.
DROP POLICY IF EXISTS pf_guard_select ON public.show_members;
CREATE POLICY pf_guard_select ON public.show_members AS RESTRICTIVE FOR SELECT
  USING (user_id = auth.uid() OR show_id IN (SELECT public.my_accessible_show_ids()));
DROP POLICY IF EXISTS pf_guard_insert ON public.show_members;
CREATE POLICY pf_guard_insert ON public.show_members AS RESTRICTIVE FOR INSERT
  WITH CHECK (public.is_show_owner(show_id));
DROP POLICY IF EXISTS pf_guard_update ON public.show_members;
CREATE POLICY pf_guard_update ON public.show_members AS RESTRICTIVE FOR UPDATE
  USING (public.is_show_owner(show_id)) WITH CHECK (public.is_show_owner(show_id));
DROP POLICY IF EXISTS pf_guard_delete ON public.show_members;
CREATE POLICY pf_guard_delete ON public.show_members AS RESTRICTIVE FOR DELETE
  USING (user_id = auth.uid() OR public.is_show_owner(show_id));

DROP POLICY IF EXISTS pf_guard_select ON public.show_invites;
CREATE POLICY pf_guard_select ON public.show_invites AS RESTRICTIVE FOR SELECT
  USING (public.is_show_owner(show_id)
         OR lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', '')));
DROP POLICY IF EXISTS pf_guard_insert ON public.show_invites;
CREATE POLICY pf_guard_insert ON public.show_invites AS RESTRICTIVE FOR INSERT
  WITH CHECK (public.is_show_owner(show_id));
DROP POLICY IF EXISTS pf_guard_update ON public.show_invites;
CREATE POLICY pf_guard_update ON public.show_invites AS RESTRICTIVE FOR UPDATE
  USING (public.is_show_owner(show_id)) WITH CHECK (public.is_show_owner(show_id));
DROP POLICY IF EXISTS pf_guard_delete ON public.show_invites;
CREATE POLICY pf_guard_delete ON public.show_invites AS RESTRICTIVE FOR DELETE
  USING (public.is_show_owner(show_id)
         OR lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- 6d. Abonnements : lecture de son propre abonnement uniquement ; toute
--     écriture passe par le webhook Lemon Squeezy (service_role).
DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NOT NULL THEN
    DROP POLICY IF EXISTS pf_guard_select ON public.subscriptions;
    CREATE POLICY pf_guard_select ON public.subscriptions AS RESTRICTIVE FOR SELECT
      USING (user_id = auth.uid());
    DROP POLICY IF EXISTS pf_guard_insert ON public.subscriptions;
    CREATE POLICY pf_guard_insert ON public.subscriptions AS RESTRICTIVE FOR INSERT
      WITH CHECK (false);
    DROP POLICY IF EXISTS pf_guard_update ON public.subscriptions;
    CREATE POLICY pf_guard_update ON public.subscriptions AS RESTRICTIVE FOR UPDATE
      USING (false);
    DROP POLICY IF EXISTS pf_guard_delete ON public.subscriptions;
    CREATE POLICY pf_guard_delete ON public.subscriptions AS RESTRICTIVE FOR DELETE
      USING (false);
  END IF;
END $$;

-- 6e. Modèles de patch : privés à leur auteur. Un utilisateur ne peut pas
--     publier un modèle pour tout le monde (is_public reste réservé à
--     l'administration).
DO $$
DECLARE
  v_pub boolean;
BEGIN
  IF to_regclass('public.templates') IS NULL THEN RETURN; END IF;
  v_pub := EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'templates' AND column_name = 'is_public');
  DROP POLICY IF EXISTS pf_guard_select ON public.templates;
  DROP POLICY IF EXISTS pf_guard_insert ON public.templates;
  DROP POLICY IF EXISTS pf_guard_update ON public.templates;
  DROP POLICY IF EXISTS pf_guard_delete ON public.templates;
  IF v_pub THEN
    CREATE POLICY pf_guard_select ON public.templates AS RESTRICTIVE FOR SELECT
      USING (owner_id = auth.uid() OR is_public IS TRUE);
    CREATE POLICY pf_guard_insert ON public.templates AS RESTRICTIVE FOR INSERT
      WITH CHECK (owner_id = auth.uid() AND is_public IS NOT TRUE);
    CREATE POLICY pf_guard_update ON public.templates AS RESTRICTIVE FOR UPDATE
      USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid() AND is_public IS NOT TRUE);
  ELSE
    CREATE POLICY pf_guard_select ON public.templates AS RESTRICTIVE FOR SELECT
      USING (owner_id = auth.uid());
    CREATE POLICY pf_guard_insert ON public.templates AS RESTRICTIVE FOR INSERT
      WITH CHECK (owner_id = auth.uid());
    CREATE POLICY pf_guard_update ON public.templates AS RESTRICTIVE FOR UPDATE
      USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
  END IF;
  CREATE POLICY pf_guard_delete ON public.templates AS RESTRICTIVE FOR DELETE
    USING (owner_id = auth.uid());
END $$;

-- 6f. Photos de profil (bucket Storage « avatars ») : chacun n'écrit que
--     dans son dossier <user_id>/. Les autres buckets ne sont pas concernés.
--     Bloc tolérant : si le rôle courant ne peut pas créer de policy sur
--     storage.objects, le reste de la migration s'applique quand même.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;
  BEGIN
    DROP POLICY IF EXISTS pf_guard_avatars_insert ON storage.objects;
    CREATE POLICY pf_guard_avatars_insert ON storage.objects AS RESTRICTIVE FOR INSERT
      WITH CHECK (bucket_id <> 'avatars' OR (storage.foldername(name))[1] = auth.uid()::text);
    DROP POLICY IF EXISTS pf_guard_avatars_update ON storage.objects;
    CREATE POLICY pf_guard_avatars_update ON storage.objects AS RESTRICTIVE FOR UPDATE
      USING (bucket_id <> 'avatars' OR (storage.foldername(name))[1] = auth.uid()::text)
      WITH CHECK (bucket_id <> 'avatars' OR (storage.foldername(name))[1] = auth.uid()::text);
    DROP POLICY IF EXISTS pf_guard_avatars_delete ON storage.objects;
    CREATE POLICY pf_guard_avatars_delete ON storage.objects AS RESTRICTIVE FOR DELETE
      USING (bucket_id <> 'avatars' OR (storage.foldername(name))[1] = auth.uid()::text);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'storage.objects : policies avatars non créées (droits insuffisants)';
  END;
END $$;
