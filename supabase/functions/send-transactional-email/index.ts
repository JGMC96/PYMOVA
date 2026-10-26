import * as React from 'npm:react@18.3.1'
import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { createClient } from 'npm:@supabase/supabase-js@2'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { TEMPLATES } from '../_shared/transactional-email-templates/registry.ts'
import { redactEmail } from '../_shared/privacy.ts'
import { buildSaleReceipt, SALE_RECEIPT_DAILY_LIMIT } from '../_shared/sale-receipt.ts'

// Configuration baked in at scaffold time — do NOT change these manually.
// To update, re-run the email domain setup flow.
const SITE_NAME = "cogent-business-os"
// SENDER_DOMAIN is the verified sender subdomain FQDN (e.g., "notify.example.com").
// It MUST match the subdomain delegated to Lovable's nameservers — never the root domain.
// The email API looks up this exact domain; a mismatch causes "No email domain record found".
const SENDER_DOMAIN = "notify.pymova.com"
// FROM_DOMAIN is the domain shown in the From: header (e.g., "example.com").
// When display_from_root is enabled, this can be the root domain for cleaner branding,
// even though actual sending uses the subdomain above.
const FROM_DOMAIN = "pymova.com"

// Generate a cryptographically random 32-byte hex token
function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Auth note: verify_jwt = true validates the JWT signature, but it does NOT
// bind the recipient or the template data to the caller. Everything a normal
// signed-in user can send is derived server-side below from trusted state.

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  staff: 'Personal',
}

// Only these origins may appear in an invitation link.
const ALLOWED_INVITE_ORIGINS = [
  'https://pymova.com',
  'https://www.pymova.com',
  'https://cogent-business-os.lovable.app',
]
const DEFAULT_INVITE_ORIGIN = ALLOWED_INVITE_ORIGINS[0]

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

interface ResolvedSend {
  templateName: string
  recipientEmail: string
  idempotencyKey: string
  templateData: object
  logMetadata: Record<string, unknown>
}

