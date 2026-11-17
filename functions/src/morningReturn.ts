// Morning Return reminders and the 9:00 AM upgrade (Customer UX v8 — Morning Return is offered from 3:00 PM to 12:59 AM pickups; the 4 AM / 6 AM / 9 AM schedule is unchanged).
//
//   4 AM  customer + driver notification · 5 hours left · the 9 AM cutoff and the upgrade fare
//   6 AM  customer + driver notification · 3 hours left · a reminder call for the customer (queued for the office dialer)
//   9 AM  a trip still active → the booking is marked upgraded to the Next-Day Return of its original pickup time and
//         everyone is told the revised fare. The fare itself is worked out by finalizeFare from the real end time, so a
//         trip that finishes at 9:00 or earlier is never upgraded.
//
// Times come from each booking's own stored cutoff (timePackage.morningCutoffAt), not from a clock in this file, so a
// changed cutoff setting never rewrites a booking that was already sold. Every step is recorded on the booking, so a
// re-run of the job never sends the same reminder twice.
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { finalizeFare, PricingSnapshot } from './domain/tariff';
import { formatDateTime12 } from './domain/time';
import { inr, notify } from './notify';

const HOUR = 3_600_000;
/** Trips in these states still need their Morning Return watched. */
const LIVE = new Set(['Approved', 'Confirmed', 'Assigned', 'Ongoing']);

export interface MorningResult { checked: number; reminded4: number; reminded6: number; upgraded: number }

/** The fare of the upgraded (Next-Day Return) package on the distance quoted — shown in the 9 AM notification. */
export function revisedFareOf(pricing: unknown, cutoffMs: number): number | null {
  const p = pricing as PricingSnapshot | null;
  if (!p || p.schema !== 2 || p.model !== 'round_trip_time_based' || !p.timeBased?.upgrade || !(p.quotedKm > 0)) return null;
  try { return finalizeFare({ pricing: p, totalKm: p.quotedKm, endMs: cutoffMs + 1 }).fare.total; } catch { return null; }
}

