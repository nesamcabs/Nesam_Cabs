// Demo data plan — every pricing and settings value the "Demo setup" page publishes, as plain data (no imports, no Firebase).
// The page sends each step through the same validated server functions the admin screens use (saveTariffSection, savePlatformFee,
// saveNightAllowance, saveTariffConfig, saveFixedRouteFare), so nothing here can bypass a check, and the emulator test runs this very file.
//
// Where the numbers come from:
//  • Sedan: Round Trip & Hill Station Developer Guide v8 — ₹14/km, ₹500 bata, 250 km/day (Full Day ₹4,000), 5-Hour ₹2,080 / 100 km,
//    8-Hour ₹2,780 / 150 km, Morning Return ₹4,500 / 250 km.
//  • One Way sedan/SUV/Crysta: the owner-confirmed tariff of 09 Oct 2026 (₹15 / ₹20 / ₹26 per km, ₹400 / ₹400 / ₹600 allowance, 130 km minimum).
//  • Everything else: demo values placed inside today's Tamil Nadu outstation / city-taxi market (Dzire-class ₹13–15/km, Ertiga ₹17–20,
//    Innova ₹19–22, Crysta ₹23–27; 8-hour rentals ₹2,400–2,800 sedan, ₹3,800–4,300 Innova, ₹4,800–5,500 Crysta; hill-road allowance ₹500–1,500).
//    They are DEMO amounts, easy to replace later in Admin → Pricing.

export type DemoClass = 'hatchback' | 'sedan' | 'suv' | 'suv7' | 'innova' | 'crysta';
export const DEMO_CLASSES: readonly DemoClass[] = ['hatchback', 'sedan', 'suv', 'suv7', 'innova', 'crysta'];
export const CLASS_NAME: Record<DemoClass, string> = { hatchback: 'Hatchback', sedan: 'Sedan', suv: 'SUV 6+1', suv7: 'SUV 7+1', innova: 'Innova', crysta: 'Innova Crysta' };

export const DEMO_REASON = 'Demo data setup (Round Trip guide v8)';

interface Rate { ow: [number, number, number, number]; rt: [number, number, number, number]; extra: { waiting: number } }
/** [customerRate, customerBata, partnerRate, partnerBata] for One Way (ow) and Round Trip (rt). */
const RATES: Record<DemoClass, Rate> = {
  hatchback: { ow: [14, 350, 12.6, 260], rt: [13, 450, 11.7, 350], extra: { waiting: 120 } },
  sedan: { ow: [15, 400, 13.5, 300], rt: [14, 500, 12.6, 400], extra: { waiting: 150 } },
  suv: { ow: [20, 400, 18, 300], rt: [19, 500, 17.1, 400], extra: { waiting: 200 } },
  suv7: { ow: [21, 450, 18.9, 350], rt: [20, 500, 18, 400], extra: { waiting: 200 } },
  innova: { ow: [22, 500, 19.8, 400], rt: [21, 600, 18.9, 450], extra: { waiting: 250 } },
  crysta: { ow: [26, 600, 24, 400], rt: [23, 700, 20.7, 500], extra: { waiting: 300 } },
};
const MIN_KM_PER_DAY = 250;
const to10 = (n: number) => Math.round(n / 10) * 10;
const to5 = (n: number) => Math.round(n / 5) * 5;

/** Full-Day Return of a class: km per day × customer rate + allowance (what the guide calls the ₹4,000 Sedan day). */
export const fullDayFare = (c: DemoClass) => RATES[c].rt[0] * MIN_KM_PER_DAY + RATES[c].rt[1];

/** Sedan exactly as the guide; every other class scaled by how its Full Day compares with the Sedan's. Partner keeps the class's own share. */
export function timeBasedAmounts(c: DemoClass) {
  const k = c === 'sedan' ? 1 : fullDayFare(c) / fullDayFare('sedan');
  const share = RATES[c].rt[2] / RATES[c].rt[0];
  const fare = (sedan: number) => (c === 'sedan' ? sedan : to10(sedan * k));
  const pay = (sedan: number) => to10((c === 'sedan' ? sedan : sedan * k) * share);
  return {
    fiveFare: fare(2080), fiveKm: 100, fivePartner: pay(2080),
    eightFare: fare(2780), eightKm: 150, eightPartner: pay(2780),
    morningFare: fare(4500), morningKm: 250, morningPartner: pay(4500),
  };
}

