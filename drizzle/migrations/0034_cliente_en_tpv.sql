-- 0034 · Cliente en la venta del TPV y consentimiento para el ticket por correo.
--
-- Desde la 0030 (rol personal) solo los administradores dan de alta o editan clientes.
-- En la tienda, quien cobra necesita buscar al cliente, darlo de alta con lo mínimo
-- (nombre, correo, teléfono) y apuntar si acepta recibir el ticket por correo. Estas
-- funciones lo permiten a cualquier miembro, con la misma regla de vendedor que las
-- ventas: si el negocio tiene dependientes con PIN, hace falta una sesión de vendedor.
-- No editan nada más del cliente: el resto sigue siendo cosa de administradores.

-- 1. Consentimiento para recibir el ticket por correo --------------------------------
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS receipt_email_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receipt_email_consent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_clients_business_email
  ON public.clients (business_id, lower(email)) WHERE email IS NOT NULL;

-- 2. Quién actúa en el TPV (interna) --------------------------------------------------
-- Miembro activo del negocio; con dependientes con PIN, además una sesión de vendedor
-- válida. Devuelve el empleado de la sesión (o null si el negocio no exige vendedor).
CREATE OR REPLACE FUNCTION public.pos_client_actor(_business_id uuid, _seller_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No perteneces a este negocio' USING ERRCODE = '42501';
  END IF;
  IF _seller_session_id IS NOT NULL THEN
    RETURN seller_from_session(_business_id, _seller_session_id);
  END IF;
  IF business_requires_seller(_business_id) THEN
    RAISE EXCEPTION 'La sesión de vendedor no es válida: vuelve a introducir el PIN' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_client_actor(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Correo normalizado o error si no tiene forma de correo.
CREATE OR REPLACE FUNCTION public.pos_normalize_email(_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  _e text := nullif(lower(btrim(coalesce(_email, ''))), '');
BEGIN
  IF _e IS NOT NULL AND _e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'El correo no es válido' USING ERRCODE = '22023';
  END IF;
  RETURN _e;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_normalize_email(text) FROM PUBLIC, anon, authenticated;

-- 3. Buscar clientes desde el TPV -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pos_search_clients(_business_id uuid, _query text, _limit integer DEFAULT 10)
RETURNS TABLE(id uuid, name text, email text, phone text, receipt_email_consent boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _q text := btrim(coalesce(_query, ''));
  _pattern text;
  _digits text;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No perteneces a este negocio' USING ERRCODE = '42501';
  END IF;
  IF length(_q) < 2 THEN
    RETURN;
  END IF;
  -- Los comodines que escriba el usuario se buscan tal cual.
  _pattern := '%' || replace(replace(replace(_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  _digits := regexp_replace(_q, '\D', '', 'g');
  RETURN QUERY
  SELECT c.id, c.name, c.email, c.phone, c.receipt_email_consent
  FROM clients c
  WHERE c.business_id = _business_id
    AND c.is_active
    AND (
      c.name ILIKE _pattern
      OR c.email ILIKE _pattern
      OR (length(_digits) >= 3 AND regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') LIKE '%' || _digits || '%')
    )
  ORDER BY (lower(c.name) = lower(_q) OR lower(coalesce(c.email, '')) = lower(_q)) DESC, c.name
  LIMIT least(greatest(coalesce(_limit, 10), 1), 25);
END;
$$;
REVOKE ALL ON FUNCTION public.pos_search_clients(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_search_clients(uuid, text, integer) TO authenticated, service_role;

-- 4. Alta mínima (o reutilizar el que ya existe con ese correo o teléfono) --------------
CREATE OR REPLACE FUNCTION public.pos_find_or_create_client(
  _business_id uuid,
  _name text,
  _email text DEFAULT NULL,
  _phone text DEFAULT NULL,
  _receipt_consent boolean DEFAULT false,
  _seller_session_id uuid DEFAULT NULL
)
RETURNS TABLE(client_id uuid, name text, email text, receipt_email_consent boolean, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  _n text := nullif(btrim(coalesce(_name, '')), '');
  _e text;
  _p text := nullif(btrim(coalesce(_phone, '')), '');
  _digits text;
  _c clients%ROWTYPE;
  _id uuid;
BEGIN
  PERFORM pos_client_actor(_business_id, _seller_session_id);
  _e := pos_normalize_email(_email);
  _digits := regexp_replace(coalesce(_p, ''), '\D', '', 'g');

  IF coalesce(_receipt_consent, false) AND _e IS NULL THEN
    RAISE EXCEPTION 'Para enviar el ticket por correo hace falta el correo del cliente' USING ERRCODE = '22023';
  END IF;

  IF _e IS NOT NULL THEN
    SELECT * INTO _c FROM clients c
    WHERE c.business_id = _business_id AND c.is_active AND lower(c.email) = _e
    ORDER BY c.created_at LIMIT 1;
  END IF;
  IF _c.id IS NULL AND length(_digits) >= 6 THEN
    SELECT * INTO _c FROM clients c
    WHERE c.business_id = _business_id AND c.is_active
      AND regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = _digits
    ORDER BY c.created_at LIMIT 1;
  END IF;

  IF _c.id IS NOT NULL THEN
    -- Ya existe: solo se completa el correo si no tenía y se apunta el consentimiento.
    IF _e IS NOT NULL AND _c.email IS NOT NULL AND lower(_c.email) <> _e THEN
      RAISE EXCEPTION 'Ese teléfono es de un cliente con otro correo: búscalo o cámbialo desde Clientes' USING ERRCODE = '22023';
    END IF;
    _id := _c.id;
    UPDATE clients c
    SET email = coalesce(c.email, _e),
        receipt_email_consent = true,
        receipt_email_consent_at = now()
    WHERE c.id = _id AND coalesce(_receipt_consent, false) AND NOT c.receipt_email_consent;
    UPDATE clients c SET email = _e WHERE c.id = _id AND c.email IS NULL AND _e IS NOT NULL;
    SELECT * INTO _c FROM clients c WHERE c.id = _id;
    RETURN QUERY SELECT _c.id, _c.name, _c.email, _c.receipt_email_consent, false;
    RETURN;
  END IF;

  IF _n IS NULL THEN
    RAISE EXCEPTION 'Escribe el nombre del cliente' USING ERRCODE = '22023';
  END IF;
  IF length(_n) > 200 OR length(coalesce(_p, '')) > 40 OR length(coalesce(_e, '')) > 254 THEN
    RAISE EXCEPTION 'Datos del cliente demasiado largos' USING ERRCODE = '22023';
  END IF;

  INSERT INTO clients (business_id, name, email, phone, created_by, notes,
                       receipt_email_consent, receipt_email_consent_at)
  VALUES (_business_id, _n, _e, _p, auth.uid(), 'Alta desde el TPV',
          coalesce(_receipt_consent, false), CASE WHEN coalesce(_receipt_consent, false) THEN now() END)
  RETURNING * INTO _c;
  RETURN QUERY SELECT _c.id, _c.name, _c.email, _c.receipt_email_consent, true;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_find_or_create_client(uuid, text, text, text, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_find_or_create_client(uuid, text, text, text, boolean, uuid) TO authenticated, service_role;

-- 5. Apuntar o retirar el consentimiento de un cliente que ya existe -------------------
CREATE OR REPLACE FUNCTION public.pos_set_receipt_consent(
  _client_id uuid,
  _consent boolean,
  _email text DEFAULT NULL,
  _seller_session_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _c clients%ROWTYPE;
  _e text;
BEGIN
  SELECT * INTO _c FROM clients c WHERE c.id = _client_id;
  IF _c.id IS NULL THEN
    RAISE EXCEPTION 'Cliente no encontrado' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pos_client_actor(_c.business_id, _seller_session_id);
  _e := pos_normalize_email(_email);
  IF _e IS NOT NULL AND _c.email IS NOT NULL AND lower(_c.email) <> _e THEN
    RAISE EXCEPTION 'El cliente tiene otro correo: cámbialo desde Clientes' USING ERRCODE = '22023';
  END IF;
  IF coalesce(_consent, false) AND coalesce(_c.email, _e) IS NULL THEN
    RAISE EXCEPTION 'Para enviar el ticket por correo hace falta el correo del cliente' USING ERRCODE = '22023';
  END IF;
  UPDATE clients c
  SET email = coalesce(c.email, _e),
      receipt_email_consent = coalesce(_consent, false),
      receipt_email_consent_at = CASE
        WHEN coalesce(_consent, false) = c.receipt_email_consent THEN c.receipt_email_consent_at
        ELSE now() END
  WHERE c.id = _c.id;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_set_receipt_consent(uuid, boolean, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_set_receipt_consent(uuid, boolean, text, uuid) TO authenticated, service_role;

-- 6. Poner el cliente a una venta ya cobrada --------------------------------------------
-- Para cuando el cliente pide el ticket por correo después de pagar. Una venta que ya
-- tiene otro cliente solo la cambia un administrador.
CREATE OR REPLACE FUNCTION public.pos_set_sale_client(
  _sale_id uuid,
  _client_id uuid,
  _seller_session_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _business uuid;
  _current uuid;
BEGIN
  SELECT s.business_id, s.client_id INTO _business, _current FROM sales s WHERE s.id = _sale_id;
  IF _business IS NULL THEN
    RAISE EXCEPTION 'Venta no encontrada' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pos_client_actor(_business, _seller_session_id);
  IF NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = _client_id AND c.business_id = _business AND c.is_active) THEN
    RAISE EXCEPTION 'Cliente no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF _current IS NOT NULL AND _current <> _client_id AND NOT has_min_role(_business, 'admin') THEN
    RAISE EXCEPTION 'La venta ya tiene otro cliente: solo un administrador puede cambiarlo' USING ERRCODE = '42501';
  END IF;
  UPDATE sales s SET client_id = _client_id WHERE s.id = _sale_id AND s.client_id IS DISTINCT FROM _client_id;
END;
$$;
REVOKE ALL ON FUNCTION public.pos_set_sale_client(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pos_set_sale_client(uuid, uuid, uuid) TO authenticated, service_role;
