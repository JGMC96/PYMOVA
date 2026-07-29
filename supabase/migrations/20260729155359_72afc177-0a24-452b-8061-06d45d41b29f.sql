-- 1. Store profile on businesses
DO $$ BEGIN
  CREATE TYPE public.store_profile AS ENUM ('general','shoe_store','bar','florist','bakery','fashion');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS store_profile public.store_profile NOT NULL DEFAULT 'general';

-- 2. Products: barcode + sku
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS barcode text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sku text;
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products (business_id, barcode);

-- 3. Product variants
CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name text NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  sku text,
  barcode text,
  price numeric(12,2),
  stock_quantity integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON public.product_variants (product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_barcode ON public.product_variants (business_id, barcode);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_variants TO authenticated;
GRANT ALL ON public.product_variants TO service_role;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "variants_select_members" ON public.product_variants FOR SELECT TO authenticated
  USING (public.is_member_of_business(business_id) OR public.is_super_admin());
CREATE POLICY "variants_insert_members" ON public.product_variants FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of_business(business_id));
CREATE POLICY "variants_update_members" ON public.product_variants FOR UPDATE TO authenticated
  USING (public.is_member_of_business(business_id)) WITH CHECK (public.is_member_of_business(business_id));
CREATE POLICY "variants_delete_admins" ON public.product_variants FOR DELETE TO authenticated
  USING (public.has_min_role(business_id, 'admin'));

CREATE TRIGGER trg_product_variants_updated_at BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Cash register sessions
DO $$ BEGIN
  CREATE TYPE public.register_status AS ENUM ('open','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.cash_register_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  status public.register_status NOT NULL DEFAULT 'open',
  opened_by uuid,
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_amount numeric(12,2) NOT NULL DEFAULT 0,
  closed_by uuid,
  closed_at timestamptz,
  counted_amount numeric(12,2),
  expected_amount numeric(12,2),
  difference numeric(12,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_register_per_business
  ON public.cash_register_sessions (business_id) WHERE status = 'open';

GRANT SELECT, INSERT, UPDATE ON public.cash_register_sessions TO authenticated;
GRANT ALL ON public.cash_register_sessions TO service_role;
ALTER TABLE public.cash_register_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "register_select_members" ON public.cash_register_sessions FOR SELECT TO authenticated
  USING (public.is_member_of_business(business_id) OR public.is_super_admin());
CREATE POLICY "register_insert_members" ON public.cash_register_sessions FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of_business(business_id));
CREATE POLICY "register_update_admins" ON public.cash_register_sessions FOR UPDATE TO authenticated
  USING (public.has_min_role(business_id, 'admin')) WITH CHECK (public.has_min_role(business_id, 'admin'));

CREATE TRIGGER trg_register_updated_at BEFORE UPDATE ON public.cash_register_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Sales extra fields
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS discount numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cash_received numeric(12,2);
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS change_given numeric(12,2);
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS tip numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS register_session_id uuid REFERENCES public.cash_register_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS discount numeric(12,2) NOT NULL DEFAULT 0;

-- 6. Stock decrement (product or variant)
CREATE OR REPLACE FUNCTION public.decrement_stock_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.variant_id IS NOT NULL THEN
    UPDATE product_variants
    SET stock_quantity = stock_quantity - NEW.quantity::integer,
        updated_at = now()
    WHERE id = NEW.variant_id;
  ELSIF NEW.product_id IS NOT NULL THEN
    UPDATE products
    SET stock_quantity = COALESCE(stock_quantity, 0) - NEW.quantity::integer
    WHERE id = NEW.product_id AND track_inventory = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_decrement_stock_on_sale ON public.sale_items;
CREATE TRIGGER trg_decrement_stock_on_sale AFTER INSERT ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.decrement_stock_on_sale();

-- 7. Register RPCs
CREATE OR REPLACE FUNCTION public.open_register_session(_business_id uuid, _opening_amount numeric DEFAULT 0)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _id uuid;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para abrir caja en este negocio';
  END IF;
  IF EXISTS (SELECT 1 FROM cash_register_sessions WHERE business_id = _business_id AND status = 'open') THEN
    RAISE EXCEPTION 'Ya hay una caja abierta';
  END IF;
  INSERT INTO cash_register_sessions (business_id, opening_amount, opened_by)
  VALUES (_business_id, COALESCE(_opening_amount, 0), auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_register_session(_session_id uuid, _counted_amount numeric, _notes text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _s cash_register_sessions%ROWTYPE;
  _cash numeric;
BEGIN
  SELECT * INTO _s FROM cash_register_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caja no encontrada'; END IF;
  IF NOT has_min_role(_s.business_id, 'admin') THEN
    RAISE EXCEPTION 'Solo administradores pueden cerrar la caja';
  END IF;
  IF _s.status = 'closed' THEN RAISE EXCEPTION 'La caja ya está cerrada'; END IF;

  SELECT COALESCE(SUM(total + COALESCE(tip,0)), 0) INTO _cash
  FROM sales
  WHERE register_session_id = _session_id AND payment_method = 'cash';

  UPDATE cash_register_sessions
  SET status = 'closed',
      closed_at = now(),
      closed_by = auth.uid(),
      counted_amount = _counted_amount,
      expected_amount = _s.opening_amount + _cash,
      difference = _counted_amount - (_s.opening_amount + _cash),
      notes = _notes,
      updated_at = now()
  WHERE id = _session_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_register_summary(_session_id uuid)
RETURNS TABLE(payment_method text, sales_count bigint, total_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _business_id uuid;
BEGIN
  SELECT business_id INTO _business_id FROM cash_register_sessions WHERE id = _session_id;
  IF _business_id IS NULL THEN RAISE EXCEPTION 'Caja no encontrada'; END IF;
  IF NOT is_member_of_business(_business_id) THEN RAISE EXCEPTION 'Sin permiso'; END IF;

  RETURN QUERY
  SELECT COALESCE(s.payment_method, 'other')::text,
         COUNT(*)::bigint,
         COALESCE(SUM(s.total + COALESCE(s.tip,0)), 0)::numeric
  FROM sales s
  WHERE s.register_session_id = _session_id
  GROUP BY 1
  ORDER BY 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.open_register_session(uuid, numeric) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.close_register_session(uuid, numeric, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_register_summary(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.open_register_session(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_register_session(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_register_summary(uuid) TO authenticated;