// deno-lint-ignore-file no-explicit-any
import { template as teamInvitation } from './team-invitation.tsx'

export interface TemplateEntry {
  component: (props: any) => any
  subject: string | ((data: any) => string)
  displayName?: string
  previewData?: Record<string, any>
  to?: string
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  'team-invitation': teamInvitation,
}
