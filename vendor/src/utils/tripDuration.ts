// How long a duty was booked for, as the duty card shows it beside the distance: "5 Hrs", "Full Day", "Morning Return", "2 Days".
const IST_MS = 19_800_000;
const istDay = (ms: number) => Math.floor((ms + IST_MS) / 86_400_000);
const msOf = (v: unknown): number => {
  const t = v as { toDate?: () => Date; seconds?: number; _seconds?: number } | null | undefined;
  if (!t) return 0;
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  const sec = t.seconds ?? t._seconds;
  return typeof sec === 'number' ? sec * 1000 : Date.parse(String(v)) || 0;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const hrs = (n: number) => plural(n, 'Hr');

/**
 * Reads a duty document. `tripDays` and `timePackage.hours` come with the duty; one published without them is worked out
 * from its package name and the time its cover ends. An hourly rental carries its booked `rentalHours`. '' when the duty
 * is neither a round trip nor a rental, or does not say.
 */
export function tripDurationOf(d: { tripDays?: unknown; timePackage?: unknown; pickupAt?: unknown; rentalHours?: unknown }): string {
  if (Number(d.rentalHours) > 0) return hrs(Number(d.rentalHours));
  const booked = Number(d.tripDays) > 0 ? Math.round(Number(d.tripDays)) : 0;
  const p = d.timePackage && typeof d.timePackage === 'object' ? (d.timePackage as Record<string, unknown>) : null;
  if (!p) return booked ? plural(booked, 'Day') : '';
  const label = String(p.label ?? '');
  const start = msOf(d.pickupAt), end = msOf(p.coverageEndAt);
  if (p.kind === 'morning' && p.upgraded !== true) return 'Morning Return';
  if (p.kind === 'same_day') {
    if (/full/i.test(label)) return 'Full Day';
    const exact = start && end > start ? (end - start) / 3_600_000 : 0;
    const hours = Number(p.hours) || Number(/(\d+)\s*-?\s*h(?:ou)?r/i.exec(label)?.[1]) || (Number.isInteger(exact) ? exact : 0);
    return hours ? hrs(hours) : label;
  }
  const days = booked || Number(/(\d+)\s*-?\s*day/i.exec(label)?.[1]) || (start && end > start ? istDay(end) - istDay(start) + 1 : 0);
  return days ? plural(days, 'Day') : label;
}
