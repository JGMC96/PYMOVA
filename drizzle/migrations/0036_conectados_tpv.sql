-- Conectados al TPV en otros dispositivos.
-- La lista de «Conectados» del TPV se guarda en cada dispositivo, así que cada uno solo veía a
-- quien metió el PIN en él. get_connected_sellers da, a cualquier miembro activo del negocio,
-- las personas con una sesión de vendedor vigente en cualquier dispositivo: solo el empleado,
-- su nombre y hasta cuándo dura. No devuelve el id de la sesión ni quién la abrió, así que no
-- sirve para vender a nombre de otra persona (para eso sigue haciendo falta su PIN).
-- Migración idempotente, sin secretos.

CREATE OR REPLACE FUNCTION public.get_connected_sellers(_business_id uuid)
RETURNS TABLE(employee_id uuid, name text, expires_at timestamptz, last_used_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.employee_id,
         public.employee_display_name(s.employee_id),
         max(s.expires_at),
         max(s.last_used_at)
  FROM pos_seller_sessions s
  JOIN hr_employees e ON e.id = s.employee_id AND e.business_id = s.business_id
  WHERE s.business_id = _business_id
    AND s.expires_at > now()
    AND e.is_active
    AND is_member_of_business(_business_id)
  GROUP BY s.employee_id
  ORDER BY 2;
$$;
REVOKE ALL ON FUNCTION public.get_connected_sellers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_connected_sellers(uuid) TO authenticated, service_role;
