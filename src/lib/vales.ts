// Vales de tienda (0039): se crean al devolver con «Vale de tienda» y se canjean en el TPV.
// Mismas reglas que create_sale_with_items: el vale paga como mucho su saldo y el total de la venta.

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface StoreVoucher {
  id: string;
  code: string;
  initial_amount: number;
  balance: number;
  status: 'active' | 'used' | 'void' | string;
  expires_at: string | null;
  expired: boolean;
  /** Vale de Stockagile convertido (0063): devolución que lo emitió, cuándo y si se gastó allí después. */
  stockagile_ticket?: string | null;
  issued_at?: string | null;
  conflict_at?: string | null;
  converted_now?: boolean;
}

/** Código tal como se guarda: sin espacios y en mayúsculas (el escáner o el teclado pueden variar). */
export function normalizeVoucherCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Clave de un vale de Stockagile (0063), igual que stockagile_voucher_key en la base de datos:
 * «nd2.VT123456», «ND2-VT123456» o «VT123456» → «VT123456». null si no lo parece. El código de
 * Stockagile es «nd2.» + el número del ticket de devolución que emitió el vale.
 */
export function stockagileVoucherKey(code: string): string | null {
  let key = code.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^ND\d*(?=VT\d)/, '');
  if (/^\d{5,9}$/.test(key)) key = `VT${key}`;
  return /^VT\d{4,9}$/.test(key) ? key : null;
}

/** Por qué no se puede usar un vale, o null si se puede. */
export function voucherProblem(v: Pick<StoreVoucher, 'status' | 'balance' | 'expired' | 'expires_at'>): string | null {
  if (v.status === 'void') return 'Este vale está anulado';
  if (v.expired) {
    const when = v.expires_at ? new Date(v.expires_at).toLocaleDateString('es-ES') : null;
    return when ? `Este vale caducó el ${when}` : 'Este vale ha caducado';
  }
  if (v.status === 'used' || Number(v.balance) <= 0) return 'Este vale ya está gastado';
  return null;
}

/** Lo que se paga con el vale: lo pedido, sin pasar del saldo ni del total de la venta. */
export function voucherApplied(requested: number, balance: number, total: number): number {
  if (!(requested > 0) || !(balance > 0) || !(total > 0)) return 0;
  return round2(Math.min(requested, balance, total));
}

/** Importe escrito con coma o punto; null si no es un número positivo. */
export function parseVoucherAmount(input: string): number | null {
  const value = round2(parseFloat(input.trim().replace(',', '.')));
  return isNaN(value) || value <= 0 ? null : value;
}