/** Hill station allowance [oneWay customer, oneWay partner, roundTrip customer, roundTrip partner]. */
const HILL: Record<DemoClass, [number, number, number, number]> = {
  hatchback: [450, 350, 700, 560],
  sedan: [500, 400, 800, 650], suv: [600, 500, 1000, 800], suv7: [700, 550, 1100, 900], innova: [800, 650, 1200, 1000], crysta: [1000, 800, 1500, 1250],
};

/** Local Pickup & Drop (inside one city): [minKm, customerRate, partnerRate, extraKmRate, waitingPerHour]. */
const LOCAL: Record<DemoClass, [number, number, number, number, number]> = {
  hatchback: [5, 14, 12, 14, 100],
  sedan: [5, 16, 14, 16, 120], suv: [5, 22, 19, 22, 160], suv7: [5, 24, 21, 24, 170], innova: [5, 26, 23, 26, 200], crysta: [5, 32, 28, 32, 250],
};
/** Airport transfer [customerBase, partnerBase, includedKm, extraKmRate, partnerExtraKmRate, waitingPerHour]. */
const AIRPORT: Record<DemoClass, [number, number, number, number, number, number]> = {
  hatchback: [950, 780, 25, 13, 11, 120],
  sedan: [1100, 900, 25, 14, 12, 150], suv: [1500, 1250, 25, 19, 17, 200], suv7: [1600, 1320, 25, 20, 18, 200], innova: [1800, 1500, 25, 21, 19, 250], crysta: [2300, 1900, 25, 24, 21, 300],
};

/** Rental packages: sedan [fare, km] per hours; other classes scale the fare. */
const RENTAL_SEDAN: Record<number, [number, number]> = { 4: [1400, 40], 5: [1700, 50], 6: [1950, 60], 8: [2500, 80], 10: [2950, 100], 12: [3400, 120] };
const RENTAL_SCALE: Record<DemoClass, number> = { hatchback: 0.9, sedan: 1, suv: 1.35, suv7: 1.45, innova: 1.6, crysta: 2 };
const RENTAL_MIN_HOURS: Record<DemoClass, number> = { hatchback: 4, sedan: 4, suv: 4, suv7: 4, innova: 4, crysta: 6 };
const EXTRA_HOUR: Record<DemoClass, number> = { hatchback: 220, sedan: 250, suv: 330, suv7: 350, innova: 400, crysta: 500 };

export interface TariffCall {
  /** Stable key for the progress list. */
  id: string;
  label: string;
  /** The body of one saveTariffSection call (reason and `latest` are added by the runner). */
  body: Record<string, unknown>;
}

export interface DemoContext {
  /** Active vehicle categories (extra charges are saved per category). */
  categories: { id: string; name: string }[];
  /** Active cities of the location master (Local Pickup & Drop is saved per city). */
  cities: { id: string; name: string }[];
}

/** The big metros: their city taxi fares are 15% higher than everywhere else in the country. */
export const METRO_CITIES = ['mumbai', 'new delhi', 'delhi', 'bengaluru', 'chennai', 'hyderabad', 'kolkata', 'pune', 'ahmedabad'];

const classOfName = (name: string): DemoClass => {
  const n = name.toLowerCase();
  if (/crysta/.test(n)) return 'crysta';
  if (/innova/.test(n)) return 'innova';
  if (/7\s*\+\s*1/.test(n)) return 'suv7';
  if (/(suv|xuv|ertiga|marazzo|scorpio|muv|mpv)/.test(n)) return 'suv';
  if (/(hatch|wagon\s?r|alto|i10|celerio|kwid|tiago|micro)/.test(n)) return 'hatchback';
  return 'sedan';
};

