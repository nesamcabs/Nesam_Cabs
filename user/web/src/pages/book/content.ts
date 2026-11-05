// Editorial content for the booking home. Nothing here is a price or a rating: fares always come
// from the booking server, and the site never invents reviews or statistics.
import type { GeoPlace, TripType } from '@core/types';

export const IMG = (path: string) => `/website-images/web/${path}.webp`;

export interface Corridor {
  id: string;
  origin: string;
  destination: string;
  pickup: GeoPlace;
  drop: GeoPlace;
  /** Approximate road distance and time, for orientation only; the exact figures are computed when you book. */
  km: string;
  duration: string;
  image?: string;
}

const place = (id: string, name: string, address: string, lat: number, lng: number): GeoPlace => ({ id, name, address, lat, lng, type: 'other' });

export const CORRIDORS: Corridor[] = [
  {
    id: 'chennai-pondicherry',
    origin: 'Chennai',
    destination: 'Pondicherry',
    pickup: place('p-chn', 'Chennai Central', 'Chennai, Tamil Nadu', 13.0827, 80.2707),
    drop: place('d-pnd', 'Pondicherry White Town', 'Puducherry', 11.9416, 79.8083),
    km: '150 km',
    duration: '3 hr 10 min',
    image: 'destinations/route-chennai-pondicherry',
  },
  {
    id: 'chennai-bangalore',
    origin: 'Chennai',
    destination: 'Bangalore',
    pickup: place('p-chn2', 'Chennai Koyambedu', 'Chennai, Tamil Nadu', 13.0694, 80.1948),
    drop: place('d-blr', 'Bangalore Majestic', 'Bengaluru, Karnataka', 12.9767, 77.5713),
    km: '345 km',
    duration: '6 hr',
    image: 'destinations/route-chennai-bangalore',
  },
  {
    id: 'coimbatore-ooty',
    origin: 'Coimbatore',
    destination: 'Ooty',
    pickup: place('p-cbe', 'Coimbatore Gandhipuram', 'Coimbatore, Tamil Nadu', 11.0168, 76.9558),
    drop: place('d-ooty', 'Ooty Charring Cross', 'Udhagamandalam, Tamil Nadu', 11.4102, 76.695),
    km: '88 km',
    duration: '2 hr 50 min',
    image: 'destinations/route-coimbatore-ooty',
  },
  {
    id: 'madurai-rameshwaram',
    origin: 'Madurai',
    destination: 'Rameshwaram',
    pickup: place('p-mdu', 'Madurai Junction', 'Madurai, Tamil Nadu', 9.9252, 78.1198),
    drop: place('d-rsm', 'Rameshwaram Temple', 'Rameswaram, Tamil Nadu', 9.2876, 79.3129),
    km: '172 km',
    duration: '3 hr 30 min',
    image: 'destinations/route-madurai-rameshwaram',
  },
];

export const MORE_CORRIDORS: Corridor[] = [
  {
    id: 'trichy-thanjavur',
    origin: 'Trichy',
    destination: 'Thanjavur',
    pickup: place('p-trz', 'Trichy Central', 'Tiruchirappalli, Tamil Nadu', 10.7905, 78.7047),
    drop: place('d-tjv', 'Thanjavur Big Temple', 'Thanjavur, Tamil Nadu', 10.787, 79.1378),
    km: '58 km',
    duration: '1 hr 10 min',
  },
  {
    id: 'bangalore-mysore',
    origin: 'Bangalore',
    destination: 'Mysore',
    pickup: place('p-blr3', 'Bangalore Electronic City', 'Bengaluru, Karnataka', 12.8399, 77.677),
    drop: place('d-mys', 'Mysore Palace', 'Mysuru, Karnataka', 12.3051, 76.6551),
    km: '142 km',
    duration: '2 hr 30 min',
  },
  {
    id: 'salem-yercaud',
    origin: 'Salem',
    destination: 'Yercaud',
    pickup: place('p-slm', 'Salem Junction', 'Salem, Tamil Nadu', 11.6643, 78.146),
    drop: place('d-ycd', 'Yercaud Lake', 'Yercaud, Tamil Nadu', 11.7753, 78.2093),
    km: '32 km',
    duration: '1 hr',
  },
  {
    id: 'chennai-tirupati',
    origin: 'Chennai',
    destination: 'Tirupati',
    pickup: place('p-chn3', 'Chennai Koyambedu', 'Chennai, Tamil Nadu', 13.0694, 80.1948),
    drop: place('d-tpt', 'Tirupati Balaji', 'Tirumala, Andhra Pradesh', 13.6833, 79.3472),
    km: '138 km',
    duration: '3 hr',
  },
];

export interface Destination {
  id: string;
  name: string;
  tagline: string;
  place: GeoPlace;
  image: string;
}

