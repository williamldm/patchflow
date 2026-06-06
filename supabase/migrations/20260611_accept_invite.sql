-- ── Acceptation d'invitation par l'invité (sécurisé) ──
-- La policy members_insert n'autorise que le propriétaire du show à ajouter
-- des membres. Un invité ne peut donc pas s'auto-ajouter. Cette fonction
-- SECURITY DEFINER permet à un utilisateur d'accepter UNIQUEMENT une
-- invitation adressée à sa propre adresse email, et de s'ajouter lui-même.

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
  IF v_inv.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invite_not_found');
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

  RETURN jsonb_build_object('ok', true, 'show_id', v_inv.show_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_show_invite(uuid) TO authenticated;
