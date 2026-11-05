// Non-callable HTTP entry points: health check, WhatsApp delivery webhook and the cron jobs
// that replace the Firebase scheduler / Firestore triggers.
import { createHmac } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../admin';
import { runUnassignedAlerts, clearResolvedFlags } from '../scheduler';
import { reconcileBacklog, runPeriodicJobs } from '../jobs';
import { handleRazorpayEvent, razorpayWebhookValid } from '../payments';
import { ApiRequest, ApiResponse, apiHeaders, cronAuthorized, header, safeEqual, sendError, sendJson } from './util';

export async function health(_req: ApiRequest, res: ApiResponse): Promise<void> {
  apiHeaders(res);
  sendJson(res, 200, { ok: true, time: new Date().toISOString() });
}

async function readRawBody(req: ApiRequest, limit = 1_000_000): Promise<Buffer> {
  if (Buffer.isBuffer(req.rawBody)) {
    if (req.rawBody.length > limit) throw new Error('body too large');
    return req.rawBody;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

/**
 * WhatsApp delivery receipts. Configure this URL in the Meta app's webhook settings with
 * WHATSAPP_WEBHOOK_VERIFY_TOKEN; POSTs are accepted only with a valid X-Hub-Signature-256
 * made with WHATSAPP_APP_SECRET over the raw request body.
 */
export async function whatsappWebhook(req: ApiRequest, res: ApiResponse): Promise<void> {
  apiHeaders(res);
  const verifyToken = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '').trim();
  const secret = (process.env.WHATSAPP_APP_SECRET ?? '').trim();
  const query = req.query;
  const q = (k: string) => String(Array.isArray(query[k]) ? query[k]![0] : query[k] ?? '');

  if (req.method === 'GET') {
    if (verifyToken && q('hub.mode') === 'subscribe' && safeEqual(q('hub.verify_token'), verifyToken)) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end(q('hub.challenge'));
      return;
    }
    return sendError(res, 403, 'permission-denied', 'Forbidden.');
  }
  if (req.method !== 'POST' || !secret) return sendError(res, 403, 'permission-denied', 'Forbidden.');

  let raw: Buffer;
  try {
    raw = await readRawBody(req);
  } catch {
    return sendError(res, 413, 'invalid-argument', 'Request is too large.');
  }
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  if (!safeEqual(header(req, 'x-hub-signature-256'), expected)) return sendError(res, 403, 'permission-denied', 'Forbidden.');

  let body: any;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return sendError(res, 400, 'invalid-argument', 'Invalid JSON.');
  }
  const map: Record<string, string> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
  const statuses = (body?.entry ?? []).flatMap((e: any) => (e.changes ?? []).flatMap((c: any) => c.value?.statuses ?? []));
  for (const s of statuses) {
    const status = map[s.status];
    if (!status || !s.id) continue;
    const rows = await db.collection('notification_deliveries').where('providerMessageId', '==', s.id).limit(5).get();
    await Promise.all(rows.docs.map((d) => d.ref.update({
      status,
      statusAt: FieldValue.serverTimestamp(),
      ...(status === 'failed' ? { error: String(s.errors?.[0]?.title ?? 'Delivery failed').slice(0, 200) } : {}),
    })));
  }
  sendJson(res, 200, { ok: true });
}

/** Every 10 minutes (Pro) / daily (Hobby): flag bookings still unassigned near pickup. */
export async function cronAlerts(req: ApiRequest, res: ApiResponse): Promise<void> {
  apiHeaders(res);
  if (!cronAuthorized(req)) return sendError(res, 401, 'unauthenticated', 'Unauthorized.');
  try {
    const result = await runUnassignedAlerts();
    await clearResolvedFlags();
    sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    console.error('[cron] alerts failed', err);
    sendError(res, 500, 'internal', 'Job failed.');
  }
}

/** Backlog-based safety net: settles every booking written since the stored watermark (not just the last N minutes). */
export async function cronReconcile(req: ApiRequest, res: ApiResponse): Promise<void> {
  apiHeaders(res);
  if (!cronAuthorized(req)) return sendError(res, 401, 'unauthenticated', 'Unauthorized.');
  try {
    sendJson(res, 200, { ok: true, ...(await reconcileBacklog()) });
  } catch (err) {
    console.error('[cron] reconcile failed', err);
    sendError(res, 500, 'internal', 'Job failed.');
  }
}

/** Runs every periodic job (backlog reconcile, alerts, offer escalation, cut-offs, waves, settlements, expiries). */
export async function cronTick(req: ApiRequest, res: ApiResponse): Promise<void> {
  apiHeaders(res);
  if (!cronAuthorized(req)) return sendError(res, 401, 'unauthenticated', 'Unauthorized.');
  try {
    sendJson(res, 200, { ok: true, ...(await runPeriodicJobs()) });
  } catch (err) {
    console.error('[cron] tick failed', err);
    sendError(res, 500, 'internal', 'Job failed.');
  }
}

/**
 * Razorpay webhook. Accepts only a body signed with RAZORPAY_WEBHOOK_SECRET (X-Razorpay-Signature over
 * the raw bytes). A captured payment becomes a canonical receipt exactly once, even when Razorpay
 * redelivers the event or the customer's own checkout callback also verified it.
 */
export async function razorpayWebhook(req: ApiRequest, res: ApiResponse): Promise<void> {
  apiHeaders(res);
  if (req.method !== 'POST') return sendError(res, 405, 'method-not-allowed', 'Use POST.');
  const secret = (process.env.RAZORPAY_WEBHOOK_SECRET ?? '').trim();
  if (!secret) return sendError(res, 503, 'unavailable', 'Webhook is not configured.');
  let raw: Buffer;
  try {
    raw = await readRawBody(req);
  } catch {
    return sendError(res, 413, 'invalid-argument', 'Request is too large.');
  }
  if (!razorpayWebhookValid(raw, header(req, 'x-razorpay-signature'), secret)) return sendError(res, 403, 'permission-denied', 'Forbidden.');
  let body: any;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return sendError(res, 400, 'invalid-argument', 'Invalid JSON.');
  }
  try {
    const r = await handleRazorpayEvent(body);
    sendJson(res, 200, { ok: true, ...r });
  } catch (err) {
    // 5xx makes Razorpay retry; the receipt is idempotent so a retry is safe.
    console.error('[razorpay] webhook failed', err);
    sendError(res, 500, 'internal', 'Could not process the event.');
  }
}
