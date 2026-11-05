// Outbound channel adapters: WhatsApp (Meta WhatsApp Business Cloud API),
// SMS (MSG91 or Twilio) and email (Nodemailer SMTP). Credentials come only from the
// environment (see .env.example); nothing is hard-coded. An unconfigured
// channel reports `not_configured` — it never pretends to have sent.
//
// WhatsApp uses the official Cloud API with approved templates only. No
// unofficial automation is used, so the sending number cannot be banned for it.

export type Channel = 'whatsapp' | 'sms' | 'email';

export type SendStatus = 'sent' | 'failed' | 'not_configured';

export interface SendResult {
  ok: boolean;
  channel: Channel;
  status: SendStatus;
  provider: string;
  providerMessageId?: string;
  /** User-safe explanation; raw provider responses are never exposed. */
  error?: string;
}

import { channelEnabled } from './channelPolicy';
import { BRANDS, type BrandProfile, mailConfigured, renderEmail, sendMail } from './mailer';
const env = (k: string) => (process.env[k] ?? '').trim();
const disabled=(channel:Channel):SendResult=>({ok:false,channel,status:'not_configured',provider:'settings',error:`${channel} delivery is disabled in Settings.`});

/** Digits only, country code first (no '+'), as the WhatsApp and MSG91 APIs expect. */
export function toDigits(e164: string): string {
  return e164.replace(/\D/g, '');
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-JSON response */ }
  return { ok: res.ok, status: res.status, json };
}

const notConfigured = (channel: Channel, provider: string, what: string): SendResult => ({
  ok: false, channel, status: 'not_configured', provider, error: `${what} is not configured on the server.`,
});

// ── WhatsApp Cloud API ────────────────────────────────────────────────────

export interface WhatsAppTemplate {
  /** Template name as approved in Meta Business Manager. */
  name: string;
  languageCode?: string;
  /** Values for {{1}}, {{2}}, … in the template body. */
  bodyParams: string[];
  /** Authentication templates carry the code again in the copy-code button. */
  otpButton?: string;
}

export function whatsappConfigured(): boolean {
  return !!(env('WHATSAPP_ACCESS_TOKEN') && env('WHATSAPP_PHONE_NUMBER_ID'));
}

export async function sendWhatsApp(toE164: string, t: WhatsAppTemplate): Promise<SendResult> {
  if(!await channelEnabled('whatsapp'))return disabled('whatsapp');
  if (!whatsappConfigured()) return notConfigured('whatsapp', 'whatsapp_cloud', 'WhatsApp Business API');
  const version = env('WHATSAPP_API_VERSION') || 'v20.0';
  const components: unknown[] = [{ type: 'body', parameters: t.bodyParams.map((text) => ({ type: 'text', text })) }];
  if (t.otpButton) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: t.otpButton }] });
  try {
    const r = await postJson(
      `https://graph.facebook.com/${version}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`,
      { Authorization: `Bearer ${env('WHATSAPP_ACCESS_TOKEN')}` },
      {
        messaging_product: 'whatsapp', to: toDigits(toE164), type: 'template',
        template: { name: t.name, language: { code: t.languageCode || env('WHATSAPP_TEMPLATE_LANGUAGE') || 'en' }, components },
      },
    );
    const id = r.json?.messages?.[0]?.id as string | undefined;
    if (r.ok && id) return { ok: true, channel: 'whatsapp', status: 'sent', provider: 'whatsapp_cloud', providerMessageId: id };
    console.warn('WhatsApp send failed', r.status, JSON.stringify(r.json?.error ?? r.json));
    return { ok: false, channel: 'whatsapp', status: 'failed', provider: 'whatsapp_cloud', error: 'WhatsApp could not deliver the message. Check the number and try another channel.' };
  } catch (err) {
    console.warn('WhatsApp send error', err);
    return { ok: false, channel: 'whatsapp', status: 'failed', provider: 'whatsapp_cloud', error: 'WhatsApp is temporarily unreachable.' };
  }
}

// ── SMS ───────────────────────────────────────────────────────────────────

export interface SmsMessage {
  /** Plain text used by Twilio. */
  text: string;
  /** MSG91 DLT flow template variables, e.g. { otp: '123456' }. */
  variables?: Record<string, string>;
  /** MSG91 flow template id; falls back to SMS_MSG91_TEMPLATE_ID. */
  templateId?: string;
}

