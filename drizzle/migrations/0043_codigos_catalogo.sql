-- Códigos para productos nuevos: EAN-13 de la serie del negocio y SKU con su formato, solo
-- para las tallas que no tienen. Nunca cambia un código existente.
--
-- · business_settings.ean_prefix / sku_pattern: la serie EAN (prefijo; el resto, contador y
--   dígito de control) y el formato del SKU. Tuilus sigue la serie de Stockagile, 9600000.
-- · catalog_code_reservations: cada código entregado queda reservado, aunque luego falle
--   Shopify, para que nunca se repita.
-- · Mientras Stockagile esté conectado (él también reparte esa serie), no se reserva nada:
--   la pantalla funciona en vista previa.
-- · Genera quien puede editar el catálogo (member_can 'edit_catalog').

-- 1. Ajustes ------------------------------------------------------------------------------------
ALTER TABLE public.business_settings
  ADD COLUMN IF NOT EXISTS ean_prefix text,
  ADD COLUMN IF NOT EXISTS sku_pattern text;
DO $$ BEGIN
  ALTER TABLE public.business_settings ADD CONSTRAINT business_settings_ean_prefix_check CHECK (ean_prefix ~ '^[0-9]{2,9}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.business_settings ADD CONSTRAINT business_settings_sku_pattern_check CHECK (length(sku_pattern) BETWEEN 1 AND 120);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- TUILUS: la serie y el formato de Stockagile.
UPDATE public.business_settings
SET ean_prefix = COALESCE(ean_prefix, '9600000'),
    sku_pattern = COALESCE(sku_pattern, 'T{TEMPORADA}{TIPO}{MODELO}{COLOR}{TALLA}')
WHERE business_id = 'c84f3b72-ae45-4501-a454-79cf47b888b4';

-- 2. Códigos reservados ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.catalog_code_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('barcode', 'sku')),
  code text NOT NULL,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, kind, code)
);
ALTER TABLE public.catalog_code_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalog_code_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.catalog_code_reservations TO service_role;