/** The saveTariffSection calls, in the order they are sent. */
export function buildTariffCalls(ctx: DemoContext): TariffCall[] {
  const calls: TariffCall[] = [];
  const add = (id: string, label: string, body: Record<string, unknown>) => calls.push({ id, label, body });

  // 1 · Base rates: One Way + Round Trip for every vehicle class, extra km and waiting, and the airport base fare.
  const classes: Record<string, unknown> = {};
  for (const c of DEMO_CLASSES) {
    const r = RATES[c];
    classes[c] = {
      oneWay: { customerRate: r.ow[0], customerBata: r.ow[1], partnerRate: r.ow[2], partnerBata: r.ow[3] },
      roundTrip: { customerRate: r.rt[0], customerBata: r.rt[1], partnerRate: r.rt[2], partnerBata: r.rt[3], minKmPerDay: MIN_KM_PER_DAY },
      oneWayExtra: { extraKmRate: r.ow[0], waitingPerHour: r.extra.waiting },
      roundTripExtra: { extraKmRate: r.rt[0], waitingPerHour: r.extra.waiting },
      outstationExtra: { extraKmRate: r.rt[0], waitingPerHour: r.extra.waiting },
    };
  }
  add('base-rates', 'Base rates · One Way and Round Trip for 5 vehicle classes', {
    section: 'baseRates', data: { oneWayMinKm: 130, airport: { customerBase: AIRPORT.sedan[0], partnerBase: AIRPORT.sedan[1] }, classes },
  });

  // 2 · Airport transfer per class (included km, extra km, waiting).
  for (const c of DEMO_CLASSES) {
    const a = AIRPORT[c];
    add(`airport-${c}`, `Airport transfer · ${CLASS_NAME[c]}`, {
      section: 'brandOverride', brand: 'common', service: 'Airport Taxi', class: c,
      data: { customerBase: a[0], partnerBase: a[1], minKm: a[2], extraKmRate: a[3], partnerRate: a[4], waitingPerHour: a[5] },
    });
  }

  // 3 · Time-based Round Trip (guide v8): switched on, with every class's 5-hour / 8-hour / Morning Return amounts.
  const tbClasses: Record<string, unknown> = {};
  for (const c of DEMO_CLASSES) tbClasses[c] = timeBasedAmounts(c);
  add('time-based', 'Round Trip packages · 5-Hour, 8-Hour, Full-Day, Next-Day, Morning Return', {
    section: 'roundTripTimeBased',
    data: {
      enabled: true,
      settings: { cutoffMinutes: 1425, morningCutoffMinutes: 540, nextDayEightFromMinutes: 900, nextDayFiveFromMinutes: 1320, shortKmLimit: 150, fiveKmLimit: 100, lateNightEndMinutes: 60, fiveHours: 5, eightHours: 8 },
      classes: tbClasses,
    },
  });

  // 4 · Hill station allowance (One Way and Round Trip slab per class), switched on.
  const hillClasses: Record<string, unknown> = {};
  for (const c of DEMO_CLASSES) {
    const h = HILL[c];
    hillClasses[c] = { oneWay: { customer: h[0], partner: h[1] }, roundTrip: { customer: h[2], partner: h[3] } };
  }
  add('hill-station', 'Hill Station Allowance / Charge · 15 hill stations', { section: 'hillStation', data: { enabled: true, chargePer: 'trip', classes: hillClasses } });

  // 5 · Pet travel (common).
  add('pet-charge', 'Pet travel charge', { section: 'petCharge', data: { petCharge: 300 } });

  // 6 · Extra charges per vehicle category: waiting and roof carrier (the hill charge is its own section above).
  const rows: Record<string, unknown> = {};
  for (const cat of ctx.categories) {
    const c = classOfName(cat.name);
    const waiting = RATES[c].extra.waiting;
    rows[cat.id] = {
      customer: { waitingPerHour: waiting, ...(c === 'sedan' ? {} : { carrier: 400 }) },
      partner: { waitingPerHour: Math.round(waiting * 0.85), ...(c === 'sedan' ? {} : { carrier: 340 }) },
    };
  }
  if (Object.keys(rows).length) {
    add('extra-charges', 'Extra charges · waiting and roof carrier per vehicle', {
      section: 'extraCharges', data: { freeWaitingMinutes: 30, waitingRoundingMinutes: 15, waitingRoundingScope: 'per_stop', taxTreatment: 'tariff_gst', categories: rows },
    });
  }

  // 7 · Rental packages: minimum hours per class, then 4/5/6/8/10/12-hour packages above it.
  for (const c of DEMO_CLASSES) {
    add(`rental-min-${c}`, `Rental minimum · ${CLASS_NAME[c]}`, { section: 'rentalMinimum', class: c, minHours: RENTAL_MIN_HOURS[c] });
    for (const hours of Object.keys(RENTAL_SEDAN).map(Number)) {
      if (hours < RENTAL_MIN_HOURS[c]) continue;
      const [fare, km] = RENTAL_SEDAN[hours]!;
      const customerFare = to10(fare * RENTAL_SCALE[c]);
      add(`rental-${c}-${hours}`, `Rental ${hours}-hour · ${CLASS_NAME[c]}`, {
        section: 'rentalPackage', class: c, hours,
        data: { enabled: true, gstMode: 'included', customerFare, partnerPayout: to10(customerFare * 0.85), includedKm: km, extraKmRate: RATES[c].rt[0], extraHourRate: EXTRA_HOUR[c] },
      });
    }
  }

  // 8 · GST: each service's default rule (5%, included in the entered fares, supplier state Tamil Nadu).
  for (const service of ['One Way', 'Round Trip', 'Airport Taxi', 'Local Rental', 'Multicity']) {
    add(`gst-${service}`, `GST · ${service}`, {
      section: 'fareGst', brand: 'common', service,
      data: { state: '', rule: { supplierState: '33', rate: 0.05, mode: 'included', classification: service === 'Local Rental' ? 'rental' : 'passenger', reference: 'Demo setup — confirm the rate with your CA' } },
    });
  }

  // 9 · Brand pricing: People Taxi is a little cheaper, One Way Car Rentals a little dearer, on One Way Sedan and SUV 6+1.
  for (const [brand, adj, label] of [['people_taxi', -0.5, 'People Taxi'], ['onewaycarrentals', 0.5, 'One Way Car Rentals']] as const) {
    for (const c of ['sedan', 'suv'] as const) {
      const r = RATES[c].ow;
      add(`brand-${brand}-${c}`, `${label} price · One Way ${CLASS_NAME[c]}`, {
        section: 'brandOverride', brand, service: 'One Way', class: c, data: { customerRate: r[0] + adj, partnerRate: r[2] + (adj > 0 ? 0.45 : -0.45), extraKmRate: r[0] + adj },
      });
    }
  }

  // 10 · Local Pickup & Drop (inside one city) for EVERY active city of the location master, in one versioned save.
  const fares: Record<string, unknown> = {};
  for (const city of ctx.cities) {
    const k = METRO_CITIES.includes(city.name.trim().toLowerCase()) ? 1.15 : 1;
    const byClass: Record<string, unknown> = {};
    for (const c of DEMO_CLASSES) {
      const l = LOCAL[c];
      byClass[c] = { enabled: true, minKm: l[0], customerRate: to5(l[1] * k * 10) / 10, partnerRate: to5(l[2] * k * 10) / 10, extraKmRate: to5(l[3] * k * 10) / 10, waitingPerHour: to5(l[4] * k) };
    }
    fares[city.id] = byClass;
  }
  if (Object.keys(fares).length) add('local-all-cities', `Local Pickup & Drop · all ${Object.keys(fares).length} cities × 5 vehicle classes`, { section: 'localPickupDropBulk', data: { fares } });
  return calls;
}

