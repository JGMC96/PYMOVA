CREATE TABLE public.business_invitations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  email text NOT NULL,
  role app_role NOT NULL DEFAULT 'staff',
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  status text NOT NULL DEFAULT 'pending',
  invited_by uuid,
  accepted_by uuid,
  accepted_at timestamp with time zone,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT business_invitations_status_check CHECK (status IN ('pending','accepted','revoked'))
);

CREATE UNIQUE INDEX business_invitations_unique_pending
  ON public.business_invitations (business_id, lower(email))
  WHERE status = 'pending';

CREATE INDEX business_invitations_email_idx ON public.business_invitations (lower(email));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_invitations TO authenticated;
GRANT ALL ON public.business_invitations TO service_role;

ALTER TABLE public.business_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view invitations of their business"
  ON public.business_invitations FOR SELECT TO authenticated
  USING (public.has_min_role(business_id, 'admin') OR public.is_super_admin());

CREATE POLICY "Admins can create invitations"
  ON public.business_invitations FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_min_role(business_id, 'admin') OR public.is_super_admin())
    AND invited_by = auth.uid()
  );

CREATE POLICY "Admins can update invitations"
  ON public.business_invitations FOR UPDATE TO authenticated
  USING (public.has_min_role(business_id, 'admin') OR public.is_super_admin())
  WITH CHECK (public.has_min_role(business_id, 'admin') OR public.is_super_admin());

CREATE POLICY "Admins can delete invitations"
  ON public.business_invitations FOR DELETE TO authenticated
  USING (public.has_min_role(business_id, 'admin') OR public.is_super_admin());

CREATE TRIGGER update_business_invitations_updated_at
  BEFORE UPDATE ON public.business_invitations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Accept an invitation with the signed-in user's verified email
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

-- List team members with their emails (members only)
CREATE OR REPLACE FUNCTION public.get_business_team(_business_id uuid)
RETURNS TABLE(user_id uuid, full_name text, email text, role app_role, is_active boolean, joined_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_member_of_business(_business_id) AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'No tienes permiso para ver el equipo de este negocio';
  END IF;

  RETURN QUERY
  SELECT bm.user_id, p.full_name, u.email::text, bm.role, bm.is_active, bm.joined_at
  FROM public.business_members bm
  LEFT JOIN public.profiles p ON p.id = bm.user_id
  LEFT JOIN auth.users u ON u.id = bm.user_id
  WHERE bm.business_id = _business_id
  ORDER BY bm.role, p.full_name NULLS LAST;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_business_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_business_team(uuid) TO authenticated;