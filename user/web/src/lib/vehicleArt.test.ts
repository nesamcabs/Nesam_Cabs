import { describe, expect, it } from 'vitest';
import { vehicleArtFor } from './vehicleArt';

describe('vehicle illustration for a ride category', () => {
  it('maps NESAM category names to one consistent illustration set', () => {
    expect(vehicleArtFor({ name: 'Mini', seats: 4 })).toBe('hatchback');
    expect(vehicleArtFor({ name: 'Sedan', seats: 4 })).toBe('sedan');
    expect(vehicleArtFor({ name: 'SUV', seats: 6 })).toBe('suv');
    expect(vehicleArtFor({ name: 'Premium SUV', seats: 7 })).toBe('mpv');
    expect(vehicleArtFor({ name: 'Tempo Traveller', seats: 12 })).toBe('passenger-van');
  });

  it('falls back to capacity for names it does not know', () => {
    expect(vehicleArtFor({ name: 'Category X', seats: 4 })).toBe('sedan');
    expect(vehicleArtFor({ name: 'Category X', seats: 7 })).toBe('mpv');
    expect(vehicleArtFor({ name: 'Category X', seats: 14 })).toBe('passenger-van');
    expect(vehicleArtFor({ name: 'Category X', seats: 30 })).toBe('tourist-coach');
  });
});