/**
 * The calls still worth sending. With `replace` every call is sent; otherwise (the safe default) anything the saved tariff already has is
 * left exactly as it is: a section is skipped when its values exist, and the all-cities fare list only carries the cities without a fare.
 * `tariff` is business_config/tariff_v2 as stored (null when nothing is saved yet).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pendingTariffCalls(calls: TariffCall[], tariff: any | null, replace: boolean): TariffCall[] {
  if (replace || !tariff) return calls;
  const t = tariff;
  const every = (obj: unknown) => !!obj && DEMO_CLASSES.every((c) => !!(obj as Record<string, unknown>)[c]);
  const done = (c: TariffCall): boolean => {
    const id = c.id;
    if (id === 'base-rates') return every(t.oneWay?.classes) && every(t.roundTrip?.classes);
    if (id.startsWith('airport-')) { const k = id.slice(8); return !!(t.brandOverrides?.common?.['Airport Taxi']?.[k]?.customerBase || t.airportClasses?.[k]?.customerBase); }
    if (id === 'time-based') return t.roundTrip?.timeBased?.enabled === true && DEMO_CLASSES.every((k) => !!t.roundTrip?.classes?.[k]?.timeBased);
    if (id === 'hill-station') return t.hillStation?.enabled === true;
    if (id === 'pet-charge') return typeof t.petCharge === 'number' && t.petCharge > 0;
    if (id === 'extra-charges') { const rows = (c.body.data as { categories: Record<string, unknown> }).categories; return Object.keys(rows).every((k) => !!t.extraCharges?.categories?.[k]); }
    if (id.startsWith('rental-min-')) return !!t.rentalPackages?.[id.slice(11)]?.minHours;
    if (id.startsWith('rental-')) { const [, cls, hours] = id.split('-'); return !!t.rentalPackages?.[cls!]?.packages?.[hours!]; }
    if (id.startsWith('gst-')) return !!t.fareGst?.common?.[id.slice(4)]?.default;
    if (id.startsWith('brand-')) { const [, brand, cls] = id.split('-'); return !!t.brandOverrides?.[brand!]?.['One Way']?.[cls!]; }
    return false;
  };
  const out: TariffCall[] = [];
  for (const c of calls) {
    if (c.id === 'local-all-cities') {
      const fares = (c.body.data as { fares: Record<string, unknown> }).fares;
      const missing = Object.fromEntries(Object.entries(fares).filter(([cityId]) => !t.localPickupDrop?.[cityId]));
      if (Object.keys(missing).length) out.push({ ...c, label: `Local Pickup & Drop · ${Object.keys(missing).length} cities without a fare`, body: { section: 'localPickupDropBulk', data: { fares: missing } } });
    } else if (!done(c)) out.push(c);
  }
  return out;
}

/**
 * Fallback for Cloud Functions that do not know the all-cities save yet: the whole stored tariff with the city fares merged in, shaped for the
 * long-standing `saveTariffConfig` function (which parses and validates every field exactly as it reads the tariff). Only plain data is kept
 * (no timestamps); the stored version is sent back so a tariff changed by someone else in between is refused, never overwritten.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tariffInputWithLocalFares(stored: any, fares: Record<string, Record<string, unknown>>, cities: { id: string; name: string }[], reason: string): Record<string, unknown> {
  const plain = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(plain);
    if (v && typeof v === 'object') {
      if (typeof (v as { toMillis?: unknown }).toMillis === 'function') return undefined;
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, plain(x)]).filter(([, x]) => x !== undefined));
    }
    return v;
  };
  const { updatedAt: _a, updatedBy: _b, updatedByName: _c, version, ...rest } = stored ?? {};
  const names = new Map(cities.map((c) => [c.id, c.name]));
  const local: Record<string, unknown> = { ...(stored?.localPickupDrop ?? {}) };
  for (const [id, byClass] of Object.entries(fares)) {
    const existing = local[id] as { cityName?: string; classes?: Record<string, unknown> } | undefined;
    local[id] = { cityName: existing?.cityName ?? names.get(id) ?? id, classes: { ...(existing?.classes ?? {}), ...byClass } };
  }
  return { ...(plain(rest) as Record<string, unknown>), localPickupDrop: plain(local), enabled: stored?.enabled === true, expectedVersion: typeof version === 'number' ? version : 0, reason };
}

/** savePlatformFee payload: no platform fee (0 % and ₹0 everywhere), so the fares stay exactly the guide's. Enter a fee per service later in Fares. */
export const PLATFORM_FEE_DEMO = {
  services: {
    outstation: { enabled: false, percent: 0, min: 0, cap: 0 },
    local: { enabled: false, percent: 0, min: 0, cap: 0 },
    rental: { enabled: false, percent: 0, min: 0, cap: 0 },
    airport: { enabled: false, percent: 0, min: 0, cap: 0 },
    multicity: { enabled: false, percent: 0, min: 0, cap: 0 },
  },
};

