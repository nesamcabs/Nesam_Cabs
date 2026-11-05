import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { auth, storage } from './firebase';

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Downscales a phone photo (often 4–12 MB) to a JPEG no larger than
 * MAX_DIMENSION on its long edge. Falls back to the original file when the
 * browser can't decode it (e.g. HEIC on desktop Chrome).
 */
async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/**
 * Uploads a driver image under drivers/{uid}/{folder}/{name}-{ts}.jpg and
 * returns its download URL. storage.rules only allow the owner to write here.
 */
export async function uploadDriverImage(file: File, folder: string, name: string): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please sign in again.');
  if (!file.type.startsWith('image/')) throw new Error('Please choose a photo (JPG or PNG).');

  const blob = await compressImage(file);
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('Photo is too large (max 8 MB).');

  const ext = blob.type === 'image/png' ? 'png' : 'jpg';
  const path = `drivers/${user.uid}/${folder}/${name}-${Date.now()}.${ext}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, blob, { contentType: blob.type || 'image/jpeg' });
  return getDownloadURL(fileRef);
}

export function describeUploadError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  if (code === 'storage/unauthorized') return 'Upload not permitted. Please sign in again.';
  if (code === 'storage/canceled') return 'Upload cancelled.';
  if (code === 'storage/retry-limit-exceeded') return 'Network is slow. Please try again.';
  return (error as Error)?.message || 'Upload failed. Please try again.';
}
