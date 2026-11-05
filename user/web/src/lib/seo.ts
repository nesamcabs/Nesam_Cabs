import { useEffect } from 'react';

export interface BreadcrumbItem {
  name: string;
  path: string;
}

export interface SeoProps {
  /** Page specific title. Will be formatted as "${title} · NESAM Cabs" or used directly if it includes branding */
  title: string;
  /** Meta description for search engine snippets and social cards (140-160 chars recommended) */
  description?: string;
  /** Targeted SEO keywords */
  keywords?: string;
  /** Canonical URL path (e.g. '/book', '/routes/chennai-to-pondicherry') or full absolute URL */
  canonical?: string;
  /** Set true for user-private screens like /account, /trips, /ride to prevent search indexing */
  noindex?: boolean;
  /** Optional custom OpenGraph image URL */
  ogImage?: string;
  /** Optional Breadcrumb hierarchy for automatic BreadcrumbList JSON-LD */
  breadcrumbs?: BreadcrumbItem[];
  /** Optional custom Schema.org JSON-LD object or array of objects */
  schema?: object | object[];
}

// One canonical host. Every other NESAM domain (see SUPPORTED_DOMAINS) redirects here with a 301 (vercel.json), so search engines
// see a single site, one sitemap and one robots.txt. The apex nesamcabs.com is redirected to www by the hosting.
export const PRIMARY_DOMAIN = 'www.nesamcabs.com';
export const PRIMARY_BASE_URL = 'https://www.nesamcabs.com';
export const BASE_URL = PRIMARY_BASE_URL;

export const SUPPORTED_DOMAINS = [
  'nesamcabs.com',
  'nesamcabs.in',
  'nesamtravels.com',
  'nesamtravels.in',
  'nesamtoursandtravels.com',
  'nesamtoursandtravels.in',
] as const;

export type SupportedDomain = (typeof SUPPORTED_DOMAINS)[number];

export const ALL_BRAND_URLS: string[] = SUPPORTED_DOMAINS.map((d) => `https://${d}/`);

/** The canonical host: other domains redirect to it, so canonical URLs never follow the visitor's host. */
export function getActiveDomain(): string {
  return PRIMARY_DOMAIN;
}

export function getActiveBaseUrl(): string {
  return PRIMARY_BASE_URL;
}

export const DEFAULT_DESCRIPTION =
  'Book outstation cabs, one-way drop taxis & round trips across Tamil Nadu, Bangalore & Pondicherry. Verified drivers, clean AC cars, upfront fares & 24/7 customer support.';
export const DEFAULT_KEYWORDS =
  'one way drop taxi, outstation cabs tamil nadu, drop taxi chennai, chennai to pondicherry cab, chennai to bangalore taxi, coimbatore to ooty cab, madurai outstation cabs, trichy drop taxi, intercity cab booking, airport taxi chennai, drop taxi online booking, nesam cabs, nesam travels';
export const DEFAULT_OG_IMAGE = `${PRIMARY_BASE_URL}/website-images/web/heroes/hero-desktop.webp`;

function setMetaTag(attrName: 'name' | 'property', attrValue: string, content: string) {
  let element = document.querySelector(`meta[${attrName}="${attrValue}"]`) as HTMLMetaElement | null;
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attrName, attrValue);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function setCanonical(href: string) {
  let element = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', 'canonical');
    document.head.appendChild(element);
  }
  element.setAttribute('href', href);
}

function setAlternateTag(hreflang: string | null, href: string) {
  const selector = hreflang
    ? `link[rel="alternate"][hreflang="${hreflang}"]`
    : `link[rel="alternate"][data-multi-domain="true"][href="${href}"]`;
  let element = document.querySelector(selector) as HTMLLinkElement | null;
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', 'alternate');
    if (hreflang) {
      element.setAttribute('hreflang', hreflang);
    } else {
      element.setAttribute('data-multi-domain', 'true');
    }
    document.head.appendChild(element);
  }
  element.setAttribute('href', href);
}

