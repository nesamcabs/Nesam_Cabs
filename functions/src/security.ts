// Security events and device integrity.
//
// Anything the app itself reports (developer options on, root detected…) comes
// from a device the user controls, so it is logged as a signal but never
// trusted as proof. The check that matters is the Google Play Integrity
// verdict, decoded and judged here on the server: the token is bound to a
// one-time nonce issued to that user, so it cannot be replayed from another
// device or session.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';
import { GoogleAuth } from 'google-auth-library';
import { db } from './admin';
import { notify } from './notify';
import { IntegrityVerdictInput, evaluateIntegrity } from './domain/verification';
import { text } from './shared';

export type SecuritySeverity = 'low' | 'medium' | 'high';

export interface SecurityEventInput {
  type: string;
  severity: SecuritySeverity;
  userId: string;
  role: string;
  bookingId?: string;
  platform?: string;
  source: 'client' | 'server';
  details?: Record<string, unknown>;
  ip?: string;
}

/** Details are small, flat and capped: a security log must not become a data dump. */
function cleanDetails(d: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d ?? {}).slice(0, 20)) {
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 10).map((x) => String(x).slice(0, 80));
  }
  return out;
}

export async function logSecurityEvent(e: SecurityEventInput): Promise<void> {
  await db.collection('security_events').add({
    type: e.type, severity: e.severity, userId: e.userId, role: e.role, bookingId: e.bookingId ?? '', platform: e.platform ?? '',
    source: e.source, details: cleanDetails(e.details), ip: e.ip ?? '', resolved: false, at: FieldValue.serverTimestamp(),
  });
  if (e.severity === 'high') {
    await notify({
      recipientType: 'admin', recipientId: 'admin', category: 'general', severity: 'critical', sound: 'general', title: 'Security alert',
      message: `${e.type.replace(/_/g, ' ')} (${e.role} ${e.userId.slice(0, 6)}…)${e.bookingId ? ` on a trip` : ''}`,
      bookingId: e.bookingId, cta: { label: 'View security events', page: 'security' },
      dedupeKey: `security_${e.type}_${e.userId}_${new Date().toISOString().slice(0, 13)}`, push: true,
    }).catch(() => null);
  }
}

export const requestIp = (request: { rawRequest?: { headers?: Record<string, unknown>; ip?: string } }): string =>
  String(request.rawRequest?.headers?.['x-forwarded-for'] ?? request.rawRequest?.ip ?? '').split(',')[0].trim().slice(0, 64);

// ── Settings ──────────────────────────────────────────────────────────────

export interface SecuritySettings {
  /** Refuse trip actions from an Android device without a fresh passing integrity verdict. */
  enforceIntegrity: boolean;
  /** Web browsers cannot attest; allow them to run trips while integrity is enforced for Android. */
  allowWebDriverTrips: boolean;
  /** How long a passing verdict stays valid. */
  integrityTtlHours: number;
}

export async function securitySettings(): Promise<SecuritySettings> {
  const d = (await db.doc('settings/security').get()).data() ?? {};
  return {
    enforceIntegrity: d.enforceIntegrity === true,
    allowWebDriverTrips: d.allowWebDriverTrips !== false,
    integrityTtlHours: typeof d.integrityTtlHours === 'number' && d.integrityTtlHours > 0 && d.integrityTtlHours <= 72 ? d.integrityTtlHours : 24,
  };
}

/**
 * Throws unless the device may run a sensitive trip action. With enforcement
 * off (the default until Play Integrity is configured) nothing is blocked.
 */
export async function assertDeviceTrusted(uid: string, platform: string): Promise<void> {
  const s = await securitySettings();
  if (!s.enforceIntegrity) return;
  if (platform === 'web') {
    if (s.allowWebDriverTrips) return;
    throw new HttpsError('failed-precondition', 'Trips must be run from the NESAM driver app on a verified Android device.', { integrity: 'web_not_allowed' });
  }
  const snap = await db.doc(`device_integrity/${uid}`).get();
  const d = snap.data();
  const passed = d?.status === 'passed' && d.expiresAt instanceof Timestamp && d.expiresAt.toMillis() > Date.now();
  if (!passed) {
    throw new HttpsError('failed-precondition', 'This device could not be verified as secure. Update the app from Google Play on an unmodified device, then try again.', { integrity: 'required' });
  }
}

// ── Callables ─────────────────────────────────────────────────────────────

