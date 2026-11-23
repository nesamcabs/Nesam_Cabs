/**
 * A typed Indian mobile in one of the supported spellings — 10 digits, or with a 0 / 91 / +91 / 091 / 0091 prefix,
 * separated by spaces, dashes, dots or brackets — as its 10 digits; null for anything else. Extra digits are never
 * cut off, so a mistyped 11–14 digit number cannot match or create an account. (Stored records keep their own readers.)
 */
export function parseIndianMobile(v: unknown): string | null {
  if (typeof v !== 'string' || /[^\d\s+()\-.]/.test(v)) return null;
  const m = /^(?:0091|091|91|0)?([6-9]\d{9})$/.exec(v.replace(/\D/g, ''));
  return m ? m[1] : null;
}