/** saveNightAllowance payload: ₹150–300 per vehicle for pickups from 11 PM to 6 AM, always on (a vehicle with 0 has none). */
export const NIGHT_ALLOWANCE_DEMO = { enabled: true, amount: 150, classes: { hatchback: 120, sedan: 150, suv: 200, suv7: 200, innova: 250, crysta: 300 } };

/** Popular One Way routes across India with an agreed fare: [from, to, approximate km]. Sedan ≈ ₹14/km + ₹300, Innova ≈ ₹20/km + ₹450 (rounded to ₹50). Partner payout ≈ 88%. */
export const FIXED_ROUTES_DEMO: [string, string, number][] = [
  ['Theni', 'Madurai', 75], ['Madurai', 'Tiruchirappalli', 135], ['Chennai', 'Pondicherry', 150], ['Coimbatore', 'Ooty', 88], ['Chennai', 'Tirupati', 140],
  ['Chennai', 'Bengaluru', 345], ['Bengaluru', 'Mysuru', 145], ['Bengaluru', 'Coorg', 250], ['Kochi', 'Munnar', 130], ['Thiruvananthapuram', 'Kanyakumari', 90],
  ['Hyderabad', 'Vijayawada', 275], ['Hyderabad', 'Warangal', 150], ['Visakhapatnam', 'Vijayawada', 350],
  ['Mumbai', 'Pune', 150], ['Pune', 'Mahabaleshwar', 120], ['Mumbai', 'Nashik', 170], ['Goa', 'Margao', 40], ['Ahmedabad', 'Vadodara', 110],
  ['New Delhi', 'Agra', 235], ['New Delhi', 'Jaipur', 280], ['New Delhi', 'Chandigarh', 250], ['Chandigarh', 'Shimla', 115], ['Dehradun', 'Rishikesh', 45],
  ['Jaipur', 'Udaipur', 400], ['Lucknow', 'Varanasi', 320], ['Kolkata', 'Siliguri', 560], ['Patna', 'Gaya', 105], ['Bhopal', 'Indore', 190],
];
export const roundTo5 = to5;

