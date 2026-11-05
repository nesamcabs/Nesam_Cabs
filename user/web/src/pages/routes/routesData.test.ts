import { describe, expect, it } from 'vitest';
import { ALL_ROUTES, findRouteBySlug } from './routesData';
import { buildBreadcrumbSchema as breadcrumbSchema } from '@/lib/seo';

describe('SEO routesData', () => {
  it('contains valid corridor configurations with required SEO fields', () => {
    expect(ALL_ROUTES.length).toBeGreaterThanOrEqual(8);
    for (const r of ALL_ROUTES) {
      expect(r.id).toBeTruthy();
      expect(r.slug).toBeTruthy();
      expect(r.title.length).toBeGreaterThan(15);
      expect(r.distanceKm).toBeGreaterThan(0);
      expect(r.estimates.length).toBeGreaterThanOrEqual(4);
      expect(r.keyStops.length).toBeGreaterThan(0);
      expect(r.faqs.length).toBeGreaterThan(0);
      expect(r.pickup.lat).toBeTypeOf('number');
      expect(r.drop.lat).toBeTypeOf('number');
    }
  });

  it('correctly resolves routes by various slug formats', () => {
    const route = findRouteBySlug('chennai-to-pondicherry');
    expect(route).toBeDefined();
    expect(route?.origin).toBe('Chennai');
    expect(route?.destination).toBe('Pondicherry');

    // Case-insensitivity and alias
    const alias = findRouteBySlug('CHENNAI-PONDICHERRY');
    expect(alias).toBeDefined();
    expect(alias?.id).toBe('chennai-pondicherry');
  });

  it('builds valid Schema.org BreadcrumbList', () => {
    const crumbs = [
      { name: 'Home', path: '/' },
      { name: 'Chennai to Pondicherry', path: '/routes/chennai-to-pondicherry' },
    ];
    const schema = breadcrumbSchema(crumbs) as any;
    expect(schema['@type']).toBe('BreadcrumbList');
    expect(schema.itemListElement).toHaveLength(2);
    expect(schema.itemListElement[0].position).toBe(1);
    expect(schema.itemListElement[1].item).toBe('https://www.nesamcabs.com/routes/chennai-to-pondicherry');
  });
});
