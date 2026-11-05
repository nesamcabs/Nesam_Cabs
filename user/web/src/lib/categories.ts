// Presentation of the admin-managed vehicle categories: which photo represents a category and
// which filter group it belongs to. Names, seats, descriptions and fares always come from the server.
import type { RideCategory } from '@core/types';
import { vehicleArtFor } from './vehicleArt';

export type CategoryGroup = 'Sedan' | 'SUV' | 'Innova' | 'Van & bus';

export function categoryGroup(c: Pick<RideCategory, 'name' | 'seats'>): CategoryGroup {
  const n = c.name.toLowerCase();
  if (/innova|crysta|hycross/.test(n)) return 'Innova';
  const art = vehicleArtFor(c);
  if (art === 'passenger-van' || art === 'minibus' || art === 'tourist-coach') return 'Van & bus';
  if (art === 'suv' || art === 'mpv') return 'SUV';
  return 'Sedan';
}

/**
 * The reference's white studio photos where one fits the category, otherwise the site's own
 * illustration. A category image is representative only: the assigned model may vary.
 */
export function categoryPhoto(c: Pick<RideCategory, 'name' | 'seats'> & { imageUrl?: string }): string {
  const n = c.name.toLowerCase();
  if (/crysta|hycross/.test(n)) return '/nesam/cars/crysta.webp';
  if (/innova/.test(n)) return '/nesam/cars/innova.webp';
  if (/carens|xl6/.test(n)) return '/nesam/cars/carens.webp';
  if (/ertiga/.test(n)) return '/nesam/cars/ertiga.webp';
  const art = vehicleArtFor(c);
  if (art === 'sedan' || art === 'premium-sedan' || art === 'hatchback') return art === 'hatchback' ? '/vehicles/hatchback.webp' : '/nesam/cars/sedan.webp';
  if (art === 'mpv') return c.seats >= 7 ? '/nesam/cars/innova.webp' : '/nesam/cars/ertiga.webp';
  if (art === 'suv') return c.seats >= 7 ? '/nesam/cars/carens.webp' : '/nesam/cars/ertiga.webp';
  return `/vehicles/${art}.webp`;
}

/** Longest admin-written display text that is used as the main text; a longer description is treated as marketing copy. */
const MAX_DISPLAY_TEXT = 48;

/**
 * The main text customers see for a category: the example cars ("Dzire / Etios or similar"), never the generic
 * "Sedan" / "SUV" label. It is the admin's display text (the category description) when that is a short line,
 * otherwise the example cars for the category, otherwise the category name without its "6+1" / "7+1" seat suffix.
 */
export function categoryName(c: Pick<RideCategory, 'name'> & { seats?: number; description?: string }): string {
  const own = (c.description ?? '').trim();
  if (own && own.length <= MAX_DISPLAY_TEXT) return own;
  const models = typeof c.seats === 'number' ? categoryModels({ name: c.name, seats: c.seats }) : '';
  if (models) return models;
  return c.name.replace(/\s*\d+\s*\+\s*\d+\s*$/, '').trim() || c.name;
}

/** The example cars shown under a category name: "Dzire / Etios or similar". Only the Crysta is named exactly. */
export function categoryModels(c: Pick<RideCategory, 'name' | 'seats'>): string {
  const n = c.name.toLowerCase();
  if (/crysta/.test(n)) return 'Toyota Innova Crysta';
  if (/innova|hycross/.test(n)) return 'Toyota Innova or similar';
  const group = categoryGroup(c);
  if (group === 'SUV') return 'Ertiga or similar';
  if (group === 'Sedan') return 'Dzire / Etios or similar';
  return '';
}