function setDynamicSchema(schemaData: object | null) {
  const SCRIPT_ID = 'dynamic-page-schema';
  let element = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (!schemaData) {
    if (element) element.remove();
    return;
  }
  if (!element) {
    element = document.createElement('script');
    element.id = SCRIPT_ID;
    element.type = 'application/ld+json';
    document.head.appendChild(element);
  }
  element.textContent = JSON.stringify(schemaData, null, 2);
}

export function buildBreadcrumbSchema(breadcrumbs: BreadcrumbItem[], baseUrl?: string): object {
  const base = baseUrl || getActiveBaseUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbs.map((b, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: b.name,
      item: b.path.startsWith('http') ? b.path : `${base}${b.path.startsWith('/') ? b.path : `/${b.path}`}`,
    })),
  };
}

export function updateSeo({
  title,
  description,
  keywords,
  canonical,
  noindex,
  ogImage,
  breadcrumbs,
  schema,
}: SeoProps): void {
  const activeBaseUrl = getActiveBaseUrl();
  const fullTitle = title.includes('NESAM') ? title : `${title} · NESAM Cabs`;
  const fullDescription = description || DEFAULT_DESCRIPTION;
  const fullKeywords = keywords || DEFAULT_KEYWORDS;

  // Normalize path from canonical
  const relativePath = canonical
    ? canonical.startsWith('http')
      ? canonical.replace(/^https?:\/\/[^/]+/, '')
      : canonical.startsWith('/')
      ? canonical
      : `/${canonical}`
    : '/';

  // Canonical URL matches active domain or explicitly passed absolute URL
  const canonicalUrl =
    canonical && canonical.startsWith('http')
      ? canonical
      : `${activeBaseUrl}${relativePath}`;

  const image = ogImage || DEFAULT_OG_IMAGE;

  // Title
  document.title = fullTitle;

  // Primary Meta Tags
  setMetaTag('name', 'title', fullTitle);
  setMetaTag('name', 'description', fullDescription);
  setMetaTag('name', 'keywords', fullKeywords);
  setMetaTag(
    'name',
    'robots',
    noindex
      ? 'noindex, nofollow'
      : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
  );

  // Canonical Link
  setCanonical(canonicalUrl);

  // Language alternates: one canonical site serves every language.
  const cleanPath = relativePath === '/' ? '' : relativePath;
  setAlternateTag('x-default', `${PRIMARY_BASE_URL}${cleanPath || '/'}`);
  setAlternateTag('en-IN', `${PRIMARY_BASE_URL}${cleanPath || '/'}`);

  // Open Graph
  setMetaTag('property', 'og:title', fullTitle);
  setMetaTag('property', 'og:description', fullDescription);
  setMetaTag('property', 'og:url', canonicalUrl);
  setMetaTag('property', 'og:image', image);

  // Twitter Cards
  setMetaTag('name', 'twitter:title', fullTitle);
  setMetaTag('name', 'twitter:description', fullDescription);
  setMetaTag('name', 'twitter:image', image);

  // Dynamic Schema.org injection
  const schemaList: object[] = [];
  if (breadcrumbs && breadcrumbs.length > 0) {
    schemaList.push(buildBreadcrumbSchema(breadcrumbs, activeBaseUrl));
  }
  if (schema) {
    if (Array.isArray(schema)) {
      schemaList.push(...schema);
    } else {
      schemaList.push(schema);
    }
  }

  if (schemaList.length === 1) {
    setDynamicSchema(schemaList[0]);
  } else if (schemaList.length > 1) {
    setDynamicSchema({
      '@context': 'https://schema.org',
      '@graph': schemaList,
    });
  } else {
    setDynamicSchema(null);
  }
}

/**
 * Hook to manage page titles, meta descriptions, canonical URLs, robots directives, and JSON-LD structured data.
 */
export function useSeo(props: SeoProps): void {
  useEffect(() => {
    updateSeo(props);
    return () => {
      // Clean up dynamic schema on unmount
      const el = document.getElementById('dynamic-page-schema');
      if (el) el.remove();
    };
  }, [
    props.title,
    props.description,
    props.keywords,
    props.canonical,
    props.noindex,
    props.ogImage,
    JSON.stringify(props.breadcrumbs),
    JSON.stringify(props.schema),
  ]);
}
