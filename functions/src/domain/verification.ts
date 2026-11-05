// Vehicle photo verification: required slots, capture challenges and the
// layered anti-fraud scoring. Nothing here can prove a photo is genuine — a
// determined person can still photograph another screen. The controls make
// reuse and shortcuts hard to do unnoticed and put a risk flag in front of an
// admin; they are deliberately named "signals", never "proof".
import { createHash, createHmac, randomInt } from 'crypto';
import * as jpeg from 'jpeg-js';

// The driver's own live selfie (identity) plus the vehicle front, rear and dashboard. All are taken live
// with the in-app camera; the selfie slot is what Tariff & Operations v2 p.11 requires before departure.
export const VEHICLE_SLOTS = ['selfie', 'front', 'rear', 'interior'] as const;
export type VehicleSlot = (typeof VEHICLE_SLOTS)[number];

export const SLOT_FIELD: Record<VehicleSlot, 'driverSelfiePhoto' | 'vehicleFrontPhoto' | 'vehicleRearPhoto' | 'vehicleInteriorPhoto'> = {
  selfie: 'driverSelfiePhoto',
  front: 'vehicleFrontPhoto',
  rear: 'vehicleRearPhoto',
  interior: 'vehicleInteriorPhoto',
};

export const SLOT_LABEL: Record<VehicleSlot, string> = {
  selfie: 'Driver selfie',
  front: 'Vehicle front',
  rear: 'Vehicle rear',
  interior: 'Dashboard / interior',
};

export const isVehicleSlot = (v: unknown): v is VehicleSlot => (VEHICLE_SLOTS as readonly string[]).includes(String(v));

/** A capture session is valid for this long; each photo must be uploaded within it. */
export const CAPTURE_SESSION_MS = 15 * 60 * 1000;
/** A single instruction stays valid for this long after it is shown. */
export const INSTRUCTION_MS = 3 * 60 * 1000;
/** A photo's own capture time may differ from the server's upload time by at most this. */
export const MAX_CAPTURE_TO_UPLOAD_MS = 3 * 60 * 1000;
/** Largest photo the server will analyse. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

const INSTRUCTIONS: Record<VehicleSlot, string[]> = {
  selfie: ['Face the camera with your face fully visible', 'Remove sunglasses and keep your cap off', 'Hold the phone at eye level in good light'],
  front: ['Turn the headlights on', 'Keep the number plate fully readable', 'Stand about 3 metres in front of the vehicle'],
  rear: ['Turn the parking lights on', 'Keep the number plate fully readable', 'Open the boot slightly'],
  interior: ['Show the dashboard with the ignition on', 'Include the steering wheel and odometer', 'Keep the cabin lights on'],
};

/** A fresh instruction per photo, chosen with a secure random source. */
export function randomInstruction(slot: VehicleSlot): string {
  const list = INSTRUCTIONS[slot];
  return list[randomInt(0, list.length)];
}

/** Short code the driver must show near the dashboard / plate (anti-replay). */
export function randomVerificationCode(): string {
  return String(randomInt(1000, 10000));
}

export const sha256Hex = (buf: Buffer | string): string => createHash('sha256').update(buf).digest('hex');
export const hmacHex = (secret: string, value: string): string => createHmac('sha256', secret).update(value).digest('hex');

// ── Perceptual hash ───────────────────────────────────────────────────────

/** 64-bit difference hash (dHash) as 16 hex chars; null when the image can't be decoded. */
export function perceptualHash(jpegBytes: Buffer): string | null {
  try {
    const img = jpeg.decode(jpegBytes, { useTArray: true, maxMemoryUsageInMB: 256 });
    const gray = grayscaleResize(img.data, img.width, img.height, 9, 8);
    let bits = '';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) bits += gray[y * 9 + x] > gray[y * 9 + x + 1] ? '1' : '0';
    }
    let hex = '';
    for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  } catch {
    return null;
  }
}

/** Hamming distance between two 16-hex-char hashes (64 = completely different). */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

/** Two photos this close are treated as the same picture re-taken or lightly edited. */
export const NEAR_DUPLICATE_DISTANCE = 6;

function grayscaleResize(rgba: Uint8Array, w: number, h: number, outW: number, outH: number): number[] {
  const out: number[] = [];
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      const x0 = Math.floor((ox * w) / outW), x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * w) / outW));
      const y0 = Math.floor((oy * h) / outH), y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * h) / outH));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
          n++;
        }
      }
      out.push(n ? sum / n : 0);
    }
  }
  return out;
}

// ── Image signals ─────────────────────────────────────────────────────────

