-- 0062 · Vales de Stockagile en la copia de sus tickets (Parte 0, solo datos).
--
-- Los vales de Stockagile son tarjetas regalo con código. Cada línea de un ticket de su API
-- (`pos_order_product_variants`) dice si es una tarjeta regalo, su código y qué tarjeta carga
-- (vale emitido o vendido) o gasta. Hasta ahora la copia los descartaba: la línea «Vale» quedaba
-- sin código. Con estas columnas, y volviendo a copiar el historial, se puede saber cómo es el
-- código, si un vale se gasta en varias veces y cuánto le queda a cada uno.
--
-- Solo añade columnas a una tabla de consulta: no cambia ventas, stock, caja ni permisos. La tabla
-- ya se lee entera con la cuenta del usuario (0046), igual que los códigos de los vales de PYMOVA
-- (0039). Es aditiva e idempotente.

ALTER TABLE public.stockagile_sale_items
  ADD COLUMN IF NOT EXISTS is_gift_card boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gift_card_code text,
  ADD COLUMN IF NOT EXISTS gift_card_charged_id bigint,
  ADD COLUMN IF NOT EXISTS gift_card_consumed_id bigint;

COMMENT ON COLUMN public.stockagile_sale_items.is_gift_card IS
  'Línea de tarjeta regalo (vale) según Stockagile (is_gift_card).';
COMMENT ON COLUMN public.stockagile_sale_items.gift_card_code IS
  'Código de la tarjeta regalo (vale) de Stockagile (gift_card_code).';
COMMENT ON COLUMN public.stockagile_sale_items.gift_card_charged_id IS
  'Id en Stockagile de la tarjeta regalo que carga esta línea: vale emitido o vendido (charged_gift_card).';
COMMENT ON COLUMN public.stockagile_sale_items.gift_card_consumed_id IS
  'Id en Stockagile de la tarjeta regalo que gasta esta línea (consumed_gift_card).';

-- Para sumar cargas y gastos de un mismo vale.
CREATE INDEX IF NOT EXISTS stockagile_sale_items_gift_charged_idx
  ON public.stockagile_sale_items (gift_card_charged_id) WHERE gift_card_charged_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stockagile_sale_items_gift_consumed_idx
  ON public.stockagile_sale_items (gift_card_consumed_id) WHERE gift_card_consumed_id IS NOT NULL;
