# Multi-Domain Google Search Console (GSC) Setup & Master SEO Guide

> **Enterprise Multi-Domain Configuration for NESAM Cabs & Travels**  
> **Brand Entity:** NESAM Tours and Travels Private Limited  
> **Last Updated:** October 2026

---

## 1. Overview of the 6 Connected Domains

NESAM operates across 6 official domains representing brand variations, service aliases, and top-level country targeting:

| # | Domain | Role & Purpose | Target Audience | Primary Sitemap |
|---|--------|----------------|-----------------|-----------------|
| **1** | **`nesamcabs.com`** | **Primary Authority & Master Canonical** | Global / India Nationwide | `https://nesamcabs.com/sitemap.xml` |
| **2** | **`nesamcabs.in`** | **India ccTLD (Regional Powerhouse)** | Tamil Nadu, South India & Domestic | `https://nesamcabs.in/sitemap.xml` |
| **3** | **`nesamtravels.com`** | Brand Mirror & Tourism Portal | Intercity Travelers & Tourists | `https://nesamtravels.com/sitemap.xml` |
| **4** | **`nesamtravels.in`** | Regional Brand Mirror | South India Road Travelers | `https://nesamtravels.in/sitemap.xml` |
| **5** | **`nesamtoursandtravels.com`** | Corporate Legal Entity Domain | Corporate, Pilgrimage & Long Rentals | `https://nesamtoursandtravels.com/sitemap.xml` |
| **6** | **`nesamtoursandtravels.in`** | Corporate Regional Domain | Tamil Nadu Corporate & Temple Tours | `https://nesamtoursandtravels.in/sitemap.xml` |

---

## 2. Technical Multi-Domain SEO Architecture Built into the Platform

To ensure Google Search indexes your properties without duplicate content penalties or keyword cannibalization, our platform has been equipped with enterprise multi-domain SEO infrastructure:

### A. Host-Header Smart Routing (Vercel Edge)
- When Googlebot visits `https://nesamcabs.in/sitemap.xml`, Vercel automatically routes the request to `public/sitemaps/sitemap-nesamcabs-in.xml`.
- When Googlebot visits `https://nesamcabs.in/robots.txt`, Vercel automatically routes the request to `public/robots/robots-nesamcabs-in.txt`.
- Every domain receives a tailored sitemap whose `<loc>` tags match that exact domain, satisfying Google Search Console's strict domain scope validation.

### B. Consolidated Schema.org Knowledge Graph (`sameAs`)
Both static HTML (`index.html`) and client-side page updates (`seo.ts`) inject Schema.org JSON-LD structured data linking all 6 domains:
```json
{
  "@context": "https://schema.org",
  "@type": ["TaxiService", "LocalBusiness", "AutoRental"],
  "@id": "https://nesamcabs.com/#service",
  "name": "NESAM Cabs",
  "legalName": "NESAM Tours and Travels Private Limited",
  "alternateName": [
    "NESAM Travels",
    "NESAM Drop Taxi",
    "NESAM Outstation Cabs",
    "NESAM Tours and Travels",
    "NESAM Cabs India",
    "NESAM Travels India"
  ],
  "sameAs": [
    "https://nesamcabs.com/",
    "https://nesamcabs.in/",
    "https://nesamtravels.com/",
    "https://nesamtravels.in/",
    "https://nesamtoursandtravels.com/",
    "https://nesamtoursandtravels.in/"
  ]
}
```
*Why this matters:* Google's search algorithms recognize that all 6 websites belong to the single legitimate business entity, pooling authority rather than splitting it.

### C. Multilingual & Regional Alternate Tags (`hreflang`)
All pages and XML sitemaps specify cross-domain alternates:
- `x-default`: `https://nesamcabs.com/` (Default international fallback)
- `en-IN`: `https://nesamcabs.in/` (English speakers in India)
- `ta-IN`: `https://nesamcabs.in/` (Tamil regional audience)
- Cross-domain self/alternate links linking all 6 domains for every route (`/book`, `/routes/:id`, `/services/:id`, etc.).

---

## 3. How to Add and Verify All 6 Domains in Google Search Console

