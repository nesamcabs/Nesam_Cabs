import type { LatLng, TripRecord } from '@core/types';
import { formatPhone } from '@core/utils/format';
import { googleMapsLink, isValidLatLng } from '@core/utils/geo';

export function buildTripShareText(trip: TripRecord, where: LatLng | null): string {
  const d = trip.driver;
  const lines = [`I'm on a NESAM Cabs ride (booking ${trip.bookingId}).`, `From: ${trip.pickup.name}`, `To: ${trip.drop.name}`];
  if (d) {
    lines.push(`Driver: ${d.name}${d.phone ? ` (${formatPhone(d.phone)})` : ''}`);
    lines.push(`Vehicle: ${[d.vehicleModel, d.vehicleNumber].filter(Boolean).join(' · ') || trip.categoryName}`);
  }
  if (where && isValidLatLng(where)) lines.push(`Current location: ${googleMapsLink(where)}`);
  return lines.join('\n');
}

function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* use the legacy path */
  }
  return legacyCopy(text);
}

/** Opens the system share sheet where there is one, otherwise copies the text. Returns what happened. */
export async function shareText(title: string, text: string): Promise<'shared' | 'copied' | 'failed'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return 'failed';
    }
  }
  return (await copyToClipboard(text)) ? 'copied' : 'failed';
}
