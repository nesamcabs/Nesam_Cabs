// Which of the customer sites a notification belongs to. One rider account works on NESAM Cabs, One
// Way Car Rentals and People Taxi, so each site shows only its own notifications (plus the ones sent
// to every site).

export type SiteBrand = 'nesam' | 'onewaycarrentals' | 'people_taxi';

/** "people_taxi" / "onewaycarrentals" / "nesam" / "all"; empty for anything that names no brand. */
export function normalizeBrand(raw: unknown): SiteBrand | 'all' | '' {
  const v = typeof raw === 'string' ? raw.toLowerCase().trim() : '';
  if (v === 'all') return 'all';
  if (v.includes('people')) return 'people_taxi';
  if (v.includes('oneway') || v.includes('one_way') || v.includes('one-way')) return 'onewaycarrentals';
  if (v.includes('nesam')) return 'nesam';
  return '';
}

/**
 * Whether a notification of this brand is shown on `site`. Notifications sent before brands were
 * recorded name none and belong to NESAM, the original site.
 */
export function visibleOnSite(site: SiteBrand, notificationBrand: SiteBrand | 'all' | ''): boolean {
  return notificationBrand === 'all' || (notificationBrand || 'nesam') === site;
}