export function smsProvider(): 'msg91' | 'twilio' | '' {
  const p = env('SMS_PROVIDER').toLowerCase();
  if (p === 'msg91' && env('MSG91_AUTH_KEY')) return 'msg91';
  if (p === 'twilio' && env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && (env('TWILIO_FROM') || env('TWILIO_MESSAGING_SERVICE_SID'))) return 'twilio';
  return '';
}

export async function sendSms(toE164: string, m: SmsMessage): Promise<SendResult> {
  if(!await channelEnabled('sms'))return disabled('sms');
  const provider = smsProvider();
  if (!provider) return notConfigured('sms', env('SMS_PROVIDER') || 'sms', 'The SMS provider');
  try {
    if (provider === 'msg91') {
      const templateId = m.templateId || env('SMS_MSG91_TEMPLATE_ID') || env('MSG91_TEMPLATE_ID');
      if (!templateId) return notConfigured('sms', 'msg91', 'The MSG91 template');
      const r = await postJson('https://control.msg91.com/api/v5/flow/', { authkey: env('MSG91_AUTH_KEY') }, {
        template_id: templateId, short_url: '0', recipients: [{ mobiles: toDigits(toE164), ...(m.variables ?? {}) }],
      });
      if (r.ok && r.json?.type === 'success') return { ok: true, channel: 'sms', status: 'sent', provider, providerMessageId: String(r.json?.message ?? '') };
      console.warn('MSG91 send failed', r.status, JSON.stringify(r.json));
    } else {
      const sid = env('TWILIO_ACCOUNT_SID');
      const body = new URLSearchParams({ To: toE164, Body: m.text });
      if (env('TWILIO_MESSAGING_SERVICE_SID')) body.set('MessagingServiceSid', env('TWILIO_MESSAGING_SERVICE_SID'));
      else body.set('From', env('TWILIO_FROM'));
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body, signal: AbortSignal.timeout(15000),
      });
      const json: any = await res.json().catch(() => null);
      if (res.ok && json?.sid) return { ok: true, channel: 'sms', status: 'sent', provider, providerMessageId: json.sid };
      console.warn('Twilio send failed', res.status, JSON.stringify(json));
    }
    return { ok: false, channel: 'sms', status: 'failed', provider, error: 'The SMS could not be delivered. Check the number and try another channel.' };
  } catch (err) {
    console.warn('SMS send error', err);
    return { ok: false, channel: 'sms', status: 'failed', provider, error: 'The SMS provider is temporarily unreachable.' };
  }
}

// ── Email (Nodemailer over SMTP — see mailer.ts) ─────────────────────────

export interface EmailMessage {
  subject: string;
  text: string;
  /** A ready HTML body. When absent, the text is laid out in the brand's email template. */
  html?: string;
  /** The customer brand the message belongs to (colours, name, sender name). Defaults to NESAM. */
  brand?: BrandProfile;
  replyTo?: string;
}

export function emailConfigured(): boolean {
  return mailConfigured();
}

export async function sendEmail(to: string, m: EmailMessage): Promise<SendResult> {
  if (!await channelEnabled('email')) return disabled('email');
  if (!emailConfigured()) return notConfigured('email', 'smtp', 'Email (SMTP)');
  const brand = m.brand ?? BRANDS.nesam;
  // Plain messages from older callers still go out as a branded HTML email, with the text as the fallback part.
  const body = m.html ? { html: m.html, text: m.text } : renderEmail(brand, { title: m.subject, paragraphs: m.text.split(/[\r\n]{2,}/).map((x) => x.trim()).filter(Boolean) });
  const r = await sendMail({ to, subject: m.subject, text: m.html ? m.text : body.text, html: body.html, brand, replyTo: m.replyTo });
  return { ok: r.ok, channel: 'email', status: r.status, provider: 'smtp', providerMessageId: r.messageId ?? '', ...(r.error ? { error: r.error } : {}) };
}

export const mask = {
  phone: (p: string) => (p.length > 4 ? `${'•'.repeat(Math.max(0, p.length - 4))}${p.slice(-4)}` : p),
  email: (e: string) => e.replace(/^(.).*(@.*)$/, '$1•••$2'),
};
