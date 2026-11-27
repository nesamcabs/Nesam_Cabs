// The Test quote: what the booking server would charge for a local trip with the rates on the page (saved or not). The district
// rules come from domain/localPricing.ts, which the server prices with; the two common settings that can also apply to a local
// trip (platform fee, ₹ night allowance) follow the server's order. scripts/admin-local-fares.test.cjs compares it with the
// server's own result. Price-change rules, coupons, hill charges and booked add-ons are not part of it.
import {
  autoTollAmount, gstTotals, quoteLocalRide, quoteRentalRow, resolveCoverage, resolveRow, resolveRule, waitingCharge, zoneOfPin, istParts,
  type DistrictGeo, type FaresByBrand, type LocalClass, type LocalSettings, type Scope,
} from "../../domain/localPricing";

export interface FeeRule { enabled: boolean; percent: number; min: number; cap: number }
export interface PlatformRules { local: FeeRule; rental: FeeRule }
export interface CommonNight { enabled: boolean; amount: number; classes: Record<string, number> }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100000 ? v : fallback);

/** business_config/platform_fee, read the way the server reads it. */
export function parsePlatformRules(raw: unknown): PlatformRules {
  const services = obj(obj(raw).services);
  const rule = (k: string): FeeRule => {
    const r = obj(services[k]);
    return { enabled: r.enabled === true, percent: typeof r.percent === "number" && r.percent >= 0 && r.percent <= 100 ? r.percent : 5, min: num(r.min, 50), cap: num(r.cap, 250) };
  };
  return { local: rule("local"), rental: rule("rental") };
}
/** business_config/night_allowance. */
export function parseCommonNight(raw: unknown): CommonNight {
  const d = obj(raw);
  const classes = Object.fromEntries(Object.entries(obj(d.classes)).filter(([, v]) => typeof v === "number" && v >= 0)) as Record<string, number>;
  return { enabled: d.enabled === true, amount: num(d.amount, 0), classes };
}

/** Longer one-way trips are Outstation, whatever district they end in (the server's own limit). */
export const LOCAL_LIMIT_KM = 40;

export interface TestInput {
  service: "ride" | "rental";
  fares: FaresByBrand; brand: string; geo: DistrictGeo; settings: LocalSettings; district: string;
  cls: LocalClass; vehicle: string; pin: string;
  /** The chosen village (see areaSlug); empty for a pincode only. */
  areaNames?: readonly string[];
  km: number; hours: number; waitMins: number; pickupMs: number; routeHasToll: boolean; airport: boolean;
  platform: PlatformRules; night: CommonNight;
}
export interface TestLine { key: string; label: string; amount: number; tone?: "peak" | "minimum" }
export type TestResult =
  | { ok: false; message: string }
  | { ok: true; rateLabel: string; lines: TestLine[]; gst: number; total: number; waiting: number };

const SOURCE: Record<Scope, string> = { district: "District default", zone: "Zone override", area: "Area override" };
const p = (rupees: number) => Math.round(rupees * 100);

