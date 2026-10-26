// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any -- cada plantilla tiene sus propias props: el registro las guarda sin tipar, como indica la línea de deno-lint de arriba */
import { template as teamInvitation } from './team-invitation.tsx'
import { template as saleReceipt } from './sale-receipt.tsx'

export interface TemplateEntry {
  component: (props: any) => any
  subject: string | ((data: any) => string)
  displayName?: string
  previewData?: Record<string, any>
  to?: string
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  'team-invitation': teamInvitation,
  'sale-receipt': saleReceipt,
}
