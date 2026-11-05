// Unassigned-pickup alerts. Every ten minutes, approved or confirmed bookings
// whose pickup is near and still have no driver are flagged on the booking
// (`unassignedAlert`) and announced to staff — once per severity level, so a
// booking produces at most a "warning" and later a "critical" notification, not
// one per run. Thresholds come from settings/operations.
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { normalizeThresholds, unassignedSeverity } from './domain/bookingFlow';
import { formatDateTime12, pickupInstant } from './domain/time';
import { notify } from './notify';

export async function runUnassignedAlerts(now = new Date()): Promise<{ checked: number; warnings: number; criticals: number }> {
  const settings = (await db.doc('settings/operations').get()).data() ?? {};
  const t = normalizeThresholds({ warningHours: settings.unassignedAlertHours, criticalHours: settings.unassignedCriticalHours });
  const horizon = Timestamp.fromMillis(now.getTime() + t.warningHours * 3600000);
  // Pickups that already passed stay in the list until someone is assigned or the booking is closed.
  const snap = await db.collection('bookings').where('status', 'in', ['Approved', 'Confirmed']).where('pickupAt', '<=', horizon).get();
  let warnings = 0, criticals = 0;
  for (const d of snap.docs) {
    const b = d.data();
    const at = pickupInstant(b);
    const severity = unassignedSeverity(b, at ? at.getTime() : null, now.getTime(), t);
    if (severity !== 'warning' && severity !== 'critical') continue;
    const code = String(b.bookingId || d.id);
    const mins = Math.max(0, Math.round(((at as Date).getTime() - now.getTime()) / 60000));
    const left = at && at.getTime() < now.getTime() ? 'pickup time has passed' : mins >= 120 ? `${Math.round(mins / 60)} hours to pickup` : `${mins} minutes to pickup`;
    const prev = b.unassignedAlert?.severity;
    if (prev !== severity) {
      await d.ref.update({ unassignedAlert: { severity, since: b.unassignedAlert?.since ?? FieldValue.serverTimestamp(), raisedAt: FieldValue.serverTimestamp() } });
    }
    const id = await notify({
      recipientType: 'admin', recipientId: 'admin', category: 'bookings', severity: severity === 'critical' ? 'critical' : 'warning', sound: 'general', push: true,
      title: severity === 'critical' ? 'URGENT: no driver assigned' : 'No driver assigned yet',
      message: `${code} · ${b.pickup ?? ''} → ${b.drop ?? ''} · pickup ${formatDateTime12(at as Date)} (${left})`,
      bookingId: d.id, bookingCode: code, cta: { label: 'Assign driver', page: 'booking-detail', bookingId: d.id },
      dedupeKey: `unassigned_${d.id}_${severity}`,
    }).catch((err) => { console.warn('unassigned alert failed', err); return null; });
    if (id) severity === 'critical' ? criticals++ : warnings++;
  }
  return { checked: snap.size, warnings, criticals };
}

/** Clears the flag once a booking has a driver (or is no longer open). Runs on the same schedule. */
export async function clearResolvedFlags(): Promise<void> {
  const flagged = await db.collection('bookings').where('unassignedAlert.severity', 'in', ['warning', 'critical']).get();
  await Promise.all(flagged.docs.filter((d) => {
    const b = d.data();
    return b.assignedDriverId || !['Approved', 'Confirmed'].includes(b.status);
  }).map((d) => d.ref.update({ unassignedAlert: FieldValue.delete() })));
}

export const unassignedBookingAlerts = onSchedule({ schedule: 'every 10 minutes', timeZone: 'Asia/Kolkata', timeoutSeconds: 120 }, async () => {
  const r = await runUnassignedAlerts();
  await clearResolvedFlags();
  console.log('unassigned alerts', r);
});