-- 3. Dígito de control EAN-13 --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ean13_check_digit(_first12 text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT (10 - (sum(substr(_first12, i, 1)::integer * CASE WHEN i % 2 = 1 THEN 1 ELSE 3 END) % 10)) % 10
  FROM generate_series(1, 12) AS i;
$$;

-- 4. Estado: si está bloqueado (Stockagile) y los ajustes ------------------------------------------
CREATE OR REPLACE FUNCTION public.catalog_codes_status(_business_id uuid)
RETURNS TABLE(locked boolean, can_generate boolean, ean_prefix text, sku_pattern text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este negocio' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT EXISTS (SELECT 1 FROM stockagile_connections s WHERE s.business_id = _business_id AND s.enabled),
         member_can(_business_id, 'edit_catalog'),
         COALESCE(bs.ean_prefix, '200'),
         COALESCE(bs.sku_pattern, 'T{TEMPORADA}{TIPO}{MODELO}{COLOR}{TALLA}')
  FROM (SELECT 1) one
  LEFT JOIN business_settings bs ON bs.business_id = _business_id;
END;
$$;
REVOKE ALL ON FUNCTION public.catalog_codes_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalog_codes_status(uuid) TO authenticated, service_role;

-- 5. Siguientes EAN de la serie (vista previa, o reservados) ---------------------------------------
CREATE OR REPLACE FUNCTION public.next_barcodes(_business_id uuid, _count integer, _reserve boolean DEFAULT false)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _prefix text;
  _digits integer;
  _max bigint;
  _codes text[] := '{}';
  _first12 text;
  _i integer;
BEGIN
  IF NOT member_can(_business_id, 'edit_catalog') THEN
    RAISE EXCEPTION 'No tienes permiso para generar códigos' USING ERRCODE = '42501';
  END IF;
  IF _count IS NULL OR _count < 1 OR _count > 200 THEN
    RAISE EXCEPTION 'Se pueden generar de 1 a 200 códigos cada vez' USING ERRCODE = '22023';
  END IF;
  IF _reserve AND EXISTS (SELECT 1 FROM stockagile_connections s WHERE s.business_id = _business_id AND s.enabled) THEN
    RAISE EXCEPTION 'Mientras Stockagile esté conectado, los códigos se crean en Stockagile' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(bs.ean_prefix, '200') INTO _prefix FROM business_settings bs WHERE bs.business_id = _business_id;
  _prefix := COALESCE(_prefix, '200');
  _digits := 12 - length(_prefix);
  IF _reserve THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('catalog_barcodes:' || _business_id::text, 0));
  END IF;

  SELECT max(substr(c, length(_prefix) + 1, _digits)::bigint) INTO _max
  FROM (
    SELECT v.barcode AS c FROM product_variants v WHERE v.business_id = _business_id
    UNION ALL SELECT p.barcode FROM products p WHERE p.business_id = _business_id
    UNION ALL SELECT r.code FROM catalog_code_reservations r WHERE r.business_id = _business_id AND r.kind = 'barcode'
  ) x
  WHERE c ~ '^[0-9]{13}$' AND left(c, length(_prefix)) = _prefix;

  FOR _i IN 1.._count LOOP
    IF COALESCE(_max, 0) + _i >= power(10, _digits)::bigint THEN
      RAISE EXCEPTION 'La serie de códigos % está llena', _prefix USING ERRCODE = '22023';
    END IF;
    _first12 := _prefix || lpad((COALESCE(_max, 0) + _i)::text, _digits, '0');
    _codes := _codes || (_first12 || ean13_check_digit(_first12)::text);
  END LOOP;

  IF _reserve THEN
    INSERT INTO catalog_code_reservations (business_id, kind, code)
    SELECT _business_id, 'barcode', unnest(_codes);
  END IF;
  RETURN _codes;
END;
$$;
REVOKE ALL ON FUNCTION public.next_barcodes(uuid, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_barcodes(uuid, integer, boolean) TO authenticated, service_role;

-- 6. Reservar los códigos de las tallas de un producto ------------------------------------------
-- _items: [{ variant_id, sku: text | null, barcode: 'auto' | null }]. Solo tallas sin ese código.
-- Un SKU reservado sirve de nuevo para la misma talla (si Shopify falló y se reintenta); los EAN
-- no: cada intento usa los siguientes y los anteriores quedan como huecos de la serie.
CREATE OR REPLACE FUNCTION public.reserve_catalog_codes(_business_id uuid, _product_id uuid, _items jsonb)
RETURNS TABLE(variant_id uuid, variant_external_id text, product_external_id text, sku text, barcode text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  _item jsonb;
  _v product_variants%ROWTYPE;
  _sku text;
  _want_barcode boolean;
  _need integer := 0;
  _barcodes text[];
  _n integer := 0;
  _product_ext text;
  _skus text[] := '{}';
  _rows jsonb := '[]'::jsonb;
  _r jsonb;
BEGIN
  IF NOT member_can(_business_id, 'edit_catalog') THEN
    RAISE EXCEPTION 'No tienes permiso para generar códigos' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM stockagile_connections s WHERE s.business_id = _business_id AND s.enabled) THEN
    RAISE EXCEPTION 'Mientras Stockagile esté conectado, los códigos se crean en Stockagile' USING ERRCODE = '42501';
  END IF;
  SELECT p.external_id INTO _product_ext FROM products p WHERE p.id = _product_id AND p.business_id = _business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado' USING ERRCODE = '22023';
  END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'No hay tallas a las que poner código' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('catalog_skus:' || _business_id::text, 0));

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    SELECT * INTO _v FROM product_variants v
    WHERE v.id = (_item->>'variant_id')::uuid AND v.product_id = _product_id AND v.business_id = _business_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Una talla no es de este producto' USING ERRCODE = '22023';
    END IF;
    _sku := NULLIF(btrim(COALESCE(_item->>'sku', '')), '');
    _want_barcode := COALESCE(_item->>'barcode', '') = 'auto';
    IF _sku IS NOT NULL THEN
      IF NULLIF(btrim(COALESCE(_v.sku, '')), '') IS NOT NULL THEN
        RAISE EXCEPTION 'La talla % ya tiene SKU: no se cambia', _v.name USING ERRCODE = '22023';
      END IF;
      IF _sku !~ '^[A-Za-z0-9._-]{1,64}$' THEN
        RAISE EXCEPTION 'El SKU % solo puede llevar letras, números, punto, guion y guion bajo', _sku USING ERRCODE = '22023';
      END IF;
      IF upper(_sku) = ANY (SELECT upper(unnest(_skus)))
         OR EXISTS (SELECT 1 FROM product_variants o WHERE o.business_id = _business_id AND upper(o.sku) = upper(_sku))
         OR EXISTS (SELECT 1 FROM products o WHERE o.business_id = _business_id AND upper(o.sku) = upper(_sku))
         OR EXISTS (SELECT 1 FROM catalog_code_reservations r WHERE r.business_id = _business_id AND r.kind = 'sku'
                    AND upper(r.code) = upper(_sku) AND r.variant_id IS DISTINCT FROM _v.id) THEN
        RAISE EXCEPTION 'El SKU % ya existe', _sku USING ERRCODE = '23505';
      END IF;
      _skus := _skus || _sku;
    END IF;
    IF _want_barcode THEN
      IF NULLIF(btrim(COALESCE(_v.barcode, '')), '') IS NOT NULL THEN
        RAISE EXCEPTION 'La talla % ya tiene código de barras: no se cambia', _v.name USING ERRCODE = '22023';
      END IF;
      _need := _need + 1;
    END IF;
    IF _sku IS NULL AND NOT _want_barcode THEN CONTINUE; END IF;
    _rows := _rows || jsonb_build_object('variant_id', _v.id, 'ext', _v.external_id, 'sku', _sku, 'barcode', _want_barcode);
  END LOOP;

  IF jsonb_array_length(_rows) = 0 THEN
    RAISE EXCEPTION 'No hay códigos que poner' USING ERRCODE = '22023';
  END IF;
  IF _need > 0 THEN
    _barcodes := next_barcodes(_business_id, _need, true);
  END IF;

  FOR _r IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    IF (_r->>'sku') IS NOT NULL THEN
      INSERT INTO catalog_code_reservations (business_id, kind, code, variant_id)
      VALUES (_business_id, 'sku', _r->>'sku', (_r->>'variant_id')::uuid)
      ON CONFLICT (business_id, kind, code) DO NOTHING; -- reintento en la misma talla
    END IF;
    IF (_r->>'barcode')::boolean THEN
      _n := _n + 1;
      UPDATE catalog_code_reservations c SET variant_id = (_r->>'variant_id')::uuid
      WHERE c.business_id = _business_id AND c.kind = 'barcode' AND c.code = _barcodes[_n];
    END IF;
    variant_id := (_r->>'variant_id')::uuid;
    variant_external_id := _r->>'ext';
    product_external_id := _product_ext;
    sku := _r->>'sku';
    barcode := CASE WHEN (_r->>'barcode')::boolean THEN _barcodes[_n] END;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_catalog_codes(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_catalog_codes(uuid, uuid, jsonb) TO authenticated, service_role;
