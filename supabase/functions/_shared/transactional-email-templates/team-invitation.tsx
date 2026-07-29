/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  businessName?: string
  inviteUrl?: string
  roleLabel?: string
  inviterName?: string
}

const Email = ({
  businessName = 'tu equipo',
  inviteUrl = 'https://cogent-business-os.lovable.app',
  roleLabel = 'Personal',
  inviterName,
}: Props) => (
  <Html lang="es" dir="ltr">
    <Head />
    <Preview>{`Te han invitado a unirte a ${businessName} en Pymova`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={brand}>Pymova</Text>
        <Heading style={h1}>Te han invitado a {businessName}</Heading>
        <Text style={text}>
          {inviterName ? `${inviterName} te ha invitado` : 'Te han invitado'} a unirte al equipo de{' '}
          <strong>{businessName}</strong> en Pymova con el rol de <strong>{roleLabel}</strong>.
        </Text>
        <Section style={{ margin: '28px 0' }}>
          <Button href={inviteUrl} style={button}>
            Aceptar invitación
          </Button>
        </Section>
        <Text style={muted}>
          Importante: inicia sesión con este mismo correo (puedes usar «Continuar con Google»)
          para que la invitación se asocie a tu cuenta.
        </Text>
        <Text style={muted}>
          Si el botón no funciona, copia este enlace en tu navegador:{' '}
          <Link href={inviteUrl} style={link}>
            {inviteUrl}
          </Link>
        </Text>
        <Hr style={hr} />
        <Text style={footer}>
          La invitación caduca a los 14 días. Si no esperabas este correo, puedes ignorarlo.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (data: Props) =>
    `Invitación para unirte a ${data?.businessName ?? 'un equipo'} en Pymova`,
  displayName: 'Invitación al equipo',
  previewData: {
    businessName: 'Codiarch Squad S.L',
    inviteUrl: 'https://cogent-business-os.lovable.app/invite/abc123',
    roleLabel: 'Administrador',
    inviterName: 'Juan',
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
}
const container = { padding: '32px 28px', maxWidth: '560px' }
const brand = {
  color: 'hsl(221, 83%, 53%)',
  fontSize: '18px',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  margin: '0 0 20px',
}
const h1 = {
  color: 'hsl(222, 47%, 11%)',
  fontSize: '24px',
  fontWeight: 700,
  lineHeight: '1.3',
  margin: '0 0 16px',
}
const text = { color: 'hsl(222, 47%, 11%)', fontSize: '15px', lineHeight: '1.6', margin: '0 0 12px' }
const muted = { color: '#55575d', fontSize: '13px', lineHeight: '1.6', margin: '0 0 10px' }
const button = {
  backgroundColor: 'hsl(221, 83%, 53%)',
  color: '#ffffff',
  borderRadius: '12px',
  fontSize: '15px',
  fontWeight: 600,
  padding: '13px 26px',
  textDecoration: 'none',
  display: 'inline-block',
}
const link = { color: 'hsl(221, 83%, 53%)', wordBreak: 'break-all' as const }
const hr = { borderColor: '#e6e8eb', margin: '28px 0 16px' }
const footer = { color: '#8b8e94', fontSize: '12px', lineHeight: '1.5', margin: 0 }
