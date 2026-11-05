// KYC / pre-trip / toll photo uploads. Native replacement for
// driver/web/src/services/storageService.ts: canvas compression becomes
// expo-image-manipulator and the File becomes a local URI read into a Blob.
// Path: drivers/{uid}/{folder}/{name}-{ts}.jpg (storage.rules: owner write).
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { auth, storage } from '../config/firebase';
import { withRetry, withTimeout } from '../utils/retry';

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export type PickSource = 'camera' | 'library';

export class PickerError extends Error {}

export async function pickImage(source: PickSource): Promise<ImagePicker.ImagePickerAsset | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      throw new PickerError(
        perm.canAskAgain
          ? 'Camera permission is needed to take this photo.'
          : 'Camera access is turned off for NESAM Driver. Enable it in Settings › Apps › NESAM Driver › Permissions.',
      );
    }
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.9 };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0]!;
  if (asset.mimeType && !asset.mimeType.startsWith('image/')) throw new PickerError('Please choose a photo (JPG or PNG).');
  if (asset.fileSize && asset.fileSize > MAX_INPUT_BYTES) throw new PickerError('That photo is too large. Please choose a smaller one.');
  return asset;
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

async function compress(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const longEdge = Math.max(asset.width || 0, asset.height || 0);
  const ctx = ImageManipulator.ImageManipulator.manipulate(asset.uri);
  if (longEdge > MAX_DIMENSION) {
    if ((asset.width || 0) >= (asset.height || 0)) ctx.resize({ width: MAX_DIMENSION });
    else ctx.resize({ height: MAX_DIMENSION });
  }
  const rendered = await ctx.renderAsync();
  const saved = await rendered.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: JPEG_QUALITY });
  return saved.uri;
}

/** Only letters, digits and dashes in storage object names. */
export function safeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'photo';
}

export async function uploadDriverImage(
  asset: ImagePicker.ImagePickerAsset,
  folder: string,
  name: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please sign in again.');
  const localUri = await compress(asset).catch(() => asset.uri);
  const cleanFolder = folder.split('/').map(safeName).join('/');
  const path = `drivers/${user.uid}/${cleanFolder}/${safeName(name)}-${Date.now()}.jpg`;
  const fileRef = ref(storage, path);
  return withRetry(
    async () => {
      const blob = await uriToBlob(localUri);
      if (blob.size > MAX_UPLOAD_BYTES) throw new PickerError('Photo is too large (max 8 MB).');
      const task = uploadBytesResumable(fileRef, blob, { contentType: 'image/jpeg' });
      task.on('state_changed', (s) => onProgress?.(Math.round((s.bytesTransferred / Math.max(1, s.totalBytes)) * 100)));
      await withTimeout(
        task.then(() => undefined),
        90000,
        'Upload timed out.',
      ).catch((err: unknown) => {
        task.cancel();
        throw err;
      });
      return getDownloadURL(fileRef);
    },
    { retries: 2 },
  );
}

export function describeUploadError(error: unknown): string {
  if (error instanceof PickerError) return error.message;
  const code = (error as { code?: string })?.code ?? '';
  if (code === 'storage/unauthorized') return 'Upload not permitted. Please sign in again.';
  if (code === 'storage/canceled') return 'Upload cancelled.';
  if (code === 'storage/retry-limit-exceeded' || code === 'timeout') return 'Network is slow. Please try again.';
  return 'Upload failed. Please try again.';
}
