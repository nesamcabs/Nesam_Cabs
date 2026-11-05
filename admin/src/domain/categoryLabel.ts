/** A vehicle category as admin lists show it: the customer display text first, then the category name ("Dzire / Etios or similar · Sedan"). */
export const categoryTitle = (c: { name: string; description?: string }): string => {
  const shown = (c.description ?? "").trim();
  return shown && shown.length <= 48 && shown !== c.name ? `${shown} · ${c.name}` : c.name;
};
