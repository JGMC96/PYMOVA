-- Ventas por vendedor: solo el propietario (antes, cualquier administrador).
-- Mismo cuerpo que en la 0027; solo cambia la comprobación del rol.
-- Migración idempotente, sin secretos.

-- Fechas en la zona horaria del negocio. Las devoluciones se atribuyen a quien las hizo.
CREATE OR REPLACE FUNCTION public.get_sales_by_seller(_business_id uuid, _from date, _to date)
RETURNS TABLE(
  employee_id uuid,
  name text,
  sales_count integer,
  sales_total numeric,
  returns_count integer,
  returns_total numeric,
  net_total numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT has_business_role(_business_id, 'owner') THEN
    RAISE EXCEPTION 'Solo el propietario puede ver las ventas por vendedor' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH v AS (
    SELECT s.seller_employee_id AS emp, count(*)::integer AS n, COALESCE(SUM(s.total), 0) AS t
    FROM sales s
    WHERE s.business_id = _business_id
      AND public.business_local_date(_business_id, s.created_at) BETWEEN _from AND _to
    GROUP BY s.seller_employee_id
  ), d AS (
    SELECT r.seller_employee_id AS emp, count(*)::integer AS n, COALESCE(SUM(r.total), 0) AS t
    FROM sale_returns r
    WHERE r.business_id = _business_id
      AND public.business_local_date(_business_id, r.created_at) BETWEEN _from AND _to
    GROUP BY r.seller_employee_id
  ), emps AS (
    SELECT v.emp FROM v UNION SELECT d.emp FROM d
  )
  SELECT e.emp,
         CASE WHEN e.emp IS NULL THEN 'Sin vendedor' ELSE public.employee_display_name(e.emp) END,
         COALESCE(v.n, 0), COALESCE(v.t, 0), COALESCE(d.n, 0), COALESCE(d.t, 0),
         COALESCE(v.t, 0) - COALESCE(d.t, 0)
  FROM emps e
  LEFT JOIN v ON v.emp IS NOT DISTINCT FROM e.emp
  LEFT JOIN d ON d.emp IS NOT DISTINCT FROM e.emp
  ORDER BY COALESCE(v.t, 0) - COALESCE(d.t, 0) DESC, 2;
END;
$$;
REVOKE ALL ON FUNCTION public.get_sales_by_seller(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_seller(uuid, date, date) TO authenticated, service_role;
