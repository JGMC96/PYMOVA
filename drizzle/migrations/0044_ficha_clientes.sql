-- Ficha de clienta: sus compras de la tienda (TPV) y de la web (Shopify) juntas.
--
-- · Los pedidos online se unen a la clienta por su correo (en Shopify cada correo es una
--   clienta). Se rellenan los que ya hay y, desde ahora, los nuevos al entrar; si la
--   clienta llega después que el pedido, al crearla o cambiar su correo.
-- · list_clients_with_stats: lista paginada (la de antes se cortaba en 1.000) con compras,
--   gasto neto y última compra; busca sin tildes y ordena por nombre, gasto o fecha.
-- · get_client_history: la ficha (resumen, talla habitual, modelos y cada compra con sus
--   artículos). Gasto neto: en tienda, venta menos devoluciones; en la web, los pedidos
--   cancelados, devueltos o reembolsados no suman.
-- · Lo ve cualquier miembro del negocio, como la lista de clientes.

-- 1. Unir los pedidos online a la clienta ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_id_for_email(_business_id uuid, _email text)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT c.id FROM clients c
  WHERE c.business_id = _business_id AND _email IS NOT NULL AND btrim(_email) <> ''
    AND lower(c.email) = lower(btrim(_email))
  ORDER BY c.is_active DESC, c.created_at
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.client_id_for_email(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.online_order_link_client()
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
REVOKE ALL ON FUNCTION public.online_order_link_client() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS online_orders_link_client ON public.online_orders;
CREATE TRIGGER online_orders_link_client
  BEFORE INSERT OR UPDATE OF customer_email, client_id ON public.online_orders
  FOR EACH ROW EXECUTE FUNCTION public.online_order_link_client();

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
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.client_link_online_orders() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clients_link_online_orders ON public.clients;
CREATE TRIGGER clients_link_online_orders
  AFTER INSERT OR UPDATE OF email ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.client_link_online_orders();

-- Los que ya hay.
UPDATE public.online_orders o
SET client_id = public.client_id_for_email(o.business_id, o.customer_email)
WHERE o.client_id IS NULL AND o.customer_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS online_orders_client_idx ON public.online_orders (business_id, client_id);
CREATE INDEX IF NOT EXISTS sales_client_idx ON public.sales (business_id, client_id);

-- 2. Compras de cada clienta (una fila por compra) -----------------------------------------------
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
  WHERE o.business_id = _business_id AND o.client_id IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.client_purchases(uuid) FROM PUBLIC, anon, authenticated;

-- 3. Lista de clientas con sus números ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_clients_with_stats(
  _business_id uuid,
  _search text DEFAULT NULL,
  _include_inactive boolean DEFAULT false,
  _sort text DEFAULT 'name',
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, name text, email text, phone text, company text, notes text, is_active boolean,
              created_at timestamptz, purchases bigint, spent numeric, last_purchase_at timestamptz,
              total_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _q text := NULLIF(translate(lower(btrim(COALESCE(_search, ''))), 'áéíóúàèìòùäëïöüâêîôûñç', 'aeiouaeiouaeiouaeiounc'), '');
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes acceso a este negocio' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH stats AS (
    SELECT p.client_id, count(*) FILTER (WHERE p.net > 0) AS purchases, sum(p.net) AS spent, max(p.created_at) AS last_at
    FROM client_purchases(_business_id) p
    GROUP BY p.client_id
  ),
  filtered AS (
    SELECT c.*, COALESCE(st.purchases, 0) AS purchases, COALESCE(st.spent, 0) AS spent, st.last_at
    FROM clients c
    LEFT JOIN stats st ON st.client_id = c.id
    WHERE c.business_id = _business_id
      AND (_include_inactive OR c.is_active)
      AND (_q IS NULL
        OR translate(lower(c.name), 'áéíóúàèìòùäëïöüâêîôûñç', 'aeiouaeiouaeiouaeiounc') LIKE '%' || _q || '%'
        OR lower(COALESCE(c.email, '')) LIKE '%' || _q || '%'
        OR replace(COALESCE(c.phone, ''), ' ', '') LIKE '%' || replace(_q, ' ', '') || '%')
  )
  SELECT f.id, f.name, f.email, f.phone, f.company, f.notes, f.is_active, f.created_at,
         f.purchases, f.spent, f.last_at, count(*) OVER ()
  FROM filtered f
  ORDER BY
    CASE WHEN _sort = 'spent' THEN f.spent END DESC NULLS LAST,
    CASE WHEN _sort = 'last_purchase' THEN f.last_at END DESC NULLS LAST,
    CASE WHEN _sort = 'purchases' THEN f.purchases END DESC NULLS LAST,
    f.name, f.id
  LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(_offset, 0), 0);
END;
$$;
REVOKE ALL ON FUNCTION public.list_clients_with_stats(uuid, text, boolean, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_clients_with_stats(uuid, text, boolean, text, integer, integer) TO authenticated, service_role;

-- 4. Ficha de una clienta -------------------------------------------------------------------------
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
        'store_purchases', count(*) FILTER (WHERE p.channel = 'store' AND p.net > 0),
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