export async function runMorningReturn(now = new Date()): Promise<MorningResult> {
  const t = now.getTime();
  // Bookings whose 9 AM cutoff is within the next ~6 hours or passed in the last day.
  const snap = await db.collection('bookings')
    .where('timePackage.kind', '==', 'morning')
    .where('timePackage.morningCutoffAt', '>=', Timestamp.fromMillis(t - 24 * HOUR))
    .where('timePackage.morningCutoffAt', '<=', Timestamp.fromMillis(t + 6 * HOUR))
    .get();
  const out: MorningResult = { checked: snap.size, reminded4: 0, reminded6: 0, upgraded: 0 };
  for (const d of snap.docs) {
    const b = d.data();
    const tp = b.timePackage ?? {};
    if (!LIVE.has(String(b.status))) continue;
    const cutoff = (tp.morningCutoffAt as Timestamp | undefined)?.toMillis?.();
    if (!cutoff) continue;
    const code = String(b.bookingId || d.id);
    const route = `${b.pickup ?? ''} → ${b.drop ?? ''}`;
    const upgradeLabel = String(tp.upgradeLabel || 'Next-Day Return');
    const revised = revisedFareOf(b.pricing, cutoff);
    const cutoffText = formatDateTime12(new Date(cutoff));
    const steps = (b.morningReminders ?? {}) as Record<string, unknown>;
    const toDriver = async (title: string, message: string, key: string, severity: 'info' | 'warning') => {
      const targets: Array<{ type: 'driver' | 'vendor'; id: string }> = [];
      if (b.assignedDriverId) targets.push({ type: 'driver', id: String(b.assignedDriverId) });
      if (b.assignedVendorId) targets.push({ type: 'vendor', id: String(b.assignedVendorId) });
      for (const x of targets) {
        await notify({ recipientType: x.type, recipientId: x.id, category: 'trips', severity, sound: 'general', push: true, title, message, bookingId: d.id, bookingCode: code, dedupeKey: `${key}_${x.type}_${d.id}`, cta: { label: 'Open trip', page: x.type === 'vendor' ? 'trips' : 'trip', bookingId: d.id } })
          .catch((err) => console.warn('morning return notify failed', err));
      }
    };
    const toCustomer = (title: string, message: string, key: string, severity: 'info' | 'warning') => b.customerId
      ? notify({ recipientType: 'customer', brand: b.brand, recipientId: String(b.customerId), category: 'trips', severity, sound: 'general', push: true, title, message, bookingId: d.id, bookingCode: code, dedupeKey: `${key}_customer_${d.id}`, cta: { label: 'View trip', page: 'trip', bookingId: d.id } })
        .catch((err) => console.warn('morning return notify failed', err))
      : Promise.resolve(null);

    if (t >= cutoff - 5 * HOUR && t < cutoff && !steps.fiveHours) {
      const msg = `${route} · Morning Return must finish by ${cutoffText} (5 hours left). After that it upgrades to the ${upgradeLabel}${revised ? ` (about ${inr(revised)})` : ''}.`;
      await Promise.all([toCustomer('Morning Return: 5 hours left', msg, 'mr4', 'info'), toDriver('Morning Return: 5 hours left', msg, 'mr4', 'info')]);
      await d.ref.update({ 'morningReminders.fiveHours': FieldValue.serverTimestamp() });
      out.reminded4++;
    }
    if (t >= cutoff - 3 * HOUR && t < cutoff && !steps.threeHours) {
      const msg = `${route} · only 3 hours left to finish by ${cutoffText}, otherwise it upgrades to the ${upgradeLabel}${revised ? ` (about ${inr(revised)})` : ''}.`;
      await Promise.all([toCustomer('Morning Return: 3 hours left', msg, 'mr6', 'warning'), toDriver('Morning Return: 3 hours left', msg, 'mr6', 'warning')]);
      // The reminder call for the customer is queued for the office dialer / staff; nothing here places a call itself.
      await db.doc(`reminder_calls/${d.id}_morning_3h`).set({ bookingId: d.id, bookingCode: code, kind: 'morning_return_3h', dueAt: FieldValue.serverTimestamp(), status: 'Queued', customerId: b.customerId ?? '', message: msg }, { merge: true });
      await notify({ recipientType: 'admin', recipientId: 'admin', category: 'trips', severity: 'warning', sound: 'general', push: false, title: 'Call customer: Morning Return reminder', message: `${code} · ${route} · 3 hours to the ${cutoffText} cutoff`, bookingId: d.id, bookingCode: code, dedupeKey: `mr6_admin_${d.id}`, cta: { label: 'Open booking', page: 'booking-detail', bookingId: d.id } }).catch(() => null);
      await d.ref.update({ 'morningReminders.threeHours': FieldValue.serverTimestamp() });
      out.reminded6++;
    }
    // Past the cutoff and the trip is still running → upgrade (once).
    if (t >= cutoff && b.status === 'Ongoing' && tp.upgraded !== true) {
      const msg = `${route} · the Morning Return passed ${cutoffText}, so it is now the ${upgradeLabel} of your original pickup time${revised ? `. Revised estimate ${inr(revised)} (package increase only; extra km is recalculated on the new inclusion)` : ''}.`;
      await Promise.all([toCustomer('Package upgraded', msg, 'mrup', 'warning'), toDriver('Package upgraded', msg, 'mrup', 'warning')]);
      await notify({ recipientType: 'admin', recipientId: 'admin', category: 'trips', severity: 'warning', sound: 'general', push: false, title: 'Morning Return upgraded', message: `${code} · ${msg}`, bookingId: d.id, bookingCode: code, dedupeKey: `mrup_admin_${d.id}`, cta: { label: 'Open booking', page: 'booking-detail', bookingId: d.id } }).catch(() => null);
      await d.ref.update({
        'timePackage.upgraded': true, 'timePackage.upgradedAt': FieldValue.serverTimestamp(), 'timePackage.finalLabel': upgradeLabel,
        ...(revised ? { 'timePackage.revisedFare': revised } : {}),
      });
      out.upgraded++;
    }
  }
  return out;
}

export const morningReturnJobs = onSchedule({ schedule: 'every 5 minutes', timeZone: 'Asia/Kolkata', timeoutSeconds: 120 }, async () => {
  console.log('morning return', await runMorningReturn());
});
