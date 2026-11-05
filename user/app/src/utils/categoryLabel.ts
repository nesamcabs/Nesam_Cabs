// The main text customers see for a ride category: the example cars ("Dzire / Etios or similar"), never the generic
// "Sedan" / "SUV" label. It is the admin's display text (the category description) when that is a short line,
// otherwise the example cars for the category.
const MAX_DISPLAY_TEXT = 48;

export function categoryLabel(c: { name: string; description?: string }): string {
  const own = (c.description ?? '').trim();
  if (own && own.length <= MAX_DISPLAY_TEXT) return own;
  const n = c.name.toLowerCase();
  if (/crysta/.test(n)) return 'Toyota Innova Crysta';
  if (/innova|hycross/.test(n)) return 'Toyota Innova or similar';
  if (/suv|ertiga|xuv|scorpio|bolero|marazzo|carens|xl6/.test(n)) return 'Ertiga or similar';
  return 'Dzire / Etios or similar';
}
