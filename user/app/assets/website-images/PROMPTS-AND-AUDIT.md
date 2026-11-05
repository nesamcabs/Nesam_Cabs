# NESAM Travels — website image audit and generation prompts

Prepared 15 October 2026. Scope: customer website in `user/web`, existing local visual collection, and selected public competitor pages. This is a source-based website audit and public-page content review, not a browser-tested responsive or signed-in competitor audit. No live NESAM URL was supplied. This is a representative competitor review, not an exhaustive review of every competitor or every page.

## 1. What the current website actually needs

NESAM is positioned around Tamil Nadu outstation and intercity travel, one-way drops and round trips, with advance pickup scheduling. The current site uses red #E31E24, charcoal #17171C, warm white #FFFCFA and Poppins typography.

The customer application currently puts authentication before all main routes. The root redirects to `/book`. There is no separate public marketing homepage in this application. A public hero, service pages and destination pages are proposed extensions, not existing page slots.

| Area | Current implementation | Image decision |
|---|---|---|
| Sign in / OTP / profile setup | Existing illustrated authentication panel | Reuse welcome, phone-verification and profile-setup art; optionally improve consistency |
| Booking introduction | Centered headline and badge; no photographic hero | Create a desktop and mobile hero if introducing a photo section; keep booking fields on an opaque readable surface |
| Fleet tariff cards | Text cards for sedan, SUV and Innova Crysta | Add consistent vehicle cutouts if desired; reuse existing categories first |
| Choose vehicle / review / trips | Vehicle category images already used | Keep the existing eight-category image family |
| Popular corridors | Four text cards: Chennai–Pondicherry, Chennai–Bangalore, Coimbatore–Ooty, Madurai–Rameshwaram | Four destination photographs are the clearest new image opportunity |
| Why travel with NESAM | Text and check/star/snowflake/phone symbols | Replace those four symbols with existing matching SVG icons; new raster icons are unnecessary |
| Operations desk | Text and call button | Optional small support illustration; existing support art can serve |
| Trips, notifications, offers, saved places, payments | Existing empty-state illustrations | Reuse, rather than create duplicates |
| Live ride | Operational status, trip data and tracking | Use real trip information and real map tiles; do not generate a navigation map |
| Account / edit profile | Uploaded avatar or initials | Use actual user photo or initials; no synthetic customer identity needed |
| Legal / fares / receipts | Readable information | No decorative hero required |

The local package `output/nesam-visual-assets` reports 106 vector icons across panels, 54 illustrations, eight vehicle cutouts, ten photographs, three authentication hero illustrations and other supporting assets. The customer web source contains 76 SVG icon files, eight vehicle WebP files and 18 art WebP files. Package counts and website integration counts are different. Its photography contact sheet was visually inspected; individual full-resolution images were not all inspected. Existing photography is fairly generic, so new route-specific images and deliberately composed hero art would add more value than another complete asset pack.

Priority order: (1) reuse and standardize existing assets, (2) main hero desktop/mobile, (3) four corridor photographs, (4) any fleet category whose existing art fails visual review, (5) optional service and trust photography for new sections.

## 2. Competitor findings and implications

These observations concern retrieved public content and image slots. They do not claim measured conversion performance or pixel-level design comparisons.

