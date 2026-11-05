import { describe, it, expect } from 'vitest';
import {
  PRIMARY_DOMAIN,
  PRIMARY_BASE_URL,
  SUPPORTED_DOMAINS,
  ALL_BRAND_URLS,
  getActiveDomain,
  getActiveBaseUrl,
  buildBreadcrumbSchema,
} from './seo';

describe('Multi-Domain SEO Utilities', () => {
  it('contains all 6 required domains', () => {
    expect(SUPPORTED_DOMAINS).toEqual([
      'nesamcabs.com',
      'nesamcabs.in',
      'nesamtravels.com',
      'nesamtravels.in',
      'nesamtoursandtravels.com',
      'nesamtoursandtravels.in',
    ]);
    expect(PRIMARY_DOMAIN).toBe('www.nesamcabs.com');
    expect(PRIMARY_BASE_URL).toBe('https://www.nesamcabs.com');
    expect(ALL_BRAND_URLS).toHaveLength(6);
    expect(ALL_BRAND_URLS).toContain('https://nesamcabs.in/');
    expect(ALL_BRAND_URLS).toContain('https://nesamtoursandtravels.com/');
  });

  it('always uses the canonical host', () => {
    expect(getActiveDomain()).toBe('www.nesamcabs.com');
    expect(getActiveBaseUrl()).toBe('https://www.nesamcabs.com');
  });

  it('builds breadcrumb JSON-LD schema with correct URLs and positions', () => {
    const breadcrumbs = [
      { name: 'Home', path: '/' },
      { name: 'Corridors', path: '/routes' },
      { name: 'Chennai to Pondicherry', path: '/routes/chennai-to-pondicherry' },
    ];
    const schema = buildBreadcrumbSchema(breadcrumbs, 'https://nesamtravels.in') as any;

    expect(schema['@context']).toBe('https://schema.org');
    expect(schema['@type']).toBe('BreadcrumbList');
    expect(schema.itemListElement).toHaveLength(3);
    expect(schema.itemListElement[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: 'https://nesamtravels.in/',
    });
    expect(schema.itemListElement[2]).toEqual({
      '@type': 'ListItem',
      position: 3,
      name: 'Chennai to Pondicherry',
      item: 'https://nesamtravels.in/routes/chennai-to-pondicherry',
    });
  });
});

