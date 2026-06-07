-- ── accept_show_invite IDEMPOTENT ──
-- BUG : la fonction supprimait l'invitation au premier succès. Comme
-- onAuthStateChange déclenche initApp() plusieurs fois (INITIAL_SESSION,
-- SIGNED_IN, TOKEN_REFRESHED), l'auto-accept se lançait 2× : le 1er appel
-- réussissait (l'utilisateur rejoint), le 2e renvoyait 'invite_not_found'
-- → toast "le lien a déjà été utilisé" alors que l'utilisateur AVAIT rejoint.
--
-- Fix : quand l'invitation n'existe plus, on renvoie ok=true avec already=true
-- (idempotent) au lieu d'une erreur. Aucun membership n'est accordé à tort
-- (on ne touche pas show_members dans ce cas), c'est juste un signal "déjà fait".

CREATE OR REPLACE FUNCTION public.accept_show_invite(p_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_inv   public.show_invites%ROWTYPE;
BEGIN
  -- Email de l'appelant
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  -- Récupérer l'invitation
  SELECT * INTO v_inv FROM public.show_invites WHERE id = p_invite_id;

  -- Invitation déjà consommée (double-fire / re-clic) → succès idempotent
  IF v_inv.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  -- Vérifier que l'invitation est bien adressée à l'appelant
  IF lower(v_inv.invited_email) <> lower(v_email) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_your_invite');
  END IF;

  -- Ajouter l'appelant comme membre (lui-même uniquement)
  INSERT INTO public.show_members (show_id, user_id, role)
  VALUES (v_inv.show_id, auth.uid(), v_inv.role)
  ON CONFLICT (show_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  -- Consommer l'invitation
  DELETE FROM public.show_invites WHERE id = p_invite_id;

  RETURN jsonb_build_object('ok', true, 'show_id', v_inv.show_id, 'joined', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_show_invite(uuid) TO authenticated;
