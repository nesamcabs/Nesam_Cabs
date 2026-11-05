// Profile photo upload: downscale in a canvas, then Storage — same object path and
// content type as the customer app (customers/{uid}/profile/avatar-{ts}.jpg).
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { storage } from '@/platform/firebase';
import { withRetry, withTimeout } from '@core/utils/retry';

const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_EDGE_PX = 512;

export class PhotoError extends Error {}

export function checkPhoto(file: File): void {
  if (!file.type.startsWith('image/')) throw new PhotoError('Please choose an image file (JPG, PNG or WebP).');
  if (file.size > MAX_INPUT_BYTES) throw new PhotoError('That image is larger than 10 MB. Please choose a smaller one.');
}

async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    // Centre-crop to a square so avatars are never stretched.
    const side = Math.min(bitmap.width, bitmap.height);
    const out = Math.min(MAX_EDGE_PX, side);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PhotoError('Your browser could not prepare the photo.');
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new PhotoError('Your browser could not prepare the photo.'))), 'image/jpeg', 0.85),
    );
  } finally {
    bitmap.close();
  }
}

export async function uploadProfilePhoto(uid: string, file: File, onProgress?: (pct: number) => void): Promise<string> {
  checkPhoto(file);
  const blob = await downscale(file).catch((e: unknown) => {
    if (e instanceof PhotoError) throw e;
    throw new PhotoError('That image could not be read. Try a JPG or PNG.');
  });
  const objectRef = ref(storage, `customers/${uid}/profile/avatar-${Date.now()}.jpg`);
  return withRetry(
    async () => {
      const task = uploadBytesResumable(objectRef, blob, { contentType: 'image/jpeg' });
      task.on('state_changed', (s) => onProgress?.(Math.round((s.bytesTransferred / Math.max(1, s.totalBytes)) * 100)));
      await withTimeout(task.then(() => undefined), 60000, 'Photo upload timed out.').catch((err: unknown) => {
        task.cancel();
        throw err;
      });
      return getDownloadURL(objectRef);
    },
    { retries: 2 },
  );
}
