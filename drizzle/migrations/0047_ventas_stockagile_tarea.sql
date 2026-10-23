-- La tarea de Stockagile también trae las ventas de la tienda (0046).
--
-- La tarea «stockagile-devoluciones» solo llama a la función cuando hay trabajo pendiente, y
-- hasta ahora eso eran solo los movimientos de stock. Con la copia de las ventas, también hay
-- trabajo cuando la última copia tiene más de 4 minutos (o no se ha hecho nunca): así los
-- tickets de la tienda llegan a PYMOVA cada 5 minutos sin pulsar «Actualizar».

CREATE OR REPLACE FUNCTION public.stockagile_pending_work()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM stockagile_stock_moves m
    JOIN stockagile_connections c ON c.business_id = m.business_id AND c.enabled
    WHERE m.status = 'pending'
       OR (m.status = 'sending' AND m.claimed_at < now() - interval '10 minutes')
  ) OR EXISTS (
    SELECT 1 FROM stockagile_connections c
    WHERE c.enabled
      AND (c.sales_synced_at IS NULL OR c.sales_synced_at < now() - interval '4 minutes')
  );
$$;
REVOKE ALL ON FUNCTION public.stockagile_pending_work() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stockagile_pending_work() TO service_role;
