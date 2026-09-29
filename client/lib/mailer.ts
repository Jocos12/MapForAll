/**
 * Transactional email over SMTP (Nodemailer). Works with Gmail (app password),
 * Resend, SendGrid, Mailgun, Brevo…
 *
 * Env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM_EMAIL,
 * optional SMTP_FROM_NAME. Failures are never silent.
 *
 * Node runtime only — never import this from Edge middleware.
 */
import nodemailer, { type Transporter } from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'

export interface MailContent {
  subject: string
  html: string
  text: string
}

export type SendResult = { ok: true } | { ok: false; reason: 'unconfigured' | 'failed' | 'dev_domain' }

/**
 * Local development only: recipients on these domains (comma-separated
 * DEV_EMAIL_DOMAINS, e.g. the seeded `mapforall.rw` demo accounts) never get a
 * real email. The send is reported as not delivered, so the OTP flow falls
 * back to showing the code on screen when OTP_DEV_FALLBACK=true. Ignored in
 * production, so it can never swallow a real user's mail.
 */
function isDevOnlyRecipient(to: string): boolean {
  if (process.env.NODE_ENV === 'production') return false
  const domains = (process.env.DEV_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
  const domain = to.split('@')[1]?.trim().toLowerCase()
  return Boolean(domain) && domains.includes(domain)
}

let transporter: Transporter | null = null
let verified = false
let loggedConfig = false

function smtpPassword(): string {
  // Gmail app passwords are often pasted with spaces; strip them.
  return (process.env.SMTP_PASSWORD ?? '').replace(/\s+/g, '')
}

export function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST
    && process.env.SMTP_USER
    && smtpPassword()
    && (process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER),
  )
}

/** Log which SMTP env keys are present (never the values). Call once per process. */
export function logSmtpConfigPresence(): void {
  if (loggedConfig) return
  loggedConfig = true
  const keys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_EMAIL', 'SMTP_FROM_NAME'] as const
  const status = keys.map((k) => {
    const raw = k === 'SMTP_PASSWORD' ? smtpPassword() : (process.env[k] ?? '')
    return `${k}=${raw ? 'set' : 'missing'}`
  })
  console.info(`[mailer] config: ${status.join(' ')} NODE_ENV=${process.env.NODE_ENV}`)
}

/** j•••n@gmail.com — for logs and for the "code sent to…" line. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '•••'
  const shown = local.length <= 2 ? local[0] ?? '' : `${local[0]}•••${local[local.length - 1]}`
  return `${shown}@${domain}`
}

function transport(): Transporter {
  if (transporter) return transporter
  const port = Number(process.env.SMTP_PORT) || 587
  const secureEnv = process.env.SMTP_SECURE
  // Port 465 = implicit TLS; 587 = STARTTLS. Never force secure:true on 587.
  const secure = secureEnv === 'true' ? true : secureEnv === 'false' ? false : port === 465
  const options: SMTPTransport.Options = {
    host: process.env.SMTP_HOST,
    port,
    secure,
    requireTLS: !secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: smtpPassword(),
    },
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT) || 10_000,
    greetingTimeout: 10_000,
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT) || 10_000,
    tls: {
      // Keep certificate verification on. Do not set rejectUnauthorized: false.
      minVersion: 'TLSv1.2',
      servername: process.env.SMTP_HOST,
    },
  }
  transporter = nodemailer.createTransport(options)
  return transporter
}

function fromAddress(): string {
  // Gmail only accepts the authenticated mailbox as From.
  return (process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || '').trim()
}

function fromName(): string {
  return (process.env.SMTP_FROM_NAME || 'MapForAll').replace(/"/g, '')
}

async function ensureVerified(): Promise<void> {
  if (verified) return
  try {
    await transport().verify()
    verified = true
    console.info('[mailer] transporter.verify() OK')
  } catch (err) {
    const e = err as { message?: string; responseCode?: number; response?: string; code?: string; stack?: string }
    console.error('[mailer] transporter.verify() FAILED', {
      message: e?.message,
      code: e?.code,
      responseCode: e?.responseCode,
      response: e?.response,
      stack: e?.stack ?? (err instanceof Error ? err.stack : String(err)),
    })
    throw err
  }
}

export async function sendMail(to: string, content: MailContent): Promise<SendResult> {
  if (isDevOnlyRecipient(to)) {
    console.info(`[mailer] dev-only address ${maskEmail(to)}: "${content.subject}" not sent`)
    return { ok: false, reason: 'dev_domain' }
  }
  logSmtpConfigPresence()
  if (!isSmtpConfigured()) {
    console.warn(`[mailer] SMTP is not configured; "${content.subject}" to ${maskEmail(to)} was not sent`)
    return { ok: false, reason: 'unconfigured' }
  }
  try {
    await ensureVerified()
    const info = await transport().sendMail({
      from: { name: fromName(), address: fromAddress() },
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    })
    console.info(`[mailer] sent "${content.subject}" to ${maskEmail(to)} id=${info.messageId ?? '?'}`)
    return { ok: true }
  } catch (err) {
    const e = err as { message?: string; responseCode?: number; response?: string; code?: string; command?: string; stack?: string }
    console.error('[mailer] SMTP failure', {
      to: maskEmail(to),
      subject: content.subject,
      message: e?.message,
      code: e?.code,
      command: e?.command,
      responseCode: e?.responseCode,
      response: e?.response,
      stack: e?.stack ?? (err instanceof Error ? err.stack : String(err)),
    })
    transporter?.close()
    transporter = null
    verified = false
    return { ok: false, reason: 'failed' }
  }
}