// Ticket de una venta del TPV. Lo pide cualquier miembro activo del negocio, pero el
// destinatario es el correo del cliente de la venta y solo si aceptó recibirlo; el
// contenido sale de la base de datos. Como mucho SALE_RECEIPT_DAILY_LIMIT envíos al día.
async function resolveSaleReceipt(
  supabase: SupabaseClient,
  callerId: string,
  body: Record<string, unknown>,
  messageId: string,
): Promise<ResolvedSend | Response> {
  const saleId = body.saleId || body.sale_id
  if (typeof saleId !== 'string' || !saleId) return jsonError('saleId is required', 400)

  const { data: sale } = await supabase
    .from('sales')
    .select('id, business_id, client_id, sale_number, created_at, payment_method, subtotal, tax, total, tip, cash_received, change_given, seller_employee_id')
    .eq('id', saleId)
    .maybeSingle()
  if (!sale) return jsonError('Venta no encontrada', 404)

  const { data: membership } = await supabase
    .from('business_members')
    .select('is_active')
    .eq('business_id', sale.business_id)
    .eq('user_id', callerId)
    .maybeSingle()
  if (!membership?.is_active) return jsonError('Not allowed', 403)

  if (!sale.client_id) return jsonError('La venta no tiene cliente', 409)
  const { data: client } = await supabase
    .from('clients')
    .select('name, email, receipt_email_consent, is_active')
    .eq('id', sale.client_id)
    .maybeSingle()
  if (!client?.email) return jsonError('El cliente no tiene correo', 409)
  if (!client.receipt_email_consent) {
    return jsonError('El cliente no ha aceptado recibir el ticket por correo', 409)
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error: countError } = await supabase
    .from('email_send_log')
    .select('id', { count: 'exact', head: true })
    .eq('template_name', 'sale-receipt')
    .eq('status', 'pending')
    .eq('metadata->>sale_id', sale.id)
    .gte('created_at', since)
  if (countError) return jsonError('No se pudo comprobar los envíos anteriores', 500)
  if ((count ?? 0) >= SALE_RECEIPT_DAILY_LIMIT) {
    return jsonError('Este ticket ya se ha enviado varias veces hoy', 429)
  }

  const [{ data: items }, { data: business }, { data: settings }] = await Promise.all([
    supabase
      .from('sale_items')
      .select('product_name, quantity, unit_price, total')
      .eq('sale_id', sale.id)
      .order('id'),
    supabase
      .from('businesses')
      .select('name, trade_name, legal_name, tax_id, currency, timezone')
      .eq('id', sale.business_id)
      .maybeSingle(),
    supabase
      .from('business_settings')
      .select('tax_rate, ticket_trade_name, ticket_legal_name, ticket_tax_id, ticket_address, ticket_phone, ticket_website, ticket_footer, ticket_return_policy')
      .eq('business_id', sale.business_id)
      .maybeSingle(),
  ])
  if (!business) return jsonError('Negocio no encontrado', 404)

  let cashier: string | null = null
  if (sale.seller_employee_id) {
    const { data: name } = await supabase.rpc('employee_display_name', {
      _employee_id: sale.seller_employee_id,
    })
    cashier = typeof name === 'string' && name !== 'Sin nombre' ? name : null
  }

  return {
    templateName: 'sale-receipt',
    recipientEmail: client.email,
    idempotencyKey: `sale-receipt-${sale.id}-${messageId}`,
    templateData: buildSaleReceipt({
      sale,
      items: items ?? [],
      business,
      settings: settings ?? null,
      clientName: client.name ?? null,
      cashier,
    }),
    logMetadata: { sale_id: sale.id, business_id: sale.business_id },
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables')
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // Parse request body
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON in request body', 400)
  }

  const messageId = crypto.randomUUID()

  // Create Supabase client with service role (bypasses RLS)
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  // --- Authorization -------------------------------------------------------
  // Trusted server-to-server callers present the service role key and may send
  // any registered template. Everyone else must be a signed-in user, and the
  // recipient plus template data are derived from the database, never from the
  // request, so nobody can turn this endpoint into an open mailer.
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!bearer) return jsonError('Unauthorized', 401)

  const isServiceRole = bearer === supabaseServiceKey

  let templateName: string
  let recipientEmail: string | undefined
  let templateData: object = {}
  let idempotencyKey: string
  let logMetadata: Record<string, unknown> | null = null

  if (isServiceRole) {
    templateName = (body.templateName || body.template_name) as string
    recipientEmail = (body.recipientEmail || body.recipient_email) as string | undefined
    idempotencyKey = (body.idempotencyKey || body.idempotency_key || messageId) as string
    if (body.templateData && typeof body.templateData === 'object') {
      templateData = body.templateData
    }
  } else {
    const { data: userData, error: userError } = await supabase.auth.getUser(bearer)
    const caller = userData?.user
    if (userError || !caller) return jsonError('Unauthorized', 401)

    const requested = body.templateName || body.template_name
    if (requested === 'sale-receipt') {
      const resolved = await resolveSaleReceipt(supabase, caller.id, body, messageId)
      if (resolved instanceof Response) return resolved
      ;({ templateName, recipientEmail, idempotencyKey, templateData, logMetadata } = resolved)
    } else if (requested !== 'team-invitation') {
      return jsonError('Not allowed', 403)
    } else {

      const invitationId = body.invitationId || body.invitation_id
      if (typeof invitationId !== 'string' || !invitationId) {
        return jsonError('invitationId is required', 400)
      }

      const { data: invitation } = await supabase
        .from('business_invitations')
        .select('id, business_id, email, role, token, status, expires_at')
        .eq('id', invitationId)
        .maybeSingle()

      if (!invitation || invitation.status !== 'pending') {
        return jsonError('Invitation not found', 404)
      }
      if (new Date(invitation.expires_at).getTime() < Date.now()) {
        return jsonError('Invitation expired', 410)
      }

      // The caller must be an active owner/admin of the inviting business.
      const { data: membership } = await supabase
        .from('business_members')
        .select('role, is_active')
        .eq('business_id', invitation.business_id)
        .eq('user_id', caller.id)
        .maybeSingle()

      if (!membership || !membership.is_active || !['owner', 'admin'].includes(membership.role)) {
        return jsonError('Not allowed', 403)
      }

      const { data: business } = await supabase
        .from('businesses')
        .select('name')
        .eq('id', invitation.business_id)
        .maybeSingle()

      const requestedOrigin = typeof body.inviteOrigin === 'string' ? body.inviteOrigin : ''
      const origin = ALLOWED_INVITE_ORIGINS.includes(requestedOrigin)
        ? requestedOrigin
        : DEFAULT_INVITE_ORIGIN

      templateName = 'team-invitation'
      recipientEmail = invitation.email
      idempotencyKey = `team-invitation-${invitation.id}-${messageId}`
      templateData = {
        businessName: business?.name ?? 'tu equipo',
        inviteUrl: `${origin}/invite/${invitation.token}`,
        roleLabel: ROLE_LABEL[invitation.role] ?? 'Personal',
        inviterName:
          (caller.user_metadata?.full_name as string | undefined) ?? undefined,
      }
    }
  }

  if (!templateName) {
    return jsonError('templateName is required', 400)
  }

  // 1. Look up template from registry (early — needed to resolve recipient)
  const template = TEMPLATES[templateName]

  if (!template) {
    console.error('Template not found in registry', { templateName })
    return jsonError(`Template '${templateName}' not found`, 404)
  }

  // Resolve effective recipient: template-level `to` takes precedence over
  // the resolved recipient. This allows notification templates to always send
  // to a fixed address (e.g., site owner from env var).
  const effectiveRecipient = template.to || recipientEmail

  if (!effectiveRecipient) {
    return jsonError('No recipient could be resolved for this template', 400)
  }

  // 2. Check suppression list (fail-closed: if we can't verify, don't send)
  const { data: suppressed, error: suppressionError } = await supabase
    .from('suppressed_emails')
    .select('id')
    .eq('email', effectiveRecipient.toLowerCase())
    .maybeSingle()

  if (suppressionError) {
    console.error('Suppression check failed — refusing to send', {
      error: suppressionError,
      recipient: redactEmail(effectiveRecipient),
    })
    return new Response(
      JSON.stringify({ error: 'Failed to verify suppression status' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (suppressed) {
    // Log the suppressed attempt
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
    })

    console.log('Email suppressed', { recipient: redactEmail(effectiveRecipient), templateName })
    return new Response(
      JSON.stringify({ success: false, reason: 'email_suppressed' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // 3. Get or create unsubscribe token (one token per email address)
  const normalizedEmail = effectiveRecipient.toLowerCase()
  let unsubscribeToken: string

  // Check for existing token for this email
  const { data: existingToken, error: tokenLookupError } = await supabase
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (tokenLookupError) {
    console.error('Token lookup failed', {
      error: tokenLookupError,
      email: redactEmail(normalizedEmail),
    })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: 'Failed to look up unsubscribe token',
    })
    return new Response(
      JSON.stringify({ error: 'Failed to prepare email' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  if (existingToken && !existingToken.used_at) {
    // Reuse existing unused token
    unsubscribeToken = existingToken.token
  } else if (!existingToken) {
    // Create new token — upsert handles concurrent inserts gracefully
    unsubscribeToken = generateToken()
    const { error: tokenError } = await supabase
      .from('email_unsubscribe_tokens')
      .upsert(
        { token: unsubscribeToken, email: normalizedEmail },
        { onConflict: 'email', ignoreDuplicates: true }
      )

    if (tokenError) {
      console.error('Failed to create unsubscribe token', {
        error: tokenError,
      })
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: templateName,
        recipient_email: effectiveRecipient,
        status: 'failed',
        error_message: 'Failed to create unsubscribe token',
      })
      return new Response(
        JSON.stringify({ error: 'Failed to prepare email' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }

    // If another request raced us, our upsert was silently ignored.
    // Re-read to get the actual stored token.
    const { data: storedToken, error: reReadError } = await supabase
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (reReadError || !storedToken) {
      console.error('Failed to read back unsubscribe token after upsert', {
        error: reReadError,
        email: redactEmail(normalizedEmail),
      })
      await supabase.from('email_send_log').insert({
        message_id: messageId,
        template_name: templateName,
        recipient_email: effectiveRecipient,
        status: 'failed',
        error_message: 'Failed to confirm unsubscribe token storage',
      })
      return new Response(
        JSON.stringify({ error: 'Failed to prepare email' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      )
    }
    unsubscribeToken = storedToken.token
  } else {
    // Token exists but is already used — email should have been caught by suppression check above.
    // This is a safety fallback; log and skip sending.
    console.warn('Unsubscribe token already used but email not suppressed', {
      email: redactEmail(normalizedEmail),
    })
    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
      error_message:
        'Unsubscribe token used but email missing from suppressed list',
    })
    return new Response(
      JSON.stringify({ success: false, reason: 'email_suppressed' }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }

  // 4. Render React Email template to HTML and plain text
  const html = await renderAsync(
    React.createElement(template.component, templateData)
  )
  const plainText = await renderAsync(
    React.createElement(template.component, templateData),
    { plainText: true }
  )

  // Resolve subject — supports static string or dynamic function
  const resolvedSubject =
    typeof template.subject === 'function'
      ? template.subject(templateData)
      : template.subject

  // 5. Enqueue the pre-rendered email for async processing by the dispatcher.
  // The dispatcher (process-email-queue) handles sending, retries, and rate-limit backoff.

  // Log pending BEFORE enqueue so we have a record even if enqueue crashes
  await supabase.from('email_send_log').insert({
    message_id: messageId,
    template_name: templateName,
    recipient_email: effectiveRecipient,
    status: 'pending',
    metadata: logMetadata,
  })

  const { error: enqueueError } = await supabase.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      to: effectiveRecipient,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: resolvedSubject,
      html,
      text: plainText,
      purpose: 'transactional',
      label: templateName,
      idempotency_key: idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    console.error('Failed to enqueue email', {
      error: enqueueError,
      templateName,
      recipient: redactEmail(effectiveRecipient),
    })

    await supabase.from('email_send_log').insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: 'Failed to enqueue email',
    })

    return new Response(JSON.stringify({ error: 'Failed to enqueue email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  console.log('Transactional email enqueued', { templateName, recipient: redactEmail(effectiveRecipient) })

  return new Response(
    JSON.stringify({ success: true, queued: true }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  )
})
