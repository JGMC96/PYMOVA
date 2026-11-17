-- 0063 · Cobrar en el TPV los vales emitidos en Stockagile (Parte 1).
--
-- Un vale de Stockagile es una tarjeta regalo: su código es «nd2.» + el número del ticket de
-- devolución que lo emitió (p. ej. nd2.VT123456). La copia de sus tickets (0046, con el código
-- desde la 0062) dice qué tarjeta carga cada línea y cuál gasta, así que su saldo es lo cargado
-- menos lo gastado. La API de Stockagile no deja consultar ni gastar una tarjeta.
--
-- Al presentarlo en el TPV, PYMOVA lo convierte, una sola vez, en un vale suyo (origin 'import')
-- con ese saldo. Desde ahí es un vale de PYMOVA más: se gasta con create_sale_with_items, que no
-- cambia. No caduca (decisión del usuario, 17/11/2026). Si después Stockagile trae un gasto de esa
-- misma tarjeta, se marca el vale para avisar en el TPV.
--
-- Aditiva e idempotente.

-- 1. Columnas e índice ------------------------------------------------------------------------
ALTER TABLE public.store_vouchers
  ADD COLUMN IF NOT EXISTS stockagile_gift_card_id bigint,
  ADD COLUMN IF NOT EXISTS stockagile_conflict_at timestamptz;

COMMENT ON COLUMN public.store_vouchers.stockagile_gift_card_id IS
  'Tarjeta regalo de Stockagile de la que sale este vale (0063). Una tarjeta se convierte una sola vez.';
COMMENT ON COLUMN public.store_vouchers.stockagile_conflict_at IS
  'Cuándo se vio en la copia de Stockagile un gasto de esa tarjeta posterior a la conversión (0063).';

CREATE UNIQUE INDEX IF NOT EXISTS store_vouchers_stockagile_card_key
  ON public.store_vouchers (business_id, stockagile_gift_card_id) WHERE stockagile_gift_card_id IS NOT NULL;

