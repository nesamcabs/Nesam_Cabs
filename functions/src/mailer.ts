// Every email the platform sends goes through this module (Nodemailer over SMTP).
//
// Credentials come only from the environment (functions/.env locally, the Vercel / Firebase project settings in production):
//   SMTP_SERVICE   optional Nodemailer well-known service, e.g. "gmail" (then host/port are implied)
//   SMTP_HOST, SMTP_PORT, SMTP_SECURE   the SMTP server (e.g. smtp.gmail.com, 465, true)
//   SMTP_USER, SMTP_PASS                the mailbox and its password / app password
//   EMAIL_FROM, EMAIL_FROM_NAME         the sender shown to recipients (EMAIL_FROM defaults to SMTP_USER)
//   EMAIL_REPLY_TO                      where customer replies go (defaults to OFFICE_EMAIL)
//   OFFICE_EMAIL                        the NESAM office inbox that receives contact forms and office alerts (comma-separated allowed)
// Nothing here is ever sent to a client. A missing setting makes a send return "not configured"; it never throws at callers.
import nodemailer, { type Transporter } from 'nodemailer';

export type BrandId = 'nesam' | 'people_taxi' | 'onewaycarrentals';

export interface BrandProfile {
  id: BrandId;
  name: string;
  /** Short line under the name in emails. */
  tagline: string;
  /** Primary colour and its soft tint (email-safe hex). */
  color: string;
  soft: string;
  /** Text colour on the primary colour. */
  onColor: string;
  website: string;
  supportPhone: string;
  supportPhoneDisplay: string;
  whatsapp: string;
}

const SUPPORT_PHONE = '+919025099990';
const SUPPORT_PHONE_DISPLAY = '+91 90250 99990';
export const COMPANY_LEGAL_NAME = 'NESAM Tours and Travels Private Limited';

/** The three customer brands, with the colours their websites use. */
export const BRANDS: Record<BrandId, BrandProfile> = {
  nesam: {
    id: 'nesam', name: 'NESAM Cabs', tagline: 'NESAM Tours & Travels', color: '#c62828', soft: '#fff1ee', onColor: '#ffffff',
    website: 'https://nesamcabs.com', supportPhone: SUPPORT_PHONE, supportPhoneDisplay: SUPPORT_PHONE_DISPLAY, whatsapp: '919025099990',
  },
  people_taxi: {
    id: 'people_taxi', name: 'People Taxi', tagline: `A unit of ${COMPANY_LEGAL_NAME}`, color: '#1665e8', soft: '#edf4ff', onColor: '#ffffff',
    website: 'https://peopletaxi.in', supportPhone: SUPPORT_PHONE, supportPhoneDisplay: SUPPORT_PHONE_DISPLAY, whatsapp: '919025099990',
  },
  onewaycarrentals: {
    id: 'onewaycarrentals', name: 'One Way Car Rentals', tagline: `A unit of ${COMPANY_LEGAL_NAME}`, color: '#0d8a45', soft: '#e9f6ee', onColor: '#ffffff',
    website: 'https://onewaycarrental.nesamcabs.com', supportPhone: SUPPORT_PHONE, supportPhoneDisplay: SUPPORT_PHONE_DISPLAY, whatsapp: '919025099990',
  },
};

/** The brand of a booking or request, from any of the fields the apps write. Unknown → NESAM. */
export function brandOf(x: { brand?: unknown; bookingSource?: unknown; source?: unknown } | string | undefined | null): BrandProfile {
  const raw = (typeof x === 'string' ? x : `${x?.brand ?? ''} ${x?.bookingSource ?? ''} ${x?.source ?? ''}`).toLowerCase();
  if (raw.includes('people')) return BRANDS.people_taxi;
  if (raw.includes('oneway') || raw.includes('one_way') || raw.includes('one way')) return BRANDS.onewaycarrentals;
  return BRANDS.nesam;
}

const env = (k: string) => (process.env[k] ?? '').trim();

/** True when Nodemailer has what it needs to connect. */
export function mailConfigured(): boolean {
  return !!(env('SMTP_USER') && env('SMTP_PASS') && (env('SMTP_SERVICE') || env('SMTP_HOST')));
}

/** The office inbox(es) for contact forms and office alerts; empty when not set. */
export function officeAddresses(): string[] {
  return env('OFFICE_EMAIL').split(',').map((s) => s.trim()).filter((s) => EMAIL_RE.test(s));
}

export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

let transport: Transporter | null = null;
let transportKey = '';

