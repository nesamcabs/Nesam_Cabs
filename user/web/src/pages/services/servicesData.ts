import type { TripType } from '@core/types';

export interface ServiceDetail {
  id: string;
  slug: string;
  title: string;
  h1: string;
  tripType: TripType;
  image: string;
  metaDescription: string;
  keywords: string;
  lead: string;
  features: Array<{ title: string; text: string }>;
  overview: string[];
  pricingRules: Array<{ title: string; detail: string }>;
  faqs: Array<{ q: string; a: string }>;
}

export const ALL_SERVICES: ServiceDetail[] = [
  {
    id: 'one-way-drop-taxi',
    slug: 'one-way-drop-taxi',
    title: 'One Way Drop Taxi in Tamil Nadu | Zero Return Fare Outstation Cab',
    h1: 'One Way Drop Taxi Across Tamil Nadu & South India',
    tripType: 'One Way',
    image: '/website-images/web/photography/service-one-way.webp',
    metaDescription:
      'Book one way drop taxi across Tamil Nadu with NESAM Cabs. Pay only for one-way distance with zero return fare. Clean AC sedans, SUVs & Innova Crysta with verified drivers.',
    keywords:
      'one way drop taxi, drop taxi tamil nadu, one way cab chennai, drop taxi online booking, zero return fare cab, intercity one way taxi, outstation drop taxi',
    lead:
      'Pay only for the distance you travel between cities. Zero return charges, fares shown before you book, and commercial drivers who know the highways.',
    features: [
      { title: 'Zero Return Fare', text: 'You only pay for the one-way distance from pickup to drop city. Never pay for the car’s return journey.' },
      { title: 'Fares Shown Upfront', text: 'View exact distance fare, driver allowance, and GST before confirming. No hidden night fees.' },
      { title: 'Pay Cash or UPI', text: 'Nothing charged upfront when you book. Pay your driver comfortably at the end of the ride.' },
      { title: 'Boarding Security', text: '4-digit OTP boarding code ensures your trip only begins once you are seated inside the vehicle.' },
    ],
    overview: [
      'Traditionally, hiring a taxi between cities meant paying double: the fare for your trip plus the return fare for the driver to return empty. NESAM Cabs changes intercity travel with our dedicated One-Way Drop Taxi service across Tamil Nadu, Bangalore, and Pondicherry.',
      'Our intelligent vehicle routing and vast partner fleet match vehicles with returning travellers. This allows us to charge you strictly for the one-way distance travelled, saving you 40% to 50% compared to conventional round-trip rental billing.',
      'From solo travellers and working executives to vacationing families, choose our air-conditioned Sedans (Dzire, Etios), versatile 6-seater/7-seater SUVs (Ertiga), or spacious Innova Crysta cabs.',
    ],
    pricingRules: [
      { title: 'Sedan (4 Seater)', detail: '₹15 / KM + ₹400 driver allowance (minimum billing 130 KM)' },
      { title: 'SUV 6+1 (6 Seater)', detail: '₹20 / KM + ₹400 driver allowance (minimum billing 130 KM)' },
      { title: 'SUV 7+1 / Innova (7 Seater)', detail: '₹20 / KM + ₹400 driver allowance (minimum billing 130 KM)' },
      { title: 'Innova Crysta (7 Seater)', detail: '₹26 / KM + ₹600 driver allowance (minimum billing 130 KM)' },
      { title: 'Tolls & Permits', detail: 'Tolls, parking fees, and state border permits paid at actuals with receipts' },
      { title: 'Taxes', detail: 'Standard 5% GST included in the final invoice' },
    ],
    faqs: [
      {
        q: 'How does NESAM one-way drop taxi work in Tamil Nadu?',
        a: 'You enter your pickup and drop city. We calculate the exact highway route distance and display the all-inclusive fare. You pay strictly for that one-way distance with zero return fare charges.',
      },
      {
        q: 'Can I stop for food or refreshments during the trip?',
        a: 'Yes! Highway food stops and restroom breaks are permitted. Waiting time up to 30 minutes for normal breaks is completely free.',
      },
      {
        q: 'How far in advance do I need to book?',
        a: 'You can book anywhere from 30 minutes to 30 days ahead. Advance bookings guarantee instant driver assignment.',
      },
    ],
  },
  {
    id: 'outstation-round-trip',
    slug: 'outstation-round-trip',
    title: 'Outstation Round Trip Cabs | Multi-Day Car Rental with Driver',
    h1: 'Outstation Round Trip Car Rentals with Driver',
    tripType: 'Round Trip',
    image: '/website-images/web/photography/service-round-trip.webp',
    metaDescription:
      'Book outstation round trip cabs with dedicated driver across South India. Calendar-day billing, 250 km/day minimum, clean AC cars for family vacations and temple tours.',
    keywords:
      'outstation round trip cab, outstation car rental with driver, multi day cab booking tamil nadu, family vacation car rental, round trip taxi rate per km',
    lead:
      'Out and back over one day or multiple days with your dedicated driver. Transparent calendar-day billing, generous daily km limits, and complete flexibility.',
    features: [
      { title: 'Dedicated Driver', text: 'The same professional driver and vehicle stays with your group throughout the journey.' },
      { title: 'Calendar Day Billing', text: 'Simple, transparent billing based on calendar days with clear daily driver allowance.' },
      { title: 'Sightseeing Freedom', text: 'Stop at viewpoint spots, heritage monuments, and restaurants on your own schedule.' },
      { title: 'All-Inclusive Quotes', text: 'See your complete minimum km package and daily allowance before you confirm.' },
    ],
    overview: [
      'Whether planning a long-weekend getaway to Ooty or Kodaikanal, a family darshan tour across South Indian temples, or a business trip covering multiple industrial towns, NESAM Outstation Round Trips provide the comfort of your own car with the relaxation of a professional driver.',
      'Our round trips are billed by calendar day with fair daily minimum kilometre allowances (250 km/day for Sedans & SUVs, 300 km/day for Innova Crysta). Any extra kilometres travelled are charged at low standard per-km rates with zero surcharge.',
    ],
    pricingRules: [
      { title: 'Sedan (4 Seater)', detail: '₹14 / KM + ₹400 driver allowance/day (minimum 250 KM per calendar day)' },
      { title: 'SUV 6+1 (6 Seater)', detail: '₹19 / KM + ₹400 driver allowance/day (minimum 250 KM per calendar day)' },
      { title: 'SUV 7+1 / Innova (7 Seater)', detail: '₹19 / KM + ₹400 driver allowance/day (minimum 250 KM per calendar day)' },
      { title: 'Innova Crysta (7 Seater)', detail: '₹22 / KM + ₹500 driver allowance/day (minimum 300 KM per calendar day)' },
      { title: 'Driver Accommodation', detail: 'Driver arranges their own lodging and food; you only pay the fixed daily bata' },
    ],
    faqs: [
      {
        q: 'How does calendar day billing work for round trips?',
        a: 'Each calendar day (12:00 AM to 11:59 PM) counts as one billing day. For example, departing Saturday morning and returning Sunday evening counts as 2 days with a 500 KM minimum billing for Sedans.',
      },
      {
        q: 'Do I have to arrange hotel accommodation for the driver?',
        a: 'No. The daily driver allowance (₹400/day for Sedan/SUV, ₹500/day for Crysta) covers the driver’s personal expenses and night stay.',
      },
    ],
  },
  {
    id: 'airport-taxi',
    slug: 'airport-taxi',
    title: 'Airport Taxi Transfers | Chennai, Bangalore, Coimbatore, Madurai',
    h1: 'Guaranteed On-Time Airport Taxi Transfers',
    tripType: 'Airport Taxi',
    image: '/website-images/web/photography/service-airport.webp',
    metaDescription:
      'Book reliable airport taxi pickups and drops for Chennai (MAA), Bangalore (BLR), Coimbatore (CJB), Madurai (IXM), and Trichy (TRZ) airports. Flight tracking, zero surge.',
    keywords:
      'airport taxi chennai, chennai airport cab booking, bangalore airport taxi, coimbatore airport cab, madurai airport drop taxi, airport transfer zero surge',
    lead:
      'Never miss a flight. Guaranteed punctual pickups, flight status tracking, professional meet-and-greet, and upfront fixed package fares with zero surge pricing.',
    features: [
      { title: 'Guaranteed Punctuality', text: 'Drivers arrive 15 minutes before scheduled pickup time for seamless departure.' },
      { title: 'Zero Surge Pricing', text: 'Fixed upfront package fares regardless of peak hours, rain, or midnight timings.' },
      { title: 'Airport Meet & Greet', text: 'Driver assists with luggage at arrival gates and guides you to the vehicle.' },
      { title: 'Generous Boot Space', text: 'Spacious sedans and SUVs capable of handling large international and domestic luggage.' },
    ],
    overview: [
      'Airport journeys demand absolute reliability. A delayed cab can mean a missed flight and spoiled plans. NESAM Cabs Airport Transfers are designed around on-time precision.',
      'We serve all major international and domestic airports across the southern region: Chennai Airport (MAA), Kempegowda International Airport Bengaluru (BLR), Coimbatore International Airport (CJB), Madurai Airport (IXM), and Tiruchirappalli International Airport (TRZ).',
      'Our 20 km city base package includes 20 km of driving with extra km rates clearly shown upfront. You enjoy stress-free transit directly to and from your home, hotel, or office.',
    ],
    pricingRules: [
      { title: 'Sedan Airport Base', detail: '₹800 includes 20 KM, extra KM at ₹35 / KM' },
      { title: 'SUV Airport Base', detail: '₹1,200 includes 20 KM, extra KM at ₹50 / KM' },
      { title: 'Crysta Airport Base', detail: '₹2,000 includes 20 KM, extra KM at ₹70 / KM' },
      { title: 'Parking & Tolls', detail: 'Airport entry parking and toll fees payable at actuals with receipts' },
    ],
    faqs: [
      {
        q: 'What happens if my flight is delayed?',
        a: 'For airport pickups, our dispatch monitors flight arrival status. When you schedule an arrival pickup, your driver adjusts arrival time accordingly.',
      },
      {
        q: 'Can the driver assist with luggage?',
        a: 'Yes, our verified drivers happily assist with loading and unloading your luggage.',
      },
    ],
  },
  {
    id: 'local-rental',
    slug: 'local-rental',
    title: 'Hourly Local Car Rental with Driver | City Disposal Packages',
    h1: 'Hourly Local Car Rental & City Disposal with Driver',
    tripType: 'Local Rental',
    image: '/website-images/web/photography/service-corporate.webp',
    metaDescription:
      'Hire a car and driver by the hour for local city travel in Chennai, Bangalore, Coimbatore, and Madurai. Flexible 4hr, 8hr, and 12hr packages for business and shopping.',
    keywords:
      'hourly car rental with driver, local cab rental chennai, city taxi by hour, car disposal with driver bangalore, 8 hours 80 km cab package',
    lead:
      'A car with a driver, at your service within city limits. Multi-stop meetings, wedding shopping, or sightseeing with flexible hourly packages.',
    features: [
      { title: 'Car at Your Disposal', text: 'Vehicle waits for you at every stop while you attend meetings or shopping.' },
      { title: 'Flexible Packages', text: 'Choose from 1 hr / 10 km up to full-day 12 hr / 120 km packages.' },
      { title: 'Clean Executive Fleet', text: 'Well-maintained AC cars suited for visiting clients, families, and guests.' },
      { title: 'Transparent Extra KM/Hr', text: 'Low standard per-km and per-minute rates if you exceed package limits.' },
    ],
    overview: [
      'When your day involves multiple stops across the city — such as doctor visits, corporate client meetings, wedding shopping, or family functions — hailing multiple one-off cabs is frustrating and exhausting. NESAM Local Hourly Rentals give you a dedicated car and driver throughout your itinerary.',
      'Your driver waits patiently at each destination and navigates city traffic while you focus on your day in air-conditioned comfort.',
    ],
    pricingRules: [
      { title: 'Flexible Packages', detail: '1hr/10km, 2hr/20km, 4hr/40km, 8hr/80km, up to 12hr/120km' },
      { title: 'Sedan Rates', detail: 'Base from ₹800 (includes 20km). Extra KM at ₹35/km' },
      { title: 'SUV Rates', detail: 'Base from ₹1,200 (includes 20km). Extra KM at ₹50/km' },
      { title: 'Crysta Rates', detail: 'Base from ₹2,000 (includes 20km). Extra KM at ₹70/km' },
    ],
    faqs: [
      {
        q: 'Can I make multiple stops within the city?',
        a: 'Yes! The rental is completely flexible: travel to as many locations as you need within your booked hours and kilometres.',
      },
    ],
  },
  {
    id: 'pilgrimage-tours',
    slug: 'pilgrimage-tours',
    title: 'Tamil Nadu Temple Tours & Pilgrimage Taxi Packages | NESAM Cabs',
    h1: 'Tamil Nadu Temple Tours & Pilgrimage Taxi Circuits',
    tripType: 'Round Trip',
    image: '/website-images/web/photography/service-pilgrimage.webp',
    metaDescription:
      'Book sacred South India temple tour cabs with NESAM Cabs. Darshan packages to Rameshwaram, Tirupati, Navagraha, Madurai Meenakshi, Palani with respectful drivers.',
    keywords:
      'tamil nadu temple tour cab, rameshwaram pilgrimage taxi, tirupati balaji darshan cab, navagraha temple taxi package, south india spiritual tour car rental',
    lead:
      'Experience divine peace on sacred temple circuits. Courteous, respectful drivers familiar with temple timings, darshan queues, and holy rituals.',
    features: [
      { title: 'Temple Knowledge', text: 'Drivers familiar with temple pooja timings, dress codes, and car parking near shrines.' },
      { title: 'Comfort for Seniors', text: 'Gentle driving and easy boarding for elderly parents and young children.' },
      { title: 'Custom Circuit Planning', text: 'Design your custom darshan itinerary across multiple holy towns over several days.' },
      { title: 'Clean & Pure Fleet', text: 'Spotlessly clean, well-sanitized vehicles for an auspicious journey.' },
    ],
    overview: [
      'Tamil Nadu is the sacred Land of Temples. From the coastal shrine of Lord Ramanatha in Rameshwaram and the soaring gopurams of Madurai Meenakshi, to the Navagraha temples of Kumbakonam and the hilltop sanctum of Palani Murugan, pilgrimage is at the heart of South Indian culture.',
      'NESAM Cabs specializes in dedicated pilgrimage packages. Our drivers take personal care of senior citizens, navigate near temple entrances for minimum walking, and guide your family on sacred traditions.',
    ],
    pricingRules: [
      { title: 'Round-Trip Outstation Rates', detail: 'Sedan at ₹14/km, SUV at ₹19/km, Crysta at ₹22/km' },
      { title: 'Daily Minimum', detail: '250 KM per day (300 KM for Crysta)' },
      { title: 'Driver Allowance', detail: '₹400/day (₹500/day for Crysta) covers driver day & night stay' },
    ],
    faqs: [
      {
        q: 'Can you customize a multi-day Navagraha temple tour from Trichy or Kumbakonam?',
        a: 'Yes, we provide 2-day and 3-day customized Navagraha temple circuits covering all 9 planetary shrines with experienced drivers.',
      },
    ],
  },
];

export function findServiceBySlug(slug: string): ServiceDetail | undefined {
  const norm = slug.toLowerCase().replace(/_|\s+/g, '-');
  return ALL_SERVICES.find((s) => s.slug === norm || s.id === norm);
}

