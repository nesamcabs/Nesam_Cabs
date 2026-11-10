import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from './firebase';

/** What Storage accepts (storage.rules): the file that is actually saved. */
export const CATEGORY_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
/** What an admin may pick: bigger originals are fine because they are compressed before saving. */
export const CATEGORY_MEDIA_PICK_MAX_BYTES = 25 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Longest side, in pixels, per artwork kind: plenty for a card or a phone screen, far smaller than a camera photo. */
const MAX_SIDE: Record<'icon' | 'car', number> = { icon: 512, car: 1280 };
/** The encoder is asked for this quality first and steps down until the file is small enough. */
const QUALITY_STEPS = [0.85, 0.78, 0.7, 0.6];
const TARGET_BYTES: Record<'icon' | 'car', number> = { icon: 120 * 1024, car: 350 * 1024 };

/** Checks a file the admin has just picked (type and a generous size limit; compression follows). */
export function categoryMediaProblem(file: Pick<File, 'type' | 'size'>): string {
  if (!EXTENSIONS[file.type]) return 'Choose a PNG, JPG or WebP image.';
  if (file.size <= 0) return 'Choose an image that is not empty.';
  if (file.size > CATEGORY_MEDIA_PICK_MAX_BYTES) return 'The image must be 25 MB or smaller.';
  return '';
}

/** Checks the file that is about to be stored. */
function storedFileProblem(file: Pick<File, 'type' | 'size'>): string {
  if (!EXTENSIONS[file.type]) return 'Choose a PNG, JPG or WebP image.';
  if (file.size <= 0) return 'Choose an image that is not empty.';
  if (file.size > CATEGORY_MEDIA_MAX_BYTES) return 'The image is still over 5 MB after compression. Choose a smaller image.';
  return '';
}

/** Scales (width, height) down so the longest side is at most `max`; never scales up. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      /* fall back to an <img> element below */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('This image could not be read. Choose a different PNG, JPG or WebP file.');
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

export interface CompressedImage {
  file: File;
  originalBytes: number;
  bytes: number;
  width: number;
  height: number;
  /** Only for car images given a name: was it written on the yellow number plate? */
  plate?: 'stamped' | 'not-found';
}

export interface PlateBox { x: number; y: number; w: number; h: number }

/**
 * Finds the yellow number plate on a car picture: the biggest roughly rectangular patch of plate-yellow.
 * (Taxi plates are yellow; small amber lamps are rejected by size and shape.)
 */
export function findYellowPlate(data: Uint8ClampedArray, width: number, height: number): PlateBox | null {
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < mask.length; i += 1, p += 4) {
    const r = data[p]!, g = data[p + 1]!, b = data[p + 2]!, a = data[p + 3]!;
    if (a > 200 && r > 200 && g > 140 && g < 228 && b < 95 && r - b > 130 && r >= g) mask[i] = 1;
  }
  const seen = new Uint8Array(width * height);
  const minArea = Math.max(60, width * height * 0.00015);
  let best: (PlateBox & { area: number }) | null = null;
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let minX = width, maxX = 0, minY = height, maxY = 0, area = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const idx = stack.pop()!;
      const x = idx % width, y = (idx - x) / width;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[idx - 1] && !seen[idx - 1]) { seen[idx - 1] = 1; stack.push(idx - 1); }
      if (x < width - 1 && mask[idx + 1] && !seen[idx + 1]) { seen[idx + 1] = 1; stack.push(idx + 1); }
      if (y > 0 && mask[idx - width] && !seen[idx - width]) { seen[idx - width] = 1; stack.push(idx - width); }
      if (y < height - 1 && mask[idx + width] && !seen[idx + width]) { seen[idx + width] = 1; stack.push(idx + width); }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const aspect = w / h, fill = area / (w * h);
    if (area >= minArea && aspect >= 1.5 && aspect <= 7 && fill >= 0.5 && (!best || area > best.area)) best = { x: minX, y: minY, w, h, area };
  }
  return best ? { x: best.x, y: best.y, w: best.w, h: best.h } : null;
}

