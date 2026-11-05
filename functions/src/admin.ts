import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Credentials for the Admin SDK.
 *  - Firebase Cloud Functions: none needed (application default credentials).
 *  - Vercel / any other host: set NESAM_SERVICE_ACCOUNT to the service-account JSON
 *    (raw JSON, or base64 of it). It is read only on the server and never sent to a client.
 */
function serviceAccountFromEnv(): (ServiceAccount & { project_id?: string }) | null {
  const raw = (process.env.NESAM_SERVICE_ACCOUNT ?? process.env.FIREBASE_SERVICE_ACCOUNT ?? '').trim();
  if (!raw) return null;
  const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const account = JSON.parse(json) as Record<string, unknown>;
  // Env var editors often store the private key with literal "\n" sequences.
  if (typeof account.private_key === 'string') account.private_key = account.private_key.replace(/\\n/g, '\n');
  return account as ServiceAccount & { project_id?: string };
}

if (!getApps().length) {
  const account = serviceAccountFromEnv();
  if (account) {
    const projectId = account.project_id ?? account.projectId;
    initializeApp({
      credential: cert(account),
      projectId,
      storageBucket: (process.env.NESAM_STORAGE_BUCKET ?? process.env.FIREBASE_STORAGE_BUCKET ?? '').trim() || `${projectId}.firebasestorage.app`,
    });
  } else {
    initializeApp();
  }
}

export const db = getFirestore();