export const DESTINATIONS: Destination[] = [
  { id: 'chennai', name: 'Chennai', tagline: 'The Marina and the coast', place: place('city-chennai', 'Chennai', 'Chennai, Tamil Nadu', 13.0827, 80.2707), image: 'destinations/destination-chennai' },
  { id: 'madurai', name: 'Madurai', tagline: 'The temple city', place: place('city-madurai', 'Madurai', 'Madurai, Tamil Nadu', 9.9252, 78.1198), image: 'destinations/destination-madurai' },
  { id: 'thanjavur', name: 'Thanjavur', tagline: 'Chola heritage', place: place('city-thanjavur', 'Thanjavur', 'Thanjavur, Tamil Nadu', 10.787, 79.1378), image: 'destinations/destination-thanjavur' },
  { id: 'trichy', name: 'Trichy', tagline: 'Rockfort and the Kaveri', place: place('city-trichy', 'Trichy', 'Tiruchirappalli, Tamil Nadu', 10.7905, 78.7047), image: 'destinations/destination-trichy' },
  { id: 'coimbatore', name: 'Coimbatore', tagline: 'Gateway to the Nilgiris', place: place('city-coimbatore', 'Coimbatore', 'Coimbatore, Tamil Nadu', 11.0168, 76.9558), image: 'destinations/destination-coimbatore' },
  { id: 'kodaikanal', name: 'Kodaikanal', tagline: 'Lake and hill station', place: place('city-kodaikanal', 'Kodaikanal', 'Kodaikanal, Tamil Nadu', 10.2381, 77.4892), image: 'destinations/destination-kodaikanal' },
];

export interface Service {
  id: string;
  title: string;
  text: string;
  image: string;
  /** What choosing the card does to the booking console. */
  action: { tripType?: TripType; search?: string };
}

export const SERVICES: Service[] = [
  { id: 'one-way', title: 'One-way outstation', text: 'A drop in another city, priced for the route you actually travel.', image: 'photography/service-one-way', action: { tripType: 'One Way' } },
  { id: 'round-trip', title: 'Round trips', text: 'Out and back over one day or many, billed by calendar day.', image: 'photography/service-round-trip', action: { tripType: 'Round Trip' } },
  { id: 'local-rental', title: 'Local hourly rental', text: 'Car and driver at your disposal by the hour within city limits.', image: 'photography/service-corporate', action: { tripType: 'Local Rental' } },
  { id: 'airport', title: 'Airport transfers', text: 'Scheduled pickups and drops, arranged before your flight.', image: 'photography/service-airport', action: { tripType: 'Airport Taxi', search: 'airport' } },
  { id: 'family', title: 'Family journeys', text: 'Room for luggage, little ones and everyone’s plans.', image: 'photography/service-family', action: { tripType: 'Round Trip' } },
  { id: 'pilgrimage', title: 'Temple & pilgrimage', text: 'Darshan trips and temple circuits without the travel stress.', image: 'photography/service-pilgrimage', action: { tripType: 'Round Trip' } },
  { id: 'corporate', title: 'Business travel', text: 'Calm, punctual rides for clients, teams and early meetings.', image: 'photography/service-corporate', action: { tripType: 'One Way' } },
  { id: 'group', title: 'Group travel', text: 'Vans and larger vehicles for weddings, tours and gatherings.', image: 'photography/service-group', action: { tripType: 'Round Trip' } },
];

export const FEATURES = [
  { image: 'features/feature-transparent-fare', title: 'Fares before you book', text: 'See the fare for every vehicle, with what is and isn’t included, before you commit.' },
  { image: 'features/feature-chauffeur', title: 'Verified drivers', text: 'Commercial drivers who know the highways and take pride in the journey.' },
  { image: 'features/feature-clean-ac', title: 'Clean, air-conditioned cars', text: 'A well-kept fleet, from hatchbacks to vans, ready for long distances.' },
  { image: 'features/feature-support', title: 'A team you can call', text: 'Talk to NESAM about a booking or a trip in progress, any time you need.' },
];

export const STEPS = [
  { image: 'illustrations/book-journey', title: 'Tell us your trip', text: 'Pickup, destination and when you want to leave. Round trip? Add your return too.' },
  { image: 'illustrations/choose-vehicle', title: 'Compare and choose', text: 'See the fare for each vehicle, apply a promo code and pick what fits your group.' },
  { image: 'illustrations/driver-arriving', title: 'We confirm, you ride', text: 'NESAM reviews your request and assigns a driver. You pay your driver in cash or UPI.' },
];

export const ASSURANCE = [
  { icon: 'verified', title: 'Boarding code for every trip', text: 'Your driver can’t start the trip without the code only you can see.' },
  { icon: 'navigation', title: 'Live tracking', text: 'Follow your driver on the map once they’re on the way, with a live arrival estimate.' },
  { icon: 'emergency', title: 'Safety centre', text: 'One tap to call emergency services, share your trip or alert the NESAM team.' },
  { icon: 'receipt', title: 'Receipt for every ride', text: 'A clear fare breakup, saved to your trips and ready to print.' },
];

