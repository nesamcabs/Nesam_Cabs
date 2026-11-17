// One-line description of a time-based round trip package for duty cards and the trip screen.
import type { TimePackageInfo } from '../types/driver';

const when = (ms: number) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms));

/** e.g. "Next-Day Return · 400 km included · ends 17 Nov, 11:45 pm". Morning Return names its strict cutoff. */
export function timePackageLine(p: TimePackageInfo | null | undefined): string {
  if (!p) return '';
  const parts = [p.upgraded ? `${p.label} (upgraded)` : p.label];
  if (p.includedKm > 0) parts.push(`${p.includedKm} km included`);
  if (p.kind === 'morning' && p.morningCutoffMs && !p.upgraded) parts.push(`must finish by ${when(p.morningCutoffMs)} or it upgrades`);
  else if (p.endMs) parts.push(`ends ${when(p.endMs)}`);
  return parts.join(' · ');
}
