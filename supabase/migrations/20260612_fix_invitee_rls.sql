-- ── Fix RLS show_invites : utiliser auth.jwt() au lieu de auth.users ──
-- BUG : la policy précédente faisait (SELECT email FROM auth.users WHERE id=auth.uid())
-- mais le rôle `authenticated` n'a PAS de droit SELECT sur auth.users. La sous-requête
-- échouait silencieusement → la policy ne matchait JAMAIS → aucune invitation visible.
--
-- Solution : auth.jwt() ->> 'email' lit le claim directement depuis le JWT du caller,
-- sans aucun accès à auth.users. Plus rapide, plus sûr, et ça marche.

DROP POLICY IF EXISTS show_invites_invitee_select ON public.show_invites;
CREATE POLICY show_invites_invitee_select ON public.show_invites
  FOR SELECT
  USING (
    lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

DROP POLICY IF EXISTS show_invites_invitee_delete ON public.show_invites;
CREATE POLICY show_invites_invitee_delete ON public.show_invites
  FOR DELETE
  USING (
    lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