| Competitor and pages reviewed | Observed pattern | Implication for NESAM |
|---|---|---|
| [Savaari homepage](https://www.savaari.com/) | Main banner, journey-type booking controls, service images for round trips, one-way drops, local rentals and airport transfers; cleanliness, billing and chauffeurs emphasized | Give the hero one clear journey story; keep service photographs distinct; pair trust copy with relevant imagery |
| [DropTaxi homepage](https://www.droptaxi.in/) and [Chennai page](https://www.droptaxi.in/city/chennai) | Regional one-way/round-trip booking, popular-city image slots, local destinations and route relevance | Prioritize recognizable Tamil Nadu and nearby destinations over generic global travel pictures |
| [GozoCabs Chennai](https://www.gozocabs.com/car-rental/chennai-tamil-nadu) | Booking controls, fleet categories and sample vehicle images, airport and outstation use cases, practical fare information | Use a consistent vehicle catalogue and put prices, seat counts and terms in editable webpage text |
| [Uber Intercity India](https://www.uber.com/in/en/ride/intercity/) | Dedicated intercity proposition on a focused service page | Keep the image story about the journey and the traveler; avoid visually overcrowded promotional compositions |
| [MakeMyTrip cab offers](https://www.makemytrip.com/cabs/offers) | Separate offer cards for different trip purposes | If NESAM adds campaigns, generate flexible backgrounds and render actual offers as editable text |

The MakeMyTrip main cabs URL returned no readable page body in this research; its booking-page layout was not assessed. The offers page was readable. Competitor rates, ratings, guarantees and claims must not be transferred into NESAM artwork.

Recommended visual direction: believable South Indian road travel, clean white commercial vehicles, warm daylight, familiar places and restrained red accents. Use photography for travel inspiration, a consistent illustration family for app states, and actual SVG paths for functional icons. Avoid mixing toy-like 3D cars, flat cartoons and dramatic cinematic photos inside the same asset family.

## 3. How to use this prompt pack

The prompts are model-neutral. Generate one asset per request. For template tables, combine the complete template with exactly one row's subject; each row is a separate prompt. Upload an approved previous image as a style reference when the tool supports it. Dimensions below are delivery targets: generate at a supported native size, then crop and export appropriately.

Do not regenerate the NESAM logo. Add the supplied original logo separately in the website or design editor. Keep headings, phone numbers, prices, discounts, ratings, route labels and buttons outside generated artwork. Do not use generated people as customer testimonials or as portraits of actual NESAM staff. Generated locations are illustrative; for exact landmark architecture use a verified reference photograph and inspect the result.

**Photography suffix — append to every photographic prompt:**

> Authentic commercial travel photography for NESAM Travels, natural South Indian setting, realistic proportions and perspective, clean white vehicle where specified, restrained red accessories only, warm balanced daylight, natural skin texture, believable everyday clothing, crisp main subject, quiet background. No text, lettering, watermark, logo, price, rating, badge, collage, foreign yellow taxi, left-hand-drive interior, extra wheels, distorted hands, duplicated people or impossible reflections. Vehicles on roads should follow left-side traffic; visible interiors should be right-hand drive. Do not show anyone leaning out of a moving car. Keep seat belts visible where occupants are shown travelling.

**Illustration suffix — append to every illustration prompt:**

> Premium editorial illustration for NESAM Travels, softly shaded clean shapes, consistent three-quarter perspective, charcoal #17171C, warm ivory #FFFCFA, primary red #E31E24 as a restrained accent, minimal neutral supporting tones, generous negative space, no lettering or digits, no logo, no watermark, no interface screenshot, no photorealism, no neon, no glossy toy plastic. One isolated composition with transparent background, clean edges and no clipped objects. Match the supplied approved NESAM illustration reference if available.

## 4. Hero prompts

### H01 — main desktop hero, 2400 × 1200, 2:1

> Create a premium travel website hero photograph for a Tamil Nadu outstation cab service. A clean white compact sedan and a white family MPV are parked safely in a designated scenic turnout beside a South Indian coastal road, with subtle coastal vegetation and the Bay of Bengal in the distance. The sedan is the main subject, shown in a front three-quarter view, both vehicles on the right half of the frame. Early morning warm light, believable commercial travel rather than exotic luxury. Reserve the left 45 percent as quiet pale sky and softly defocused scenery suitable for a website heading. Keep vehicles entirely inside the frame and away from the outer 8 percent crop margin. No people required. Do not place cars on a beach or block the roadway. [Append photography suffix.]

Use only if a new photographic hero is added. For the current centered headline layout, use H03 or place H01 in a separate section; do not assume its left-side copy space matches the existing layout.

### H02 — mobile hero, 1080 × 1350, 4:5

> Recompose the approved NESAM desktop coastal hero as a portrait image. Preserve the same white sedan, white MPV, coastline, natural lighting and photographic style. Put the sedan in the lower-middle portion, the secondary vehicle small behind it, and leave the upper 40 percent quiet pale sky. Keep both vehicles fully visible with generous side margins. The image should still read clearly at a phone width of 360 pixels. [Append photography suffix.]

Generate a deliberate mobile composition rather than relying on an aggressive crop of H01.

### H03 — optional background for the current centered booking header, 2400 × 900, 8:3

> Minimal atmospheric photographic background for the centered heading of a South Indian cab booking website. Soft warm ivory sky occupies the central 65 percent; a distant low coastal horizon and subtle greenery sit only along the bottom edge, with a small white sedan in the lower-right corner. Calm natural morning light, intentionally low detail behind the central text area, no dominant landmark, ample empty space. [Append photography suffix.]

### H04 — optional future public-homepage alternative, 2400 × 1200, 2:1

> A South Indian family of two adults and one school-age child preparing for an outstation holiday beside a clean white MPV parked at a quiet residential pickup point. An adult chauffeur in a neat neutral shirt stands near the open boot with one suitcase. Warm candid interactions, everyone standing safely outside the stationary vehicle, realistic anatomy and no staged cheering. Compose people and vehicle on the right 55 percent; reserve the left side as softly blurred warm architecture for editable website copy. [Append photography suffix.]

Choose H01 or H04 as the primary campaign direction; both are alternatives, not mandatory simultaneous heroes.

## 5. Four corridor photographs matching the current website

Target 1200 × 800, 3:2. Use a shared crop, color grade and horizon treatment. Leave lower 20 percent relatively simple if labels will overlay; preferably put route names below the photo.

**D01 — Chennai to Pondicherry, `route-chennai-pondicherry.webp`**

> Editorial destination photograph of Puducherry's French Quarter: a quiet ochre-and-white colonial street, bougainvillea, shaded pavement and a subtle glimpse of coastal light, morning atmosphere, authentic local architectural scale, no dominant crowds or vehicles. Compose one beautiful coherent street scene rather than a landmark collage. [Append photography suffix.]

**D02 — Chennai to Bangalore, `route-chennai-bangalore.webp`**

> Editorial destination photograph of Bengaluru's Vidhana Soudha from a plausible public exterior viewpoint, framed by soft greenery, warm morning light and a clean open foreground. Use an accurate supplied landmark reference, retain recognizable building proportions, no invented towers or merged monuments, no political banners. [Append photography suffix.]

**D03 — Coimbatore to Ooty, `route-coimbatore-ooty.webp`**

> Editorial destination photograph of the Nilgiri hills near Ooty, rolling tea plantations with neat rows following the contours, blue-green wooded hills, delicate morning mist and a quiet winding road low in the frame. Natural South Indian hill-station atmosphere, realistic slopes, no snow mountains, no European chalets, no impossible hairpin road geometry. [Append photography suffix.]

**D04 — Madurai to Rameshwaram, `route-madurai-rameshwaram.webp`**

> Editorial destination photograph of the coastal approach to Rameswaram, turquoise sea and the Pamban crossing in the middle distance, viewed from a plausible safe shore viewpoint. Warm coastal daylight, realistic engineering and perspective, uncluttered composition. Use a verified reference for the chosen bridge and do not combine different bridge designs. No vehicles on a railway track. [Append photography suffix.]

## 6. Optional additional destinations

Only create these when corresponding destinations or service pages are actually added. Target 1200 × 800, 3:2.

Template:

> Editorial destination photograph for a South Indian intercity cab website: [SUBJECT]. One coherent real-world scene, accurate regional character, warm early daylight, room around the principal subject for responsive cropping, no montage. Use a verified landmark reference for recognizable buildings. [Append photography suffix.]

| ID / filename | SUBJECT |
|---|---|
| D05 / destination-chennai | Chennai's Marina Beach promenade at early morning, spacious sandy coastline and subtle city context |
| D06 / destination-madurai | Exterior gopuram of Meenakshi Amman Temple from an appropriate public viewpoint, detailed authentic Dravidian architecture |
| D07 / destination-trichy | Tiruchirappalli Rockfort rising above the city, natural rock mass and authentic skyline from a plausible distant viewpoint |
| D08 / destination-thanjavur | Brihadisvara Temple exterior and open courtyard, accurate stone architecture, respectful quiet atmosphere |
| D09 / destination-kodaikanal | Kodaikanal Lake with wooded hills and soft morning mist, realistic lakeside vegetation |
| D10 / destination-coimbatore | Coimbatore urban setting with distant Western Ghats, understated city-and-nature composition rather than an invented landmark |

## 7. Service and trust photography for proposed sections

Target 1600 × 1200, 4:3, unless specified. These are optional marketing additions; the current application does not have dedicated pages for every service below.

Template:

> Create a candid premium commercial photograph for NESAM Travels: [SUBJECT]. Main subject on the right two-thirds with a little breathing room on the left, warm natural light, approachable everyday travel, restrained colors, realistic Indian vehicles and setting. [Append photography suffix.]

| ID / filename | SUBJECT |
|---|---|
| S01 / service-one-way | A solo adult traveler with one suitcase being welcomed beside a stationary white sedan at a South Indian home pickup point; a single departure moment |
| S02 / service-round-trip | Two adults reviewing a folded unmarked travel brochure beside a parked white MPV at a green scenic rest stop, relaxed holiday atmosphere |
| S03 / service-airport | An adult traveler rolling a red suitcase toward a white sedan at a generic modern South Indian airport pickup bay, chauffeur waiting beside the boot, no airport branding |
| S04 / service-family | Family standing beside a safely parked white seven-seat MPV, luggage neatly arranged near the open boot, candid preparations for a holiday |
| S05 / service-pilgrimage | Two older South Indian adults and a younger companion beside a parked sedan, distant authentic temple exterior, respectful travel atmosphere |
| S06 / service-corporate | Business traveler with laptop bag approaching a parked white executive sedan outside a modern office entrance, professional but approachable |
| S07 / service-group | Four adult friends gathering luggage beside a clean white passenger van in a designated parking area, calm organized group travel |
| S08 / trust-driver | Approachable adult South Indian chauffeur in a neat light shirt standing beside a white sedan at a quiet pickup point, natural expression, no ID badge or claim of certification |
| S09 / trust-interior | Empty clean beige MPV interior photographed from a real rear passenger doorway, plausible seat arrangement and visible seat belts, natural daylight, no invented luxury features |
| S10 / trust-support | Two South Indian support agents at a tidy modern desk, headsets and monitors seen at an angle with unreadable screens, subtle red stationery, no visible customer data |
| S11 / about-fleet | Three white commercial vehicles, sedan, MPV and passenger van, parked in a neat believable depot with consistent scale and ground contact |

These people and premises would be illustrative. Use real commissioned staff and fleet photography if the section purports to show NESAM's actual team or vehicles.

## 8. Vehicle cutouts — eight existing categories

Existing filenames are already used by the website. Generate replacements only if needed, keeping the same filenames and consistent framing. Target 1600 × 1000 transparent PNG master; export transparent WebP. Do not put seating, model guarantees or fare labels inside the artwork.

Template:

> A single clean white [VEHICLE] for the NESAM Travels vehicle catalogue. Realistic automotive studio rendering, front three-quarter view with the front pointing left, camera at headlamp height, neutral softbox lighting, realistic glass and tires, restrained charcoal trim, no manufacturer logo or model lettering, no people, no scenery. Entire vehicle visible with 12 percent clear margin, consistent ground baseline at 80 percent of canvas height. Transparent background with a very subtle neutral contact shadow directly under the tires, no opaque floor or checkerboard pattern. Same lighting, angle, white paint and rendering style as the approved reference vehicle. No cropped mirrors, extra wheels or distorted bodywork. Landscape 8:5 composition.

| Filename | VEHICLE |
|---|---|
| hatchback.webp | compact five-door Indian-market hatchback, short rear overhang |
| sedan.webp | practical compact Indian-market four-door sedan, visibly separate boot |
| premium-sedan.webp | refined midsize executive four-door sedan, longer wheelbase, restrained detailing |
| suv.webp | upright midsize sport utility vehicle, higher ground clearance, distinct SUV proportions |
| mpv.webp | spacious Indian-market family MPV, long passenger cabin and three-row vehicle proportions |
| passenger-van.webp | high-roof tourist passenger van, multiple side windows and realistic commercial proportions |
| minibus.webp | compact tourist minibus, taller bus body with multiple passenger windows |
| tourist-coach.webp | full-size tourist coach, large windshield and long multi-window passenger body |

For an explicit Innova Crysta card, use a supplied authorized model reference if model accuracy is required. Generic MPV art should be described as representative. Actual seat and luggage capacity must come from the vehicle category data.

## 9. Authentication and status illustrations — all 18 current art filenames

These are already available in `user/web/public/art`. Retain them unless replacing the family coherently. Target 1024 × 1024 transparent PNG masters, then WebP. For authentication, ensure the artwork remains legible at the existing 460-pixel display size; empty-state art also needs to read at 140–220 pixels.

Template:

> Create one isolated NESAM Travels illustration showing [SUBJECT]. Use at most three main objects, communicate the idea without written labels, keep the central silhouette simple and clear at small sizes, with 12 percent transparent padding. [Append illustration suffix.]

| Existing filename | SUBJECT |
|---|---|
| welcome.webp | a friendly adult traveler with red suitcase beside a white sedan and one understated destination pin |
| phone-verification.webp | a smartphone with six simple empty code dots and a small abstract protective shield; no actual code |
| profile-setup.webp | a neutral avatar silhouette with a small pencil and one simple profile card, no personal data |
| account-review.webp | a profile card beside a magnifying glass and a neutral small clock, no approval tick or rejection stamp |
| book-journey.webp | two location pins connected by a simple decorative curved route beside a white sedan; not a navigable map |
| choose-vehicle.webp | a compact sedan and family MPV with clearly different silhouettes, balanced composition |
| booking-confirmed.webp | a simple booking card with one red check mark and a small stationary white sedan |
| driver-arriving.webp | a white sedan approaching a decorative location pin, short subtle motion accents |
| journey-progress.webp | a white sedan on a short abstract curved road with two endpoint dots, no geographic detail |
| trip-completed.webp | a stationary white sedan at an arrival pin with a restrained check symbol, no confetti overload |
| no-trips.webp | an empty travel journal beside a small suitcase and a faint decorative road curve |
| no-notifications.webp | a quiet bell beside an empty message card, calm neutral state |
| no-offers.webp | a blank ticket-shaped coupon and a small gift ribbon, no discount value |
| no-payments.webp | a neutral closed wallet with a blank receipt, no money owed or failure symbol |
| no-saved-places.webp | an empty bookmark beside a small house and a location pin |
| support.webp | an approachable South Indian support agent bust wearing a headset, one simple speech bubble |
| offline.webp | a simple disconnected plug and a small cloud, gentle neutral treatment rather than alarm |
| error.webp | a small neutral warning triangle beside an incomplete card and a circular retry arrow, no frightening imagery |

## 10. Functional icons and decorative feature icons

Use the existing SVG icon library for controls. Its implementation uses a 24-unit grid, 1.8-unit strokes, round caps and joins, and `currentColor`. AI-generated raster icons are unsuitable replacements for crisp 20–24-pixel UI controls. For icons, use this prompt with a code-capable assistant or vector design tool:

> Create one original editable SVG icon for [CONCEPT], matching the existing NESAM icon family: viewBox="0 0 24 24", fill="none", stroke="currentColor", stroke-width="1.8", stroke-linecap="round", stroke-linejoin="round". Keep geometry inside a 2-unit inset, use simple paths and consistent optical weight, no text, embedded bitmap, filters, gradients, external references or scripts. Return the standalone SVG source. Check readability at 20 and 24 pixels against the supplied existing icon reference. Reuse an existing matching icon if one is already present.

Generate individually only for missing concepts: one-way journey; round trip; airport; pickup pin; destination pin; calendar; time; passenger; luggage; air conditioning; fare receipt; driver; support headset; phone; trip history; saved place; payment; offer; notification; account; shield; copy; share; search; close; back; next; retry; current location; sign out. Check against the existing library before creating any of these.

For the booking page's four trust cards, map zero surge to a receipt/fixed-price symbol, chauffeurs to the existing driver or verified icon, clean AC fleet to a snowflake, and support to a headset. Keep the claim in webpage text; an icon is not evidence of verification.

If larger decorative feature illustrations are wanted, use the illustration template and suffix above with these four subjects, one asset per generation, target 512 × 512 transparent:

| Filename | Subject |
|---|---|
| feature-transparent-fare | a simple receipt with three blank horizontal rules and a restrained stable horizontal arrow |
| feature-chauffeur | a friendly adult chauffeur bust beside a small car silhouette, no official badge |
| feature-clean-ac | a white car cabin silhouette with one small snowflake and a restrained sparkle |
| feature-support | a headset surrounding a simple speech bubble, no numbers or text |

## 11. Optional offer, app and social backgrounds

**B01 — offer card background, 1600 × 900, 16:9**

> NESAM Travels promotional background with a clean white sedan and a small red suitcase arranged on the right third of a warm ivory studio surface. Subtle abstract red curved road line along the bottom edge, broad empty left half for editable offer copy. Sophisticated restrained composition, soft studio shadows, no text, prices, percentage marks, currency, logo or discount badges.

**B02 — app promotion background, 1600 × 1200, 4:3**

> Warm ivory editorial background for a South Indian cab booking app promotion, a red suitcase and white sedan in the lower-right corner, broad clean center and left side reserved for an actual app screenshot to be composited later. Minimal soft shadows and subtle charcoal travel-route curve. No generated phone interface, screen, lettering, logo, app-store badge or buttons.

Use an actual captured NESAM screen and genuine store badges separately, only when a published app and real store links exist.

**B03 — social sharing cover background, 1200 × 630**

> Wide editorial travel photograph for a South Indian intercity cab brand, white sedan on the right at a coastal scenic turnout, warm clear morning light, quiet pale left half reserved for a supplied logo and separately typeset brand message. Single coherent scene with strong readability at thumbnail size. [Append photography suffix.]

**B04 — optional subtle decorative background, 2400 × 900**

> Extremely subtle abstract travel background on warm white #FFFCFA, one thin muted-red curved route line confined to the bottom-right and a few pale charcoal endpoint circles. The central 75 percent is almost empty, no landmarks, car, lettering or symbols resembling controls. Flat clean visual, no texture, gradients or heavy contrast.

For B04, native SVG or CSS would be preferable to a large bitmap.

## 12. Production checklist and generation order

1. Select an approved existing vehicle and illustration as family references. Keep original NESAM logo unchanged.
2. Generate H01 and its H02 portrait composition first, or choose H04 as the main alternative. Use H03 only if a centered photo-backed header is introduced.
3. Generate D01–D04 for the exact four corridor cards already in the website.
4. Review the eight existing vehicle images together; replace only inconsistent or incorrect assets. Keep camera direction, baseline and relative scale consistent.
5. Reuse the 18 current illustrations and existing SVG icons. Commission replacements only for demonstrated gaps.
6. Produce optional services, destinations and campaigns only when those sections are approved for addition.
7. Inspect full-size outputs for vehicle geometry, reflections, hands, architectural errors and clean alpha edges. Check mobile crops. A prompt cannot guarantee anatomical or geographic accuracy.
8. Deliver photographic WebP/AVIF plus original high-resolution masters; transparent WebP plus PNG masters for cutouts; genuine SVG for icons. Verify actual transparency, not a painted checkerboard. Suggested compressed budgets: desktop hero roughly 200–400 KB, mobile hero 100–200 KB, route card 50–120 KB, vehicle 20–70 KB; tune against visible quality.
9. Use explicit image width/height, responsive sources and lazy loading below the fold. Keep meaningful page text in HTML. Use descriptive alt text for informative photos, and empty alt text for decorative illustrations that repeat nearby labels.

No website files were changed and no new images were generated as part of this prompt audit.

## 13. Source files used

- `user/web/src/App.tsx` — route inventory and authentication gate.
- `user/web/src/pages/book/BookPage.tsx` — current hero text, fleet cards, corridors, trust and operations desk.
- `user/web/src/pages/book/PlanStep.tsx` — trip modes and advance scheduling.
- `user/web/src/pages/auth/AuthFlow.tsx` — sign-in, OTP and profile illustration placements.
- Customer page components and image references — trips, notifications, offers, saved places, payments, support, account, legal and ride.
- `user/web/src/styles/tokens.css` — actual brand colors.
- `user/web/src/lib/vehicleArt.ts` — eight vehicle-category mappings.
- `user/web/src/components/Icon.tsx` — existing SVG specification.
- `output/nesam-visual-assets/README.md`, manifest headers and photography preview — existing collection and stated limitations.
