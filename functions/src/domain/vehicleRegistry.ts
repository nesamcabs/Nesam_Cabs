// Vehicle identity from the national VAHAN register.
//
// There is no public mParivahan / VAHAN API for private companies: the data is
// reachable only through a licensed intermediary (or an approved government
// requester account). This module is provider-neutral — it normalises the
// registration number, maps whatever record the configured provider returns to
// one internal shape and derives the NESAM category from it. It performs no I/O.
//
// Everything derived here (category, seating class) is a SUGGESTION for the
// onboarding form and the admin reviewer. It is never an approval.

export type VehicleCategoryName = 'Hatchback' | 'Sedan' | 'SUV' | 'Premium SUV' | 'Tempo Traveller';
/** Eligibility classes of the tariff spec (page 14). */
export type SpecVehicleClass = 'Sedan' | 'SUV' | 'Innova' | 'Crysta' | 'Tempo Traveller';

export interface VehicleValidity {
  /** ISO dates (YYYY-MM-DD) in Indian calendar terms; '' when the register has none. */
  fitnessUpto: string;
  insuranceUpto: string;
  permitUpto: string;
  taxUpto: string;
  pucUpto: string;
}

export interface VehicleRecord {
  registrationNumber: string;
  make: string;
  model: string;
  variant: string;
  fuelType: string;
  /** Seating capacity as printed on the RC — it includes the driver's seat. */
  seatingCapacity: number;
  /** Passenger seats = RC capacity − the driver's seat. */
  passengerSeats: number;
  /** "6+1" / "7+1" notation of the tariff spec. */
  seatClass: string;
  manufactureYear: string;
  colour: string;
  vehicleClass: string;
  /** commercial = a transport (cab/taxi) class; private = personal-use class. */
  usage: 'commercial' | 'private' | 'unknown';
  registrationStatus: string;
  registrationActive: boolean | null;
  registeredAt: string;
  ownerNameMasked: string;
  category: VehicleCategoryName;
  specClass: SpecVehicleClass;
  validity: VehicleValidity;
}

// ── Registration number ───────────────────────────────────────────────────────

const STANDARD = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/;
const BHARAT = /^(\d{2})(BH)(\d{4})([A-Z]{1,2})$/;

/** Upper-case, no spaces, hyphens or dots: "tn 01-ab 1234" → "TN01AB1234". */
export function normalizeRegistration(input: unknown): string {
  return typeof input === 'string' ? input.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}

export function isValidRegistration(input: unknown): boolean {
  const n = normalizeRegistration(input);
  if (n.length < 6 || n.length > 11) return false;
  const m = STANDARD.exec(n);
  // A standard plate needs a district number and a serial: "TN" + "01" + "AB" + "1234".
  if (m) return m[4].length >= 1 && (m[3].length > 0 || m[4].length >= 4);
  return BHARAT.test(n);
}

