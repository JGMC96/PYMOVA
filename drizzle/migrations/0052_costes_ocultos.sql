-- Costes ocultos también en el servidor (Equipo y permisos, 23/10/2026).
--
-- Desde la 0031, el rol personal no ve el coste en pantalla, pero la API se lo daba: las
-- tablas tenían SELECT sobre todas las columnas y la RLS solo filtra filas. Desde ahora:
--
-- 1. get_catalog_costs: el precio de coste de productos y tallas, solo para quien tiene el
--    permiso «Ver costes» (member_can 'see_costs': propietarios, administradores y quien
--    tenga el permiso a medida). La app lo usa desde la PR #69.
-- 2. La columna de coste no se puede leer con la cuenta del usuario (authenticated ni anon)
--    en products, product_variants, sale_items, sale_return_items y
--    shopify_inventory_pushes. El resto de columnas, sí. INSERT, UPDATE y DELETE no cambian:
--    quien puede editar el catálogo sigue guardando el coste.
--
-- Las RPC de ventas, devoluciones y compras son SECURITY DEFINER y las edge functions usan el
-- rol de servicio: siguen leyendo y guardando el coste como antes.
--
-- Ojo: una columna nueva en estas cinco tablas no se puede leer desde la app hasta darle su
-- GRANT SELECT (columna) TO authenticated, anon. Lo vigila src/test/rls/costes-ocultos.test.ts.

-- 1. Costes con permiso ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_catalog_costs(_business_id uuid, _product_id uuid DEFAULT NULL)
RETURNS TABLE(kind text, id uuid, cost_price numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.member_can(_business_id, 'see_costs') THEN
    RAISE EXCEPTION 'No tienes permiso para ver los costes de este negocio' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT 'product'::text, p.id, p.cost_price::numeric
    FROM products p
    WHERE p.business_id = _business_id AND p.cost_price IS NOT NULL
      AND (_product_id IS NULL OR p.id = _product_id)
    UNION ALL
    SELECT 'variant'::text, v.id, v.cost_price::numeric
    FROM product_variants v
    WHERE v.business_id = _business_id AND v.cost_price IS NOT NULL
      AND (_product_id IS NULL OR v.product_id = _product_id)
    ORDER BY 1, 2;
END;
$$;

REVOKE ALL ON FUNCTION public.get_catalog_costs(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_catalog_costs(uuid, uuid) TO authenticated, service_role;

-- 2. Lectura por columnas, sin el coste ----------------------------------------------------------
-- Quitar el SELECT de tabla quita también los de columna; luego se dan todas las columnas
-- menos la del coste. Se puede volver a aplicar.
DO $$
DECLARE
  _t record;
  _cols text;
BEGIN
  FOR _t IN
    SELECT * FROM (VALUES
      ('products', 'cost_price'),
      ('product_variants', 'cost_price'),
      ('sale_items', 'unit_cost'),
      ('sale_return_items', 'unit_cost'),
      ('shopify_inventory_pushes', 'unit_cost')
    ) AS x(tabla, coste)
  LOOP
    SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position) INTO _cols
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = _t.tabla AND c.column_name <> _t.coste;

    EXECUTE format('REVOKE SELECT ON public.%I FROM authenticated, anon', _t.tabla);
    EXECUTE format('GRANT SELECT (%s) ON public.%I TO authenticated, anon', _cols, _t.tabla);
  END LOOP;
END;
$$;
