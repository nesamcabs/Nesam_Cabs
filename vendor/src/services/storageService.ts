// Vendor uploads. Native rewrite of vendor/web/src/services/storageService.ts
// (same storage layout, same type/size rules as storage.rules validUpload()).
// Files come from the system document picker (PDF / images) or the camera /
// gallery; the Web File object becomes a local URI read into a Blob.
//
//   vendors/{uid}/onboarding/{category}/{ts}_{rand}_{name}   onboarding documents
//   vendors/{uid}/vehicles/{vehicleId}/{kind}-{ts}.{ext}       fleet vehicle documents
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable, type UploadTask } from 'firebase/storage';
import { auth, storage } from '../config/firebase';
import { MAX_UPLOAD_BYTES, type UploadCategory } from '../config/onboarding';
import type { StoredFile } from '../types/vendor';
import { errorCode, withRetry } from '../utils/retry';

const ALLOWED_TYPES = /^(image\/(jpeg|png|webp)|application\/pdf)$/;

/** A file chosen on the device, ready to upload. */
export interface LocalFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

export class PickerError extends Error {}

/** Client-side mirror of storage.rules validUpload(). Returns '' when OK. */
export function validateUploadFile(file: Pick<LocalFile, 'name' | 'mimeType' | 'size'>): string {
  if (!ALLOWED_TYPES.test(file.mimeType)) return `"${file.name}" must be a JPG, PNG, WEBP or PDF file.`;
  if (file.size === 0) return `"${file.name}" is empty.`;
  if (file.size > MAX_UPLOAD_BYTES) return `"${file.name}" is larger than 10 MB.`;
  return '';
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : '';
}

/** System document picker (PDF / JPG / PNG / WEBP). Null when cancelled. */
export async function pickDocument(): Promise<LocalFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.length) return null;
  const a = result.assets[0]!;
  return { uri: a.uri, name: a.name || 'document', mimeType: a.mimeType || guessMime(a.name || ''), size: a.size ?? 0 };
}

/** Camera or gallery photo, compressed to a JPEG. Null when cancelled. */
export async function pickPhoto(source: 'camera' | 'library'): Promise<LocalFile | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      throw new PickerError(
        perm.canAskAgain ? 'Camera permission is needed to take a photo.' : 'Camera access is turned off for NESAM Vendor. Enable it in Settings › Apps › NESAM Vendor › Permissions.',
      );
    }
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.9 };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0]!;
  const ctx = ImageManipulator.ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width || 0, asset.height || 0) > 1800) {
    if ((asset.width || 0) >= (asset.height || 0)) ctx.resize({ width: 1800 });
    else ctx.resize({ height: 1800 });
  }
  const saved = await (await ctx.renderAsync()).saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.82 });
  const blob = await uriToBlob(saved.uri);
  const base = (asset.fileName || `photo-${Date.now()}`).replace(/\.[a-z0-9]+$/i, '');
  return { uri: saved.uri, name: `${base}.jpg`, mimeType: 'image/jpeg', size: blob.size };
}

export function uriToBlob(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => resolve(xhr.response as Blob);
    xhr.onerror = () => reject(new Error('Could not read the selected file.'));
    xhr.responseType = 'blob';
    xhr.open('GET', uri, true);
    xhr.send(null);
  });
}

/** vendors/{uid}/onboarding/{category}/{timestamp}_{random}_{safe-name} */
export function buildOnboardingPath(uid: string, category: UploadCategory, fileName: string, now = Date.now(), rand = Math.random().toString(36).slice(2, 8)): string {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const base =
    (dot > 0 ? fileName.slice(0, dot) : fileName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'file';
  return `vendors/${uid}/onboarding/${category}/${now}_${rand}_${base}${ext ? `.${ext}` : ''}`;
}

export interface UploadHandle<T> {
  promise: Promise<T>;
  cancel: () => void;
}

function upload(path: string, file: LocalFile, onProgress: (pct: number) => void, category: string): UploadHandle<void> {
  let task: UploadTask | null = null;
  let cancelled = false;
  const promise = (async () => {
    const invalid = validateUploadFile(file);
    if (invalid) throw new PickerError(invalid);
    const blob = await uriToBlob(file.uri);
    if (cancelled) throw Object.assign(new Error('Upload cancelled.'), { code: 'storage/canceled' });
    task = uploadBytesResumable(ref(storage, path), blob, {
      contentType: file.mimeType,
      customMetadata: { originalName: file.name.slice(0, 200), category },
    });
    await new Promise<void>((resolve, reject) => {
      task!.on(
        'state_changed',
        (snap) => {
          if (snap.totalBytes > 0) onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
        },
        reject,
        () => resolve(),
      );
    });
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      task?.cancel();
    },
  };
}

/** Resumable onboarding upload with progress. Returns the stored-file record. */
export function uploadVendorFile(category: UploadCategory, file: LocalFile, onProgress: (pct: number) => void): UploadHandle<StoredFile> {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    const e = Object.assign(new Error('Your session has expired. Please sign in again.'), { code: 'unauthenticated' });
    return { promise: Promise.reject(e), cancel: () => undefined };
  }
  const path = buildOnboardingPath(uid, category, file.name);
  const h = upload(path, file, onProgress, category);
  return {
    promise: h.promise.then(() => ({ path, name: file.name, contentType: file.mimeType, size: file.size, uploadedAt: Date.now() })),
    cancel: h.cancel,
  };
}

/** Fleet vehicle document (RC / insurance / fitness / permit). Returns its download URL. */
export async function uploadVehicleDocument(vehicleId: string, kind: string, file: LocalFile, onProgress: (pct: number) => void): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw Object.assign(new Error('Your session has expired. Please sign in again.'), { code: 'unauthenticated' });
  const ext = file.mimeType === 'application/pdf' ? 'pdf' : file.mimeType === 'image/png' ? 'png' : file.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const path = `vendors/${uid}/vehicles/${vehicleId.replace(/[^A-Za-z0-9_-]/g, '')}/${kind}-${Date.now()}.${ext}`;
  await upload(path, file, onProgress, `vehicle_${kind}`).promise;
  return withRetry(() => getDownloadURL(ref(storage, path)));
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
