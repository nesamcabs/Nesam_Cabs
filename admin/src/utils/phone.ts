/**
 * A typed Indian mobile in a supported spelling — 10 digits, or with a 0 / 91 / +91 / 091 / 0091 prefix, separated by
 * spaces, dashes, dots or brackets — as its 10 digits; null otherwise. Mirrors the server's `parseIndianMobile`
 * (functions/src/phone.ts), which makes the final decision. Extra digits are never cut off.
 */
export function parseIndianMobile(v: string): string | null {
  if (/[^\d\s+()\-.]/.test(v)) return null;
  const m = /^(?:0091|091|91|0)?([6-9]\d{9})$/.exec(v.replace(/\D/g, ""));
  return m ? m[1] : null;
}
