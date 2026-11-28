// Place names on a duty card: the town for the route, the pickup point without country, state and PIN code, and the states
// the trip runs through. The same rules as NESAM Partner (components/kit/format.ts there).

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

/** Straight-line distance between two points, in kilometres. */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
