// Profile photo upload. Native replacement for user/web/src/services/
// storageService.ts: the canvas downscale becomes expo-image-manipulator and
// the File object becomes a local file URI read into a Blob.
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { storage } from '../config/firebase';
import { withRetry, withTimeout } from '../utils/retry';

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_EDGE_PX = 512;

export type PickSource = 'camera' | 'library';

export class PickerError extends Error {}

/** Opens the camera or the system photo picker. Returns null if cancelled. */
export async function pickImage(source: PickSource): Promise<ImagePicker.ImagePickerAsset | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      throw new PickerError(
        perm.canAskAgain
          ? 'Camera permission is needed to take a photo.'
          : 'Camera access is turned off for NESAM. Enable it in Settings › Apps › NESAM › Permissions.',
      );
    }
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.9, allowsEditing: true, aspect: [1, 1] };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0]!;
  if (asset.mimeType && !asset.mimeType.startsWith('image/')) throw new PickerError('Please choose an image file (JPG, PNG or WebP).');
  if (asset.fileSize && asset.fileSize > MAX_INPUT_BYTES) throw new PickerError('That image is larger than 10 MB. Please choose a smaller one.');
  return asset;
}

/** Reads a local file:// or content:// URI into a Blob (works for Firebase Storage on Android). */
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

async function downscale(uri: string, width: number, height: number): Promise<string> {
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(width || MAX_EDGE_PX, height || MAX_EDGE_PX));
  const ctx = ImageManipulator.ImageManipulator.manipulate(uri);
  if (scale < 1) ctx.resize({ width: Math.round((width || MAX_EDGE_PX) * scale) });
  const rendered = await ctx.renderAsync();
  const saved = await rendered.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.85 });
  return saved.uri;
}

/** Uploads to customers/{uid}/profile/avatar-{ts}.jpg and returns the download URL. */
export async function uploadProfilePhoto(
  uid: string,
  asset: ImagePicker.ImagePickerAsset,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const localUri = await downscale(asset.uri, asset.width, asset.height).catch(() => asset.uri);
  const objectRef = ref(storage, `customers/${uid}/profile/avatar-${Date.now()}.jpg`);
  return withRetry(
    async () => {
      const blob = await uriToBlob(localUri);
      const task = uploadBytesResumable(objectRef, blob, { contentType: 'image/jpeg' });
      task.on('state_changed', (s) => onProgress?.(Math.round((s.bytesTransferred / Math.max(1, s.totalBytes)) * 100)));
      await withTimeout(
        task.then(() => undefined),
        60000,
        'Photo upload timed out.',
      ).catch((err: unknown) => {
        task.cancel();
        throw err;
      });
      return getDownloadURL(objectRef);
    },
    { retries: 2 },
  );
}
