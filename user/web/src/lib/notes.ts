// One notes string for the booking server (it keeps at most 300 characters). Structured extras the
// form collects — a flight number, a different travelling passenger — come first, so a cut-off only
// ever shortens the rider's own words. Same layout the customer app uses.
export const NOTES_MAX = 300;

export function composeNotes(p: { flight?: string; passengerName?: string; passengerMobile?: string; notes?: string }): string {
  const parts: string[] = [];
  const flight = (p.flight ?? '').trim();
  if (flight) parts.push(`Flight: ${flight}`);
  const name = (p.passengerName ?? '').trim();
  const mobile = (p.passengerMobile ?? '').replace(/\s+/g, '');
  if (name || mobile) parts.push(`Travelling passenger: ${[name, mobile].filter(Boolean).join(', ')}`);
  const head = parts.join(' | ');
  const note = (p.notes ?? '').trim();
  return (head && note ? `${head} | ${note}` : head || note).slice(0, NOTES_MAX);
}

/** Room left for the rider's own note once the structured extras are in. */
export const notesRoom = (p: { flight?: string; passengerName?: string; passengerMobile?: string }) => Math.max(0, NOTES_MAX - (composeNotes(p).length + (composeNotes(p) ? 3 : 0)));
