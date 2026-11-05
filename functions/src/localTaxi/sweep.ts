// Local Taxi periodic safety net: advances searching rides (expired offers, widened radius, search timeout),
// promotes scheduled fares, and takes drivers with stale locations out of the dispatch pool.
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../admin';
import { promoteDueFares } from './adminFns';
import { COL } from './model';
import { sweepDispatch } from './dispatch';

const STALE_DRIVER_MS = 10 * 60000;

export async function runLocalTaxiSweep(nowMs = Date.now()) {
  const dispatch = await sweepDispatch(nowMs);
  const promoted = await promoteDueFares(nowMs);
  const online = await db.collection(COL.driverState).where('online', '==', true).where('available', '==', true).limit(300).get();
  let parked = 0;
  for (const d of online.docs) {
    const at = Number(d.data().location?.atMs ?? 0);
    if (nowMs - at > STALE_DRIVER_MS) { await d.ref.update({ available: false, online: false, updatedAt: FieldValue.serverTimestamp(), autoOfflineAtMs: nowMs }); parked++; }
  }
  return { ...dispatch, promoted, parked };
}

export const ltDispatchSweep = onSchedule({ schedule: 'every 1 minutes', timeZone: 'Asia/Kolkata', timeoutSeconds: 120 }, async () => {
  const r = await runLocalTaxiSweep();
  if (r.advanced || r.promoted || r.parked) console.info('[local taxi] sweep', r);
});
