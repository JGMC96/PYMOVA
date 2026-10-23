-- Ventas de la tienda hechas en Stockagile, solo para consultar en PYMOVA.
--
-- Mientras la tienda siga vendiendo con Stockagile, sus tickets se copian aquí (la tarea
-- programada de Stockagile cada 5 minutos, y el historial desde 2022 una vez):
-- · stockagile_sales / stockagile_sale_items: copia de solo lectura. NO son ventas de PYMOVA:
--   no mueven stock (ya lo hace Stockagile) ni crean pedidos en Shopify. Las escribe solo el
--   servidor; las ven los miembros del negocio.
-- · Cada ticket con su importe con signo: las devoluciones van en negativo y un cambio puede
--   quedar en positivo. Los pedidos web que Stockagile también guarda no se copian.
-- · La clienta se une por el correo, como los pedidos web (0044), y sus tickets salen en la
--   ficha como canal «stockagile».

-- 1. Tablas -----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stockagile_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  external_id bigint NOT NULL,
  number text,
  sold_at timestamptz NOT NULL,
  warehouse_name text,
  total numeric(12, 2) NOT NULL DEFAULT 0,
  is_return boolean NOT NULL DEFAULT false,
  return_of_external_id bigint,
  deleted boolean NOT NULL DEFAULT false,
  payment_methods text,
  customer_name text,
  customer_email text,
  customer_phone text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, external_id)
);
CREATE INDEX IF NOT EXISTS stockagile_sales_business_sold_idx ON public.stockagile_sales (business_id, sold_at DESC);
CREATE INDEX IF NOT EXISTS stockagile_sales_client_idx ON public.stockagile_sales (business_id, client_id);

CREATE TABLE IF NOT EXISTS public.stockagile_sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.stockagile_sales(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  size text,
  color text,
  barcode text,
  quantity integer NOT NULL DEFAULT 0,
  unit_price numeric(12, 2),
  total numeric(12, 2),
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS stockagile_sale_items_sale_idx ON public.stockagile_sale_items (sale_id);

ALTER TABLE public.stockagile_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stockagile_sale_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stockagile_sales, public.stockagile_sale_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.stockagile_sales, public.stockagile_sale_items TO authenticated;
GRANT ALL ON public.stockagile_sales, public.stockagile_sale_items TO service_role;

DROP POLICY IF EXISTS "Members view stockagile sales" ON public.stockagile_sales;
CREATE POLICY "Members view stockagile sales" ON public.stockagile_sales
  FOR SELECT TO authenticated USING (public.is_member_of_business(business_id));
DROP POLICY IF EXISTS "Members view stockagile sale items" ON public.stockagile_sale_items;
CREATE POLICY "Members view stockagile sale items" ON public.stockagile_sale_items
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.stockagile_sales s WHERE s.id = sale_id AND public.is_member_of_business(s.business_id)));

ALTER TABLE public.stockagile_connections
  ADD COLUMN IF NOT EXISTS sales_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS sales_history_imported_at timestamptz;

-- 2. Unir la clienta por el correo ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stockagile_sale_link_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.client_id IS NULL AND NEW.customer_email IS NOT NULL THEN
    NEW.client_id := client_id_for_email(NEW.business_id, NEW.customer_email);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.stockagile_sale_link_client() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS stockagile_sales_link_client ON public.stockagile_sales;
CREATE TRIGGER stockagile_sales_link_client
  BEFORE INSERT OR UPDATE OF customer_email, client_id ON public.stockagile_sales
  FOR EACH ROW EXECUTE FUNCTION public.stockagile_sale_link_client();

CREATE OR REPLACE FUNCTION public.client_link_online_orders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.email IS NOT NULL AND btrim(NEW.email) <> '' THEN
    UPDATE online_orders o SET client_id = NEW.id
    WHERE o.business_id = NEW.business_id AND o.client_id IS NULL
      AND lower(o.customer_email) = lower(btrim(NEW.email));
    UPDATE stockagile_sales s SET client_id = NEW.id
    WHERE s.business_id = NEW.business_id AND s.client_id IS NULL
      AND lower(s.customer_email) = lower(btrim(NEW.email));
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.client_link_online_orders() FROM PUBLIC, anon, authenticated;

-- 3. Compras de cada clienta con los tickets de Stockagile --------------------------------------
CREATE OR REPLACE FUNCTION public.client_purchases(_business_id uuid)
RETURNS TABLE(client_id uuid, channel text, purchase_id uuid, number text, created_at timestamptz,
              total numeric, net numeric, status text, payment_method text)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT s.client_id, 'store', s.id, s.sale_number, s.created_at, s.total,
         s.total - COALESCE((SELECT sum(r.total) FROM sale_returns r WHERE r.sale_id = s.id), 0),
         CASE WHEN EXISTS (SELECT 1 FROM sale_returns r WHERE r.sale_id = s.id) THEN 'returned' ELSE 'done' END,
         s.payment_method
  FROM sales s
  WHERE s.business_id = _business_id AND s.client_id IS NOT NULL
  UNION ALL
  SELECT o.client_id, 'online', o.id, o.order_number, o.created_at, o.total,
         CASE WHEN o.status::text IN ('cancelled', 'returned') OR o.payment_status::text = 'refunded' THEN 0 ELSE o.total END,
         CASE WHEN o.payment_status::text = 'refunded' AND o.status::text NOT IN ('cancelled', 'returned') THEN 'refunded'
              ELSE o.status::text END,
         o.payment_method
  FROM online_orders o
  WHERE o.business_id = _business_id AND o.client_id IS NOT NULL
  UNION ALL
  SELECT k.client_id, 'stockagile', k.id, k.number, k.sold_at, k.total, k.total,
         CASE WHEN k.is_return AND k.total <= 0 THEN 'returned' WHEN k.is_return THEN 'exchange' ELSE 'done' END,
         k.payment_methods
  FROM stockagile_sales k
  WHERE k.business_id = _business_id AND k.client_id IS NOT NULL AND NOT k.deleted;
