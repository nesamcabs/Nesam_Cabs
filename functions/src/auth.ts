import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { db } from './admin';

type Role = 'customer' | 'vendor' | 'driver';

const COLLECTION_BY_ROLE: Record<Role, string> = {
  customer: 'customers',
  vendor: 'vendors',
  driver: 'drivers',
};

function isRole(value: unknown): value is Role {
  return value === 'customer' || value === 'vendor' || value === 'driver';
}

/**
 * Called once by a client right after a brand-new Firebase Auth user completes
 * phone verification. Creates the Firestore profile doc and sets the initial
 * custom claims. Customers are auto-approved; vendors/drivers start Pending
 * until an admin approves them (see onVendorApproved/onDriverApproved below).
 */
export const registerUser = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'You must be signed in to register.');
  }

  const { role, profile } = (request.data ?? {}) as { role?: unknown; profile?: Record<string, unknown> };
  if (!isRole(role)) {
    throw new HttpsError('invalid-argument', 'role must be one of customer, vendor, driver.');
  }

  const collection = COLLECTION_BY_ROLE[role];
  const docRef = db.collection(collection).doc(uid);
  const existing = await docRef.get();
  if (existing.exists) {
    throw new HttpsError('already-exists', 'A profile already exists for this account.');
  }

  const status = role === 'customer' ? 'Approved' : 'Pending';
  const phone = request.auth?.token?.phone_number ?? null;

  await docRef.set({
    ...(profile ?? {}),
    uid,
    phone,
    role,
    status,
    createdAt: FieldValue.serverTimestamp(),
  });

  await getAuth().setCustomUserClaims(uid, {
    role,
    status,
    ...(role === 'vendor' ? { vendorId: uid } : {}),
    ...(role === 'driver' ? { driverId: uid } : {}),
  });

  logger.info(`registerUser: created ${role} profile for ${uid} with status ${status}`);

  return { role, status };
});

/**
 * Admin-only. Directly assigns/changes a user's role and claims — used to
 * provision admin accounts and for manual overrides.
 */
export const setUserRole = onCall(async (request) => {
  if (request.auth?.token?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only admins can assign roles.');
  }

  const { uid, role, status, vendorId, driverId } = (request.data ?? {}) as {
    uid?: string;
    role?: 'admin' | Role;
    status?: string;
    vendorId?: string;
    driverId?: string;
  };

  if (!uid || !role) {
    throw new HttpsError('invalid-argument', 'uid and role are required.');
  }

  await getAuth().setCustomUserClaims(uid, {
    role,
    status: status ?? 'Approved',
    ...(vendorId ? { vendorId } : {}),
    ...(driverId ? { driverId } : {}),
  });

  logger.info(`setUserRole: ${uid} set to role=${role} status=${status ?? 'Approved'}`);

  return { ok: true };
});

export const onVendorApproved = onDocumentUpdated('vendors/{vendorId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  if (before.status === after.status || after.status !== 'Approved') return;

  const vendorId = event.params.vendorId;
  const user = await getAuth().getUser(vendorId);
  await getAuth().setCustomUserClaims(vendorId, {
    ...user.customClaims,
    role: 'vendor',
    status: 'Approved',
    vendorId,
  });
  logger.info(`onVendorApproved: upgraded claims for vendor ${vendorId}`);
});

export const onDriverApproved = onDocumentUpdated('drivers/{driverId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  if (before.status === after.status || after.status !== 'Approved') return;

  const driverId = event.params.driverId;
  const user = await getAuth().getUser(driverId);
  await getAuth().setCustomUserClaims(driverId, {
    ...user.customClaims,
    role: 'driver',
    status: 'Approved',
    driverId,
  });
  logger.info(`onDriverApproved: upgraded claims for driver ${driverId}`);
});
