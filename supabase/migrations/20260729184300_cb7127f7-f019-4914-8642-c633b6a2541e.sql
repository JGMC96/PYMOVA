CREATE OR REPLACE FUNCTION public.accept_business_invitation(_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _inv business_invitations%ROWTYPE;
  _email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para aceptar la invitación';
  END IF;

  SELECT lower(u.email) INTO _email FROM auth.users u WHERE u.id = auth.uid();

  SELECT * INTO _inv
  FROM public.business_invitations
  WHERE token = _token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitación no encontrada';
  END IF;

  -- Idempotent: already accepted by this same user (double click / re-open link)
  IF _inv.status = 'accepted' AND _inv.accepted_by = auth.uid() THEN
    RETURN _inv.business_id;
  END IF;

  -- Already a member of that business: nothing to do
  IF EXISTS (
    SELECT 1 FROM public.business_members bm
    WHERE bm.business_id = _inv.business_id AND bm.user_id = auth.uid() AND bm.is_active
  ) AND lower(_inv.email) = _email THEN
    RETURN _inv.business_id;
  END IF;

  IF _inv.status <> 'pending' THEN
    RAISE EXCEPTION 'Esta invitación ya no está disponible';
  END IF;

  IF _inv.expires_at < now() THEN
    RAISE EXCEPTION 'La invitación ha caducado';
  END IF;

  IF lower(_inv.email) <> _email THEN
    RAISE EXCEPTION 'Esta invitación pertenece a otro correo electrónico';
  END IF;

  INSERT INTO public.business_members (business_id, user_id, role, is_active, joined_at)
  VALUES (_inv.business_id, auth.uid(), _inv.role, true, now())
  ON CONFLICT (business_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, is_active = true, joined_at = COALESCE(business_members.joined_at, now());

  UPDATE public.business_invitations
  SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now(), updated_at = now()
  WHERE id = _inv.id;

  RETURN _inv.business_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_business_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_business_invitation(text) TO authenticated;