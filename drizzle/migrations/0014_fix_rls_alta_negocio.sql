-- C1 · Alta de negocio solo por RPC y cierre del auto-alta en negocios ajenos.
-- A5 · El owner ya no puede cambiar su plan ni activar módulos desde el cliente.
-- A13 · El onboarding pasa a una única transacción en el servidor.
-- Ver docs/AUDITORIA.md. Migración idempotente.

-- 1. RPC de alta de negocio --------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_business(_name text, _industry text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _clean_name text := btrim(coalesce(_name, ''));
  _base_slug text;
  _slug text;
  _plan_id uuid;
  _business_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para crear un negocio' USING ERRCODE = '42501';
  END IF;

  IF _clean_name = '' THEN
    RAISE EXCEPTION 'El nombre del negocio es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF char_length(_clean_name) > 120 THEN
    RAISE EXCEPTION 'El nombre del negocio no puede superar los 120 caracteres' USING ERRCODE = '22023';
  END IF;

  IF public.owned_business_count(_uid) >= 10 THEN
    RAISE EXCEPTION 'Has alcanzado el máximo de 10 negocios propios' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO _plan_id FROM plans WHERE key = 'trial' AND is_active;
  IF _plan_id IS NULL THEN
    RAISE EXCEPTION 'No hay un plan de prueba activo';
  END IF;

  -- Slug sin depender de unaccent ni del locale: sin tildes, minúsculas y con guiones.
  _base_slug := btrim(
    regexp_replace(
      lower(translate(_clean_name,
        'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç',
        'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc')),
      '[^a-z0-9]+', '-', 'g'),
    '-');
  IF _base_slug = '' THEN
    _base_slug := 'negocio';
  END IF;
  _slug := _base_slug;
  WHILE EXISTS (SELECT 1 FROM businesses WHERE slug = _slug) LOOP
    _slug := _base_slug || '-' || substr(md5(random()::text), 1, 6);
  END LOOP;

  INSERT INTO businesses (name, slug, industry, currency, timezone)
  VALUES (_clean_name, _slug, nullif(btrim(coalesce(_industry, '')), ''), 'EUR', 'Europe/Madrid')
  RETURNING id INTO _business_id;

  INSERT INTO business_members (business_id, user_id, role, is_active, joined_at)
  VALUES (_business_id, _uid, 'owner', true, now());

  -- El trigger sync_modules_on_subscription_change activa los módulos del plan.
  INSERT INTO subscriptions (business_id, plan_id, status)
  VALUES (_business_id, _plan_id, 'trialing');

  INSERT INTO business_settings (business_id, next_invoice_number, invoice_prefix, tax_rate)
  VALUES (_business_id, 1, 'FAC-', 21)
  ON CONFLICT (business_id) DO NOTHING;

  UPDATE profiles SET active_business_id = _business_id, updated_at = now() WHERE id = _uid;

  RETURN _business_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_business(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_business(text, text) TO authenticated, service_role;

-- 2. business_members: sin auto-alta ------------------------------------------
-- La rama «alta inicial» evaluaba el NOT EXISTS con la RLS del propio usuario,
-- que no ve a los miembros de un negocio ajeno: cualquiera podía hacerse owner.
DROP POLICY IF EXISTS "Owner/Admin can insert members" ON public.business_members;
CREATE POLICY "Owner/Admin can insert members"
ON public.business_members FOR INSERT
TO authenticated
WITH CHECK (
  public.has_business_role(business_id, 'owner'::app_role)
  OR (public.has_min_role(business_id, 'admin'::app_role) AND role <> 'owner'::app_role)
);

-- 3. businesses: solo se crean con create_business -----------------------------
DROP POLICY IF EXISTS "Users can create their own businesses" ON public.businesses;
DROP POLICY IF EXISTS "Authenticated users can create businesses" ON public.businesses;

-- 4. subscriptions y business_modules: de solo lectura para los miembros -------
-- Los cambios de plan y de módulos los hace el super admin (sus políticas siguen).
DROP POLICY IF EXISTS "Owner can manage subscription" ON public.subscriptions;
DROP POLICY IF EXISTS "Owner can manage modules" ON public.business_modules;
