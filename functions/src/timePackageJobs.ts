// Time-based round trip, while the trip is running: a same-day package (e.g. 5-hour) only covers its hours. When the trip is still going an hour
// before the package ends, the customer is told in the app what happens next; when it runs past the package, the booking moves to the next
// package that fits (5-hour → 8-hour → Full Day) and the customer is told again. The next package is decided by resolveTimeBasedFinal, the same
// function the final fare uses, so what the customer was told and what the trip is finally billed always agree. The amounts are not changed here:
// the final fare is worked out when the driver ends the trip.
import { DocumentData, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { formatDateTime12 } from './domain/time';
import { resolveTimeBasedFinal, type TimeBasedSnapshot } from './domain/timeBased';
import { inr, notify } from './notify';
import { text } from './shared';

export const WARN_BEFORE_MS = 3_600_000;

export interface TimePackageStep {
  /** The package the trip is on right now, by how long it has run. */
  now: { slab: string; label: string; upgraded: boolean };
  /** Set when the trip is within an hour of leaving its package: the package it will move to, and when. */
  warn?: { slab: string; label: string; endsAtMs: number; fromFarePaise: number; toFarePaise: number; toKm: number };
  /** The booked package. */
  booked: { label: string; farePaise: number };
  toFarePaise: number;
  toKm: number;
}

/** What the customer should hear about a same-day package trip at this moment. Null for any other trip. */
export function timePackageStep(b: DocumentData, nowMs: number): TimePackageStep | null {
  const tb = b.pricing?.timeBased as TimeBasedSnapshot | undefined;
  const startMs = (b.tripStartedAt as Timestamp | undefined)?.toMillis?.();
  if (!tb || tb.kind !== 'same_day' || !tb.slabs || !tb.selected || !startMs || !(nowMs >= startMs)) return null;
  const at = (ms: number) => resolveTimeBasedFinal(tb, { startMs, endMs: ms, totalKm: 0 });
  const here = at(nowMs);
  const soon = at(nowMs + WARN_BEFORE_MS);
  const booked = { label: tb.label, farePaise: tb.base.farePaise };
  const out: TimePackageStep = { now: { slab: String(here.slab), label: here.label, upgraded: here.upgraded }, booked, toFarePaise: here.farePaise, toKm: here.includedKm };
  // Within the last hour of the package the trip is on now: when does it end, and what comes next?
  if (String(soon.slab) !== String(here.slab) && !soon.coverageExceeded) {
    // The package ends the moment the trip has run its hours: the first instant, within the next hour, the package changes.
    let lo = nowMs, hi = nowMs + WARN_BEFORE_MS;
    while (hi - lo > 1000) {
      const mid = Math.floor((lo + hi) / 2);
      if (String(at(mid).slab) === String(here.slab)) lo = mid; else hi = mid;
    }
    const endsAtMs = Math.round(hi / 60_000) * 60_000;
    out.warn = { slab: String(soon.slab), label: soon.label, endsAtMs, fromFarePaise: here.farePaise, toFarePaise: soon.farePaise, toKm: soon.includedKm };
  }
  return out;
}

/** Runs from the periodic jobs: tells customers about a package that is about to end or has just been outgrown. Idempotent. */
export async function runTimePackageUpgrades(nowMs = Date.now()): Promise<{ checked: number; warned: number; upgraded: number }> {
  const snap = await db.collection('bookings').where('status', '==', 'Ongoing').get();
  let checked = 0, warned = 0, upgraded = 0;
  for (const d of snap.docs) {
    const b = d.data();
    const step = timePackageStep(b, nowMs);
    if (!step) continue;
    checked++;
    const code = text(b.bookingId) || d.id;
    const to = (b.customerId ? { recipientType: 'customer' as const, brand: b.brand, recipientId: String(b.customerId) } : null);

    if (step.now.upgraded) {
      const tp = (b.timePackage ?? {}) as { autoSlab?: string };
      if (tp.autoSlab !== step.now.slab) {
        await d.ref.update({ 'timePackage.upgraded': true, 'timePackage.autoSlab': step.now.slab, 'timePackage.finalLabel': step.now.label, 'timePackage.upgradedAt': FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        upgraded++;
        if (to) {
          await notify({
            ...to, category: 'trips', severity: 'warning', sound: 'general', push: true, bookingId: d.id, bookingCode: code,
            title: `Your trip moved to the ${step.now.label}`,
            message: `Booking ${code} ran past its ${step.booked.label}, so it is now on the ${step.now.label} (package fare ${inr(step.toFarePaise / 100)}, ${step.toKm} km included). Your final fare is worked out when the trip ends.`,
            dedupeKey: `tpkg_up_${d.id}_${step.now.slab}`,
          }).catch((err) => console.warn('package change notice failed', err));
        }
        await notify({
          recipientType: 'admin', recipientId: 'admin', category: 'trips', severity: 'info', sound: 'general', bookingId: d.id, bookingCode: code,
          title: 'Trip moved to a longer package', message: `${code} ran past its ${step.booked.label} and is now on the ${step.now.label}.`,
          cta: { label: 'Open trip', page: 'booking-detail', bookingId: d.id }, dedupeKey: `tpkg_up_admin_${d.id}_${step.now.slab}`,
        }).catch(() => null);
      }
    }
    if (step.warn && to) {
      await notify({
        ...to, category: 'trips', severity: 'warning', sound: 'general', push: true, bookingId: d.id, bookingCode: code,
        title: `Your ${step.now.label} ends in about 1 hour`,
        message: `Booking ${code}: your ${step.now.label} ends at ${formatDateTime12(new Date(step.warn.endsAtMs))}. If the trip is still running then, it moves to the ${step.warn.label} automatically: package fare ${inr(step.warn.fromFarePaise / 100)} → ${inr(step.warn.toFarePaise / 100)}, ${step.warn.toKm} km included. End the trip before then to stay on your package.`,
        dedupeKey: `tpkg_warn_${d.id}_${step.now.slab}`,
      }).then((id) => { if (id) warned++; }).catch((err) => console.warn('package warning failed', err));
    }
  }
  return { checked, warned, upgraded };
}
