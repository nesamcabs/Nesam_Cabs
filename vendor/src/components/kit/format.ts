// Display helpers shared by every NESAM Partner page (India time, rupees, plates).
import type { MarketTrip, VendorBooking } from '../../types/operations';

const IST = 'Asia/Kolkata';

/** Whole rupees as "₹6,255"; an amount with paise always shows both digits ("₹6,255.30", never "₹6,255.3"). */
export const rupees = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : ((v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`)(Math.round(n * 100) / 100);

export const signed = (n: number): string => `${n < 0 ? '−' : '+'}${rupees(Math.abs(n))}`;

export const dayText = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' }).format(d) : '—';

export const weekdayText = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('en-GB', { timeZone: IST, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(d) : '—';

/** The plain numeric date used on the duty and booking cards: 13/11/2026 (no weekday or month name). */
export const numericDate = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d) : '—';

export const timeText = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('en-US', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true }).format(d) : '';

export const dayTime = (d: Date | null): string => (d ? `${dayText(d)} · ${timeText(d)}` : '—');

/** yyyy-mm-dd of an instant in India time (for grouping by pickup day). */
export const isoDay = (ms: number): string => (ms ? new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date(ms)) : '');

export const plate = (v: string): string => {
  const k = (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = k.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : v;
};

export const shortId = (id: string, prefix = 'NSM'): string => (id ? `${prefix}-${id.slice(0, 6).toUpperCase()}` : '—');

export const firstPart = (address: string): string => (address || '').split(',')[0]?.trim() || address || '—';

/** One label per trip type, the same words the customer apps use. */
export function tripTypeLabel(raw: string): string {
  const s = (raw || '').toLowerCase();
  // A Multicity tour is stored as a Round Trip through its cities, so it is recognised first.
  if (/multi/.test(s)) return 'Multicity';
  if (/round/.test(s)) return 'Round Trip';
  if (/airport/.test(s)) return 'Airport';
  if (/rental|hour|package/.test(s)) return 'Local Rental';
  if (/local|pickup\s*&|pickup and drop/.test(s)) return 'Pickup & Drop';
  if (/one|drop|outstation/.test(s)) return 'One Way';
  return raw || 'Trip';
}

export const marketType = (t: MarketTrip): string => tripTypeLabel(`${t.tripType} ${t.service}`);
export const marketFrom = (t: MarketTrip): string => townOf(t.pickup.city || t.pickup.address);
export const marketTo = (t: MarketTrip): string => townOf(t.drop.city || t.drop.address);

// The states duties run through, for the route's state tag ("TN-KL": pickup state, then drop state).
const STATES: [RegExp, string][] = [
  [/tamil\s*nadu/i, 'TN'], [/kerala/i, 'KL'], [/karnataka/i, 'KA'], [/andhra\s*pradesh/i, 'AP'], [/telangana/i, 'TG'],
  [/puducherry|pondicherry/i, 'PY'], [/maharashtra/i, 'MH'], [/\bgoa\b/i, 'GA'], [/odisha|orissa/i, 'OD'],
];

// Southern towns, with their other spellings, for an address that names neither the state nor a PIN code ("Trichy").
const TOWNS: [string, string][] = [
  ['TN', 'chennai|madras|coimbatore|kovai|madurai|trichy|tiruchi|tiruchy|tiruchirappalli|tiruchirapalli|trichirappalli|srirangam|salem|tirunelveli|nellai|erode|tiruppur|tirupur|vellore|thoothukudi|tuticorin|thanjavur|tanjore|dindigul|theni|periyakulam|bodinayakanur|bodi|cumbum|koduvilarpatty|andipatti|karur|namakkal|dharmapuri|krishnagiri|hosur|cuddalore|chidambaram|villupuram|viluppuram|kallakurichi|tiruvannamalai|thiruvannamalai|kanchipuram|kancheepuram|chengalpattu|mahabalipuram|mamallapuram|tambaram|tiruvallur|thiruvallur|ranipet|tirupathur|tirupattur|ariyalur|perambalur|pudukkottai|sivaganga|sivagangai|karaikudi|ramanathapuram|rameswaram|rameshwaram|virudhunagar|sivakasi|rajapalayam|tenkasi|courtallam|kutralam|kanyakumari|kanniyakumari|nagercoil|marthandam|tiruchendur|nagapattinam|velankanni|mayiladuthurai|tiruvarur|thiruvarur|kumbakonam|palani|kodaikanal|ooty|udhagamandalam|ootacamund|nilgiris|coonoor|gudalur|mettupalayam|pollachi|valparai|yercaud|hogenakkal|neyveli|tindivanam'],
  ['KL', 'thiruvananthapuram|trivandrum|kochi|cochin|ernakulam|kozhikode|calicut|thrissur|trichur|palakkad|palghat|kollam|quilon|alappuzha|alleppey|kottayam|idukki|munnar|thekkady|kumily|vagamon|kumarakom|kovalam|varkala|wayanad|kalpetta|sultan bathery|kannur|cannanore|kasaragod|malappuram|pathanamthitta|sabarimala|pamba|guruvayur|guruvayoor|athirappilly|athirapally|nilambur|kayamkulam|attingal|angamaly|aluva|nedumbassery'],
  ['KA', 'bengaluru|bangalore|mysuru|mysore|mangaluru|mangalore|hubballi|hubli|dharwad|belagavi|belgaum|ballari|bellary|davanagere|shivamogga|shimoga|tumakuru|tumkur|udupi|manipal|hassan|chikkamagaluru|chikmagalur|madikeri|coorg|kodagu|hampi|hosapete|hospet|gokarna|karwar|murudeshwar|dharmasthala|kalaburagi|gulbarga|bidar|vijayapura|bijapur|raichur|mandya|chitradurga|bagalkot|chikkaballapur|ramanagara|sakleshpur|bandipur|kolar'],
  ['AP', 'tirupati|tirupathi|tirumala|srikalahasti|chittoor|nellore|vijayawada|visakhapatnam|vizag|guntur|kurnool|kadapa|cuddapah|anantapur|kakinada|rajahmundry|ongole|eluru|tenali|vizianagaram|srikakulam|puttaparthi|madanapalle|hindupur|srisailam|mantralayam|amaravati'],
  ['TG', 'hyderabad|secunderabad|warangal|karimnagar|khammam|nizamabad|mahabubnagar|nalgonda|adilabad|bhadrachalam'],
  ['PY', 'puducherry|pondicherry|pondy|karaikal|mahe|yanam'],
];
const TOWN_STATE = new Map(TOWNS.flatMap(([code, names]) => names.split('|').map((n) => [n, code] as const)));
/** Words after a town that still mean the town ("Trichy Airport"); "Mysore Road" is a road, not Mysore. */
const AT_TOWN = /\s+(international airport|airport|central|junction|railway station|new bus stand|old bus stand|bus stand|bus station|city|town|district|dist)$/;

/** An address part that is only a state's name. */
const isStateName = (part: string) => STATES.find(([re]) => re.test(part) && !part.replace(re, '').trim())?.[1];

function townState(part: string): string | undefined {
  const name = part.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  return TOWN_STATE.get(name) ?? TOWN_STATE.get(name.replace(AT_TOWN, ''));
}

/** A southern state by PIN code. Puducherry town's codes (605001-605014) sit inside the Tamil Nadu range. */
function pinState(address: string): string {
  const pin = /\b([1-9]\d{5})\b/.exec(address)?.[1] ?? '';
  if (/^6050(0\d|1[0-4])$/.test(pin)) return 'PY';
  const n = Number(pin.slice(0, 2));
  return n >= 60 && n <= 64 ? 'TN' : n >= 67 && n <= 69 ? 'KL' : n >= 56 && n <= 59 ? 'KA' : n >= 51 && n <= 53 ? 'AP' : n === 50 ? 'TG' : '';
}

/**
 * An address's state: the state it names, else its PIN code, else a town it names (read from the end, where the town is),
 * else a state's name anywhere in it; '' when it does not say.
 */
export function stateOf(address: string): string {
  const parts = (address || '').split(',').map((p) => p.replace(/\b\d{6}\b/g, '').trim()).filter(Boolean).reverse();
  const first = (find: (part: string) => string | undefined) => parts.map(find).find(Boolean);
  return first(isStateName) || pinState(address || '') || first(townState) || STATES.find(([re]) => re.test(address || ''))?.[1] || '';
}

/** An address without its country, state and PIN code, part by part: ["Cumbum Road Junction", "Theni"]. */
export function placeParts(address: string): string[] {
  return (address || '').split(',').map((p) => p.replace(/\b\d{6}\b/g, '').trim())
    .filter((p) => p && !/^india$/i.test(p) && !STATES.some(([re]) => re.test(p) && !p.replace(re, '').trim()));
}

/** The town of an address: its last part before the state ("Theni"). */
export const townOf = (address: string): string => placeParts(address).pop() || (address || '').trim() || '—';

/** "TN-KL" (pickup state, drop state) for an interstate trip, "TN" within one state, '' when the addresses do not say. */
export function stateRoute(from: string, to: string): string {
  const a = stateOf(from);
  const b = stateOf(to);
  return a && b ? (a === b ? a : `${a}-${b}`) : a || b;
}
export const marketPickup = (t: MarketTrip): Date | null => (t.pickupMs ? new Date(t.pickupMs) : null);

export const bookingPickup = (b: VendorBooking): Date | null => b.pickupAt;
export const bookingWhen = (b: VendorBooking): string => (b.pickupAt ? dayTime(b.pickupAt) : [b.date, b.time].filter(Boolean).join(' · ') || '—');

/** Which artwork from the reference best matches a vehicle. */
export function carArt(category: string, model = ''): 'sedan' | 'suv' | 'innova' | 'crysta' | 'carens' {
  const s = `${category} ${model}`.toLowerCase();
  if (/carens/.test(s)) return 'carens';
  if (/crysta/.test(s)) return 'crysta';
  if (/innova|premium suv|tempo|traveller|bus/.test(s)) return 'innova';
  if (/suv|ertiga|xuv|muv|6\+1|7/.test(s)) return 'suv';
  return 'sedan';
}

export const initials = (name: string): string =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
