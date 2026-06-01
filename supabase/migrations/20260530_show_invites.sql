-- ─────────────────────────────────────────────────────────────────────────────
-- PatchFlow — show_invites + RLS show_members
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Table des invitations en attente (utilisateurs sans compte)
CREATE TABLE IF NOT EXISTS public.show_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id       uuid NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  role          text NOT NULL DEFAULT 'editor' CHECK (role IN ('admin','editor','viewer')),
  invited_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  show_name     text,
  inviter_name  text,
  created_at    timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS show_invites_show_email_key
  ON public.show_invites (show_id, invited_email);

-- 2. RLS sur show_invites
ALTER TABLE public.show_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "show_invites_owner_all" ON public.show_invites;
CREATE POLICY "show_invites_owner_all" ON public.show_invites
  FOR ALL
  USING (show_id IN (SELECT id FROM public.shows WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "show_invites_invitee_select" ON public.show_invites;
CREATE POLICY "show_invites_invitee_select" ON public.show_invites
  FOR SELECT
  USING (invited_email = (SELECT email FROM auth.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "show_invites_invitee_delete" ON public.show_invites;
CREATE POLICY "show_invites_invitee_delete" ON public.show_invites
  FOR DELETE
  USING (invited_email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- 3. RLS sur show_members — les membres peuvent lire leurs shows
ALTER TABLE public.show_members ENABLE ROW LEVEL SECURITY;

-- Owner peut tout faire sur les membres de ses shows
DROP POLICY IF EXISTS "show_members_owner_all" ON public.show_members;
CREATE POLICY "show_members_owner_all" ON public.show_members
  FOR ALL
  USING (show_id IN (SELECT id FROM public.shows WHERE owner_id = auth.uid()));

-- Un membre peut lire sa propre entrée (pour que loadShows() trouve ses shows)
DROP POLICY IF EXISTS "show_members_self_select" ON public.show_members;
CREATE POLICY "show_members_self_select" ON public.show_members
  FOR SELECT
  USING (user_id = auth.uid());

-- 4. RLS sur shows — les membres peuvent lire les shows auxquels ils appartiennent
-- (nécessaire si la policy actuelle filtre sur owner_id uniquement)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shows' AND policyname = 'shows_members_can_read'
  ) THEN
    EXECUTE $policy$
      DROP POLICY IF EXISTS "shows_members_can_read" ON public.shows;
CREATE POLICY "shows_members_can_read" ON public.shows
        FOR SELECT
        USING (
          owner_id = auth.uid() OR
          id IN (SELECT show_id FROM public.show_members WHERE user_id = auth.uid())
        );
    $policy$;
  END IF;
END $$;

-- 5. Contrainte CHECK sur show_members.role
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'show_members_role_check'
      AND conrelid = 'public.show_members'::regclass
  ) THEN
    ALTER TABLE public.show_members
      ADD CONSTRAINT show_members_role_check
      CHECK (role IN ('admin','editor','viewer'));
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
