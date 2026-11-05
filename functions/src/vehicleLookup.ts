// Vehicle auto-detection for driver and vendor onboarding.
//
// The partner types a registration number; this callable asks the configured
// VAHAN data provider for the vehicle (make, model, fuel, seats, document
// validity) so the onboarding form is filled from the register, not by hand.
//
//   • The provider key never leaves the server.
//   • Results are cached per plate for 12 hours (provider calls cost money and a
//     plate's register entry does not change within a session).
//   • A caller gets 10 lookups per hour, so the endpoint cannot be used as a
//     lookup service for arbitrary plates.
//   • Unconfigured → `not_configured`; the apps then fall back to manual entry
//     and the admin verifies the documents by eye. It never invents a vehicle.
//   • The owner's name is stored masked and the address / phone / financier are
//     not stored at all.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import {
  ProviderConfig, VehicleRecord, indiaToday, isValidRegistration, mapProviderRecord, normalizeRegistration, providerConfigFromEnv,
  registrationVariants, vehicleIssues,
} from './domain/vehicleRegistry';

const CACHE_MS = 12 * 60 * 60 * 1000;
const WINDOW_MS = 60 * 60 * 1000;
const HOURLY_LIMIT = 10;

export type LookupStatus = 'found' | 'not_found' | 'not_configured' | 'unavailable';

interface ProviderResult {
  status: LookupStatus;
  record?: VehicleRecord;
}

/** Calls the provider once. `fetchImpl` is injectable so the mapping can be tested offline. */
export async function queryProvider(cfg: ProviderConfig, registration: string, fetchImpl: typeof fetch = fetch): Promise<ProviderResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  headers[cfg.authHeader] = cfg.authHeader.toLowerCase() === 'authorization' ? `Bearer ${cfg.apiKey}` : cfg.apiKey;
  let res: Response;
  try {
    res = await fetchImpl(cfg.url, { method: 'POST', headers, body: JSON.stringify({ [cfg.idField]: registration }), signal: AbortSignal.timeout(20000) });
  } catch (err) {
    console.warn('Vehicle lookup provider unreachable', (err as Error)?.name);
    return { status: 'unavailable' };
  }
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON response */ }
  if (res.ok) {
    const record = mapProviderRecord(body, registration);
    if (record) return { status: 'found', record };
    // 200 with no vehicle in it: providers answer this way for an unknown plate.
    return { status: 'not_found' };
  }
  // Raw provider bodies are never returned or logged in full: they can carry personal data.
  const message = String(body?.message ?? body?.error ?? '').slice(0, 120);
  if (res.status === 404 || res.status === 422 || (res.status === 400 && /no record|not found|invalid/i.test(message))) return { status: 'not_found' };
  console.warn('Vehicle lookup provider error', res.status, message);
  return { status: 'unavailable' };
}

async function takeQuota(uid: string): Promise<void> {
  const ref = db.doc(`vehicle_lookup_quota/${uid}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const d = snap.data();
    const fresh = !d || now - Number(d.windowStartMs ?? 0) >= WINDOW_MS;
    const count = fresh ? 0 : Number(d!.count ?? 0);
    if (count >= HOURLY_LIMIT) throw new HttpsError('resource-exhausted', 'Too many vehicle checks. Please try again in an hour.');
    tx.set(ref, { windowStartMs: fresh ? now : d!.windowStartMs, count: count + 1, updatedAt: FieldValue.serverTimestamp() });
  });
}

/** Is this plate already held by another partner's active record? Never says whose. */
async function heldByAnother(uid: string, registration: string): Promise<boolean> {
  const variants = registrationVariants(registration);
  const [drivers, vehicles, applications] = await Promise.all([
    db.collection('drivers').where('vehicleNumber', 'in', variants).limit(5).get(),
    db.collection('vehicles').where('vehicleNumber', 'in', variants).limit(5).get(),
    // Plates listed in a vendor's onboarding application (fleet.plates, normalised).
    db.collection('vendors').where('fleet.plates', 'array-contains', normalizeRegistration(registration)).limit(5).get(),
  ]);
  const alive = (d: FirebaseFirestore.QueryDocumentSnapshot) => !['Rejected', 'REJECTED', 'Suspended', 'SUSPENDED', 'Inactive'].includes(String(d.data().status ?? d.data().docStatus ?? ''));
  const driverClash = drivers.docs.some((d) => d.id !== uid && alive(d));
  // A vehicle record the partner owns, or that is paired with them, is theirs — not a clash.
  const vehicleClash = vehicles.docs.some((d) => d.data().vendorId !== uid && d.data().assignedDriverId !== uid && alive(d));
  const applicationClash = applications.docs.some((d) => d.id !== uid && alive(d));
  return driverClash || vehicleClash || applicationClash;
}

async function callerMayLookUp(uid: string, token: Record<string, unknown> | undefined): Promise<void> {
  if (!token?.phone_number) throw new HttpsError('failed-precondition', 'Verify your mobile number first.');
  if (token.role === 'customer') throw new HttpsError('permission-denied', 'Vehicle checks are for partners only.');
  const customer = await db.doc(`customers/${uid}`).get();
  if (customer.exists) throw new HttpsError('permission-denied', 'Vehicle checks are for partners only.');
}

export const lookupVehicleByRegistration = onCall({ timeoutSeconds: 40 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  await callerMayLookUp(uid, request.auth?.token as Record<string, unknown> | undefined);

  const registration = normalizeRegistration(request.data?.registrationNumber);
  if (!isValidRegistration(registration)) throw new HttpsError('invalid-argument', 'Enter the registration number as printed on the plate, for example TN 01 AB 1234.');

  const cacheRef = db.doc(`vehicle_lookups/${registration}`);
  const cached = await cacheRef.get();
  const c = cached.data();
  let record: VehicleRecord | null = null;
  let fetchedAtMs = 0;
  let provider = '';
  if (cached.exists && c?.status === 'found' && c.record && Date.now() - Number((c.fetchedAt as Timestamp)?.toMillis?.() ?? 0) < CACHE_MS) {
    record = c.record as VehicleRecord;
    fetchedAtMs = (c.fetchedAt as Timestamp).toMillis();
    provider = String(c.provider ?? '');
  } else {
    const cfg = providerConfigFromEnv(process.env);
    if (!cfg) return { status: 'not_configured' as LookupStatus, registrationNumber: registration };
    await takeQuota(uid);
    const result = await queryProvider(cfg, registration);
    if (result.status !== 'found' || !result.record) return { status: result.status, registrationNumber: registration };
    record = result.record;
    provider = cfg.provider;
    fetchedAtMs = Date.now();
    await cacheRef.set({
      registrationNumber: registration, status: 'found', record, provider, fetchedAt: Timestamp.fromMillis(fetchedAtMs),
      lastRequestedBy: uid, updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const issues = vehicleIssues(record, indiaToday());
  const duplicate = await heldByAnother(uid, registration);
  return {
    status: 'found' as LookupStatus,
    registrationNumber: registration,
    vehicle: record,
    issues,
    duplicate,
    fetchedAtMs,
    source: provider,
  };
});