/** "TN01AB1234" → "TN 01 AB 1234" (display and legacy-record matching). */
export function spacedRegistration(input: unknown): string {
  const n = normalizeRegistration(input);
  const m = STANDARD.exec(n);
  if (m) return [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ');
  const b = BHARAT.exec(n);
  return b ? `${b[1]} ${b[2]} ${b[3]} ${b[4]}` : n;
}

/** Spellings under which an existing record may have stored the same plate. */
export function registrationVariants(input: unknown): string[] {
  const n = normalizeRegistration(input);
  if (!n) return [];
  const spaced = spacedRegistration(n);
  return [...new Set([n, spaced, spaced.replace(/ /g, '-')])];
}

// ── Dates ─────────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Accepts YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY and DD-MMM-YYYY; anything else (incl. "LTT") → ''. */
export function toIsoDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  const ok = (y: number, m: number, d: number) => {
    if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return '';
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (probe.getUTCMonth() !== m - 1) return '';
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return ok(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ,]+(\d{4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return ok(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return '';
}

/** A document is valid through its expiry day (Indian calendar). */
export const isExpired = (iso: string, today: string): boolean => !!iso && iso < today;

/** Today's date in India as YYYY-MM-DD. */
export function indiaToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// ── Mapping a provider record ─────────────────────────────────────────────────

type Raw = Record<string, unknown>;

/** First non-empty string among the given keys (providers disagree on names). */
function pick(raw: Raw, keys: string[]): string {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim() && !/^(null|na|n\/a|none|-+)$/i.test(v.trim())) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** "RAVI KUMAR" → "R••• K•••": enough for the reviewer to recognise, nothing more. */
export function maskName(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).map((w) => `${w[0].toUpperCase()}•••`).join(' ');
}

export function normalizeFuel(raw: string): string {
  const f = raw.toUpperCase();
  if (!f) return '';
  if (/ELECTRIC|BATTERY|EV\b/.test(f)) return 'Electric';
  if (/CNG/.test(f)) return 'CNG';
  if (/LPG/.test(f)) return 'LPG';
  if (/DIESEL/.test(f)) return 'Diesel';
  if (/PETROL/.test(f)) return 'Petrol';
  if (/HYBRID/.test(f)) return 'Hybrid';
  return title(raw);
}

const HATCHBACKS = /\b(swift|alto|wagon\s?r|celerio|ignis|baleno|s-?presso|eeco|i10|i20|santro|grand i10|tiago|altroz|punch|kwid|triber|redi|polo|figo|glanza|brio|jazz|micra|go\b|zen|a-?star|ritz|estilo|spark|beat)\b/i;
const MPV_OR_SUV_7 = /\b(ertiga|xl6|innova|crysta|hycross|marazzo|carens|xylo|bolero|scorpio|tavera|enjoy|lodgy|triber|rumion|invicto|safari|hector plus|alcazar|fortuner|gloster)\b/i;

/**
 * Suggests the NESAM category. Seating is the strongest signal: the tariff
 * classes are defined by passenger seats (page 14), so a 5-seat vehicle can
 * never be an SUV 6+1 however it is marketed.
 */
export function detectCategory(model: string, make: string, seatingCapacity: number): { category: VehicleCategoryName; specClass: SpecVehicleClass } {
  const label = `${make} ${model}`;
  if (/crysta/i.test(label)) return { category: 'Premium SUV', specClass: 'Crysta' };
  if (/tempo|traveller|traveler|urbania|winger|mini\s?bus|\bbus\b/i.test(label) || seatingCapacity >= 10) return { category: 'Tempo Traveller', specClass: 'Tempo Traveller' };
  if (/innova|hycross/i.test(label) && seatingCapacity >= 7) return { category: 'SUV', specClass: 'Innova' };
  if (seatingCapacity >= 7) return { category: 'SUV', specClass: 'SUV' };
  if (HATCHBACKS.test(label) && !MPV_OR_SUV_7.test(label)) return { category: 'Hatchback', specClass: 'Sedan' };
  return { category: 'Sedan', specClass: 'Sedan' };
}

function usageOf(vehicleClass: string, category: string): VehicleRecord['usage'] {
  const t = `${vehicleClass} ${category}`.toUpperCase();
  if (!t.trim()) return 'unknown';
  // Negated forms first: "NON-TRANSPORT" and "NON-COMMERCIAL" contain the words below.
  if (/NON[- ]?(TRANSPORT|COMMERCIAL)|PRIVATE|PERSONAL|\(NT\)/.test(t)) return 'private';
  if (/CAB|TAXI|TRANSPORT|PUBLIC SERVICE|TOURIST|\bPSV\b|CONTRACT CARRIAGE|\(T\)|T-BOARD|COMMERCIAL/.test(t)) return 'commercial';
  // A bare "Motor Car" class is used for taxis and private cars alike: not decidable here.
  return 'unknown';
}

function activeOf(status: string): boolean | null {
  if (!status) return null;
  if (/CANCEL|SUSPEND|EXPIRED|SCRAP|BLACKLIST|TRANSFER|NOT ACTIVE|INACTIVE|DEREGISTER|CONDEMN|STOLEN|SEIZED/i.test(status)) return false;
  if (/ACTIVE|VALID|REGISTERED|LIVE/i.test(status)) return true;
  return null;
}

function yearOf(raw: Raw): string {
  const direct = pick(raw, ['manufacture_year', 'manufacturing_year', 'mfg_year', 'year_of_manufacture', 'model_year']);
  if (/^\d{4}$/.test(direct)) return direct;
  const text = pick(raw, ['manufacturing_date_formatted', 'manufacturing_date', 'manufacturing_month_year', 'mfg_date', 'mfg_month_year']);
  const m = /(19|20)\d{2}/.exec(text);
  return m ? m[0] : '';
}

/** The record object inside a provider envelope ({ data: {...} } or the object itself). */
export function unwrapProviderPayload(body: unknown): Raw | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Raw;
  for (const k of ['data', 'result', 'response', 'vehicle', 'rc']) {
    const v = b[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Raw;
  }
  return pick(b, ['rc_number', 'registration_number', 'reg_no', 'regn_no', 'vehicle_number']) ? b : null;
}

/**
 * Maps a provider record. Returns null when the payload carries no registration
 * number at all (treated as "not found" by the caller, never as an empty vehicle).
 */
export function mapProviderRecord(payload: unknown, requestedRegistration = ''): VehicleRecord | null {
  const raw = unwrapProviderPayload(payload);
  if (!raw) return null;
  const registrationNumber = normalizeRegistration(pick(raw, ['rc_number', 'registration_number', 'reg_no', 'regn_no', 'vehicle_number']) || requestedRegistration);
  if (!registrationNumber) return null;

  const make = title(pick(raw, ['maker_description', 'maker', 'manufacturer', 'make', 'vehicle_maker', 'maker_name']));
  const model = title(pick(raw, ['maker_model', 'model', 'vehicle_model', 'model_name']));
  const variant = title(pick(raw, ['vehicle_variant', 'variant']));
  const seatsRaw = Number(pick(raw, ['seat_capacity', 'seating_capacity', 'seat_cap', 'no_of_seats', 'seats']));
  const seatingCapacity = Number.isFinite(seatsRaw) && seatsRaw > 0 && seatsRaw <= 80 ? Math.round(seatsRaw) : 0;
  const passengerSeats = Math.max(0, seatingCapacity - 1);
  const vehicleClass = pick(raw, ['vehicle_category', 'vehicle_class', 'vehicle_class_desc', 'class', 'vehicle_type']);
  const status = pick(raw, ['rc_status', 'status', 'registration_status']);
  // The requested plate alone proves nothing: a record must say what the vehicle is.
  if (!make && !model && !seatingCapacity) return null;
  const { category, specClass } = detectCategory(model, make, seatingCapacity);

  return {
    registrationNumber,
    make,
    model,
    variant,
    fuelType: normalizeFuel(pick(raw, ['fuel_type', 'fuel_descr', 'fuel', 'fuel_description'])),
    seatingCapacity,
    passengerSeats,
    seatClass: passengerSeats > 0 ? `${passengerSeats}+1` : '',
    manufactureYear: yearOf(raw),
    colour: title(pick(raw, ['color', 'colour', 'vehicle_colour', 'vehicle_color'])),
    vehicleClass,
    usage: usageOf(vehicleClass, pick(raw, ['vehicle_category_description', 'vehicle_class_description', 'norms_type'])),
    registrationStatus: status,
    registrationActive: activeOf(status),
    registeredAt: pick(raw, ['registered_at', 'registration_office', 'rto', 'office_name']),
    ownerNameMasked: maskName(pick(raw, ['owner_name', 'owner', 'masked_name']).replace(/[•*]+/g, '').trim()),
    category,
    specClass,
    validity: {
      fitnessUpto: toIsoDate(pick(raw, ['fit_up_to', 'fitness_upto', 'fitness_valid_upto', 'fit_upto', 'fitness_validity'])),
      insuranceUpto: toIsoDate(pick(raw, ['insurance_upto', 'insurance_valid_upto', 'insurance_validity', 'insurance_expiry'])),
      permitUpto: toIsoDate(pick(raw, ['permit_valid_upto', 'permit_upto', 'permit_validity', 'permit_expiry'])),
      taxUpto: toIsoDate(pick(raw, ['tax_upto', 'tax_paid_upto', 'tax_validity'])),
      pucUpto: toIsoDate(pick(raw, ['pucc_upto', 'puc_upto', 'pucc_valid_upto', 'puc_validity'])),
    },
  };
}

// ── Review signals ────────────────────────────────────────────────────────────

export interface VehicleIssue {
  code: 'registration_inactive' | 'not_commercial' | 'insurance_expired' | 'fitness_expired' | 'permit_expired' | 'seating_missing';
  message: string;
}

/** Problems the register itself reports. They inform the reviewer; they do not decide. */
export function vehicleIssues(r: VehicleRecord, today = indiaToday()): VehicleIssue[] {
  const out: VehicleIssue[] = [];
  if (r.registrationActive === false) out.push({ code: 'registration_inactive', message: `Registration status is "${r.registrationStatus}".` });
  if (r.usage === 'private') out.push({ code: 'not_commercial', message: 'The register lists a private (non-transport) vehicle class.' });
  if (isExpired(r.validity.insuranceUpto, today)) out.push({ code: 'insurance_expired', message: `Insurance expired on ${r.validity.insuranceUpto}.` });
  if (isExpired(r.validity.fitnessUpto, today)) out.push({ code: 'fitness_expired', message: `Fitness certificate expired on ${r.validity.fitnessUpto}.` });
  if (isExpired(r.validity.permitUpto, today)) out.push({ code: 'permit_expired', message: `Permit expired on ${r.validity.permitUpto}.` });
  if (!r.seatingCapacity) out.push({ code: 'seating_missing', message: 'Seating capacity is not on the register record.' });
  return out;
}

// ── Provider configuration ────────────────────────────────────────────────────

export interface ProviderConfig {
  url: string;
  apiKey: string;
  /** Header that carries the credential; "Authorization" sends it as a Bearer token. */
  authHeader: string;
  /** Request body field that carries the registration number. */
  idField: string;
  provider: string;
}

const DEFAULT_URLS: Record<string, string> = { surepass: 'https://kyc-api.surepass.io/api/v1/rc/rc-full' };

/** null when the deployment has no provider credentials — the lookup is then "not configured". */
export function providerConfigFromEnv(env: Record<string, string | undefined>): ProviderConfig | null {
  const provider = (env.VEHICLE_LOOKUP_PROVIDER ?? '').trim().toLowerCase();
  const apiKey = (env.VEHICLE_LOOKUP_API_KEY ?? '').trim();
  const url = (env.VEHICLE_LOOKUP_API_URL ?? '').trim() || DEFAULT_URLS[provider] || '';
  if (!provider || !apiKey || !/^https:\/\//i.test(url)) return null;
  return {
    url,
    apiKey,
    authHeader: (env.VEHICLE_LOOKUP_AUTH_HEADER ?? '').trim() || 'Authorization',
    idField: (env.VEHICLE_LOOKUP_ID_FIELD ?? '').trim() || 'id_number',
    provider,
  };
}