function getTransport(): Transporter {
  const key = ['SMTP_SERVICE', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS'].map(env).join('|');
  if (transport && key === transportKey) return transport;
  const port = Number(env('SMTP_PORT')) || 465;
  const secure = env('SMTP_SECURE') ? env('SMTP_SECURE').toLowerCase() === 'true' : port === 465;
  const opts: any = {
    ...(env('SMTP_SERVICE') ? { service: env('SMTP_SERVICE') } : { host: env('SMTP_HOST'), port, secure }),
    auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
    // Serverless: one short-lived connection per send, bounded so a slow server never hangs a request.
    pool: false,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  };
  transport = nodemailer.createTransport(opts);
  transportKey = key;
  return transport;
}

export interface MailInput {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  brand?: BrandProfile;
}

export interface MailResult { ok: boolean; status: 'sent' | 'failed' | 'not_configured'; messageId?: string; error?: string }

/** Sends one email. Never throws: returns what happened so callers can log it. */
export async function sendMail(m: MailInput): Promise<MailResult> {
  if (!mailConfigured()) return { ok: false, status: 'not_configured', error: 'Email (SMTP) is not set up on the server.' };
  const to = (Array.isArray(m.to) ? m.to : [m.to]).map((s) => s.trim()).filter((s) => EMAIL_RE.test(s));
  if (!to.length) return { ok: false, status: 'failed', error: 'No valid email address.' };
  const fromAddress = env('EMAIL_FROM') || env('SMTP_USER');
  const fromName = (m.brand?.name ?? env('EMAIL_FROM_NAME')) || 'NESAM Tours & Travels';
  const replyTo = m.replyTo || env('EMAIL_REPLY_TO') || officeAddresses()[0] || undefined;
  try {
    const info = await getTransport().sendMail({
      from: { name: fromName, address: fromAddress },
      to,
      subject: m.subject.slice(0, 200),
      text: m.text,
      ...(m.html ? { html: m.html } : {}),
      ...(replyTo ? { replyTo } : {}),
    });
    return { ok: true, status: 'sent', messageId: info.messageId };
  } catch (err) {
    console.warn('[mail] send failed', (err as { code?: string; responseCode?: number }).code ?? '', (err as { responseCode?: number }).responseCode ?? '');
    const code = (err as { code?: string }).code ?? '';
    return {
      ok: false, status: 'failed',
      error: code === 'EAUTH' ? 'The mail server refused the login. Check SMTP_USER and SMTP_PASS (use an app password).'
        : code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET' ? 'The mail server could not be reached.'
        : 'The email could not be delivered.',
    };
  }
}

/** Sends to the office inbox(es). "not_configured" when OFFICE_EMAIL is not set. */
export async function sendOfficeMail(m: Omit<MailInput, 'to'>): Promise<MailResult> {
  const to = officeAddresses();
  if (!to.length) return { ok: false, status: 'not_configured', error: 'OFFICE_EMAIL is not set on the server.' };
  return sendMail({ ...m, to });
}

// ── Branded template ────────────────────────────────────────────────────────

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface EmailContent {
  /** Preheader and heading. */
  title: string;
  greeting?: string;
  /** Plain paragraphs (escaped; line breaks kept). */
  paragraphs: string[];
  /** Label / value rows shown as a details table. */
  rows?: [string, string][];
  /** One button. */
  action?: { label: string; url: string };
  /** Small print under the body. */
  note?: string;
}

/** HTML and plain-text versions of one message, in the brand's colours. Table layout + inline styles for every mail client. */
export function renderEmail(brand: BrandProfile, c: EmailContent): { html: string; text: string } {
  const rows = (c.rows ?? []).filter(([, v]) => String(v ?? '').trim() !== '');
  const p = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#2b2f36">${esc(s).replace(/\n/g, '<br>')}</p>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.title)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="background:${brand.color};padding:20px 28px">
<div style="font-size:20px;font-weight:800;color:${brand.onColor};letter-spacing:-0.2px">${esc(brand.name)}</div>
<div style="font-size:12px;color:${brand.onColor};opacity:0.85;margin-top:2px">${esc(brand.tagline)}</div>
</td></tr>
<tr><td style="padding:28px 28px 8px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#111827">${esc(c.title)}</h1>
${c.greeting ? p(c.greeting) : ''}
${c.paragraphs.map(p).join('\n')}
${rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border:1px solid #e5e7eb;border-radius:8px;background:${brand.soft}">
${rows.map(([k, v], i) => `<tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;width:38%;${i ? 'border-top:1px solid #e5e7eb;' : ''}vertical-align:top">${esc(k)}</td><td style="padding:10px 14px;font-size:14px;color:#111827;font-weight:600;${i ? 'border-top:1px solid #e5e7eb;' : ''}vertical-align:top">${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('\n')}
</table>` : ''}
${c.action ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 20px"><tr><td style="background:${brand.color};border-radius:8px"><a href="${esc(c.action.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;color:${brand.onColor};text-decoration:none">${esc(c.action.label)}</a></td></tr></table>` : ''}
${c.note ? `<p style="margin:0 0 14px;font-size:12px;line-height:1.6;color:#6b7280">${esc(c.note)}</p>` : ''}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #f0f1f3">
<p style="margin:0;font-size:13px;color:#4b5563">Need help? Call or WhatsApp <strong>${esc(brand.supportPhoneDisplay)}</strong> (24×7).</p>
<p style="margin:6px 0 0;font-size:11px;color:#9ca3af">${esc(brand.name)} · ${esc(COMPANY_LEGAL_NAME)} · Theni, Tamil Nadu, India</p>
</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    c.title, '',
    ...(c.greeting ? [c.greeting, ''] : []),
    ...c.paragraphs.flatMap((s) => [s, '']),
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(rows.length ? [''] : []),
    ...(c.action ? [`${c.action.label}: ${c.action.url}`, ''] : []),
    ...(c.note ? [c.note, ''] : []),
    `Need help? Call or WhatsApp ${brand.supportPhoneDisplay} (24x7).`,
    `${brand.name} · ${COMPANY_LEGAL_NAME}`,
  ].join('\n');
  return { html, text };
}