export const FAQS = [
  { q: 'How do I cancel my booking?', a: 'Open the ride from My trips and choose “Cancel ride”. The screen tells you whether a cancellation fee applies before you confirm.' },
  { q: 'When are driver details shared?', a: 'As soon as a driver is assigned — name, phone, vehicle number and rating appear on your ride page.' },
  { q: 'What is the boarding code?', a: 'A 4-digit code shown on your ride page. Share it with your driver only once you are in the car; the trip cannot start without it.' },
  { q: 'How are tolls charged?', a: 'Tolls, parking and permits paid by the driver are added to your final receipt against actual receipts.' },
  { q: 'What payment modes are accepted?', a: 'You pay your driver in Cash or by UPI at the end of the journey. Nothing is charged when you book.' },
  { q: 'Can I book an outstation trip in advance?', a: 'Yes. Every booking is made in advance: choose your pickup date and time, then pick a ride. Pickups can be booked 30 minutes to 30 days ahead.' },
];

/** Cities offered as one-tap destinations in the booking console. */
export const QUICK_CITIES: GeoPlace[] = [
  place('city-pondicherry', 'Pondicherry', 'Puducherry', 11.9416, 79.8083),
  place('city-bangalore', 'Bangalore', 'Bengaluru, Karnataka', 12.9716, 77.5946),
  place('city-coimbatore', 'Coimbatore', 'Coimbatore, Tamil Nadu', 11.0168, 76.9558),
  place('city-ooty', 'Ooty', 'Udhagamandalam, Tamil Nadu', 11.4102, 76.695),
  place('city-madurai', 'Madurai', 'Madurai, Tamil Nadu', 9.9252, 78.1198),
  place('city-trichy', 'Trichy', 'Tiruchirappalli, Tamil Nadu', 10.7905, 78.7047),
  place('city-salem', 'Salem', 'Salem, Tamil Nadu', 11.6643, 78.146),
  place('city-tirupati', 'Tirupati', 'Tirupati, Andhra Pradesh', 13.6288, 79.4192),
];

// ── Booking home (reference layout) ─────────────────────────────────────────

export interface PopularRoute {
  id: string;
  from: string;
  to: string;
  pickup: GeoPlace;
  drop: GeoPlace;
  /** Red landmark artwork for the destination. */
  art: string;
}

const CHENNAI = place('pop-chennai', 'Chennai', 'Chennai, Tamil Nadu', 13.0827, 80.2707);

/** "A few favourites from Chennai": choosing one fills the booking form (the date and time stay the rider's choice). */
export const POPULAR_ROUTES: PopularRoute[] = [
  { id: 'trichy', from: 'Chennai', to: 'Trichy', pickup: CHENNAI, drop: place('pop-trichy', 'Trichy', 'Tiruchirappalli, Tamil Nadu', 10.7905, 78.7047), art: '/nesam/routes/trichy.webp' },
  { id: 'madurai', from: 'Chennai', to: 'Madurai', pickup: CHENNAI, drop: place('pop-madurai', 'Madurai', 'Madurai, Tamil Nadu', 9.9252, 78.1198), art: '/nesam/routes/madurai.webp' },
  { id: 'thanjavur', from: 'Chennai', to: 'Thanjavur', pickup: CHENNAI, drop: place('pop-thanjavur', 'Thanjavur', 'Thanjavur, Tamil Nadu', 10.787, 79.1378), art: '/nesam/routes/thanjavur.webp' },
  { id: 'puducherry', from: 'Chennai', to: 'Puducherry', pickup: CHENNAI, drop: place('pop-puducherry', 'Puducherry', 'Puducherry', 11.9416, 79.8083), art: '/nesam/routes/puducherry.webp' },
  { id: 'coimbatore', from: 'Chennai', to: 'Coimbatore', pickup: CHENNAI, drop: place('pop-coimbatore', 'Coimbatore', 'Coimbatore, Tamil Nadu', 11.0168, 76.9558), art: '/nesam/routes/coimbatore.webp' },
  { id: 'rameswaram', from: 'Chennai', to: 'Rameswaram', pickup: CHENNAI, drop: place('pop-rameswaram', 'Rameswaram', 'Rameswaram, Tamil Nadu', 9.2876, 79.3129), art: '/nesam/routes/rameswaram.webp' },
];

const airport = (id: string, name: string, address: string, lat: number, lng: number): GeoPlace => ({ id: `airport-${id}`, name, address, lat, lng, type: 'airport' });

export const AIRPORTS: GeoPlace[] = [
  airport('maa', 'Chennai International Airport (MAA)', 'Meenambakkam, Chennai, Tamil Nadu', 12.9941, 80.1709),
  airport('ixm', 'Madurai Airport (IXM)', 'Madurai, Tamil Nadu', 9.8345, 78.0934),
  airport('cjb', 'Coimbatore International Airport (CJB)', 'Peelamedu, Coimbatore, Tamil Nadu', 11.03, 77.0434),
  airport('trz', 'Tiruchirappalli International Airport (TRZ)', 'Tiruchirappalli, Tamil Nadu', 10.7654, 78.7097),
  airport('blr', 'Kempegowda International Airport (BLR)', 'Devanahalli, Bengaluru, Karnataka', 13.1986, 77.7066),
];

export const isAirportPlace = (p: GeoPlace | null | undefined) => !!p && (p.type === 'airport' || /\bairport\b/i.test(`${p.name} ${p.address}`));
