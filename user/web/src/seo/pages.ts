// What each public page tells search engines. The pages call useSeo() with these, and the build
// writes the same tags into each page's prerendered HTML — one source for both.
import { FAQS } from '../pages/book/content';
import type { RouteCorridorDetail } from '../pages/routes/routesData';
import type { ServiceDetail } from '../pages/services/servicesData';
import { PRIMARY_BASE_URL, type SeoProps } from '@/lib/seo';

const absoluteUrl = (path: string): string => (/^https?:\/\//.test(path) ? path : `${PRIMARY_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`);
const faqSchema = (faqs: ReadonlyArray<{ q: string; a: string }>): object => ({
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
});

export const HOME_SEO: SeoProps = {
  title: 'NESAM Cabs — Outstation Cabs & One Way Drop Taxi in Tamil Nadu | Upfront Fares',
  description:
    'Book outstation cabs, one-way drop taxis & round trips across Tamil Nadu, Bangalore & Pondicherry. Verified drivers, clean AC cars, upfront fares & 24/7 support.',
  keywords:
    'one way drop taxi, outstation cabs tamil nadu, drop taxi chennai, chennai to pondicherry cab, chennai to bangalore taxi, coimbatore to ooty cab, madurai outstation cabs, trichy drop taxi, intercity cab booking, airport taxi chennai, drop taxi online booking, nesam cabs, nesam travels',
  canonical: '/',
  schema: faqSchema(FAQS),
};

export const OFFERS_SEO: SeoProps = {
  title: 'Offers, Coupons & Promo Codes',
  description:
    'Save on your next outstation cab or drop taxi booking with NESAM Cabs promo codes, festive discounts and new user coupons.',
  canonical: '/offers',
};

export const SUPPORT_SEO: SeoProps = {
  title: 'Customer Support & 24/7 Helpline',
  description: 'Need help with your outstation cab booking? Call NESAM Cabs at +91 90250 99990 or submit a ticket. Fast 24/7 assistance across Tamil Nadu.',
  canonical: '/support',
};

export const ABOUT_SEO: SeoProps = {
  title: 'About NESAM Cabs',
  description: 'NESAM Tours and Travels Private Limited — outstation cabs, one-way drop taxis, round trips, airport transfers and local rentals across Tamil Nadu and South India.',
  canonical: '/about',
};

export const LEGAL_SEO: SeoProps = {
  title: 'Terms of Service & Privacy Policy',
  description: 'Read the official terms and conditions, customer privacy policy, fare transparency rules and cancellation guidelines for NESAM Cabs.',
  canonical: '/legal',
};

export function routeSeo(r: RouteCorridorDetail): SeoProps {
  const path = `/routes/${r.slug}`;
  return {
    title: r.title,
    description: r.metaDescription,
    keywords: r.keywords,
    canonical: path,
    ogImage: r.image,
    ogImageAlt: `${r.origin} to ${r.destination} taxi`,
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: `${r.origin} to ${r.destination}`, path },
    ],
    schema: [
      {
        '@type': 'TaxiService',
        name: r.h1,
        description: r.summary,
        url: absoluteUrl(path),
        provider: { '@id': `${PRIMARY_BASE_URL}/#business` },
        areaServed: [
          { '@type': 'City', name: r.origin },
          { '@type': 'City', name: r.destination },
        ],
      },
      faqSchema(r.faqs),
    ],
  };
}

export function serviceSeo(s: ServiceDetail): SeoProps {
  const path = `/services/${s.slug}`;
  return {
    title: s.title,
    description: s.metaDescription,
    keywords: s.keywords,
    canonical: path,
    ogImage: s.image,
    ogImageAlt: s.h1,
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: s.h1, path },
    ],
    schema: [
      {
        '@type': 'TaxiService',
        name: s.h1,
        description: s.metaDescription,
        url: absoluteUrl(path),
        provider: { '@id': `${PRIMARY_BASE_URL}/#business` },
        areaServed: { '@type': 'State', name: 'Tamil Nadu' },
      },
      faqSchema(s.faqs),
    ],
  };
}
