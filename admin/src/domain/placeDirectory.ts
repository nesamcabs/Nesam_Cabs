/**
 * Built-in cities and zones for the "Which location are you managing?" pickers, so they are never
 * empty. Cities and areas saved under Locations are added to these (see Pricing.tsx); rules keep
 * storing the plain names, so a saved "Chennai" and the built-in "Chennai" are the same place.
 *
 * Keys are GST state codes (the same codes the State picker uses). Zones are listed only where the
 * city corporation's official zones are known; any other area is added under Locations.
 */
export const CITIES_BY_STATE: Record<string, string[]> = {
  // Tamil Nadu: every district headquarters, plus the towns riders book from most.
  "33": [
    "Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore", "Dharmapuri", "Dindigul", "Erode", "Kallakurichi", "Kanchipuram",
    "Kanyakumari", "Karur", "Krishnagiri", "Madurai", "Mayiladuthurai", "Nagapattinam", "Namakkal", "Nilgiris", "Perambalur", "Pudukkottai",
    "Ramanathapuram", "Ranipet", "Salem", "Sivaganga", "Tenkasi", "Thanjavur", "Theni", "Thoothukudi", "Tiruchirappalli", "Tirunelveli",
    "Tirupathur", "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur", "Vellore", "Viluppuram", "Virudhunagar",
    "Chidambaram", "Coonoor", "Hosur", "Karaikudi", "Kodaikanal", "Kumbakonam", "Mahabalipuram", "Mettupalayam", "Nagercoil", "Ooty",
    "Palani", "Pollachi", "Rameswaram", "Sivakasi", "Velankanni", "Yercaud",
  ],
  "34": ["Puducherry", "Karaikal", "Mahe", "Yanam"],
  "29": [
    "Bengaluru", "Ballari", "Belagavi", "Chikkamagaluru", "Davanagere", "Hassan", "Hubballi", "Kalaburagi", "Madikeri", "Mangaluru",
    "Mysuru", "Shivamogga", "Tumakuru", "Udupi",
  ],
  "32": [
    "Thiruvananthapuram", "Alappuzha", "Guruvayur", "Idukki", "Kannur", "Kasaragod", "Kochi", "Kollam", "Kottayam", "Kozhikode",
    "Malappuram", "Munnar", "Palakkad", "Pathanamthitta", "Thrissur", "Wayanad",
  ],
  "37": [
    "Visakhapatnam", "Anantapur", "Chittoor", "Guntur", "Kadapa", "Kakinada", "Kurnool", "Nellore", "Ongole", "Rajahmundry",
    "Srikalahasti", "Tirupati", "Vijayawada",
  ],
  "36": ["Hyderabad", "Secunderabad", "Karimnagar", "Khammam", "Nizamabad", "Warangal"],
  "27": ["Mumbai", "Nagpur", "Pune"],
  "07": ["New Delhi"],
};

/** Official corporation zones, by city (lower-case key). */
export const ZONES_BY_CITY: Record<string, string[]> = {
  // Greater Chennai Corporation: 15 zones.
  chennai: [
    "Thiruvottiyur", "Manali", "Madhavaram", "Tondiarpet", "Royapuram", "Thiru Vi Ka Nagar", "Ambattur", "Anna Nagar", "Teynampet",
    "Kodambakkam", "Valasaravakkam", "Alandur", "Adyar", "Perungudi", "Sholinganallur",
  ],
  // Coimbatore City Municipal Corporation: 5 zones.
  coimbatore: ["Central", "East", "North", "South", "West"],
  // Salem City Municipal Corporation: 4 zones.
  salem: ["Ammapet", "Hasthampatti", "Kondalampatti", "Suramangalam"],
  // Bruhat Bengaluru Mahanagara Palike: 8 zones.
  bengaluru: ["Bommanahalli", "Dasarahalli", "East", "Mahadevapura", "Rajarajeshwari Nagar", "South", "West", "Yelahanka"],
  // Greater Hyderabad Municipal Corporation: 6 zones.
  hyderabad: ["Charminar", "Kukatpally", "Khairatabad", "LB Nagar", "Secunderabad", "Serilingampally"],
};

const norm = (v: string) => v.trim().toLocaleLowerCase();

/** The built-in cities of one state (its GST code), or of every listed state when none is chosen. */
export function directoryCities(stateCode: string): string[] {
  return stateCode ? CITIES_BY_STATE[stateCode] ?? [] : Object.values(CITIES_BY_STATE).flat();
}

/** The built-in zones of one city (matched by name, ignoring case). */
export function directoryZones(city: string): string[] {
  return city ? ZONES_BY_CITY[norm(city)] ?? [] : [];
}