export interface ImageSignals {
  width: number;
  height: number;
  /** Share of pixels that are nearly pure white, in one contiguous glare-like area (0–1). */
  glareRatio: number;
  /** Ratio of fine periodic texture energy; high values are typical of photographing a display. */
  moireScore: number;
  /** Mean luminance 0–255. */
  brightness: number;
}

/** Cheap pixel statistics. Heuristics only: they raise a flag, they never block. */
export function analyzeImage(jpegBytes: Buffer): ImageSignals | null {
  try {
    const img = jpeg.decode(jpegBytes, { useTArray: true, maxMemoryUsageInMB: 256 });
    const { width: w, height: h, data } = img;
    // Sample on a grid so a 12 MP photo costs little.
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40000)));
    const gw = Math.floor(w / step), gh = Math.floor(h / step);
    if (gw < 8 || gh < 8) return null;
    const lum = new Float32Array(gw * gh);
    let sum = 0, bright = 0;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = ((y * step) * w + x * step) * 4;
        const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        lum[y * gw + x] = l;
        sum += l;
        if (l > 250) bright++;
      }
    }
    const n = gw * gh;
    // Glare: a block of near-saturated pixels, found with a coarse 8x8 grid of cells.
    let glareCells = 0;
    const cellW = Math.floor(gw / 8), cellH = Math.floor(gh / 8);
    for (let cy = 0; cy < 8; cy++) {
      for (let cx = 0; cx < 8; cx++) {
        let hot = 0, total = 0;
        for (let y = cy * cellH; y < (cy + 1) * cellH; y++) {
          for (let x = cx * cellW; x < (cx + 1) * cellW; x++) {
            total++;
            if (lum[y * gw + x] > 250) hot++;
          }
        }
        if (total && hot / total > 0.6) glareCells++;
      }
    }
    // Moiré proxy: energy of the 2-pixel-period component relative to local variance.
    let hf = 0, variance = 0;
    const mean = sum / n;
    for (let y = 0; y < gh; y++) {
      for (let x = 2; x < gw; x++) {
        const a = lum[y * gw + x] - lum[y * gw + x - 2];
        hf += a * a;
      }
      for (let x = 0; x < gw; x++) variance += (lum[y * gw + x] - mean) ** 2;
    }
    const moireScore = variance > 0 ? Math.min(5, hf / (2 * variance)) : 0;
    return { width: w, height: h, glareRatio: Math.min(1, glareCells / 64 + (bright / n) * 0.2), moireScore, brightness: mean };
  } catch {
    return null;
  }
}

/** Dimensions that equal a common phone/tablet screen: typical of a screenshot or a saved screen capture. */
const SCREEN_SIZES = new Set([
  '1080x1920', '1080x2340', '1080x2400', '1080x2408', '1170x2532', '1179x2556', '1284x2778', '1290x2796', '1440x3200',
  '1440x3088', '720x1280', '720x1600', '750x1334', '828x1792', '1125x2436', '1242x2688', '1200x2670', '1440x2560',
]);

export function looksLikeScreenshot(width: number, height: number, hasCameraExif: boolean): boolean {
  const key = `${Math.min(width, height)}x${Math.max(width, height)}`;
  return SCREEN_SIZES.has(key) && !hasCameraExif;
}

// ── Risk score ────────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high';

export interface RiskSignal {
  code: string;
  weight: number;
  message: string;
}

export function riskLevelOf(score: number): RiskLevel {
  if (score >= 60) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

export function scoreSignals(signals: RiskSignal[]): { score: number; level: RiskLevel } {
  const score = Math.min(100, signals.reduce((s, x) => s + x.weight, 0));
  return { score, level: riskLevelOf(score) };
}

/** Distance between two coordinates in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ── Device integrity verdict ──────────────────────────────────────────────

export interface IntegrityVerdictInput {
  /** Raw verdict fields from the Play Integrity API (already decoded by Google). */
  appRecognitionVerdict?: string;
  deviceRecognitionVerdict?: string[];
  appLicensingVerdict?: string;
  packageName?: string;
  nonce?: string;
}

/**
 * A production device must be a genuine, unmodified Android device running the
 * published app. MEETS_BASIC_INTEGRITY alone (rooted/custom ROM that passes
 * only basic checks) and emulators are refused.
 */
export function evaluateIntegrity(v: IntegrityVerdictInput, expect: { packageName: string; nonce: string }): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (v.packageName !== expect.packageName) reasons.push('package_mismatch');
  if (v.nonce !== expect.nonce) reasons.push('nonce_mismatch');
  if (v.appRecognitionVerdict !== 'PLAY_RECOGNIZED') reasons.push('app_not_recognized');
  const device = v.deviceRecognitionVerdict ?? [];
  if (!device.includes('MEETS_DEVICE_INTEGRITY')) reasons.push('device_integrity_failed');
  return { ok: reasons.length === 0, reasons };
}