Follow these steps to add and verify all 6 properties in [Google Search Console](https://search.google.com/search-console).

### Step 1: Open Google Search Console
1. Go to [https://search.google.com/search-console](https://search.google.com/search-console).
2. Sign in with your primary business Google Workspace / Gmail account.
3. In the top-left property dropdown, click **+ Add property**.

---

### Step 2: Choose Property Type

Google Search Console offers two property types:

#### Option A: Domain Property (Recommended — One Verification per Root Domain)
- Best for verifying `nesamcabs.com`, `nesamcabs.in`, `nesamtravels.com`, `nesamtravels.in`, `nesamtoursandtravels.com`, and `nesamtoursandtravels.in`.
- Covers `http://`, `https://`, `www.`, and all subdomains automatically.
- **Verification Method:** DNS TXT Record.

**DNS TXT Records to Add to your DNS Registrar (GoDaddy, Cloudflare, Namecheap, etc.):**

| Domain | DNS Host / Name | Type | Value (Provided by Google) |
|--------|-----------------|------|----------------------------|
| `nesamcabs.com` | `@` | TXT | `google-site-verification=YOUR_TOKEN_HERE` |
| `nesamcabs.in` | `@` | TXT | `google-site-verification=YOUR_TOKEN_HERE` |
| `nesamtravels.com` | `@` | TXT | `google-site-verification=YOUR_TOKEN_HERE` |
| `nesamtravels.in` | `@` | TXT | `google-site-verification=YOUR_TOKEN_HERE` |
| `nesamtoursandtravels.com` | `@` | TXT | `google-site-verification=YOUR_TOKEN_HERE` |
| `nesamtoursandtravels.in` | `@` | TXT | `google-site-verification=YOUR_TOKEN_HERE` |

*(DNS propagation typically takes 2 to 15 minutes. Once added, click "Verify" in GSC).*

---

#### Option B: URL Prefix Property (HTML Meta Tag Method)
If you prefer instant verification without modifying DNS:
1. Select **URL prefix** in Google Search Console.
2. Enter the full URL, for example: `https://nesamcabs.com/`.
3. Select **HTML tag** as the verification method.
4. Copy the `content="..."` value from the provided meta tag.
5. You can set this token in your environment or code in two easy ways:
   - **Environment Variable:** Set `VITE_GOOGLE_SITE_VERIFICATION=your_copied_token` in your deployment or `.env`.
   - **Direct in HTML:** Replace `%VITE_GOOGLE_SITE_VERIFICATION%` in `user/web/index.html` with your token.
6. Click **Verify** in Google Search Console.

---

## 4. Submitting Sitemaps for Each Property in GSC

Once verified, you must submit the dedicated sitemap for each property. In the GSC left menu, navigate to **Indexing > Sitemaps** and submit:

### Property 1: `https://nesamcabs.com/` (or `nesamcabs.com` Domain Property)
- **Submit:** `sitemap.xml`
- **Optional/Secondary:** `sitemaps/sitemap-nesamcabs-com.xml`
- **Global Index:** `sitemap-index.xml`

### Property 2: `https://nesamcabs.in/` (or `nesamcabs.in` Domain Property)
- **Submit:** `sitemap.xml`
- **Direct Link:** `sitemaps/sitemap-nesamcabs-in.xml`

### Property 3: `https://nesamtravels.com/` (or `nesamtravels.com` Domain Property)
- **Submit:** `sitemap.xml`
- **Direct Link:** `sitemaps/sitemap-nesamtravels-com.xml`

### Property 4: `https://nesamtravels.in/` (or `nesamtravels.in` Domain Property)
- **Submit:** `sitemap.xml`
- **Direct Link:** `sitemaps/sitemap-nesamtravels-in.xml`

### Property 5: `https://nesamtoursandtravels.com/` (or `nesamtoursandtravels.com` Domain Property)
- **Submit:** `sitemap.xml`
- **Direct Link:** `sitemaps/sitemap-nesamtoursandtravels-com.xml`

### Property 6: `https://nesamtoursandtravels.in/` (or `nesamtoursandtravels.in` Domain Property)
- **Submit:** `sitemap.xml`
- **Direct Link:** `sitemaps/sitemap-nesamtoursandtravels-in.xml`

---

## 5. Master Sitemaps Directory Reference

All generated sitemaps and robots files are permanently located in `user/web/public/`:

```
user/web/public/
├── robots.txt                                      (Root primary robots.txt)
├── sitemap.xml                                     (Root primary sitemap)
├── sitemap-index.xml                               (Root global sitemap index)
├── robots/
│   ├── robots-nesamcabs-com.txt                    (nesamcabs.com crawler rules)
│   ├── robots-nesamcabs-in.txt                     (nesamcabs.in crawler rules)
│   ├── robots-nesamtravels-com.txt                 (nesamtravels.com crawler rules)
│   ├── robots-nesamtravels-in.txt                  (nesamtravels.in crawler rules)
│   ├── robots-nesamtoursandtravels-com.txt         (nesamtoursandtravels.com crawler rules)
│   └── robots-nesamtoursandtravels-in.txt          (nesamtoursandtravels.in crawler rules)
└── sitemaps/
    ├── sitemap-index.xml                           (Global master index of all 6 sitemaps)
    ├── sitemap-nesamcabs-com.xml                   (18 URLs + Images + Hreflang)
    ├── sitemap-nesamcabs-in.xml                    (18 URLs + Images + Hreflang)
    ├── sitemap-nesamtravels-com.xml                (18 URLs + Images + Hreflang)
    ├── sitemap-nesamtravels-in.xml                 (18 URLs + Images + Hreflang)
    ├── sitemap-nesamtoursandtravels-com.xml        (18 URLs + Images + Hreflang)
    └── sitemap-nesamtoursandtravels-in.xml         (18 URLs + Images + Hreflang)
```

---

## 6. How to Re-generate Sitemaps Automatically

Whenever new routes, services, or pages are added:
```bash
cd "user/web"
npm run build:seo
```
This script (`scripts/generate-multi-domain-seo.js`) automatically regenerates all 6 XML sitemaps, all 6 robots files, and the global sitemap index in seconds. It also runs automatically as part of `npm run build`.

---

## 7. High-Priority URLs to Inspect and Request Indexing First

After sitemaps are submitted, use the **URL Inspection** tool at the top of Google Search Console on your primary property (`nesamcabs.com` and `nesamcabs.in`) and click **"Request Indexing"** on these top revenue corridors:

1. `https://nesamcabs.com/` (Homepage)
2. `https://nesamcabs.com/book` (Booking Engine)
3. `https://nesamcabs.com/services/one-way-drop-taxi` (High intent service)
4. `https://nesamcabs.com/services/outstation-round-trip` (High value service)
5. `https://nesamcabs.com/services/airport-taxi` (High frequency transit)
6. `https://nesamcabs.com/routes/chennai-to-pondicherry` (Top searched corridor)
7. `https://nesamcabs.com/routes/chennai-to-bangalore` (Top interstate corridor)
8. `https://nesamcabs.com/routes/coimbatore-to-ooty` (Top tourism corridor)
9. `https://nesamcabs.com/routes/madurai-to-rameshwaram` (Top pilgrimage corridor)
10. `https://nesamcabs.com/routes/chennai-to-tirupati` (Top darshan corridor)

---

## 8. Ongoing Search Console Monitoring & Maintenance

| Feature | Where in GSC | What to Look For | Healthy Status |
|---------|--------------|------------------|----------------|
| **Page Indexing** | Indexing > Pages | "Submitted and indexed" vs "Excluded" | Steady upward trend of indexed pages |
| **Sitemaps** | Indexing > Sitemaps | "Success" status on `sitemap.xml` | Green "Success" badge |
| **Search Queries** | Performance > Search results | Clicks, impressions, CTR, average position for keywords like "drop taxi chennai", "one way cab tamil nadu" | Growing impressions and ranking for commercial keywords |
| **Core Web Vitals** | Experience > Core Web Vitals | LCP < 2.5s, INP < 200ms, CLS < 0.1 | 100% "Good" URLs (Preconnects & WebP images preconfigured) |
| **Rich Results** | Enhancements | Structured Data (LocalBusiness, Sitelinks Searchbox, Breadcrumbs, FAQs) | 0 errors, valid items detected |

---

*NESAM Cabs & Travels SEO Architecture is production-ready for immediate indexing across all 6 target domains.*

