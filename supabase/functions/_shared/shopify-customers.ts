// Clientes de Shopify en PYMOVA: qué se importa y cómo se empareja (puro, se prueba con Vitest).
//
// Solo entran los clientes que han comprado (decisión del 21/10/2026): la importación inicial
// filtra `orders_count:>0` y, después, entran con cada pedido nuevo de la web. Se traen
// nombre, correo, teléfono e id de Shopify; ni notas internas ni consentimientos (el del
// ticket por correo se pregunta en la tienda). Un cliente ya enlazado sigue a Shopify; uno
// que ya existía en PYMOVA con ese correo se enlaza sin pisar lo que tenga.
// La parte que escribe en la base de datos está en shopify-customers-db.ts.

/** Clientes con al menos un pedido, por páginas (orden estable por id). */
export const CUSTOMERS_WITH_ORDERS_QUERY = `
  query CustomersWithOrders($first: Int!, $after: String) {
    customers(first: $first, after: $after, query: "orders_count:>0", sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        firstName
        lastName
        defaultEmailAddress { emailAddress }
        defaultPhoneNumber { phoneNumber }
      }
    }
  }
`;

export interface ShopifyCustomer {
  /** gid://shopify/Customer/… */
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export interface CustomerQueryNode {
  id: string;
  firstName: string | null;
  lastName: string | null;
  defaultEmailAddress: { emailAddress: string | null } | null;
  defaultPhoneNumber: { phoneNumber: string | null } | null;
}

export const fromQueryNode = (n: CustomerQueryNode): ShopifyCustomer => ({
  id: n.id,
  firstName: n.firstName,
  lastName: n.lastName,
  email: n.defaultEmailAddress?.emailAddress ?? null,
  phone: n.defaultPhoneNumber?.phoneNumber ?? null,
});

/** gid de un cliente a partir del id numérico de los avisos («123» → «gid://shopify/Customer/123»). */
export function customerGid(id: unknown): string | null {
  if (typeof id === 'string' && id.startsWith('gid://shopify/Customer/')) return id;
  if ((typeof id === 'number' && Number.isFinite(id)) || (typeof id === 'string' && /^\d+$/.test(id))) {
    return `gid://shopify/Customer/${id}`;
  }
  return null;
}

/** Cliente del cuerpo de un aviso `customers/*` (campos en snake_case). */
export function customerFromWebhook(payload: Record<string, unknown>): ShopifyCustomer | null {
  const id = customerGid(payload.admin_graphql_api_id ?? payload.id);
  if (!id) return null;
  const s = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    id,
    firstName: s(payload.first_name),
    lastName: s(payload.last_name),
    email: s(payload.email),
    phone: s(payload.phone),
  };
}

const clean = (s: string | null | undefined) => {
  const t = (s ?? '').trim();
  return t ? t : null;
};

/** Datos que se guardan en `clients`. */
export function customerFields(c: ShopifyCustomer) {
  const email = clean(c.email)?.toLowerCase() ?? null;
  const name = clean([c.firstName, c.lastName].filter(Boolean).join(' ')) ?? email ?? 'Cliente de Shopify';
  return { name: name.slice(0, 200), email, phone: clean(c.phone)?.slice(0, 40) ?? null };
}

export interface LocalClient {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  external_id: string | null;
  external_source: string | null;
}

export type CustomerPlanItem =
  | { kind: 'insert'; gid: string; fields: ReturnType<typeof customerFields> }
  | { kind: 'update'; gid: string; id: string; patch: Record<string, string | null> }
  | { kind: 'skip'; gid: string; reason: string };

/**
 * Qué hacer con cada cliente de Shopify frente a los de PYMOVA:
 * - ya enlazado (mismo id de Shopify): se actualizan nombre, correo y teléfono si han cambiado;
 * - sin enlazar pero con el mismo correo: se enlaza y solo se rellena el teléfono si faltaba;
 * - nuevo: se crea si `allowInsert` (importación y pedidos); si no (aviso de cliente), se omite.
 */
export function planCustomerUpserts(
  customers: ShopifyCustomer[],
  locals: LocalClient[],
  opts: { allowInsert: boolean },
): CustomerPlanItem[] {
  const byGid = new Map(
    locals.filter((l) => l.external_source === 'shopify' && l.external_id).map((l) => [l.external_id as string, l]),
  );
  const byEmail = new Map<string, LocalClient>();
  for (const l of locals) {
    const e = l.email?.trim().toLowerCase();
    if (e && !l.external_id && !byEmail.has(e)) byEmail.set(e, l);
  }

  const seen = new Set<string>();
  const plan: CustomerPlanItem[] = [];
  for (const c of customers) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const fields = customerFields(c);

    const linked = byGid.get(c.id);
    if (linked) {
      const patch: Record<string, string | null> = {};
      // Sin nombre en Shopify no se cambia el de PYMOVA por el correo.
      const realName = clean([c.firstName, c.lastName].filter(Boolean).join(' '));
      if (realName && fields.name !== linked.name) patch.name = fields.name;
      if (fields.email && fields.email !== linked.email?.toLowerCase()) patch.email = fields.email;
      if (fields.phone && fields.phone !== linked.phone) patch.phone = fields.phone;
      plan.push(Object.keys(patch).length ? { kind: 'update', gid: c.id, id: linked.id, patch } : { kind: 'skip', gid: c.id, reason: 'sin cambios' });
      continue;
    }

    const local = fields.email ? byEmail.get(fields.email) : undefined;
    if (local) {
      byEmail.delete(fields.email as string); // un cliente local solo se enlaza con uno de Shopify
      const patch: Record<string, string | null> = { external_id: c.id, external_source: 'shopify' };
      if (!local.phone && fields.phone) patch.phone = fields.phone;
      plan.push({ kind: 'update', gid: c.id, id: local.id, patch });
      continue;
    }

    plan.push(
      opts.allowInsert
        ? { kind: 'insert', gid: c.id, fields }
        : { kind: 'skip', gid: c.id, reason: 'no está en PYMOVA (aún no ha comprado)' },
    );
  }
  return plan;
}
