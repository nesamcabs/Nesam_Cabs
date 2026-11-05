import { DocumentData } from 'firebase-admin/firestore';

/** Release waves of a published duty. Off by default: thresholds are open decisions (D09/D11). */
export interface ReleaseConfig {
  enabled: boolean;
  /** Seconds after publication at which lower-rated independent drivers are added. */
  ownersAllSeconds: number;
  /** Seconds after publication at which Vendors are added. */
  vendorsSeconds: number;
  /** Rating at or above which an owner-driver is "top rated" (first wave). */
  topRatedMin: number;
}
export function releaseConfigOf(settings: DocumentData | undefined): ReleaseConfig {
  const r = (settings?.dutyRelease && typeof settings.dutyRelease === 'object' ? settings.dutyRelease : {}) as Record<string, unknown>;
  const n = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d);
  return {
    enabled: r.enabled === true,
    ownersAllSeconds: n(r.ownersAllSeconds, 120, 0, 3600),
    vendorsSeconds: n(r.vendorsSeconds, 180, 0, 3600),
    topRatedMin: n(r.topRatedMin, 4.5, 0, 5),
  };
}

/** Why `who` may not take part yet (waves), or ''. Authoritative: the server enforces it, apps only mirror it. */
export function releaseBlocker(cfg: ReleaseConfig, kind: 'driver' | 'vendor', rating: number | null, publishedAtMs: number, nowMs: number): string {
  if (!cfg.enabled || !publishedAtMs) return '';
  const age = (nowMs - publishedAtMs) / 1000;
  if (kind === 'vendor') return age >= cfg.vendorsSeconds ? '' : 'This duty is being offered to owner-drivers first. It opens to vendors shortly.';
  if (rating !== null && rating >= cfg.topRatedMin) return '';
  return age >= cfg.ownersAllSeconds ? '' : 'This duty is first offered to top-rated owner-drivers. It opens to you shortly.';
}

