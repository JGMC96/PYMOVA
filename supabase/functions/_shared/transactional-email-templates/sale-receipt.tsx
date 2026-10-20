/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'
import type { SaleReceiptProps } from '../sale-receipt.ts'

// Ticket de una venta del TPV por correo. Los datos los calcula el servidor
// (`buildSaleReceipt`); aquí solo se pintan. El código de barras va como tabla
// porque muchos clientes de correo no muestran SVG.

const MODULE_PX = 2
const QUIET_MODULES = 10

const Barcode = ({ runs, label }: { runs: SaleReceiptProps['barcode']; label: string }) => {
  if (!runs.length) return null
  const cells = [{ bar: false, width: QUIET_MODULES }, ...runs, { bar: false, width: QUIET_MODULES }]
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} border={0} style={barcodeTable} aria-label={`Código de barras ${label}`}>
      <tbody>
        <tr>
          {cells.map((c, i) => (
            <td
              key={i}
              width={c.width * MODULE_PX}
              height={48}
              style={{ ...barcodeCell, width: `${c.width * MODULE_PX}px`, backgroundColor: c.bar ? '#000000' : '#ffffff' }}
            >
              &nbsp;
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <tr>
    <td style={{ ...cell, fontWeight: strong ? 700 : 400 }}>{label}</td>
    <td style={{ ...cellRight, fontWeight: strong ? 700 : 400 }}>{value}</td>
  </tr>
)

const multiline = (s: string | null) =>
  s ? s.split('\n').map((l, i) => <Text key={i} style={centerSmall}>{l}</Text>) : null

const Email = (p: SaleReceiptProps) => (
  <Html lang="es" dir="ltr">
    <Head />
    <Preview>{`Tu ticket ${p.saleNumber} de ${p.businessName}: ${p.total}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>{p.businessName}</Text>
        {p.legalName && <Text style={centerSmall}>{p.legalName}</Text>}
        {p.taxId && <Text style={centerSmall}>NIF: {p.taxId}</Text>}
        {multiline(p.address)}
        {p.phone && <Text style={centerSmall}>Tel. {p.phone}</Text>}
        {p.website && <Text style={centerSmall}>{p.website}</Text>}

        <Hr style={hr} />
        <Text style={title}>FACTURA SIMPLIFICADA</Text>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={table}>
          <tbody>
            <Row label="Nº" value={p.saleNumber} strong />
            <Row label="Fecha" value={p.date} />
            {p.clientName && <Row label="Cliente" value={p.clientName} />}
            {p.cashier && <Row label="Atendido por" value={p.cashier} />}
          </tbody>
        </table>

        <Hr style={hr} />
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={table}>
          <tbody>
            {p.lines.map((l, i) => (
              <React.Fragment key={i}>
                <tr>
                  <td colSpan={2} style={{ ...cell, fontWeight: 700, paddingTop: i ? '8px' : 0 }}>{l.name}</td>
                </tr>
                <Row label={l.detail} value={l.total} />
                {l.discount && <Row label="  Descuento" value={l.discount} />}
              </React.Fragment>
            ))}
          </tbody>
        </table>

        <Hr style={hr} />
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={table}>
          <tbody>
            <Row label="Base imponible" value={p.base} />
            <Row label={p.taxLabel} value={p.tax} />
            {p.tip && <Row label="Propina" value={p.tip} />}
            <Row label="TOTAL" value={p.total} strong />
            {p.payment && <Row label="Pago" value={p.payment} />}
            {p.cashReceived && <Row label="Entregado" value={p.cashReceived} />}
            {p.change && <Row label="Cambio" value={p.change} />}
          </tbody>
        </table>
        <Text style={muted}>IVA incluido</Text>

        <Hr style={hr} />
        <Section style={{ textAlign: 'center' }}>
          <Barcode runs={p.barcode} label={p.saleNumber} />
          <Text style={reference}>{p.saleNumber}</Text>
        </Section>
        {multiline(p.returnPolicy)}
        {multiline(p.footer)}
        <Text style={muted}>
          Te enviamos este ticket porque lo pediste en la tienda. Guárdalo: con él puedes
          hacer cambios y devoluciones.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (data: SaleReceiptProps) =>
    `Tu ticket ${data?.saleNumber ?? ''} de ${data?.businessName ?? 'la tienda'}`.replace(/\s+/g, ' '),
  displayName: 'Ticket de venta',
  previewData: {
    businessName: 'Tuilus',
    legalName: 'Codiarch Squad S.L.',
    taxId: 'B02768679',
    address: 'Calle Conde de Altea 1\n46005 Valencia',
    phone: '627 04 59 89',
    website: 'www.tuilus.com',
    saleNumber: 'VTA-000123',
    date: '20/10/2026, 18:30',
    cashier: 'Ana',
    clientName: 'Lucía',
    lines: [{ name: 'Zueco Rio Tira Pelo Cow · 38', detail: '1 x 175,00 €', total: '175,00 €', discount: null }],
    base: '144,63 €',
    taxLabel: 'IVA 21 %',
    tax: '30,37 €',
    tip: null,
    total: '175,00 €',
    payment: 'Tarjeta',
    cashReceived: null,
    change: null,
    returnPolicy: 'Cambios y devoluciones en 15 días con este ticket.',
    footer: '¡Gracias por su compra!',
    barcode: [],
  } satisfies SaleReceiptProps,
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
}
const container = { padding: '28px 24px', maxWidth: '420px' }
const ink = 'hsl(222, 47%, 11%)'
const brand = { color: ink, fontSize: '20px', fontWeight: 700, textAlign: 'center' as const, margin: '0 0 6px' }
const centerSmall = { color: ink, fontSize: '13px', lineHeight: '1.5', textAlign: 'center' as const, margin: 0 }
const title = { color: ink, fontSize: '14px', fontWeight: 700, textAlign: 'center' as const, margin: '0 0 8px' }
const table = { borderCollapse: 'collapse' as const }
const cell = { color: ink, fontSize: '14px', lineHeight: '1.5', padding: 0, textAlign: 'left' as const, whiteSpace: 'pre' as const }
const cellRight = { ...cell, textAlign: 'right' as const }
const hr = { borderColor: '#e5e7eb', margin: '14px 0' }
const muted = { color: '#55575d', fontSize: '12px', lineHeight: '1.6', margin: '8px 0 0', textAlign: 'center' as const }
const reference = { color: ink, fontSize: '13px', letterSpacing: '0.08em', margin: '4px 0 10px', textAlign: 'center' as const }
const barcodeTable = { borderCollapse: 'collapse' as const, margin: '0 auto' }
const barcodeCell = { padding: 0, fontSize: '1px', lineHeight: '1px' }
