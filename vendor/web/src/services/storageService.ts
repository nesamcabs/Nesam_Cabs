import {
  ref,
  uploadBytesResumable,
  deleteObject,
  getDownloadURL,
  type UploadTask,
} from 'firebase/storage';
import { auth, storage } from './firebase';
import { MAX_UPLOAD_BYTES, type UploadCategory } from '../config/onboarding';
import type { StoredFile } from '../types';
import { errorCode, withRetry } from '../utils/retry';

const ALLOWED_TYPES = /^(image\/(jpeg|png|webp)|application\/pdf)$/;

/** Client-side mirror of storage.rules validUpload(). Returns '' when OK. */
export function validateUploadFile(file: File): string {
  if (!ALLOWED_TYPES.test(file.type)) return `"${file.name}" must be a JPG, PNG, WEBP or PDF file.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > MAX_UPLOAD_BYTES) return `"${file.name}" is larger than 10 MB.`;
  return '';
}

/** vendors/{uid}/onboarding/{category}/{timestamp}_{random}_{safe-name} */
function buildPath(uid: string, category: UploadCategory, fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'file';
  const rand = Math.random().toString(36).slice(2, 8);
  return `vendors/${uid}/onboarding/${category}/${Date.now()}_${rand}_${base}${ext ? `.${ext}` : ''}`;
}

export interface UploadHandle {
  promise: Promise<StoredFile>;
  cancel: () => void;
}

/**
 * Resumable upload with progress. The SDK itself retries transient chunk
 * failures (up to maxUploadRetryTime); callers can re-invoke to retry a
 * failed upload.
 */
export function uploadVendorFile(
  category: UploadCategory,
  file: File,
  onProgress: (pct: number) => void,
): UploadHandle {
  const uid = auth.currentUser?.uid;
  let task: UploadTask | null = null;
  let cancelled = false;

  const promise = new Promise<StoredFile>((resolve, reject) => {
    if (!uid) {
      reject(Object.assign(new Error('Your session has expired. Please sign in again.'), { code: 'unauthenticated' }));
      return;
    }
    const invalid = validateUploadFile(file);
    if (invalid) {
      reject(new Error(invalid));
      return;
    }
    const path = buildPath(uid, category, file.name);
    task = uploadBytesResumable(ref(storage, path), file, {
      contentType: file.type,
      customMetadata: { originalName: file.name.slice(0, 200), category },
    });
    if (cancelled) task.cancel();
    task.on(
      'state_changed',
      (snap) => {
        if (snap.totalBytes > 0) onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
      },
      (error) => reject(error),
      () =>
        resolve({
          path,
          name: file.name,
          contentType: file.type,
          size: file.size,
          uploadedAt: Date.now(),
        }),
    );
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      task?.cancel();
    },
  };
}

/** Best-effort delete — a missing object is treated as success. */
export async function deleteVendorFile(path: string): Promise<void> {
  try {
    await withRetry(() => deleteObject(ref(storage, path)));
  } catch (error) {
    if (errorCode(error) === 'storage/object-not-found') return;
    throw error;
  }
}

export function resolveFileUrl(path: string): Promise<string> {
  return withRetry(() => getDownloadURL(ref(storage, path)));
}