const CLIENT_EVENT_TYPES: Record<string, SecuritySeverity> = {
  developer_options_enabled: 'medium',
  usb_debugging_enabled: 'medium',
  root_detected: 'high',
  emulator_detected: 'high',
  app_tampered: 'high',
  debuggable_build: 'high',
  mock_location_detected: 'medium',
  gallery_capture_attempt: 'low',
  screen_capture_detected: 'low',
};

export const reportSecurityEvent = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const type = text(request.data?.type, 40);
  const severity = CLIENT_EVENT_TYPES[type];
  if (!severity) throw new HttpsError('invalid-argument', 'Unknown security event.');
  const role = ['driver', 'vendor', 'customer'].includes(request.data?.role) ? request.data.role : 'driver';
  // Cap per user per hour so a modified client cannot flood the log.
  const recent = await db.collection('security_events').where('userId', '==', uid).where('at', '>', Timestamp.fromMillis(Date.now() - 3600000)).limit(21).get();
  if (recent.size > 20) return { ok: true, throttled: true };
  await logSecurityEvent({
    type, severity, userId: uid, role, bookingId: text(request.data?.bookingId, 128), platform: text(request.data?.platform, 12), source: 'client',
    details: { appVersion: text(request.data?.appVersion, 20), detail: text(request.data?.detail, 120) }, ip: requestIp(request),
  });
  return { ok: true };
});

export const getIntegrityNonce = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const nonce = randomBytes(24).toString('base64url');
  await db.doc(`integrity_nonces/${nonce}`).create({ uid, used: false, createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 5 * 60000) });
  return { nonce };
});

async function decodeToken(packageName: string, token: string): Promise<IntegrityVerdictInput> {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/playintegrity'] });
  const client = await auth.getClient();
  const res = await client.request<any>({
    url: `https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`,
    method: 'POST', data: { integrity_token: token },
  });
  const p = res.data?.tokenPayloadExternal ?? {};
  return {
    appRecognitionVerdict: p.appIntegrity?.appRecognitionVerdict,
    deviceRecognitionVerdict: p.deviceIntegrity?.deviceRecognitionVerdict,
    appLicensingVerdict: p.accountDetails?.appLicensingVerdict,
    packageName: p.requestDetails?.requestPackageName,
    // Classic requests carry a nonce, standard requests (the apps use these) a requestHash; both hold our one-time value.
    nonce: p.requestDetails?.nonce ?? p.requestDetails?.requestHash,
  };
}

export const verifyDeviceIntegrity = onCall({ timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const packageName = (process.env.PLAY_INTEGRITY_PACKAGE_NAME ?? '').trim();
  if (!packageName) return { status: 'not_configured' as const, message: 'Device verification is not configured on the server yet.' };
  const token = typeof request.data?.token === 'string' ? request.data.token : '';
  const nonce = text(request.data?.nonce, 100);
  if (!token || !nonce) throw new HttpsError('invalid-argument', 'Missing verification data.');
  const nonceRef = db.doc(`integrity_nonces/${nonce}`);
  const n = await nonceRef.get();
  // One use, this user only, five minutes.
  if (!n.exists || n.data()!.uid !== uid || n.data()!.used === true || n.data()!.expiresAt.toMillis() < Date.now()) {
    await logSecurityEvent({ type: 'integrity_nonce_invalid', severity: 'medium', userId: uid, role: 'driver', platform: 'android', source: 'server', ip: requestIp(request) });
    throw new HttpsError('failed-precondition', 'The verification expired. Try again.');
  }
  await nonceRef.update({ used: true });
  let verdict: IntegrityVerdictInput;
  try {
    verdict = await decodeToken(packageName, token);
  } catch (err) {
    console.warn('Play Integrity decode failed', err);
    throw new HttpsError('unavailable', 'Device verification is temporarily unavailable. Try again shortly.');
  }
  const result = evaluateIntegrity(verdict, { packageName, nonce });
  const ttl = (await securitySettings()).integrityTtlHours;
  await db.doc(`device_integrity/${uid}`).set({
    status: result.ok ? 'passed' : 'failed', reasons: result.reasons, platform: 'android', packageName, checkedAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + (result.ok ? ttl : 0) * 3600000), appVersion: text(request.data?.appVersion, 20),
  });
  if (!result.ok) {
    await logSecurityEvent({ type: 'integrity_failed', severity: 'high', userId: uid, role: 'driver', platform: 'android', source: 'server', details: { reasons: result.reasons }, ip: requestIp(request) });
  }
  return { status: result.ok ? ('passed' as const) : ('failed' as const), message: result.ok ? 'Device verified.' : 'This device or app could not be verified as secure.' };
});