/** saveFixedRouteFare bodies for the demo routes, for every route whose two cities exist, in the Sedan and Innova categories. */
export function buildFixedRouteCalls(ctx: { cities: { id: string; name: string }[]; categories: { id: string; name: string }[] }): { id: string; label: string; body: Record<string, unknown> }[] {
  const alias: Record<string, string[]> = { tiruchirappalli: ['trichy'], pondicherry: ['puducherry'], coorg: ['madikeri'], goa: ['panaji'], 'new delhi': ['delhi'] };
  const city = (name: string) => {
    const n = name.toLowerCase();
    const names = [n, ...(alias[n] ?? [])];
    return ctx.cities.find((c) => names.includes(c.name.trim().toLowerCase()));
  };
  const cat = (cls: DemoClass) => ctx.categories.find((c) => classOfName(c.name) === cls && !/hatch/i.test(c.name));
  const out: { id: string; label: string; body: Record<string, unknown> }[] = [];
  for (const [from, to, km] of FIXED_ROUTES_DEMO) {
    const a = city(from), b = city(to);
    if (!a || !b || a.id === b.id) continue;
    for (const [cls, fare] of [['sedan', Math.round((km * 14 + 300) / 50) * 50], ['innova', Math.round((km * 20 + 450) / 50) * 50]] as const) {
      const category = cat(cls);
      if (!category) continue;
      out.push({
        id: `fixed-${a.id}-${b.id}-${cls}`, label: `Fixed route · ${a.name} ⇄ ${b.name} · ${CLASS_NAME[cls]}`,
        body: {
          data: {
            brand: 'common', fareService: 'One Way', originLocationId: a.id, destinationLocationId: b.id, vehicleCategoryId: category.id, serviceId: '',
            customerFare: fare, partnerPayout: to5(fare * 0.88), gstMode: 'included', peakAdjustment: 'exclude', reverseDirection: true,
            status: 'Active', priority: 10, effectiveFrom: '', effectiveUntil: '', name: `${a.name} to ${b.name} · ${CLASS_NAME[cls]}`,
          },
        },
      });
    }
  }
  return out;
}