$$;
REVOKE ALL ON FUNCTION public.client_purchases(uuid) FROM PUBLIC, anon, authenticated;

-- 4. Ficha de la clienta (líneas de los tickets de Stockagile) -----------------------------------
CREATE OR REPLACE FUNCTION public.get_client_history(_business_id uuid, _client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _result jsonb;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este negocio' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = _client_id AND c.business_id = _business_id) THEN
    RAISE EXCEPTION 'Cliente no encontrado' USING ERRCODE = '22023';
  END IF;

  WITH p AS (
    SELECT * FROM client_purchases(_business_id) x WHERE x.client_id = _client_id
  ),
  items AS (
    SELECT 'store'::text AS channel, i.sale_id AS purchase_id, i.product_name, i.quantity, i.total,
           i.product_id, i.variant_id
    FROM sale_items i JOIN p ON p.channel = 'store' AND p.purchase_id = i.sale_id
    UNION ALL
    SELECT 'online', i.order_id, i.product_name, i.quantity, i.total, i.product_id, i.variant_id
    FROM online_order_items i JOIN p ON p.channel = 'online' AND p.purchase_id = i.order_id
    UNION ALL
    SELECT 'stockagile', i.sale_id, i.product_name, i.quantity, i.total, v2.product_id, i.variant_id
    FROM stockagile_sale_items i JOIN p ON p.channel = 'stockagile' AND p.purchase_id = i.sale_id
    LEFT JOIN product_variants v2 ON v2.id = i.variant_id
  ),
  -- Talla y modelo de lo que se quedó (sin compras devueltas ni canceladas).
  kept AS (
    SELECT it.*, NULLIF(btrim(COALESCE(v.attributes->>'Talla',
             substring(it.product_name FROM ' - ([0-9]{2}(?:[.,]5)?)$'))), '') AS talla,
           COALESCE(pr.name, regexp_replace(it.product_name, ' - [^-]*$', '')) AS modelo
    FROM items it
    JOIN p ON p.channel = it.channel AND p.purchase_id = it.purchase_id AND p.net > 0
    LEFT JOIN product_variants v ON v.id = it.variant_id
    LEFT JOIN products pr ON pr.id = it.product_id
  )
  SELECT jsonb_build_object(
    'summary', (
      SELECT jsonb_build_object(
        'purchases', count(*) FILTER (WHERE p.net > 0),
        'spent', COALESCE(sum(p.net), 0),
        'average', CASE WHEN count(*) FILTER (WHERE p.net > 0) > 0
                        THEN round(sum(p.net) / count(*) FILTER (WHERE p.net > 0), 2) ELSE 0 END,
        'first_purchase_at', min(p.created_at),
        'last_purchase_at', max(p.created_at),
        'store_purchases', count(*) FILTER (WHERE p.channel IN ('store', 'stockagile') AND p.net > 0),
        'online_purchases', count(*) FILTER (WHERE p.channel = 'online' AND p.net > 0),
        'returned', count(*) FILTER (WHERE p.status IN ('returned', 'refunded', 'cancelled'))
      ) FROM p
    ),
    'sizes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('size', s.talla, 'units', s.units) ORDER BY s.units DESC, s.talla)
      FROM (SELECT k.talla, sum(k.quantity) AS units FROM kept k WHERE k.talla IS NOT NULL GROUP BY k.talla) s
    ), '[]'::jsonb),
    'models', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', m.modelo, 'units', m.units) ORDER BY m.units DESC, m.modelo)
      FROM (SELECT k.modelo, sum(k.quantity) AS units FROM kept k GROUP BY k.modelo ORDER BY 2 DESC, 1 LIMIT 8) m
    ), '[]'::jsonb),
    'purchases', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'channel', p.channel, 'id', p.purchase_id, 'number', p.number, 'created_at', p.created_at,
        'total', p.total, 'net', p.net, 'status', p.status, 'payment_method', p.payment_method,
        'items', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('name', it.product_name, 'quantity', it.quantity, 'total', it.total)
                           ORDER BY it.product_name)
          FROM items it WHERE it.channel = p.channel AND it.purchase_id = p.purchase_id
        ), '[]'::jsonb)
      ) ORDER BY p.created_at DESC)
      FROM p
    ), '[]'::jsonb)
  ) INTO _result;
  RETURN _result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_client_history(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_history(uuid, uuid) TO authenticated, service_role;
