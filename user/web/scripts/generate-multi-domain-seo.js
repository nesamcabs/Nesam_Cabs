/**
 * Multi-Domain SEO Generator for NESAM Cabs / NESAM Travels
 * Generates sitemaps, robots.txt, and sitemap indexes for all 6 official domains:
 *  1. nesamcabs.com
 *  2. nesamcabs.in
 *  3. nesamtravels.com
 *  4. nesamtravels.in
 *  5. nesamtoursandtravels.com
 *  6. nesamtoursandtravels.in
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const SITEMAPS_DIR = path.resolve(PUBLIC_DIR, 'sitemaps');
const ROBOTS_DIR = path.resolve(PUBLIC_DIR, 'robots');

const TODAY = new Date().toISOString().split('T')[0];

export const DOMAINS = [
  { domain: 'www.nesamcabs.com', name: 'NESAM Cabs', tld: 'com', isPrimary: true },
  { domain: 'nesamcabs.in', name: 'NESAM Cabs India', tld: 'in' },
  { domain: 'nesamtravels.com', name: 'NESAM Travels', tld: 'com' },
  { domain: 'nesamtravels.in', name: 'NESAM Travels India', tld: 'in' },
  { domain: 'nesamtoursandtravels.com', name: 'NESAM Tours and Travels', tld: 'com' },
  { domain: 'nesamtoursandtravels.in', name: 'NESAM Tours and Travels India', tld: 'in' },
];

export const URL_ENTRIES = [
  {
    path: '',
    changefreq: 'daily',
    priority: '1.0',
    comment: 'Homepage: NESAM Cabs Online Outstation & Drop Taxi',
    images: [
      {
        loc: '/website-images/web/heroes/hero-desktop.webp',
        title: 'NESAM Cabs Outstation Taxi Service Tamil Nadu',
        caption: 'Outstation cabs, one-way drop taxis and intercity round trips across Tamil Nadu, Bangalore and Pondicherry with upfront fares',
      },
      {
        loc: '/brand/logo.png',
        title: 'NESAM Cabs Official Logo',
      },
    ],
  },
  {
    path: 'book',
    changefreq: 'daily',
    priority: '0.95',
    comment: 'Booking Engine Entrypoint',
    images: [
      {
        loc: '/website-images/web/heroes/hero-family.webp',
        title: 'Book Outstation Taxi with NESAM Cabs',
        caption: 'Plan and book intercity one-way and round-trip journeys with verified commercial drivers',
      },
      {
        loc: '/website-images/web/vehicles/sedan.webp',
        title: 'NESAM AC Sedan Taxi Fleet',
      },
      {
        loc: '/website-images/web/vehicles/suv.webp',
        title: 'NESAM AC SUV Taxi Fleet',
      },
    ],
  },
  {
    path: 'offers',
    changefreq: 'weekly',
    priority: '0.80',
    comment: 'Special Offers & Promo Codes',
    images: [
      {
        loc: '/website-images/web/backgrounds/offer-background.webp',
        title: 'NESAM Cabs Promo Codes and Offers',
      },
    ],
  },
  {
    path: 'support',
    changefreq: 'monthly',
    priority: '0.70',
    comment: '24/7 Customer Support & Help Desk',
    images: [
      {
        loc: '/website-images/web/photography/trust-support.webp',
        title: 'NESAM Customer Care Support 24/7',
      },
    ],
  },
  {
    path: 'about',
    changefreq: 'yearly',
    priority: '0.40',
    comment: 'About NESAM Cabs',
  },
  {
    path: 'legal',
    changefreq: 'monthly',
    priority: '0.50',
    comment: 'Legal, Terms of Service & Privacy Policy',
  },
  {
    path: 'services/one-way-drop-taxi',
    changefreq: 'weekly',
    priority: '0.90',
    comment: 'Travel Service: One-Way Drop Taxi',
    images: [
      {
        loc: '/website-images/web/photography/service-one-way.webp',
        title: 'One Way Drop Taxi Across Tamil Nadu',
        caption: 'Pay only for one-way distance between cities with zero return fare charges',
      },
    ],
  },
  {
    path: 'services/outstation-round-trip',
    changefreq: 'weekly',
    priority: '0.90',
    comment: 'Travel Service: Outstation Round Trips',
    images: [
      {
        loc: '/website-images/web/photography/service-round-trip.webp',
        title: 'Outstation Round Trip Car Rentals with Driver',
        caption: 'Multi-day outstation car rentals with dedicated driver and calendar day billing',
      },
    ],
  },
  {
    path: 'services/airport-taxi',
    changefreq: 'weekly',
    priority: '0.90',
    comment: 'Travel Service: Airport Transfers',
    images: [
      {
        loc: '/website-images/web/photography/service-airport.webp',
        title: 'Airport Taxi Transfers in South India',
        caption: 'Guaranteed on-time pickups for Chennai (MAA), Bangalore (BLR), Coimbatore (CJB), Madurai (IXM), and Trichy (TRZ)',
      },
    ],
  },
  {
    path: 'services/local-rental',
    changefreq: 'weekly',
    priority: '0.85',
    comment: 'Travel Service: Local Hourly Rental',
    images: [
      {
        loc: '/website-images/web/photography/service-corporate.webp',
        title: 'Hourly Local Car Rental with Driver',
        caption: 'Vehicle and driver at your disposal by the hour within city limits',
      },
    ],
  },
  {
    path: 'services/pilgrimage-tours',
    changefreq: 'weekly',
    priority: '0.85',
    comment: 'Travel Service: Pilgrimage Tours',
    images: [
      {
        loc: '/website-images/web/photography/service-pilgrimage.webp',
        title: 'Tamil Nadu Temple Tours & Pilgrimage Taxi Packages',
        caption: 'Sacred pilgrimage circuits to Rameshwaram, Tirupati Balaji, Madurai Meenakshi, and Navagraha temples',
      },
    ],
  },
  {
    path: 'routes/chennai-to-pondicherry',
    changefreq: 'weekly',
    priority: '0.88',
    comment: 'Popular Corridor: Chennai to Pondicherry Drop Taxi',
    images: [
      {
        loc: '/website-images/web/destinations/route-chennai-pondicherry.webp',
        title: 'Chennai to Pondicherry One Way Drop Taxi',
        caption: '150 km road journey, approx 3 hr 10 min along the scenic East Coast Road (ECR). Zero return fare.',
      },
    ],
  },
  {
    path: 'routes/chennai-to-bangalore',
    changefreq: 'weekly',
    priority: '0.88',
    comment: 'Popular Corridor: Chennai to Bangalore Outstation Cab',
    images: [
      {
        loc: '/website-images/web/destinations/route-chennai-bangalore.webp',
        title: 'Chennai to Bangalore Outstation Cab',
        caption: '345 km highway trip, approx 6 hr with verified commercial driver via NH-48.',
      },
    ],
  },
  {
    path: 'routes/coimbatore-to-ooty',
    changefreq: 'weekly',
    priority: '0.88',
    comment: 'Popular Corridor: Coimbatore to Ooty Cab',
    images: [
      {
        loc: '/website-images/web/destinations/route-coimbatore-ooty.webp',
        title: 'Coimbatore to Ooty Hill Station Taxi',
        caption: '88 km scenic ghat road journey, approx 2 hr 50 min with certified mountain drivers.',
      },
    ],
  },
  {
    path: 'routes/madurai-to-rameshwaram',
    changefreq: 'weekly',
    priority: '0.88',
    comment: 'Popular Corridor: Madurai to Rameshwaram Pilgrimage Taxi',
    images: [
      {
        loc: '/website-images/web/destinations/route-madurai-rameshwaram.webp',
        title: 'Madurai to Rameshwaram Temple Tour Cab',
        caption: '172 km road trip, approx 3 hr 30 min across Pamban Sea Bridge to Ramanathaswamy Temple & Dhanushkodi.',
      },
    ],
  },
  {
    path: 'routes/bangalore-to-mysore',
    changefreq: 'weekly',
    priority: '0.85',
    comment: 'Popular Corridor: Bangalore to Mysore Expressway Cab',
    images: [
      {
        loc: '/website-images/web/destinations/route-chennai-bangalore.webp',
        title: 'Bangalore to Mysore 10-Lane Expressway Cab',
        caption: '142 km expressway trip, approx 2 hr 30 min to Mysore Palace and Chamundi Hills.',
      },
    ],
  },
  {
    path: 'routes/trichy-to-thanjavur',
    changefreq: 'weekly',
    priority: '0.82',
    comment: 'Popular Corridor: Trichy to Thanjavur Heritage Taxi',
    images: [
      {
        loc: '/website-images/web/destinations/destination-thanjavur.webp',
        title: 'Trichy to Thanjavur Big Temple Heritage Taxi',
        caption: '58 km drive, approx 1 hr 10 min to UNESCO World Heritage Brihadisvara Temple.',
      },
    ],
  },
  {
    path: 'routes/salem-to-yercaud',
    changefreq: 'weekly',
    priority: '0.82',
    comment: 'Popular Corridor: Salem to Yercaud Hill Station Taxi',
    images: [
      {
        loc: '/website-images/web/destinations/destination-coimbatore.webp',
        title: 'Salem to Yercaud 20 Hairpin Bends Hill Taxi',
        caption: '32 km mountain drive, approx 1 hr to Yercaud Lake and Shevaroy Hills.',
      },
    ],
  },
  {
    path: 'routes/chennai-to-tirupati',
    changefreq: 'weekly',
    priority: '0.85',
    comment: 'Popular Corridor: Chennai to Tirupati Balaji Cab',
    images: [
      {
        loc: '/website-images/web/destinations/destination-chennai.webp',
        title: 'Chennai to Tirupati Balaji Pilgrimage Taxi',
        caption: '138 km pilgrimage transit, approx 3 hr with Andhra Pradesh inter-state permit support.',
      },
    ],
  },
];

function generateDomainSitemap(domainObj) {
  const domain = domainObj.domain;
  const baseUrl = `https://${domain}`;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n`;
  xml += `        xmlns:xhtml="http://www.w3.org/1999/xhtml"\n`;
  xml += `        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`;

  for (const entry of URL_ENTRIES) {
    const pageUrl = entry.path ? `${baseUrl}/${entry.path}` : `${baseUrl}/`;
    xml += `  <!-- ${entry.comment} -->\n`;
    xml += `  <url>\n`;
    xml += `    <loc>${pageUrl}</loc>\n`;
    xml += `    <lastmod>${TODAY}</lastmod>\n`;
    xml += `    <changefreq>${entry.changefreq}</changefreq>\n`;
    xml += `    <priority>${entry.priority}</priority>\n`;

    if (entry.images && entry.images.length > 0) {
      for (const img of entry.images) {
        xml += `    <image:image>\n`;
        xml += `      <image:loc>${baseUrl}${img.loc}</image:loc>\n`;
        if (img.title) xml += `      <image:title>${escapeXml(img.title)}</image:title>\n`;
        if (img.caption) xml += `      <image:caption>${escapeXml(img.caption)}</image:caption>\n`;
        xml += `    </image:image>\n`;
      }
    }

    xml += `  </url>\n\n`;
  }

  xml += `</urlset>\n`;
  return xml;
}

function generateSitemapIndex() {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  for (const d of DOMAINS) {
    const slug = d.domain.replace(/\./g, '-');
    xml += `  <!-- Sitemap for ${d.domain} (${d.name}) -->\n`;
    xml += `  <sitemap>\n`;
    xml += `    <loc>https://${d.domain}/sitemaps/sitemap-${slug}.xml</loc>\n`;
    xml += `    <lastmod>${TODAY}</lastmod>\n`;
    xml += `  </sitemap>\n`;
  }

  xml += `</sitemapindex>\n`;
  return xml;
}

function generateDomainRobots(domainObj) {
  const domain = domainObj.domain;
  return `# Robots.txt for ${domainObj.name} (https://${domain})
# Configured for maximum search engine visibility and crawl efficiency

User-agent: Googlebot
Allow: /
Allow: /book
Allow: /routes/
Allow: /routes/*
Allow: /services/
Allow: /services/*
Allow: /offers
Allow: /support
Allow: /legal
Allow: /about
Allow: /assets/
Allow: /website-images/
Allow: /vehicles/
Allow: /art/
Allow: /brand/
Disallow: /account/
Disallow: /account/*
Disallow: /trips/
Disallow: /trips/*
Disallow: /ride/
Disallow: /ride/*
Disallow: /notifications
Disallow: /book/ride
Disallow: /book/confirm

User-agent: Bingbot
Allow: /
Allow: /book
Allow: /routes/
Allow: /routes/*
Allow: /services/
Allow: /services/*
Allow: /offers
Allow: /support
Allow: /legal
Allow: /about
Disallow: /account/
Disallow: /account/*
Disallow: /trips/
Disallow: /trips/*
Disallow: /ride/
Disallow: /ride/*
Disallow: /notifications
Disallow: /book/ride
Disallow: /book/confirm

User-agent: Applebot
Allow: /
Allow: /book
Allow: /routes/
Allow: /routes/*
Allow: /services/
Allow: /services/*
Disallow: /account/
Disallow: /trips/
Disallow: /ride/
Disallow: /notifications

User-agent: *
Allow: /
Allow: /book
Allow: /routes/
Allow: /routes/*
Allow: /services/
Allow: /services/*
Allow: /offers
Allow: /support
Allow: /legal
Allow: /about
Allow: /assets/
Allow: /website-images/
Allow: /vehicles/
Allow: /art/
Allow: /brand/
Disallow: /account/
Disallow: /account/*
Disallow: /trips/
Disallow: /trips/*
Disallow: /ride/
Disallow: /ride/*
Disallow: /notifications
Disallow: /book/ride
Disallow: /book/confirm

# Sitemap Directives for Google Search Console & Bing Webmaster Tools
Sitemap: https://${domain}/sitemap.xml
`;
}

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

export function generateAll() {
  // One site: www.nesamcabs.com. The other NESAM domains redirect to it (vercel.json), so there is one sitemap and one robots.txt,
  // written at the site root where search engines look for them.
  const primary = DOMAINS.find((d) => d.isPrimary) ?? DOMAINS[0];
  console.log(`Generating SEO assets for ${primary.domain}...`);

  fs.writeFileSync(path.join(PUBLIC_DIR, 'sitemap.xml'), generateDomainSitemap(primary), 'utf-8');
  console.log('  ✓ Generated sitemap: public/sitemap.xml');
  fs.writeFileSync(path.join(PUBLIC_DIR, 'robots.txt'), generateDomainRobots(primary), 'utf-8');
  console.log('  ✓ Generated robots.txt: public/robots.txt');

  // Older per-domain files and the sitemap index are no longer used.
  for (const dir of [SITEMAPS_DIR, ROBOTS_DIR]) fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(path.join(PUBLIC_DIR, 'sitemap-index.xml'), { force: true });

  console.log('SEO asset generation complete.');
}

// Execute if run directly
generateAll();

