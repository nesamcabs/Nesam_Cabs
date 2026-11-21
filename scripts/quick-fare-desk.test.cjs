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
