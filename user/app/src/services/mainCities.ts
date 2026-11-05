// Main cities and towns riders book from, with the names people actually type ("Trichy",
// "Kovai", "Madras", "Pondy"). Place search puts a matching city first, because the map geocoder
// often answers a short city name with boundaries, wards and zones instead of the city itself.
import type { GeoPlace } from '../types';

interface MainCity {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** Other spellings and common names, lowercase. */
  aka?: string[];
}

const CITIES: MainCity[] = [
  // Tamil Nadu
  { id: 'chennai', name: 'Chennai', address: 'Chennai, Tamil Nadu', lat: 13.0827, lng: 80.2707, aka: ['madras'] },
  { id: 'coimbatore', name: 'Coimbatore', address: 'Coimbatore, Tamil Nadu', lat: 11.0168, lng: 76.9558, aka: ['kovai'] },
  { id: 'madurai', name: 'Madurai', address: 'Madurai, Tamil Nadu', lat: 9.9252, lng: 78.1198 },
  { id: 'trichy', name: 'Trichy', address: 'Tiruchirappalli, Tamil Nadu', lat: 10.7905, lng: 78.7047, aka: ['tiruchirappalli', 'tiruchirapalli', 'tiruchi', 'tiruchy'] },
  { id: 'salem', name: 'Salem', address: 'Salem, Tamil Nadu', lat: 11.6643, lng: 78.146 },
  { id: 'erode', name: 'Erode', address: 'Erode, Tamil Nadu', lat: 11.341, lng: 77.7172 },
  { id: 'tiruppur', name: 'Tiruppur', address: 'Tiruppur, Tamil Nadu', lat: 11.1085, lng: 77.3411, aka: ['tirupur'] },
  { id: 'vellore', name: 'Vellore', address: 'Vellore, Tamil Nadu', lat: 12.9165, lng: 79.1325 },
  { id: 'thanjavur', name: 'Thanjavur', address: 'Thanjavur, Tamil Nadu', lat: 10.787, lng: 79.1378, aka: ['tanjore'] },
  { id: 'kumbakonam', name: 'Kumbakonam', address: 'Kumbakonam, Tamil Nadu', lat: 10.9617, lng: 79.3881 },
  { id: 'tirunelveli', name: 'Tirunelveli', address: 'Tirunelveli, Tamil Nadu', lat: 8.7139, lng: 77.7567, aka: ['nellai'] },
  { id: 'thoothukudi', name: 'Thoothukudi', address: 'Thoothukudi, Tamil Nadu', lat: 8.7642, lng: 78.1348, aka: ['tuticorin'] },
  { id: 'nagercoil', name: 'Nagercoil', address: 'Nagercoil, Tamil Nadu', lat: 8.1833, lng: 77.4119 },
  { id: 'kanyakumari', name: 'Kanyakumari', address: 'Kanyakumari, Tamil Nadu', lat: 8.0883, lng: 77.5385, aka: ['cape comorin'] },
  { id: 'dindigul', name: 'Dindigul', address: 'Dindigul, Tamil Nadu', lat: 10.3673, lng: 77.9803 },
  { id: 'theni', name: 'Theni', address: 'Theni, Tamil Nadu', lat: 10.0104, lng: 77.4768 },
  { id: 'karur', name: 'Karur', address: 'Karur, Tamil Nadu', lat: 10.9601, lng: 78.0766 },
  { id: 'namakkal', name: 'Namakkal', address: 'Namakkal, Tamil Nadu', lat: 11.2189, lng: 78.1674 },
  { id: 'hosur', name: 'Hosur', address: 'Hosur, Tamil Nadu', lat: 12.7409, lng: 77.8253 },
  { id: 'krishnagiri', name: 'Krishnagiri', address: 'Krishnagiri, Tamil Nadu', lat: 12.5266, lng: 78.215 },
  { id: 'kanchipuram', name: 'Kanchipuram', address: 'Kanchipuram, Tamil Nadu', lat: 12.8342, lng: 79.7036, aka: ['kanchi', 'kancheepuram'] },
  { id: 'tiruvannamalai', name: 'Tiruvannamalai', address: 'Tiruvannamalai, Tamil Nadu', lat: 12.2253, lng: 79.0747 },
  { id: 'cuddalore', name: 'Cuddalore', address: 'Cuddalore, Tamil Nadu', lat: 11.748, lng: 79.7714 },
  { id: 'chidambaram', name: 'Chidambaram', address: 'Chidambaram, Tamil Nadu', lat: 11.3993, lng: 79.6915 },
  { id: 'nagapattinam', name: 'Nagapattinam', address: 'Nagapattinam, Tamil Nadu', lat: 10.7672, lng: 79.8449 },
  { id: 'velankanni', name: 'Velankanni', address: 'Velankanni, Tamil Nadu', lat: 10.6828, lng: 79.8486, aka: ['vailankanni'] },
  { id: 'pudukkottai', name: 'Pudukkottai', address: 'Pudukkottai, Tamil Nadu', lat: 10.3833, lng: 78.8001, aka: ['pudukottai'] },
  { id: 'karaikudi', name: 'Karaikudi', address: 'Karaikudi, Tamil Nadu', lat: 10.0731, lng: 78.7732 },
  { id: 'rameswaram', name: 'Rameswaram', address: 'Rameswaram, Tamil Nadu', lat: 9.2876, lng: 79.3129, aka: ['rameshwaram'] },
  { id: 'sivakasi', name: 'Sivakasi', address: 'Sivakasi, Tamil Nadu', lat: 9.4533, lng: 77.8024 },
  { id: 'pollachi', name: 'Pollachi', address: 'Pollachi, Tamil Nadu', lat: 10.6609, lng: 77.0048 },
  { id: 'palani', name: 'Palani', address: 'Palani, Tamil Nadu', lat: 10.45, lng: 77.52 },
  { id: 'ooty', name: 'Ooty', address: 'Udhagamandalam, Tamil Nadu', lat: 11.4102, lng: 76.695, aka: ['udhagamandalam', 'udagamandalam', 'ootacamund'] },
  { id: 'kodaikanal', name: 'Kodaikanal', address: 'Kodaikanal, Tamil Nadu', lat: 10.2381, lng: 77.4892, aka: ['kodai'] },
  { id: 'yercaud', name: 'Yercaud', address: 'Yercaud, Tamil Nadu', lat: 11.7753, lng: 78.2093 },
  { id: 'mahabalipuram', name: 'Mahabalipuram', address: 'Mamallapuram, Tamil Nadu', lat: 12.6208, lng: 80.1945, aka: ['mamallapuram'] },
  // Puducherry
  { id: 'pondicherry', name: 'Pondicherry', address: 'Puducherry', lat: 11.9416, lng: 79.8083, aka: ['puducherry', 'pondy'] },
  // Karnataka
  { id: 'bangalore', name: 'Bangalore', address: 'Bengaluru, Karnataka', lat: 12.9716, lng: 77.5946, aka: ['bengaluru'] },
  { id: 'mysore', name: 'Mysore', address: 'Mysuru, Karnataka', lat: 12.2958, lng: 76.6394, aka: ['mysuru'] },
  // Kerala
  { id: 'kochi', name: 'Kochi', address: 'Kochi, Kerala', lat: 9.9312, lng: 76.2673, aka: ['cochin', 'ernakulam'] },
  { id: 'trivandrum', name: 'Trivandrum', address: 'Thiruvananthapuram, Kerala', lat: 8.5241, lng: 76.9366, aka: ['thiruvananthapuram'] },
  { id: 'calicut', name: 'Calicut', address: 'Kozhikode, Kerala', lat: 11.2588, lng: 75.7804, aka: ['kozhikode'] },
  { id: 'thrissur', name: 'Thrissur', address: 'Thrissur, Kerala', lat: 10.5276, lng: 76.2144, aka: ['trichur'] },
  { id: 'palakkad', name: 'Palakkad', address: 'Palakkad, Kerala', lat: 10.7867, lng: 76.6548, aka: ['palghat'] },
  { id: 'alappuzha', name: 'Alappuzha', address: 'Alappuzha, Kerala', lat: 9.4981, lng: 76.3388, aka: ['alleppey'] },
  { id: 'munnar', name: 'Munnar', address: 'Munnar, Kerala', lat: 10.0889, lng: 77.0595 },
  { id: 'guruvayur', name: 'Guruvayur', address: 'Guruvayur, Kerala', lat: 10.5943, lng: 76.0411 },
  // Andhra Pradesh and Telangana
  { id: 'tirupati', name: 'Tirupati', address: 'Tirupati, Andhra Pradesh', lat: 13.6288, lng: 79.4192, aka: ['tirupathi'] },
  { id: 'hyderabad', name: 'Hyderabad', address: 'Hyderabad, Telangana', lat: 17.385, lng: 78.4867 },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Main cities whose name or common name starts with what the rider typed ("tri" → Trichy,
 * Trivandrum; "kovai" → Coimbatore), exact matches first. A longer query naming a place inside a
 * city ("trichy bus stand") matches nothing here, so the geocoder's own results lead.
 */
export function matchMainCities(query: string, limit = 2): GeoPlace[] {
  const q = norm(query.split(',')[0] ?? '');
  if (q.length < 3) return [];
  return CITIES.map((c) => {
    const names = [c.name, ...(c.aka ?? [])].map(norm);
    const exact = names.includes(q);
    return { c, exact, hit: exact || names.some((n) => n.startsWith(q)) };
  })
    .filter((m) => m.hit)
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.c.name.length - b.c.name.length)
    .slice(0, limit)
    .map(({ c }): GeoPlace => ({ id: `city-${c.id}`, name: c.name, address: c.address, type: 'other', lat: c.lat, lng: c.lng }));
}
