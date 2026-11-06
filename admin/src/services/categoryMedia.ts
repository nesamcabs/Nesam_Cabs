import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from './firebase';

export const CATEGORY_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function categoryMediaProblem(file: Pick<File, 'type' | 'size'>): string {
  if (!EXTENSIONS[file.type]) return 'Choose a PNG, JPG or WebP image.';
  if (file.size <= 0) return 'Choose an image that is not empty.';
  if (file.size > CATEGORY_MEDIA_MAX_BYTES) return 'The image must be 5 MB or smaller.';
  return '';
}

/** Unique filenames prevent cached images from masking an admin's replacement. */
export async function uploadCategoryMedia(file: File, kind: 'icon' | 'car', categoryId: string): Promise<string> {
  const problem = categoryMediaProblem(file);
  if (problem) throw new Error(problem);
  const folder = categoryId.replace(/[^A-Za-z0-9_-]/g, '') || crypto.randomUUID();
  const target = ref(storage, `category-media/${folder}/${kind}-${crypto.randomUUID()}.${EXTENSIONS[file.type]}`);
  const uploaded = await uploadBytes(target, file, { contentType: file.type, cacheControl: 'public,max-age=31536000,immutable' });
  return getDownloadURL(uploaded.ref);
}
