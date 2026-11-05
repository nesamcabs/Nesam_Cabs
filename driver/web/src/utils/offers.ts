const normalise = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Trip categories are admin-defined names ("Sedan (AC)", "Innova Crysta"), so match loosely on the
 * driver's vehicle type. A plain SUV must not match "Premium SUV" trips.
 */
export function categoryMatches(tripCategory: string, driverType: string): boolean {
  const cat = normalise(tripCategory);
  const mine = normalise(driverType);
  if (!cat) return true;
  if (cat.includes('premium') !== mine.includes('premium')) return false;
  return cat.includes(mine) || mine.includes(cat);
}
