-- ─────────────────────────────────────────────────────────────────────────────
-- PatchFlow — show_invites table
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Table des invitations en attente (utilisateurs sans compte)
CREATE TABLE IF NOT EXISTS public.show_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id      uuid NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  invited_email text NOT NULL,
  role         text NOT NULL DEFAULT 'editor' CHECK (role IN ('admin','editor','viewer')),
  invited_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  show_name    text,
  inviter_name text,
  created_at   timestamptz DEFAULT now()
);

-- Unicité : un seul invite en attente par (show, email)
CREATE UNIQUE INDEX IF NOT EXISTS show_invites_show_email_key
  ON public.show_invites (show_id, invited_email);

-- 2. RLS
ALTER TABLE public.show_invites ENABLE ROW LEVEL SECURITY;

-- L'owner du show peut voir toutes ses invitations
CREATE POLICY "show_invites_owner_all" ON public.show_invites
  FOR ALL
  USING (
    show_id IN (SELECT id FROM public.shows WHERE owner_id = auth.uid())
  );

-- L'utilisateur invité peut lire ses invitations (pour les traiter après login)
CREATE POLICY "show_invites_invitee_select" ON public.show_invites
  FOR SELECT
  USING (invited_email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- L'utilisateur invité peut supprimer (consommer) son invite
CREATE POLICY "show_invites_invitee_delete" ON public.show_invites
  FOR DELETE
  USING (invited_email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- 3. Contrainte CHECK sur show_members.role
--    Si la colonne role existe déjà sans contrainte, on l'ajoute :
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'show_members_role_check' AND conrelid = 'public.show_members'::regclass
  ) THEN
    ALTER TABLE public.show_members
      ADD CONSTRAINT show_members_role_check
      CHECK (role IN ('admin','editor','viewer'));
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Permissions for the service role used by Edge Functions
-- (service role bypasses RLS by default — no extra grants needed)
-- ─────────────────────────────────────────────────────────────────────────────
