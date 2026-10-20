import { useCallback } from 'react';
import { useBusiness } from '@/contexts/BusinessContext';
import { DEFAULT_CURRENCY, formatMoney } from '@/lib/money';

/** Formatea importes en la moneda del negocio activo. */
export function useMoney() {
  const { activeBusiness } = useBusiness();
  const currency = activeBusiness?.currency || DEFAULT_CURRENCY;
  const format = useCallback((amount: number | null | undefined) => formatMoney(amount, currency), [currency]);
  return { currency, format };
}
