-- ════════════════════════════════════════════════════════════════════
-- DURCISSEMENT SÉCURITÉ — audit 2026-09
-- ════════════════════════════════════════════════════════════════════
-- Script idempotent (rejouable) et atomique (tout ou rien).
-- Rédigé après relevé de l'état RÉEL de la base : les policies RLS de
-- channels, shows, show_files, show_members, show_invites, show_riders,
-- coda_amps, subscriptions et profiles étaient déjà correctes et ne sont pas
-- modifiées. Seules les failles décrites ci-dessous sont corrigées.
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

-- 4. profiles : colonnes sensibles.
--    profiles_update autorise la modification de toutes les colonnes de sa
--    propre ligne et le trigger ne protégeait que « plan » :
--      - plan_override (octroi manuel du Pro, qui fait ignorer les
--        événements d'abonnement par le webhook) était modifiable : dès que le
--        paiement sera actif, un abonné pouvait l'activer puis résilier et
--        garder le Pro ;
--      - email : un utilisateur pouvait afficher l'adresse de quelqu'un
--        d'autre à ses collaborateurs (usurpation dans l'équipe).
--    Le trigger protège désormais plan, plan_override et email, à la création
--    comme à la modification ; l'email est toujours celui, vérifié, du compte.
--    Les écritures du webhook (service_role), du dashboard/CLI et des triggers
--    internes (handle_new_user, sync_profile_email) restent libres.
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

-- 5. shows : verrouillage de la propriété (défense en profondeur).
--    Aujourd'hui shows_update est réservé au propriétaire, donc un éditeur ne
--    peut rien réécrire. Mais si cette policy est un jour élargie aux éditeurs
--    (pour qu'ils enregistrent la liste des sorties, par exemple), rien
--    n'empêcherait de changer owner_id ou de mettre le show à la corbeille.
--    Ce trigger rend owner_id immuable depuis l'application, réserve
--    deleted_at (corbeille) au propriétaire, et exige owner_id = utilisateur
--    connecté (ou vide, alors renseigné) à la création.
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
      IF NEW.owner_id IS NULL THEN
        NEW.owner_id := auth.uid();
      ELSIF NEW.owner_id <> auth.uid() THEN
        RAISE EXCEPTION 'Le propriétaire doit être l''utilisateur connecté' USING ERRCODE = '42501';
      END IF;
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

-- 6. show_scenes : la policy show_scenes_access (FOR ALL … can_access_show)
--    donne l'écriture — insertion, modification, suppression — à TOUT membre,
--    « Lecture seule » compris : un lecteur pouvait modifier ou effacer les
--    plans (scène, site, synoptique) d'un show. Une policy RESTRICTIVE
--    s'applique en ET avec les existantes : elle ne peut que restreindre.
--    Écriture = propriétaire + membres admin/éditeur. La lecture ne change pas.
DROP POLICY IF EXISTS pf_guard_scenes_insert ON public.show_scenes;
CREATE POLICY pf_guard_scenes_insert ON public.show_scenes AS RESTRICTIVE FOR INSERT
  WITH CHECK (public.can_edit_show(show_id));
DROP POLICY IF EXISTS pf_guard_scenes_update ON public.show_scenes;
CREATE POLICY pf_guard_scenes_update ON public.show_scenes AS RESTRICTIVE FOR UPDATE
  USING (public.can_edit_show(show_id)) WITH CHECK (public.can_edit_show(show_id));
DROP POLICY IF EXISTS pf_guard_scenes_delete ON public.show_scenes;
CREATE POLICY pf_guard_scenes_delete ON public.show_scenes AS RESTRICTIVE FOR DELETE
  USING (public.can_edit_show(show_id));

-- 7. templates : templates_insert ne contrôle que owner_id, et templates_update
--    ne contrôle pas is_public. Un utilisateur pouvait donc publier un modèle
--    « public » (templates_select l'expose à tous les comptes). Un modèle ne
--    peut plus être créé ni passé en public depuis l'application (l'ajout
--    d'un modèle public reste possible depuis le dashboard).
DROP POLICY IF EXISTS pf_guard_templates_insert ON public.templates;
CREATE POLICY pf_guard_templates_insert ON public.templates AS RESTRICTIVE FOR INSERT
  WITH CHECK (owner_id = auth.uid() AND is_public IS NOT TRUE);
DROP POLICY IF EXISTS pf_guard_templates_update ON public.templates;
CREATE POLICY pf_guard_templates_update ON public.templates AS RESTRICTIVE FOR UPDATE
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid() AND is_public IS NOT TRUE);

-- 8. Stockage : le bucket « show-files » (ancien stockage, remplacé par
--    Backblaze B2, plus utilisé par l'application) contient encore des
--    fichiers, et ses policies « Authenticated users can … » donnent lecture,
--    modification et suppression à TOUT compte connecté, quel que soit le
--    dossier. Accès fermé aux rôles anon/authenticated ; les fichiers restent
--    en place (dashboard / service_role). Ne concerne aucun autre bucket.
DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN RETURN; END IF;
  DROP POLICY IF EXISTS pf_guard_legacy_show_files ON storage.objects;
  CREATE POLICY pf_guard_legacy_show_files ON storage.objects AS RESTRICTIVE FOR ALL
    TO anon, authenticated
    USING (bucket_id <> 'show-files') WITH CHECK (bucket_id <> 'show-files');
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'storage.objects : policy non créée (droits insuffisants) — à faire depuis le dashboard';
END $$;