-- 2. Código de un vale de Stockagile, como se compara ----------------------------------------
-- Mayúsculas, sin separadores y sin el prefijo «ND<n>»: «nd2.VT123456», «ND2-VT123456» y
-- «VT123456» dan «VT123456». Solo cifras (lo que queda si el escáner pierde las letras): «VT» + cifras.
CREATE OR REPLACE FUNCTION public.stockagile_voucher_key(_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN k ~ '^[0-9]{5,9}$' THEN 'VT' || k
    ELSE NULLIF(k, '')
  END
  FROM (
    SELECT regexp_replace(regexp_replace(upper(COALESCE(_code, '')), '[^A-Z0-9]', '', 'g'), '^ND[0-9]*(?=VT[0-9])', '') AS k
  ) x;
$$;
REVOKE ALL ON FUNCTION public.stockagile_voucher_key(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stockagile_voucher_key(text) TO authenticated, service_role;

-- 3. Convertir un vale de Stockagile en vale de PYMOVA ---------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_stockagile_voucher(_business_id uuid, _code text)
RETURNS TABLE(
  id uuid,
  code text,
  initial_amount numeric,
  balance numeric,
  status text,
  expires_at timestamptz,
  expired boolean,
  stockagile_ticket text,
  issued_at timestamptz,
  conflict_at timestamptz,
  converted_now boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _key text := stockagile_voucher_key(_code);
  _cards bigint[];
  _card bigint;
  _charged numeric;
  _spent numeric;
  _saldo numeric;
  _charge_code text;
  _ticket text;
  _issued timestamptz;
  _client uuid;
  _voucher_id uuid;
  _new boolean := false;
BEGIN
  IF NOT is_member_of_business(_business_id) THEN
    RAISE EXCEPTION 'No tienes permiso para cobrar vales en este negocio' USING ERRCODE = '42501';
  END IF;
  IF _key IS NULL THEN
    RAISE EXCEPTION 'Escribe el código del vale' USING ERRCODE = '22023';
  END IF;

  -- La tarjeta, por el código de sus cargas (vale emitido o vendido), solo en este negocio.
  SELECT array_agg(DISTINCT i.gift_card_charged_id) INTO _cards
  FROM stockagile_sale_items i
  JOIN stockagile_sales s ON s.id = i.sale_id AND s.business_id = _business_id AND NOT s.deleted
  WHERE i.gift_card_charged_id IS NOT NULL
    AND stockagile_voucher_key(i.gift_card_code) = _key;

  IF _cards IS NULL OR cardinality(_cards) = 0 THEN
    RAISE EXCEPTION 'No hay ningún vale de Stockagile con el código %', btrim(_code) USING ERRCODE = '22023';
  END IF;
  IF cardinality(_cards) > 1 THEN
    RAISE EXCEPTION 'El código % corresponde a más de un vale de Stockagile: revísalo en Stockagile', btrim(_code)
      USING ERRCODE = '22023';
  END IF;
  _card := _cards[1];

  -- Una sola conversión por tarjeta, aunque dos cajas lo intenten a la vez.
  PERFORM pg_advisory_xact_lock(hashtextextended('stockagile_voucher:' || _business_id::text || ':' || _card::text, 0));

  SELECT v.id INTO _voucher_id
  FROM store_vouchers v
  WHERE v.business_id = _business_id AND v.stockagile_gift_card_id = _card;

  IF _voucher_id IS NULL THEN
    SELECT COALESCE(sum(i.total) FILTER (WHERE i.gift_card_charged_id = _card), 0),
           COALESCE(-sum(i.total) FILTER (WHERE i.gift_card_consumed_id = _card), 0)
      INTO _charged, _spent
    FROM stockagile_sale_items i
    JOIN stockagile_sales s ON s.id = i.sale_id AND s.business_id = _business_id AND NOT s.deleted
    WHERE i.gift_card_charged_id = _card OR i.gift_card_consumed_id = _card;
    _saldo := round(_charged - _spent, 2);

    SELECT upper(btrim(i.gift_card_code)), s.number, s.sold_at, s.client_id
      INTO _charge_code, _ticket, _issued, _client
    FROM stockagile_sale_items i
    JOIN stockagile_sales s ON s.id = i.sale_id AND s.business_id = _business_id AND NOT s.deleted
    WHERE i.gift_card_charged_id = _card
    ORDER BY s.sold_at
    LIMIT 1;

    IF _saldo <= 0 THEN
      RAISE EXCEPTION 'Este vale de Stockagile ya está gastado' USING ERRCODE = '22023';
    END IF;

    INSERT INTO store_vouchers (
      business_id, code, initial_amount, balance, status, expires_at, client_id, origin,
      stockagile_gift_card_id, created_by
    ) VALUES (
      _business_id, _charge_code, _saldo, _saldo, 'active', NULL, _client, 'import', _card, auth.uid()
    )
    RETURNING store_vouchers.id INTO _voucher_id;

    INSERT INTO store_voucher_movements (business_id, voucher_id, kind, amount, balance_after, note, created_by)
    VALUES (
      _business_id, _voucher_id, 'import', _saldo, _saldo,
      format('Vale de Stockagile %s (devolución %s del %s): cargado %s €, gastado en Stockagile %s €',
             _charge_code, COALESCE(_ticket, '?'),
             COALESCE(to_char(_issued AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY'), '?'),
             to_char(_charged, 'FM999990.00'), to_char(_spent, 'FM999990.00')),
      auth.uid()
    );
    _new := true;
  END IF;

  RETURN QUERY
  SELECT v.id, v.code, v.initial_amount, v.balance, v.status, v.expires_at,
         (v.expires_at IS NOT NULL AND v.expires_at < now()),
         t.number, t.sold_at, v.stockagile_conflict_at, _new
  FROM store_vouchers v
  LEFT JOIN LATERAL (
    SELECT s.number, s.sold_at
    FROM stockagile_sale_items i
    JOIN stockagile_sales s ON s.id = i.sale_id AND s.business_id = _business_id AND NOT s.deleted
    WHERE i.gift_card_charged_id = v.stockagile_gift_card_id
    ORDER BY s.sold_at
    LIMIT 1
  ) t ON true
  WHERE v.id = _voucher_id;
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_stockagile_voucher(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_stockagile_voucher(uuid, text) TO authenticated, service_role;

-- 4. Vigilancia: un gasto en Stockagile de una tarjeta ya convertida --------------------------
-- La copia rehace las líneas de cada ticket en cada sincronización: solo cuentan los tickets
-- posteriores a la conversión, y la primera marca se conserva.
CREATE OR REPLACE FUNCTION public.stockagile_voucher_conflict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.gift_card_consumed_id IS NOT NULL THEN
    UPDATE store_vouchers v
       SET stockagile_conflict_at = COALESCE(v.stockagile_conflict_at, now()),
           updated_at = now()
      FROM stockagile_sales s
     WHERE s.id = NEW.sale_id
       AND NOT s.deleted
       AND v.business_id = s.business_id
       AND v.stockagile_gift_card_id = NEW.gift_card_consumed_id
       AND s.sold_at > v.created_at
       AND v.stockagile_conflict_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.stockagile_voucher_conflict() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stockagile_voucher_conflict ON public.stockagile_sale_items;
CREATE TRIGGER trg_stockagile_voucher_conflict
  AFTER INSERT ON public.stockagile_sale_items
  FOR EACH ROW EXECUTE FUNCTION public.stockagile_voucher_conflict();
