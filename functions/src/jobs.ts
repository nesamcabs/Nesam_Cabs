// Periodic server jobs. One runner (runPeriodicJobs) is driven by whichever scheduler the
// deployment has:
//   • Firebase  → the `periodicJobs` scheduled function below (every 5 minutes, needs Blaze)
//   • Vercel    → POST/GET /api/cron/tick every 5-10 minutes (Vercel Pro, or any external cron
//                 that can send `Authorization: Bearer $CRON_SECRET`). A daily Hobby cron still
//                 works because every job below is WATERMARK / BACKLOG based, not "last N minutes".
// Every job is idempotent, paginated and bounded by a time budget, so a missed run, a retry or two
// overlapping runs only repeat harmless work.
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { DocumentData, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { releaseConfigOf } from './release';
import { announceToPartners } from './marketplace';
import { notify } from './notify';
import { reconcileBooking, reconcilePayout } from './reconcile';
import { clearResolvedFlags, runUnassignedAlerts } from './scheduler';
import { runOfferEscalation } from './claims';
import { runSettlementOverdue } from './settlement';
import { formatDate, pickupInstant } from './domain/time';
import { expiryMs } from './domain/eligibility';
import { text } from './shared';
import { runScheduledNotices } from './noticeCampaigns';
import { reconcilePublicContent } from './publicContent';

const STATE_DOC = 'system/reconcile_state';

export interface BacklogReport { retried: number; swept: number; failed: number; watermarkMs: number; hasMore: boolean }

/**
 * Settles every booking written since the stored watermark, oldest first, in pages, then retries
 * the bookings that failed before. The watermark only moves past documents that were processed
 * (or parked in reconcile_failures), so a worker that dies mid-run resumes where it stopped.
 */
export async function reconcileBacklog(budgetMs = 40000, pageSize = 100): Promise<BacklogReport> {
  const started = Date.now();
  const stateRef = db.doc(STATE_DOC);
  const state = (await stateRef.get()).data() ?? {};
  let watermark: Timestamp = state.watermark instanceof Timestamp ? state.watermark : Timestamp.fromMillis(Date.now() - 3 * 86400000);
  let retried = 0, swept = 0, failed = 0, hasMore = false;

  // 1. Retry what failed on an earlier run.
  const parked = await db.collection('reconcile_failures').orderBy('lastTriedAt').limit(50).get();
  for (const f of parked.docs) {
    if (Date.now() - started > budgetMs) { hasMore = true; break; }
    try {
      if (f.data().kind === 'payout') await reconcilePayout(f.id.replace(/^payout_/, ''));
      else await reconcileBooking(f.id.replace(/^booking_/, ''));
      await f.ref.delete();
      retried++;
    } catch (err) {
      await f.ref.set({ attempts: FieldValue.increment(1), lastTriedAt: FieldValue.serverTimestamp(), error: String((err as Error).message ?? err).slice(0, 300) }, { merge: true });
    }
  }

  // 2. Page through bookings written since the watermark.
  for (;;) {
    if (Date.now() - started > budgetMs) { hasMore = true; break; }
    const page = await db.collection('bookings').where('updatedAt', '>=', watermark).orderBy('updatedAt').limit(pageSize).get();
    if (page.empty) break;
    for (const d of page.docs) {
      try {
        await reconcileBooking(d.id);
        swept++;
      } catch (err) {
        failed++;
        await db.doc(`reconcile_failures/booking_${d.id}`).set({ kind: 'booking', bookingId: d.id, attempts: FieldValue.increment(1), lastTriedAt: FieldValue.serverTimestamp(), error: String((err as Error).message ?? err).slice(0, 300) }, { merge: true });
      }
      const u = d.data().updatedAt;
      if (u instanceof Timestamp && u.toMillis() >= watermark.toMillis()) watermark = u;
    }
    // A short page is the end of the backlog. A full page of identical timestamps cannot loop
    // forever: the watermark is nudged one millisecond past it.
    if (page.size < pageSize) break;
    if (page.docs.every((d) => (d.data().updatedAt as Timestamp)?.toMillis?.() === watermark.toMillis())) watermark = Timestamp.fromMillis(watermark.toMillis() + 1);
  }

  // 3. Open payout requests are few; keep their ledger debits in step.
  const openPayouts = await db.collection('payout_requests').where('status', 'in', ['Pending', 'Processing', 'Approved']).limit(200).get();
  for (const p of openPayouts.docs) {
    try { await reconcilePayout(p.id); } catch { /* retried next run */ }
  }

  // Move the mark back a minute so documents written while the run was in flight are seen again.
  const next = Timestamp.fromMillis(Math.max(0, watermark.toMillis() - 60000));
  await stateRef.set({ watermark: next, lastRunAt: FieldValue.serverTimestamp(), lastReport: { retried, swept, failed, hasMore } }, { merge: true });
  return { retried, swept, failed, watermarkMs: next.toMillis(), hasMore };
}

/** Closes offers whose cut-off passed with nobody assigned and tells staff once; the customer fare is untouched. */
export async function expireMarketplaceOffers(now = Date.now()): Promise<number> {
  const open = await db.collection('marketplace_trips').where('status', 'in', ['Open', 'Bidding']).get();
  let closed = 0;
  for (const m of open.docs) {
    const cutoff = (m.data().cutoffAt as Timestamp | undefined)?.toMillis?.();
    if (!cutoff || cutoff > now) continue;
    const done = await db.runTransaction(async (tx) => {
      const [snap, bids] = await Promise.all([tx.get(m.ref), tx.get(m.ref.collection('bids'))]);
      if (!snap.exists || !['Open', 'Bidding'].includes(String(snap.data()!.status))) return false;
      const stamp = FieldValue.serverTimestamp();
      tx.update(m.ref, { status: 'Closed', closedReason: 'cutoff', closedAt: stamp, updatedAt: stamp });
      for (const b of bids.docs) if (b.data().status === 'Pending Review') tx.update(b.ref, { status: 'Rejected', reviewedAt: stamp });
      tx.update(db.doc(`bookings/${m.id}`), { fulfilmentRoute: FieldValue.delete(), updatedAt: stamp });
      return true;
    });
    if (!done) continue;
    closed++;
    await notify({
      recipientType: 'admin', recipientId: 'admin', category: 'bookings', severity: 'critical', sound: 'general', push: true,
      title: 'Marketplace offer closed with no partner', message: `${text(m.data().bookingId) || m.id} reached its cut-off unassigned. Assign a partner directly or publish again.`,
      bookingId: m.id, bookingCode: text(m.data().bookingId), cta: { label: 'Open booking', page: 'booking-detail', bookingId: m.id }, dedupeKey: `offer_cutoff_${m.id}`,
    }).catch(() => null);
  }
  return closed;
}

/** Tells the next audience of a published duty when its wave opens. No-op unless release waves are enabled. */
export async function runReleaseWaves(now = Date.now()): Promise<number> {
  const settings = (await db.doc('settings/operations').get()).data();
  const cfg = releaseConfigOf(settings);
  if (!cfg.enabled) return 0;
  const open = await db.collection('marketplace_trips').where('status', '==', 'Open').get();
  let sent = 0;
  for (const m of open.docs) {
    const o = m.data();
    const published = (o.publishedAt as Timestamp | undefined)?.toMillis?.();
    if (!published) continue;
    const age = (now - published) / 1000;
    const bookingSnap = await db.doc(`bookings/${m.id}`).get();
    if (!bookingSnap.exists) continue;
    if (age >= cfg.ownersAllSeconds && !o.wave2At) {
      sent += await announceToPartners(m.id, bookingSnap.data()!, o, 'otherOwners', cfg.topRatedMin).catch(() => 0);
      await m.ref.update({ wave2At: FieldValue.serverTimestamp() });
    }
    if (age >= cfg.vendorsSeconds && !o.wave3At) {
      sent += await announceToPartners(m.id, bookingSnap.data()!, o, 'vendors', cfg.topRatedMin).catch(() => 0);
      await m.ref.update({ wave3At: FieldValue.serverTimestamp() });
    }
  }
  return sent;
}

// ── Document expiry reminders ───────────────────────────────────────────────

export const REMINDER_DAYS = [20, 7, 3, 1] as const;
const DRIVER_DOCS: [string, string][] = [['licenseExpiry', 'driving licence']];
const VEHICLE_DOCS: [string, string][] = [['insuranceExpiry', 'insurance'], ['fitnessExpiry', 'fitness certificate'], ['permitExpiry', 'permit'], ['pucExpiry', 'PUC certificate'], ['rcExpiry', 'registration']];

/** The reminder threshold a document is currently inside (smallest day count ≥ days left), or null. */
export function reminderBucket(daysLeft: number): number | null {
  if (daysLeft < 0) return 0;
  for (const d of [...REMINDER_DAYS].sort((a, b) => a - b)) if (daysLeft <= d) return d;
  return null;
}

/**
 * Reminds owners 20 / 7 / 3 / 1 days before a driver or vehicle document expires and tells staff
 * which future bookings the expiry would break. Each (document, expiry date, bucket) notifies once.
 */
export async function runDocumentExpiryReminders(now = Date.now()): Promise<{ checked: number; reminded: number }> {
  let checked = 0, reminded = 0;
  const [drivers, vehicles] = await Promise.all([
    db.collection('drivers').where('status', '==', 'Approved').get(),
    db.collection('vehicles').where('docStatus', '==', 'Approved').get(),
  ]);
  const groups: { id: string; kind: 'driver' | 'vehicle'; data: DocumentData; docs: [string, string][] }[] = [
    ...drivers.docs.map((d) => ({ id: d.id, kind: 'driver' as const, data: d.data(), docs: DRIVER_DOCS })),
    ...vehicles.docs.map((d) => ({ id: d.id, kind: 'vehicle' as const, data: d.data(), docs: VEHICLE_DOCS })),
  ];
  for (const g of groups) {
    for (const [field, what] of g.docs) {
      const at = expiryMs(g.data[field]);
      if (at === null) continue;
      checked++;
      const daysLeft = Math.floor((at - now) / 86400000);
      const bucket = reminderBucket(daysLeft);
      if (bucket === null) continue;
      const subject = g.kind === 'driver' ? text(g.data.name) || 'Your' : text(g.data.vehicleNumber) || 'A vehicle';
      const when = formatDate(new Date(at));
      const recipient = g.kind === 'driver' ? { type: 'driver' as const, id: g.id } : g.data.vendorId ? { type: 'vendor' as const, id: String(g.data.vendorId) } : g.data.assignedDriverId ? { type: 'driver' as const, id: String(g.data.assignedDriverId) } : null;
      const key = `docexp_${g.kind}_${g.id}_${field}_${when}_${bucket}`;
      const title = bucket === 0 ? `${what[0]!.toUpperCase()}${what.slice(1)} has expired` : `${what[0]!.toUpperCase()}${what.slice(1)} expires in ${Math.max(0, daysLeft)} day${daysLeft === 1 ? '' : 's'}`;
      const message = `${subject}${g.kind === 'driver' ? ' ' : ' · '}${what} ${bucket === 0 ? 'expired on' : 'expires on'} ${when}. Upload the renewal to keep taking duties.`;
      if (recipient) {
        const id = await notify({ recipientType: recipient.type, recipientId: recipient.id, category: 'general', severity: bucket <= 3 ? 'critical' : 'warning', sound: 'general', push: true, title, message, dedupeKey: key }).catch(() => null);
        if (id) reminded++;
      }
      // Staff: which assigned future duties would be affected.
      const field2 = g.kind === 'driver' ? 'assignedDriverId' : 'assignedVehicleId';
      const future = await db.collection('bookings').where(field2, '==', g.id).where('status', 'in', ['Assigned', 'Confirmed']).get();
      const hit = future.docs.filter((b) => { const p = pickupInstant(b.data()); return p && p.getTime() > at; });
      if (hit.length) {
        await notify({
          recipientType: 'admin', recipientId: 'admin', category: 'bookings', severity: 'critical', sound: 'general', push: true,
          title: 'Document expiry puts assigned trips at risk', message: `${subject} ${what} ${bucket === 0 ? 'has expired' : `expires ${when}`}. Affected: ${hit.map((b) => text(b.data().bookingId) || b.id).slice(0, 5).join(', ')}${hit.length > 5 ? '…' : ''}.`,
          dedupeKey: `docexp_admin_${key}`,
        }).catch(() => null);
      }
    }
  }
  return { checked, reminded };
}

// ── Runner ──────────────────────────────────────────────────────────────────

export async function runPeriodicJobs(): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { report[name] = await fn(); } catch (err) { report[name] = { error: String((err as Error).message ?? err).slice(0, 200) }; console.error(`[jobs] ${name} failed`, err); }
  };
  await step('reconcile', () => reconcileBacklog());
  await step('unassigned', async () => { const r = await runUnassignedAlerts(); await clearResolvedFlags(); return r; });
  await step('escalation', () => runOfferEscalation());
  await step('cutoff', () => expireMarketplaceOffers());
  await step('waves', () => runReleaseWaves());
  await step('settlementOverdue', () => runSettlementOverdue());
  await step('documentExpiry', () => runDocumentExpiryReminders());
  await step('scheduledNotices', () => runScheduledNotices());
  await step('publicContent', () => reconcilePublicContent());
  return report;
}

export const periodicJobs = onSchedule({ schedule: 'every 5 minutes', timeZone: 'Asia/Kolkata', timeoutSeconds: 300, memory: '512MiB' }, async () => {
  console.log('periodic jobs', JSON.stringify(await runPeriodicJobs()));
});
