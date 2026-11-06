import { describe, expect, it } from 'vitest';
import { categoryPhoto } from './categories';
describe('admin-managed category photos', () => {
  it('uses the saved car image for every category, including branded built-in cars', () => {
    const imageUrl = 'https://example.com/admin-car.webp';
    for (const name of ['Sedan', 'Toyota Innova', 'Innova Crysta', 'Ertiga', 'Kia Carens']) {
      expect(categoryPhoto({ name, seats: 7, imageUrl })).toBe(imageUrl);
    }
  });
  it('keeps existing artwork when no image is uploaded or the custom image is removed', () => {
    const fallback = categoryPhoto({ name: 'Innova Crysta', seats: 7 });
    expect(fallback).toMatch(/\.webp$/);
    expect(categoryPhoto({ name: 'Innova Crysta', seats: 7, imageUrl: '' })).toBe(fallback);
  });
});
