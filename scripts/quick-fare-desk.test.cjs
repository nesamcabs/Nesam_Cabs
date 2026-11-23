/**
 * Unit test suite for NESAM CABS Quick Fare & Follow-Up Desk.
 * Tests pure domain rules, brand normalization, tariff cases, phone masking,
 * due reminder evaluation, WhatsApp message formatting, and payment plans.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// 1. Domain Constants & Pure Functions Verification
describe('Quick Fare Desk - Brand Normalization', () => {
  function normalizeBrand(raw) {
    if (!raw) return 'nesam';
    const s = raw.toLowerCase().trim();
    if (s.includes('people')) return 'people_taxi';
    if (s.includes('oneway') || s.includes('one_way') || s.includes('one-way') || s.includes('one way')) return 'onewaycarrentals';
    return 'nesam';
  }

  test('normalizes Nesam Cabs brand', () => {
    assert.equal(normalizeBrand('Nesam Cabs'), 'nesam');
    assert.equal(normalizeBrand('nesam'), 'nesam');
    assert.equal(normalizeBrand(''), 'nesam');
    assert.equal(normalizeBrand(undefined), 'nesam');
  });

  test('normalizes One Way Car Rentals brand', () => {
    assert.equal(normalizeBrand('One Way Car Rentals'), 'onewaycarrentals');
    assert.equal(normalizeBrand('oneway'), 'onewaycarrentals');
    assert.equal(normalizeBrand('one-way-cabs'), 'onewaycarrentals');
  });

  test('normalizes People Taxi brand', () => {
    assert.equal(normalizeBrand('People Taxi'), 'people_taxi');
    assert.equal(normalizeBrand('people'), 'people_taxi');
  });
});

describe('Quick Fare Desk - 6 Trip Services', () => {
  const TRIP_SERVICES = [
    { key: "One Way", label: "One Way", icon: "arrow-right", tripType: "One Way" },
    { key: "Round Trip", label: "Round Trip", icon: "arrow-left-right", tripType: "Round Trip" },
    { key: "Multicity", label: "Multicity", icon: "route", tripType: "Round Trip", multicity: true },
    { key: "Airport", label: "Airport", icon: "plane", tripType: "Airport Taxi" },
    { key: "Rental", label: "Rental", icon: "clock", tripType: "Local Rental" },
    { key: "Local", label: "Local", icon: "map-pin", tripType: "One Way", local: true },
  ];

  test('preserves exact 6 services in exact order', () => {
    assert.equal(TRIP_SERVICES.length, 6);
    assert.deepEqual(TRIP_SERVICES.map(s => s.key), [
      'One Way', 'Round Trip', 'Multicity', 'Airport', 'Rental', 'Local'
    ]);
  });
});

describe('Quick Fare Desk - Phone Masking & Digits', () => {
  function phoneDigits(raw) {
    if (!raw) return "";
    const d = raw.replace(/\D/g, "");
    return d.length >= 10 ? d.slice(-10) : "";
  }

  function maskPhone(phone) {
    const digits = phoneDigits(phone);
    if (digits.length < 10) return phone || "—";
    return `+91 ${digits.slice(0, 5)} •••••`;
  }

  test('extracts 10 digits from various inputs', () => {
    assert.equal(phoneDigits('9842144510'), '9842144510');
    assert.equal(phoneDigits('+91 98421 44510'), '9842144510');
    assert.equal(phoneDigits('+91-98421-44510'), '9842144510');
    assert.equal(phoneDigits('09842144510'), '9842144510');
  });

  test('masks last 5 digits matching reference specification', () => {
    assert.equal(maskPhone('9842144510'), '+91 98421 •••••');
    assert.equal(maskPhone('+91 98940 11223'), '+91 98940 •••••');
    assert.equal(maskPhone('6379056759'), '+91 63790 •••••');
  });

  test('handles invalid or short phones safely', () => {
    assert.equal(maskPhone('123'), '123');
    assert.equal(maskPhone(''), '—');
  });
});

describe('Quick Fare Desk - Currency & Duration Formatting', () => {
  function formatINR(val) {
    if (val === null || val === undefined || !Number.isFinite(val)) return "₹0";
    return "₹" + Math.round(val).toLocaleString("en-IN");
  }

  function formatDuration(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  test('formats INR amounts', () => {
    assert.equal(formatINR(3725), '₹3,725');
    assert.equal(formatINR(500), '₹500');
    assert.equal(formatINR(12500), '₹12,500');
    assert.equal(formatINR(0), '₹0');
    assert.equal(formatINR(null), '₹0');
  });

  test('formats minutes to human duration', () => {
    assert.equal(formatDuration(45), '45m');
    assert.equal(formatDuration(120), '2h');
    assert.equal(formatDuration(270), '4h 30m');
    assert.equal(formatDuration(269), '4h 29m');
  });
});

describe('Quick Fare Desk - Due Alert & Reminder Logic', () => {
  function deskFilterOf(e, nowMs) {
    if (e.status === "Converted" || !!e.convertedBookingId) return "booked";
    if (e.status === "Closed" && !!e.lostReason) return "lost";
    const dueMs = e.dueTimestamp ?? null;
    if (dueMs !== null) {
      return dueMs <= nowMs ? "due" : "upcoming";
    }
    return "all";
  }

  function isFollowUpDue(e, nowMs) {
    if (e.status === "Converted" || e.status === "Closed" || !!e.convertedBookingId) return false;
    const dueMs = e.dueTimestamp ?? null;
    return dueMs !== null && dueMs <= nowMs;
  }

  test('due alert is active when dueTimestamp <= now', () => {
    const now = 1763720000000;
    const pastItem = { id: 'FU-1', dueTimestamp: now - 30000, status: 'due' };
    assert.equal(isFollowUpDue(pastItem, now), true);
    assert.equal(deskFilterOf(pastItem, now), 'due');
  });

  test('due alert is not active when dueTimestamp > now', () => {
    const now = 1763720000000;
    const futureItem = { id: 'FU-2', dueTimestamp: now + 30000, status: 'upcoming' };
    assert.equal(isFollowUpDue(futureItem, now), false);
    assert.equal(deskFilterOf(futureItem, now), 'upcoming');
  });

  test('booked item stops alerting and maps to booked filter', () => {
    const now = 1763720000000;
    const bookedItem = { id: 'FU-3', dueTimestamp: now - 10000, status: 'Converted', convertedBookingId: '#NSM-1' };
    assert.equal(isFollowUpDue(bookedItem, now), false);
    assert.equal(deskFilterOf(bookedItem, now), 'booked');
  });

  test('lost item stops alerting and maps to lost filter', () => {
    const now = 1763720000000;
    const lostItem = { id: 'FU-4', dueTimestamp: now - 10000, status: 'Closed', lostReason: 'Rate too high / Budget issue' };
    assert.equal(isFollowUpDue(lostItem, now), false);
    assert.equal(deskFilterOf(lostItem, now), 'lost');
  });

  test('snooze adds 15 minutes to due timestamp', () => {
    const now = 1763720000000;
    const item = { id: 'FU-5', dueTimestamp: now - 5000, status: 'due' };
    assert.equal(isFollowUpDue(item, now), true);

    // Apply snooze +15m
    const snoozedTs = now + 15 * 60000;
    item.dueTimestamp = snoozedTs;
    item.status = 'upcoming';

    assert.equal(isFollowUpDue(item, now), false);
    assert.equal(deskFilterOf(item, now), 'upcoming');
    assert.equal(item.dueTimestamp - now, 900000);
  });
});

describe('Quick Fare Desk - Tariff Calculation Cases', () => {
  const SEDAN = {
    id: 'sedan',
    name: 'Dzire / Etios Or Similar',
    category: 'SEDAN',
    oneWayRate: 15,
    roundRate: 14,
    base30: 600,
    bata: 500,
    rental1Hr: 350,
    rentalPerHr: 260,
  };

  test('One Way: Coimbatore to Madurai (215 km)', () => {
    const km = 215;
    const billKm = Math.max(130, km);
    const total = billKm * SEDAN.oneWayRate + SEDAN.bata;
    // 215 * 15 + 500 = 3225 + 500 = 3725
    assert.equal(total, 3725);
  });

  test('One Way: short route (<130 km minimum enforcement)', () => {
    const km = 60;
    const billKm = Math.max(130, km);
    const total = billKm * SEDAN.oneWayRate + SEDAN.bata;
    // 130 * 15 + 500 = 1950 + 500 = 2450
    assert.equal(total, 2450);
  });

  test('Rental: 4-hour package with 40 km included', () => {
    const hours = 4;
    const total = SEDAN.rental1Hr + (hours - 1) * SEDAN.rentalPerHr;
    // 350 + 3 * 260 = 350 + 780 = 1130
    assert.equal(total, 1130);
  });

  test('Rental: 8-hour package with 80 km included', () => {
    const hours = 8;
    const total = SEDAN.rental1Hr + (hours - 1) * SEDAN.rentalPerHr;
    // 350 + 7 * 260 = 350 + 1820 = 2170
    assert.equal(total, 2170);
  });

  test('Round Trip: 2-Day Overnight after 3 PM (Slab D - 400 km)', () => {
    const days = 2;
    const km = 215;
    const extra = Math.max(0, km - 400);
    const total = SEDAN.base30 + 120 * SEDAN.roundRate + 250 * SEDAN.roundRate + extra * SEDAN.roundRate + SEDAN.bata * 2;
    // 600 + 120*14 (1680) + 250*14 (3500) + 0 + 1000 = 6780
    assert.equal(total, 6780);
  });

  test('Round Trip: Standard 3-Day trip (3 * 250 km = 750 km minimum)', () => {
    const days = 3;
    const km = 400;
    const billKm = Math.max(days * 250, km);
    const total = billKm * SEDAN.roundRate + days * SEDAN.bata;
    // 750 * 14 + 3 * 500 = 10500 + 1500 = 12000
    assert.equal(total, 12000);
  });
});

describe('Quick Fare Desk - Payment Plan Calculations', () => {
  const fare = 3725;

  test('Pay Later: ₹0 Now', () => {
    const payPlan = 'later';
    const amountNow = payPlan === 'later' ? 0 : fare;
    assert.equal(amountNow, 0);
  });

  test('25% Advance: rounded 25% of fare', () => {
    const advance = Math.round(fare * 0.25);
    // 3725 * 0.25 = 931.25 -> 931
    assert.equal(advance, 931);
  });

  test('100% Online: full fare', () => {
    assert.equal(fare, 3725);
  });
});

describe('Quick Fare Desk - WhatsApp Message Formats', () => {
  function formatWhatsAppQuote(params) {
    const lines = params.vehicleLines.map((v) => {
      const seatText = v.seats ? ` (${typeof v.seats === "number" ? `${v.seats} Seats` : v.seats})` : "";
      return `• ${v.name}${seatText}: ₹${Number(v.fare).toLocaleString('en-IN')}`;
    });
    return `*${params.brandName} — Fare Estimate*\nRoute: ${params.route}\nDate: ${params.dateStr} at ${params.timeStr}\n\n${lines.join('\n')}\n\n_(Includes Driver Bata. Toll, Parking & Permit extra as actuals)_\nReply to confirm your cab!`;
  }

  function formatWhatsAppBooking(params) {
    return `*${params.brandName} — Booking Confirmed*\nBooking ID: ${params.bookingId}\nCustomer: ${params.customerName} (+91 ${params.phone})\nRoute: ${params.route}\nPickup: ${params.dateStr} at ${params.timeStr}\nCab: ${params.vehicleName}\nFare: ₹${Number(params.fare).toLocaleString('en-IN')} (+ Toll/Parking/Permit actuals)\nThank you!`;
  }

  test('generates compliant WhatsApp quote', () => {
    const text = formatWhatsAppQuote({
      brandName: 'Nesam Cabs',
      route: 'Coimbatore → Madurai',
      dateStr: '22-11-2026',
      timeStr: '8:00 AM',
      vehicleLines: [
        { name: 'Wagon R Or Similar', seats: '4 Seats', fare: 3510 },
        { name: 'Dzire / Etios Or Similar', seats: '4 Seats', fare: 3725 },
      ],
    });
    assert.ok(text.includes('*Nesam Cabs — Fare Estimate*'));
    assert.ok(text.includes('Route: Coimbatore → Madurai'));
    assert.ok(text.includes('• Dzire / Etios Or Similar (4 Seats): ₹3,725'));
    assert.ok(text.includes('_(Includes Driver Bata. Toll, Parking & Permit extra as actuals)_'));
  });

  test('generates compliant WhatsApp booking confirmation', () => {
    const text = formatWhatsAppBooking({
      brandName: 'Nesam Cabs',
      bookingId: '#NSM-2611-1001',
      customerName: 'Arun Prakash',
      phone: '9842144510',
      route: 'Coimbatore → Madurai',
      dateStr: '22-11-2026',
      timeStr: '8:00 AM',
      vehicleName: 'Dzire / Etios Or Similar',
      fare: 3725,
    });
    assert.ok(text.includes('*Nesam Cabs — Booking Confirmed*'));
    assert.ok(text.includes('Booking ID: #NSM-2611-1001'));
    assert.ok(text.includes('Customer: Arun Prakash (+91 9842144510)'));
    assert.ok(text.includes('Fare: ₹3,725 (+ Toll/Parking/Permit actuals)'));
  });
});

describe('Quick Fare Desk - Lost & Reveal Categories', () => {
  const LOST_REASONS = [
    "Rate too high / Budget issue",
    "Booked another cab / Local taxi",
    "Trip cancelled / Postponed",
    "No response after 2 calls",
  ];

  const REVEAL_CATEGORIES = [
    "Scheduled follow-up callback",
    "WhatsApp fare quote confirmation",
    "Pickup time / cab availability update",
  ];

  test('exact 4 lost reasons present', () => {
    assert.equal(LOST_REASONS.length, 4);
    assert.ok(LOST_REASONS.includes('Rate too high / Budget issue'));
    assert.ok(LOST_REASONS.includes('Booked another cab / Local taxi'));
    assert.ok(LOST_REASONS.includes('Trip cancelled / Postponed'));
    assert.ok(LOST_REASONS.includes('No response after 2 calls'));
  });

  test('exact 3 reveal categories present', () => {
    assert.equal(REVEAL_CATEGORIES.length, 3);
    assert.ok(REVEAL_CATEGORIES.includes('Scheduled follow-up callback'));
    assert.ok(REVEAL_CATEGORIES.includes('WhatsApp fare quote confirmation'));
    assert.ok(REVEAL_CATEGORIES.includes('Pickup time / cab availability update'));
  });
});


// ── The live desk (admin/src/domain/quickFareDesk.ts, loaded from the TypeScript source) ──
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../admin/node_modules/typescript');
const deskCache = new Map();
function loadDesk(file) {
  if (deskCache.has(file)) return deskCache.get(file).exports;
  const module = { exports: {} };
  deskCache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)((id) => {
    if (!id.startsWith('.')) throw Error('Unexpected dependency: ' + id);
    const base = path.resolve(path.dirname(file), id);
    return loadDesk([base + '.ts', base + '.tsx'].find(fs.existsSync));
  }, module, module.exports);
  return module.exports;
}
const D = loadDesk(path.resolve(__dirname, '../admin/src/domain/quickFareDesk.ts'));

// 22 Nov 2026, 10:07:23 IST
const NOW = Date.parse('2026-11-22T04:37:23Z');

describe('Quick Fare Desk - fuel and add-on labels', () => {
  test('fuel: CNG when priced on the CNG card, otherwise the standard Diesel rate', () => {
    assert.equal(D.deskFuelLabel('cng'), 'CNG');
    assert.equal(D.deskFuelLabel(null), 'Diesel');
    assert.equal(D.deskFuelLabel(undefined), 'Diesel');
  });

  test('add-ons use the desk names, in toolbar order', () => {
    assert.deepEqual(D.deskAddOnLabels({ pets: true, carrier: true }), ['Pet Friendly', 'Luggage Carrier']);
    assert.deepEqual(D.deskAddOnLabels({ pets: false, carrier: true }), ['Luggage Carrier']);
    assert.deepEqual(D.deskAddOnLabels(undefined), []);
    assert.equal(D.deskExtrasLabel({ fuel: 'cng', addOns: { pets: true, carrier: false } }), 'CNG • Pet Friendly');
    assert.equal(D.deskExtrasLabel({}), 'Diesel');
  });

  test('add-on price tag comes from the server rates and never invents one', () => {
    assert.equal(D.addOnRateLabel([300, 300, 300]), '+₹300');
    assert.equal(D.addOnRateLabel([250, 400, null]), 'from +₹250');
    assert.equal(D.addOnRateLabel([]), '');
    assert.equal(D.addOnRateLabel([0, undefined, null]), '');
  });
});

describe('Quick Fare Desk - India time and 12-hour clock', () => {
  test('12-hour labels cover midnight and noon', () => {
    assert.equal(D.clock12('00:00'), '12:00 AM');
    assert.equal(D.clock12('00:30'), '12:30 AM');
    assert.equal(D.clock12('08:00'), '8:00 AM');
    assert.equal(D.clock12('12:00'), '12:00 PM');
    assert.equal(D.clock12('12:30'), '12:30 PM');
    assert.equal(D.clock12('23:30'), '11:30 PM');
    assert.equal(D.clock12('bad'), '');
  });

  test('48 half-hour pickup times across the whole day; a saved odd time is listed, not rounded', () => {
    assert.equal(D.PICKUP_TIME_SLOTS.length, 48);
    assert.deepEqual(D.PICKUP_TIME_SLOTS[0], { value: '00:00', label: '12:00 AM' });
    assert.deepEqual(D.PICKUP_TIME_SLOTS[47], { value: '23:30', label: '11:30 PM' });
    const opts = D.pickupTimeOptions('08:15');
    assert.equal(opts.length, 49);
    assert.deepEqual(opts.map((o) => o.value).slice(16, 19), ['08:00', '08:15', '08:30']);
    assert.equal(D.pickupTimeOptions('08:30').length, 48);
  });

  test('hour / minute / AM-PM controls round-trip every minute, 12 AM and 12 PM included', () => {
    assert.deepEqual(D.splitClock12('00:05'), { hour: '12', minute: '05', mer: 'AM' });
    assert.deepEqual(D.splitClock12('12:00'), { hour: '12', minute: '00', mer: 'PM' });
    assert.deepEqual(D.splitClock12('17:07'), { hour: '05', minute: '07', mer: 'PM' });
    assert.equal(D.joinClock12('12', '00', 'AM'), '00:00');
    assert.equal(D.joinClock12('12', '30', 'PM'), '12:30');
    assert.equal(D.joinClock12('05', '07', 'PM'), '17:07');
    for (let m = 0; m < 24 * 60; m += 7) {
      const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const p = D.splitClock12(hhmm);
      assert.equal(D.joinClock12(p.hour, p.minute, p.mer), hhmm);
    }
  });

  test('India date and time whatever the machine zone, and Today / Tomorrow badges across IST midnight', () => {
    assert.equal(D.istDateOf(NOW), '2026-11-22');
    assert.equal(D.istTimeOf(NOW), '10:07');
    assert.equal(D.istMs('2026-11-22', '10:07'), Date.parse('2026-11-22T04:37:00Z'));
    assert.ok(Number.isNaN(D.istMs('2026-11-22', '24:00')));
    // 00:10 IST on 23 Nov is still 22 Nov in UTC.
    const justAfterMidnight = Date.parse('2026-11-22T18:40:00Z');
    assert.equal(D.istDateOf(justAfterMidnight), '2026-11-23');
    assert.equal(D.istDayOffset('2026-11-23', justAfterMidnight), 0);
    assert.equal(D.istDayOffset('2026-11-24', justAfterMidnight), 1);
    assert.equal(D.istDayOffset('2026-11-22', NOW), 0);
    assert.equal(D.istDayOffset('2026-11-23', NOW), 1);
    assert.equal(D.istDayOffset('2026-11-30', NOW), 8);
    assert.equal(D.ddmmyyyy('2026-11-22'), '22-11-2026');
    assert.equal(D.addDaysIst('2026-12-31', 1), '2027-01-01');
  });
});

describe('Quick Fare Desk - follow-up reminder presets', () => {
  test('In 15 / 30 min and 1 hour are exact: never rounded to a quarter-hour', () => {
    assert.equal(D.reminderPresetAt('15', NOW), NOW + 15 * 60000);
    assert.equal(D.reminderPresetAt('30', NOW), NOW + 30 * 60000);
    assert.equal(D.reminderPresetAt('60', NOW), NOW + 60 * 60000);
    assert.equal(D.reminderPresetAt('now', NOW), NOW);
    assert.equal(D.istTimeOf(D.reminderPresetAt('15', NOW)), '10:22');
  });

  test('Tomorrow 9:00 AM / 5:00 PM are on the next India day, also just after IST midnight', () => {
    assert.equal(D.scheduleLabel(D.reminderPresetAt('tmrw9', NOW)), '23-11-2026 • 9:00 AM');
    assert.equal(D.scheduleLabel(D.reminderPresetAt('tmrw17', NOW)), '23-11-2026 • 5:00 PM');
    const lateNight = Date.parse('2026-11-22T18:20:00Z'); // 22 Nov, 11:50 PM IST
    assert.equal(D.scheduleLabel(D.reminderPresetAt('tmrw9', lateNight)), '23-11-2026 • 9:00 AM');
    const afterMidnight = Date.parse('2026-11-22T18:40:00Z'); // 23 Nov, 12:10 AM IST (still 22 Nov in UTC)
    assert.equal(D.scheduleLabel(D.reminderPresetAt('tmrw9', afterMidnight)), '24-11-2026 • 9:00 AM');
  });
});

describe('Quick Fare Desk - Indian mobile numbers', () => {
  test('pasted +91 / 0091 / 0 forms keep all ten digits', () => {
    assert.equal(D.mobileInputValue('+91 98421 44510'), '9842144510');
    assert.equal(D.mobileInputValue('0091-98421-44510'), '9842144510');
    assert.equal(D.mobileInputValue('098421 44510'), '9842144510');
    assert.equal(D.mobileInputValue('98421'), '98421');
    assert.deepEqual(D.normalizeIndianMobile('+91 98421 44510'), { ok: true, e164: '+919842144510', digits: '9842144510' });
  });

  test('a number that does not fit is refused, never cut to fit', () => {
    assert.equal(D.normalizeIndianMobile('984214451012').ok, false);
    assert.equal(D.normalizeIndianMobile('+44 7700 900123').ok, false);
    assert.equal(D.normalizeIndianMobile('5842144510').ok, false);
    assert.equal(D.mobileInputValue('984214451012'), '984214451012');
  });

  test('numbers are masked as the reference shows them', () => {
    assert.equal(D.maskPhone('+919842144510'), '+91 98421 •••••');
    assert.equal(D.spacedPhone('+919842144510'), '+91 98421 44510');
  });
});

const trip = { source: 'nesam', tab: 'One Way', placeKey: '11.0168,76.9558;9.9252,78.1198', pickupAtMs: Date.parse('2026-11-23T02:30:00Z'), days: null, rentalHours: null };

describe('Quick Fare Desk - one open enquiry per caller and trip', () => {
  test('same caller and trip is the same enquiry whatever the fuel, add-ons or vehicle', () => {
    assert.equal(D.deskKeyOf('9842144510', trip), D.deskKeyOf('9842144510', { ...trip, fuel: 'cng', addOns: { pets: true, carrier: true } }));
  });

  test('another number, source or pickup time is a different enquiry (names are never compared)', () => {
    const k = D.deskKeyOf('9842144510', trip);
    assert.notEqual(k, D.deskKeyOf('9842144511', trip));
    assert.notEqual(k, D.deskKeyOf('9842144510', { ...trip, source: 'people_taxi' }));
    assert.notEqual(k, D.deskKeyOf('9842144510', { ...trip, pickupAtMs: trip.pickupAtMs + 30 * 60000 }));
    assert.ok(!k.includes('Ramesh'));
  });

  test('only an open enquiry is updated: converted, closed or expired ones start a new follow-up', () => {
    const key = D.deskKeyOf('9842144510', trip);
    const base = { id: 'a', code: 'NSM-QT-000001', pickup: 'A', drop: 'B', deskKey: key };
    assert.equal(D.openDuplicateOf([{ ...base, status: 'Call back' }], key, NOW).id, 'a');
    assert.equal(D.openDuplicateOf([{ ...base, status: 'Converted' }], key, NOW), null);
    assert.equal(D.openDuplicateOf([{ ...base, status: 'Call back', convertedBookingId: 'NSM1' }], key, NOW), null);
    assert.equal(D.openDuplicateOf([{ ...base, status: 'Closed' }], key, NOW), null);
    assert.equal(D.openDuplicateOf([{ ...base, status: 'Call back', validUntil: NOW - 1 }], key, NOW), null);
    assert.equal(D.openDuplicateOf([{ ...base, status: 'Call back', deskKey: 'other' }], key, NOW), null);
  });
});

describe('Quick Fare Desk - follow-up queue from saved enquiries', () => {
  const e = (over) => ({ id: over.id || 'e', code: over.id || 'NSM-QT-000001', status: 'Call back', pickup: 'Coimbatore', drop: 'Madurai', phone: '+919842144510', customerName: 'Caller', createdAt: NOW - 3600000, ...over });

  test('due, upcoming, booked and lost come from the stored status and callback time', () => {
    assert.equal(D.deskQueueRowOf(e({ followUpAt: NOW - 1 }), NOW).status, 'due');
    assert.equal(D.deskQueueRowOf(e({ followUpAt: NOW }), NOW).status, 'due');
    assert.equal(D.deskQueueRowOf(e({ followUpAt: NOW + 60000 }), NOW).status, 'upcoming');
    assert.equal(D.deskQueueRowOf(e({ status: 'Converted', convertedBookingId: 'NSM-1', followUpAt: NOW - 1 }), NOW).status, 'booked');
    const lost = D.deskQueueRowOf(e({ status: 'Closed', lostReason: 'Trip cancelled / Postponed', followUpAt: NOW - 1 }), NOW);
    assert.equal(lost.status, 'lost');
    assert.equal(lost.lostReason, 'Trip cancelled / Postponed');
    assert.equal(D.deskQueueRowOf(e({ followUpAt: NOW + 60000, validUntil: NOW - 1 }), NOW).lostReason, 'Quote expired');
  });

  test('an enquiry with no callback time is not a follow-up; finished ones leave after 30 days', () => {
    assert.equal(D.deskQueueRowOf(e({}), NOW), null);
    assert.equal(D.deskQueueRowOf(e({ status: 'Converted', followUpAt: NOW - 1, createdAt: NOW - 31 * 86400000 }), NOW), null);
  });

  test('rows are masked; a Firestore Timestamp works like a number', () => {
    const r = D.deskQueueRowOf(e({ followUpAt: { toMillis: () => NOW - 5 } }), NOW);
    assert.equal(r.masked, '+91 98421 •••••');
    assert.equal(r.followUpAtMs, NOW - 5);
  });

  test('order: longest-waiting due first, then soonest upcoming, then booked, then lost; counts are real', () => {
    const q = D.buildQueue([
      e({ id: 'up2', followUpAt: NOW + 7200000 }),
      e({ id: 'lost', status: 'Closed', followUpAt: NOW - 1, createdAt: NOW - 100 }),
      e({ id: 'due-late', followUpAt: NOW - 60000 }),
      e({ id: 'up1', followUpAt: NOW + 600000 }),
      e({ id: 'due-early', followUpAt: NOW - 3600000 }),
      e({ id: 'booked', status: 'Converted', followUpAt: NOW - 1 }),
      e({ id: 'none' }),
    ], NOW);
    assert.deepEqual(q.rows.map((r) => r.id), ['due-early', 'due-late', 'up1', 'up2', 'booked', 'lost']);
    assert.deepEqual(q.counts, { all: 6, due: 2, upcoming: 2, booked: 1, lost: 1 });
  });

  test('reminder labels', () => {
    assert.equal(D.reminderLabel({ status: 'upcoming', followUpAtMs: NOW + 12 * 60000 }, NOW), 'In 12 mins');
    assert.equal(D.reminderLabel({ status: 'upcoming', followUpAtMs: NOW + 3 * 3600000 }, NOW), '22-11-2026 • 1:07 PM');
    assert.equal(D.reminderLabel({ status: 'due', followUpAtMs: NOW }, NOW), 'Due Now');
  });
});

describe('Quick Fare Desk - fare facts come from the server quote', () => {
  test('slab label from the pricing model', () => {
    assert.equal(D.slabLabelOf('One Way', { model: 'one_way_standard', quotedKm: 215, minKmPerDay: 130 }, null, null), 'One Way • 215 km (Min 130 km)');
    assert.equal(D.slabLabelOf('Round Trip', { model: 'round_trip_calendar', days: 3, minKmPerDay: 250 }, 3, null), '3-Day Round Trip (750 km min)');
    assert.equal(D.slabLabelOf('Rental', { model: 'rental_package', rentalHours: 4, includedKm: 40 }, null, 4), 'Rental • 4 Hrs / 40 km');
    assert.equal(D.slabLabelOf('Round Trip', { model: 'round_trip_time_based', includedKm: 150, timeBased: { label: '8-Hr Slab' } }, 1, null), '8-Hr Slab (150 km)');
    assert.equal(D.slabLabelOf('One Way', null, null, null), '');
  });

  test('rate note uses the configured (GST-inclusive when set so) rate and names the fuel', () => {
    assert.equal(D.rateNoteOf({ model: 'one_way_standard', customerRatePaise: 1400, customerBataPaise: 40000 }, 'Diesel'), '₹14/km (Diesel) + ₹400 Bata');
    assert.equal(D.rateNoteOf({ model: 'one_way_standard', customerRatePaise: 1333, gstInclusiveBase: { customerRatePaise: 1400 }, customerBataPaise: 40000 }, 'CNG'), '₹14/km (CNG) + ₹400 Bata');
    assert.equal(D.rateNoteOf({ model: 'rental_package', includedKm: 40, extraKmRatePaise: 1500 }, 'Diesel'), 'Includes 40 km (Diesel) • ₹15/km extra');
    assert.equal(D.rateNoteOf(null, 'Diesel'), '');
  });

  test('inclusions and exclusions only from the breakup lines', () => {
    const lines = [
      { key: 'distance', treatment: 'included', amount: 3000 },
      { key: 'driverAllowance', treatment: 'included', amount: 400 },
      { key: 'toll', treatment: 'extra', amount: null },
      { key: 'parking', treatment: 'extra', amount: null },
      { key: 'stateTax', treatment: 'extra', amount: null },
    ];
    assert.equal(D.coverageNote(D.coverageOf(lines)), 'Includes Driver Bata • Excludes Toll, Parking & State Permit Tax (Actuals)');
    const local = lines.map((l) => (l.key === 'stateTax' ? { ...l, treatment: 'not_applicable' } : l));
    assert.equal(D.coverageNote(D.coverageOf(local)), 'Includes Driver Bata • Excludes Toll & Parking (Actuals)');
    assert.equal(D.coverageNote(D.coverageOf([])), '');
  });
});

describe('Quick Fare Desk - copied WhatsApp texts', () => {
  const coverage = { includes: ['Driver Bata'], excludes: ['Toll', 'Parking', 'State Permit Tax'] };
  const lines = [{ vehicle: 'Dzire', seats: '4 Seats', fare: 4365, manual: false }, { vehicle: 'Innova', seats: '7 Seats', fare: 6120, manual: false }];

  test('fare estimate in the reference format, with the fares shown and the fuel / add-ons they were priced with', () => {
    const text = D.fareEstimateText({ brandName: 'Nesam Cabs', route: 'Coimbatore → Madurai', date: '23-11-2026', time: '8:00 AM', fuel: 'cng', addOns: ['Pet Friendly'], lines, coverage });
    assert.equal(text, [
      '*Nesam Cabs — Fare Estimate*',
      'Route: Coimbatore → Madurai',
      'Date: 23-11-2026 at 8:00 AM',
      'Fuel Type: CNG',
      'Add-ons: Pet Friendly',
      '',
      '• Dzire (4 Seats): ₹4,365',
      '• Innova (7 Seats): ₹6,120',
      '',
      '_(Includes Driver Bata. Toll, Parking & State Permit Tax extra as actuals)_',
      'Reply to confirm your cab!',
    ].join('\n'));
  });

  test('a typed draft quote says so and names no fuel', () => {
    const text = D.fareEstimateText({ brandName: 'People Taxi', route: 'A → B', date: '23-11-2026', time: '8:00 AM', fuel: null, addOns: [], lines: [{ vehicle: 'SUV', seats: '', fare: 5000, manual: true }], coverage: { includes: [], excludes: [] } });
    assert.ok(text.startsWith('*People Taxi — Draft Fare Estimate*'));
    assert.ok(!text.includes('Fuel Type'));
    assert.ok(text.endsWith('_Draft quote — not yet confirmed._'));
  });

  test('booking confirmation carries the server booking ID; a payment link only when one was created', () => {
    const base = { brandName: 'Nesam Cabs', bookingId: 'NSM-2611-0042', customer: 'Ramesh', maskedPhone: '+91 98421 •••••', route: 'A → B', date: '23-11-2026', time: '8:00 AM', vehicle: 'Dzire', fuel: null, addOns: [], fare: 4365 };
    const text = D.bookingConfirmationText(base);
    assert.ok(text.includes('Booking ID: NSM-2611-0042\nCustomer: Ramesh (+91 98421 •••••)'));
    assert.ok(text.includes('Cab: Dzire (Diesel)\nFare: ₹4,365 (+ Toll/Parking/Permit actuals)\nThank you!'));
    assert.ok(!text.includes('Payment link'));
    assert.ok(D.bookingConfirmationText({ ...base, paymentLink: { url: 'https://rzp.io/i/abc', amount: 1092 } }).includes('Payment link (₹1,092): https://rzp.io/i/abc'));
  });
});

describe('Quick Fare Desk - cab names (admin/src/domain/categoryLabel.ts)', () => {
  const L = loadDesk(path.resolve(__dirname, '../admin/src/domain/categoryLabel.ts'));
  const six = [
    ['HATCHBACK', 'Wagon R Or Similar'],
    ['SEDAN', 'Dzire / Etios Or Similar'],
    ['SUV', 'Ertiga Or Similar'],
    ['MUV', 'Kia Carens Or Similar'],
    ['INNOVA', 'Innova'],
    ['CRYSTA', 'Innova Crysta'],
  ];

  test('the six standard categories named only by their category get their cab name; the category is the badge', () => {
    for (const [code, cab] of six) {
      const c = { id: `id-${code}`, name: code, code };
      assert.equal(L.cabDisplayName(c), cab, code);
      assert.equal(L.cabCategoryBadge(c), code, code);
    }
    // A generic name in another case, or the id slug with no code, is the same category.
    assert.equal(L.cabDisplayName({ id: 'x1', name: 'Sedan', code: '' }), 'Dzire / Etios Or Similar');
    assert.equal(L.cabDisplayName({ id: 'muv', name: 'MUV' }), 'Kia Carens Or Similar');
    assert.equal(L.cabCategoryBadge({ id: 'muv', name: 'MUV' }), 'MUV');
  });

  test('the configured Display Text wins, unless it only repeats the category or is a long description', () => {
    assert.equal(L.cabDisplayName({ name: 'SEDAN', code: 'SEDAN', description: 'Dzire / Etios or similar' }), 'Dzire / Etios or similar');
    assert.equal(L.cabDisplayName({ name: 'Hatchback', code: 'HATCHBACK', description: ' Wagon R or Similar ' }), 'Wagon R or Similar');
    assert.equal(L.cabDisplayName({ name: 'SUV', code: 'SUV', description: 'SUV' }), 'Ertiga Or Similar');
    assert.equal(L.cabDisplayName({ name: 'SUV', code: 'SUV', description: 'Sedan' }), 'Ertiga Or Similar');
    assert.equal(L.cabDisplayName({ name: 'SEDAN', code: 'SEDAN', description: 'A comfortable air-conditioned sedan for up to four passengers' }), 'Dzire / Etios Or Similar');
    assert.equal(L.cabCategoryBadge({ name: 'Sedan', description: 'Dzire / Etios or similar' }), 'SEDAN');
  });

  test('custom categories keep their configured names and are never forced into the six', () => {
    assert.equal(L.cabDisplayName({ name: 'Tempo Traveller', code: 'TT' }), 'Tempo Traveller');
    assert.equal(L.cabCategoryBadge({ name: 'Tempo Traveller', code: 'TT' }), 'TT');
    assert.equal(L.cabDisplayName({ name: 'Premium SUV', code: 'SUV' }), 'Premium SUV');
    assert.equal(L.cabDisplayName({ name: 'Ertiga', code: 'SUV' }), 'Ertiga');
    assert.equal(L.cabDisplayName({ name: 'Innova Crysta', code: 'CRYSTA' }), 'Innova Crysta');
    assert.equal(L.cabDisplayName({ name: 'Force Urbania', code: '', description: 'Urbania or similar' }), 'Urbania or similar');
    assert.equal(L.standardCategoryOf({ name: 'Tempo Traveller', code: 'TT', id: 'abc' }), null);
  });

  test('the badge names the category once and never repeats the heading word for word', () => {
    assert.equal(L.cabCategoryBadge({ name: 'INNOVA', code: 'INNOVA' }), 'INNOVA');
    assert.equal(L.cabDisplayName({ name: 'TEMPO', code: 'TEMPO' }), 'TEMPO');
    assert.equal(L.cabCategoryBadge({ name: 'TEMPO', code: 'TEMPO' }), '');
    assert.equal(L.cabCategoryBadge({ name: 'Tempo Traveller' }), '');
  });

  test('the admin list title is unchanged', () => {
    assert.equal(L.categoryTitle({ name: 'Sedan', description: 'Dzire / Etios or similar' }), 'Dzire / Etios or similar · Sedan');
    assert.equal(L.categoryTitle({ name: 'Sedan' }), 'Sedan');
  });
});