export function testQuote(i: TestInput): TestResult {
  if (!resolveCoverage(i.fares, i.brand).local) return { ok: false, message: `Local trips are switched OFF for ${i.district} district.` };
  const target = { pin: i.pin, zoneId: zoneOfPin(i.geo, i.pin)?.id, areaNames: i.areaNames };
  const s = i.settings, lines: TestLine[] = [];
  let sum = 0, waiting = 0, rateLabel = "", ownNight = false;
  const add = (key: string, label: string, amount: number, tone?: TestLine["tone"]) => { lines.push({ key, label, amount, ...(tone ? { tone } : {}) }); sum += p(amount); };
  const from = (source: { scope: Scope; brand: string }) => `${SOURCE[source.scope]}${i.brand !== "common" && source.brand === "common" ? " · shared" : ""}`;

  if (i.service === "ride") {
    if (!(i.km > 0)) return { ok: false, message: "Enter the trip distance." };
    if (i.km > LOCAL_LIMIT_KM) return { ok: false, message: `Over ${LOCAL_LIMIT_KM} km is priced as Outstation, not from this page.` };
    const customer = resolveRule(i.fares, i.brand, "customer", i.cls, target);
    const partner = resolveRule(i.fares, i.brand, "partner", i.cls, target);
    const noRate = i.cls === "auto" || i.cls === "bike" ? "it is not offered to customers here" : "bookings use the older fares";
    if (!customer) return { ok: false, message: `No ${i.vehicle} customer fare is set for this area, so ${noRate}.` };
    if (!partner) return { ok: false, message: `Set the ${i.vehicle} partner payout too. Until then ${noRate}.` };
    const a = s.additional;
    // "Route has toll": the mapped amount of a route from this area, else the fallback amount.
    const mapped = a.corridors.find((c) => c.fromPin === i.pin || c.toPin === i.pin);
    const toll = !i.routeHasToll ? 0 : a.tollSource === "mapped_rate" && mapped ? autoTollAmount(s, mapped.fromPin, mapped.toPin, null) : a.autoToll && a.tollSource !== "at_actuals" ? a.tollAmount : 0;
    const q = quoteLocalRide({ rule: customer.value, settings: s, km: i.km, pickupMs: i.pickupMs, airportTrip: i.airport, toll });
    const wait = waitingCharge(customer.value, i.km, i.waitMins);
    rateLabel = `${from(customer)} (${i.district})`;
    ownNight = s.night.percent > 0;
    add("base", `Base fare (incl. ${q.includedKm} km)`, q.baseFare);
    if (q.extraKm > 0) add("extra", `Extra distance (${q.extraKm} km)`, q.extraKmCharge);
    if (q.minimumTopUp > 0) add("minimum", `Minimum fare floor ₹${customer.value.minimumFare} applied`, q.minimumTopUp, "minimum");
    if (q.toll > 0) add("toll", "Route toll (auto-added)", q.toll);
    if (q.airport > 0) add("airport", "Airport entry charge", q.airport);
    if (q.night > 0) add("night", `Night allowance (${s.night.percent}%)`, q.night);
    if (q.peak > 0) add("peak", `Peak-hour charge · ${q.peakRule?.label ?? ""}`, q.peak, "peak");
    if (wait.chargeableMins > 0 && wait.charge > 0) { waiting = wait.charge; lines.push({ key: "waiting", label: `Chargeable waiting (${wait.chargeableMins} min, billed after the trip)`, amount: wait.charge }); }
  } else {
    const row = resolveRow(i.fares, i.brand, i.cls, i.hours, target);
    if (!row) return { ok: false, message: `No ${i.hours}-hour ${i.vehicle} package is set for this area.` };
    const { peakRule, peak } = quoteRentalRow({ row: row.value, settings: s, pickupMs: i.pickupMs });
    rateLabel = `${SOURCE[row.scope].split(" ")[0]} Rental Package (${i.hours} hr / ${row.value.includedKm} km)${i.brand !== "common" && row.brand === "common" ? " · shared" : ""}`;
    add("package", `Package (${i.hours} hr / ${row.value.includedKm} km)`, row.value.customerFare);
    if (peak > 0) add("peak", `Peak-hour charge · ${peakRule?.label ?? ""}`, peak, "peak");
  }

  // The common ₹ night allowance (11 PM – 6 AM) applies unless this page's own percentage decides the night charge.
  const { hour } = istParts(i.pickupMs);
  if (!ownNight && i.night.enabled && (hour >= 23 || hour < 6)) {
    const amount = i.night.classes[i.cls] ?? i.night.amount;
    if (amount > 0) add("commonNight", "Night allowance (common setting)", amount);
  }

  const { percent, mode } = s.gst, rate = percent / 100;
  let totals = gstTotals(sum / 100, percent, mode);
  const fee = i.platform[i.service === "ride" ? "local" : "rental"];
  if (fee.enabled && totals.taxable > 0) {
    let amount = Math.round(totals.taxable * fee.percent) / 100;
    if (amount < fee.min) amount = fee.min;
    if (fee.cap > 0 && amount > fee.cap) amount = fee.cap;
    amount = Math.round(amount);
    if (amount > 0) {
      lines.push({ key: "platform", label: "Platform fee", amount });
      if (mode === "excluded") totals = gstTotals((sum + p(amount)) / 100, percent, mode);
      else {
        const total = (p(totals.total) + Math.round(p(amount) * (1 + rate))) / 100;
        const taxable = (p(totals.taxable) + p(amount)) / 100;
        totals = { taxable, total, gst: (p(total) - p(taxable)) / 100 };
      }
    }
  }
  const later = waiting > 0 ? gstTotals(waiting, percent, mode) : { total: 0, gst: 0 };
  return { ok: true, rateLabel, lines, gst: (p(totals.gst) + p(later.gst)) / 100, total: (p(totals.total) + p(later.total)) / 100, waiting };
}