/** Writes `text` on the plate: one line, or two when the name is long, as large as fits. */
export function drawPlateText(ctx: CanvasRenderingContext2D, plate: PlateBox, text: string) {
  const label = text.trim().toUpperCase().slice(0, 28);
  if (!label) return;
  const family = '"Poppins", "Arial Black", Arial, sans-serif';
  const fit = (lines: string[]) => {
    const maxW = plate.w * 0.86, maxH = plate.h * 0.8;
    let size = Math.min(plate.h * 0.62, maxH / lines.length);
    for (; size > 3; size -= 0.5) {
      ctx.font = `800 ${size}px ${family}`;
      if (Math.max(...lines.map((l) => ctx.measureText(l).width)) <= maxW) break;
    }
    return size;
  };
  const words = label.split(/\s+/);
  const one = [label];
  let lines = one;
  let size = fit(one);
  if (words.length > 1) {
    const mid = Math.ceil(words.length / 2);
    const two = [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
    const twoSize = fit(two);
    if (twoSize > size * 1.15) { lines = two; size = twoSize; }
  }
  ctx.font = `800 ${size}px ${family}`;
  ctx.fillStyle = '#1c1c1c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lineH = size * 1.08;
  const cx = plate.x + plate.w / 2;
  const top = plate.y + plate.h / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => ctx.fillText(line, cx, top + i * lineH));
}

/**
 * Upload → compress → store. Shrinks a picked image in the browser before it is saved:
 *  - the longest side is limited (icon 512 px, car 1280 px),
 *  - it is re-encoded as WebP (keeps transparent backgrounds, far smaller than PNG/JPG),
 *  - quality steps down until the file reaches a small target size.
 * Car images can also get the category name written on their yellow number plate.
 * If compressing would not make the file smaller (and nothing was written), the original is kept.
 */
export async function compressCategoryImage(file: File, kind: 'icon' | 'car', plateText?: string): Promise<CompressedImage> {
  const problem = categoryMediaProblem(file);
  if (problem) throw new Error(problem);
  const decoded = await decode(file);
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height, MAX_SIDE[kind]);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot compress images. Try Chrome or Edge.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.source, 0, 0, width, height);

    // Car images: write the category name on the yellow number plate (before encoding, so it is part of the stored image).
    let plate: CompressedImage['plate'];
    if (kind === 'car' && plateText?.trim()) {
      const box = findYellowPlate(ctx.getImageData(0, 0, width, height).data, width, height);
      if (box) {
        drawPlateText(ctx, box, plateText);
        plate = 'stamped';
      } else plate = 'not-found';
    }

    // WebP first. A browser that cannot encode WebP hands back a PNG; then a JPEG source is encoded as JPEG instead.
    const outType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    let best: Blob | null = null;
    for (const q of QUALITY_STEPS) {
      const blob = await toBlob(canvas, outType, q);
      if (!blob || !EXTENSIONS[blob.type]) continue;
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= TARGET_BYTES[kind]) break;
    }
    const resized = width !== decoded.width || height !== decoded.height;
    // Keep the original when it is already smaller and was not resized (nothing to gain).
    if (!best || (!resized && plate !== 'stamped' && file.size <= best.size)) {
      const kept = storedFileProblem(file);
      if (kept) throw new Error(kept);
      return { file, originalBytes: file.size, bytes: file.size, width, height, plate };
    }
    const ext = EXTENSIONS[best.type];
    const base = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40) || kind;
    const out = new File([best], `${base}.${ext}`, { type: best.type });
    const stored = storedFileProblem(out);
    if (stored) throw new Error(stored);
    return { file: out, originalBytes: file.size, bytes: out.size, width, height, plate };
  } finally {
    decoded.close();
  }
}

/** Unique filenames prevent cached images from masking an admin's replacement. */
export async function uploadCategoryMedia(file: File, kind: 'icon' | 'car', categoryId: string): Promise<string> {
  const problem = storedFileProblem(file);
  if (problem) throw new Error(problem);
  const folder = categoryId.replace(/[^A-Za-z0-9_-]/g, '') || crypto.randomUUID();
  const target = ref(storage, `category-media/${folder}/${kind}-${crypto.randomUUID()}.${EXTENSIONS[file.type]}`);
  const uploaded = await uploadBytes(target, file, { contentType: file.type, cacheControl: 'public,max-age=31536000,immutable' });
  return getDownloadURL(uploaded.ref);
}
