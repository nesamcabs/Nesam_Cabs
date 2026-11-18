// "Demo setup": one action that fills every pricing and catalogue setting of the admin panel with a complete, validated demo data set.
// Nothing here writes around the admin screens' own rules: every price goes through the same server functions the Pricing page uses
// (they validate, bump the version and write the audit entry), and the catalogue steps use the same services as the Services, Locations,
// Vehicle categories and Offers pages. What is published is defined in demoSetupPlan.ts (also exercised end to end by
// functions/test/demoSetup.e2e.test.js on the Firebase emulators).
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { auth, db } from "./firebase";
import { callFunction } from "./callables";
import { saveCategory, type CategoryForm } from "./categoryService";
import { seedBuiltInCities } from "./locationService";
import { seedDefaultServices } from "./serviceMasterService";
import { emptyCouponDraft, saveCoupon, validateDraft, type Coupon } from "./couponService";
import { saveNightAllowance, saveTariffConfig, savePlatformFee, saveFixedRouteFare, seedLegalDocuments } from "./bookingOpsService";
import {
  DEMO_REASON, NIGHT_ALLOWANCE_DEMO, PLATFORM_FEE_DEMO, buildFixedRouteCalls, buildTariffCalls, pendingTariffCalls, tariffInputWithLocalFares, type DemoContext,
} from "./demoSetupPlan";
import type { MasterLocation, TravelService, VehicleCategory } from "../types";

export type DemoStatus = "waiting" | "running" | "done" | "skipped" | "failed";
export interface DemoStep { id: string; label: string; hint: string; status: DemoStatus; detail: string }

export const DEMO_STEPS: Omit<DemoStep, "status" | "detail">[] = [
  { id: "categories", label: "Vehicle categories", hint: "Hatchback, Sedan, SUV 6+1, SUV 7+1, Innova, Innova Crysta (only the ones missing)" },
  { id: "cities", label: "Locations · every Indian state and union territory", hint: "432 cities in 36 states and union territories (only the ones missing)" },
  { id: "services", label: "Services", hint: "One Way, Round Trip, Airport, Local Rental, Pickup & Drop, Multicity (only the ones missing)" },
  { id: "tariff", label: "Fares & settings", hint: "Base rates, airport, Round Trip packages (guide v8), hill stations, rentals, extra charges, GST, brand prices, Pickup & Drop in every city" },
  { id: "fees", label: "Platform fee & night allowance", hint: "Night allowance for every vehicle (11 PM – 6 AM); no platform fee, so the guide's fares stay exact" },
  { id: "enable", label: "Switch the tariff on", hint: "Customers on all three sites start seeing these prices" },
  { id: "fixed", label: "Fixed route fares across India", hint: "Popular routes for Sedan and Innova" },
  { id: "coupons", label: "Offers & coupons", hint: "WELCOME100, NESAM10, ROUNDTRIP5" },
  { id: "legal", label: "Terms & privacy templates", hint: "Templates only — nothing is published without your review" },
];

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Firebase: /, "").slice(0, 240);
const uid = () => auth.currentUser?.uid ?? "";

/** The six demo vehicle categories: names the server maps to their own tariff class, each with its own rates. */
const DEMO_CATEGORIES: { name: string; seats: number; description: string; rate: number; bata: number; carrier: number; waiting: number; luggage: string }[] = [
  { name: "Hatchback", seats: 4, description: "Swift, Wagon R, i10 or similar — 4 seats, AC", rate: 15, bata: 400, carrier: 0, waiting: 150, luggage: "2 Bags" },
  { name: "Sedan", seats: 4, description: "Dzire, Etios, Aura or similar — comfortable AC sedans", rate: 15, bata: 400, carrier: 0, waiting: 150, luggage: "2 Bags" },
  { name: "SUV 6+1", seats: 6, description: "Maruti Ertiga, Marazzo or similar — 6 passengers", rate: 20, bata: 400, carrier: 400, waiting: 200, luggage: "3 Bags" },
  { name: "SUV 7+1", seats: 7, description: "Mahindra Scorpio, Bolero Neo or similar — 7 passengers", rate: 21, bata: 450, carrier: 400, waiting: 200, luggage: "4 Bags" },
  { name: "Innova", seats: 7, description: "Toyota Innova — spacious highway comfort", rate: 22, bata: 500, carrier: 400, waiting: 250, luggage: "4 Bags" },
  { name: "Innova Crysta", seats: 7, description: "Toyota Innova Crysta — executive luxury MPV", rate: 26, bata: 600, carrier: 400, waiting: 300, luggage: "4 Bags" },
];

async function readCategories(): Promise<VehicleCategory[]> {
  const snap = await getDocs(collection(db, "vehicle_categories"));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as VehicleCategory);
}
async function readCities(): Promise<MasterLocation[]> {
  const snap = await getDocs(query(collection(db, "locations"), where("type", "==", "City")));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as MasterLocation);
}

export interface PublishOptions {
  /** Replace values that are already saved with the demo values. Off = keep everything already saved and fill only the gaps. */
  replace: boolean;
  /** Called with the full list after every change, so the page can show progress. */
  onProgress: (steps: DemoStep[]) => void;
}

/** Runs every step in order. A failing step is reported and the rest still run, so one problem never leaves the data half-published silently. */
export async function publishDemoSetup(opts: PublishOptions): Promise<DemoStep[]> {
  const steps: DemoStep[] = DEMO_STEPS.map((s) => ({ ...s, status: "waiting", detail: "" }));
  const push = () => opts.onProgress(steps.map((s) => ({ ...s })));
  const set = (id: string, patch: Partial<DemoStep>) => { Object.assign(steps.find((s) => s.id === id)!, patch); push(); };
  const step = async (id: string, fn: () => Promise<{ status?: DemoStatus; detail: string }>) => {
    set(id, { status: "running", detail: "" });
    try {
      const r = await fn();
      set(id, { status: r.status ?? "done", detail: r.detail });
    } catch (e) {
      set(id, { status: "failed", detail: errText(e) });
    }
  };
  push();

  // 1 · Vehicle categories
  await step("categories", async () => {
    const have = await readCategories();
    const names = new Set(have.map((c) => (c.name || "").trim().toLowerCase()));
    let added = 0;
    for (const [i, c] of DEMO_CATEGORIES.entries()) {
      if (names.has(c.name.toLowerCase())) continue;
      const form: CategoryForm = {
        name: c.name, code: "", description: c.description, imageUrl: "", iconUrl: "", icon: "🚘", seatingCapacity: c.seats, luggageCapacity: c.luggage, acSupported: "Both",
        recommendedPassengers: c.seats, displayOrder: have.length + i + 1, cngEnabled: false, status: "Active",
        fare: {
          baseFare: 0, baseKm: 0, perKmRate: c.rate, minimumFare: 0, driverAllowance: c.bata, nightAllowance: 0, waitingChargePerHour: c.waiting, extraHourCharge: 250, extraKmCharge: c.rate,
          tollIncluded: false, parkingIncluded: false, permitCharge: 0, carrierCharge: c.carrier, outstationPerKmRate: c.rate, outstationDriverBattaPerDay: c.bata, outstationMinKmPerDay: 250,
        },
      };
      await saveCategory(form, null);
      added += 1;
    }
    return { status: added ? "done" : "skipped", detail: added ? `${added} categories added` : "All six categories already exist" };
  });

  // 2 · Cities of every state and union territory
  await step("cities", async () => {
    const n = await seedBuiltInCities(await readCities(), uid());
    return { status: n ? "done" : "skipped", detail: n ? `${n} cities added` : "Every city is already in Locations" };
  });

  // 3 · Services
  await step("services", async () => {
    const snap = await getDocs(collection(db, "services"));
    const have = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as TravelService);
    const n = await seedDefaultServices(have, uid());
    return { status: n ? "done" : "skipped", detail: n ? `${n} services added` : "All services already exist" };
  });

  // What the price steps need: the categories and cities as they are now.
  let ctx: DemoContext = { categories: [], cities: [] };
  try {
    const [cats, cities] = await Promise.all([readCategories(), readCities()]);
    ctx = {
      categories: cats.filter((c) => c.status === "Active").map((c) => ({ id: c.id, name: c.name })),
      cities: cities.filter((c) => c.status === "Active").map((c) => ({ id: c.id, name: (c.name || c.city || "").trim() })).filter((c) => c.name),
    };
  } catch (e) {
    set("tariff", { status: "failed", detail: `Could not read the vehicle categories and cities: ${errText(e)}` });
  }

  // 4 · Fares and settings, section by section through the real validating function
  if (steps.find((s) => s.id === "tariff")!.status !== "failed") {
    await step("tariff", async () => {
      const raw = await getDoc(doc(db, "business_config", "tariff_v2"));
      const calls = pendingTariffCalls(buildTariffCalls(ctx), raw.exists() ? raw.data() : null, opts.replace);
      if (!calls.length) return { status: "skipped", detail: "Every fare and setting is already saved — nothing was changed" };
      const failures: string[] = [];
      let outdated = false;
      let sent = 0;
      for (const c of calls) {
        set("tariff", { detail: `${sent} of ${calls.length} · ${c.label}` });
        try {
          await callFunction("saveTariffSection", { ...c.body, latest: true, reason: DEMO_REASON });
        } catch (e) {
          // The all-cities fare save is newer than the Cloud Functions that are live: say exactly what to do.
          if (c.body.section === "localPickupDropBulk" && /unknown tariff section/i.test(errText(e))) {
            // The live functions are older: save the same fares through the long-standing whole-tariff save instead (one call, same checks).
            try {
              const now = await getDoc(doc(db, "business_config", "tariff_v2"));
              const fares = (c.body.data as { fares: Record<string, Record<string, unknown>> }).fares;
              await callFunction("saveTariffConfig", tariffInputWithLocalFares(now.data(), fares, ctx.cities, DEMO_REASON));
            } catch (inner) {
              outdated = true;
              failures.push(`${c.label}: ${errText(inner)}`);
            }
          } else failures.push(`${c.label}: ${errText(e)}`);
        }
        sent += 1;
      }
      if (outdated) throw new Error(`${calls.length - failures.length} of ${calls.length} saved. The Pickup & Drop fares for all cities could not be saved (see below). Press Publish again; the saved parts are kept.${failures.length > 1 ? ` Other failures — ${failures.filter((f) => !f.includes("older version")).slice(0, 2).join(" · ")}` : ""}`);
      if (failures.length) throw new Error(`${calls.length - failures.length} of ${calls.length} saved. Failed — ${failures.slice(0, 3).join(" · ")}${failures.length > 3 ? ` (+${failures.length - 3} more)` : ""}`);
      return { detail: `${calls.length} settings saved` };
    });
  }

  // 5 · Night allowance per vehicle; platform fee at zero
  await step("fees", async () => {
    const [fee, night] = await Promise.all([getDoc(doc(db, "business_config", "platform_fee")), getDoc(doc(db, "business_config", "night_allowance"))]);
    let saved = 0;
    if (opts.replace || !fee.exists()) { await savePlatformFee(PLATFORM_FEE_DEMO as never); saved += 1; }
    if (opts.replace || !night.exists()) { await saveNightAllowance(NIGHT_ALLOWANCE_DEMO as never); saved += 1; }
    return { status: saved ? "done" : "skipped", detail: saved ? `${saved} setting${saved > 1 ? "s" : ""} saved (switched off)` : "Already saved" };
  });

  // 6 · Switch the tariff on
  await step("enable", async () => {
    const raw = await getDoc(doc(db, "business_config", "tariff_v2"));
    if (!raw.exists()) throw new Error("No tariff is saved yet, so it cannot be switched on. Fix the fares step first.");
    if (raw.data().enabled === true) return { status: "skipped", detail: "Already on" };
    await saveTariffConfig({ keepSavedRates: true, enabled: true, reason: DEMO_REASON });
    return { detail: "The tariff is on for all three sites" };
  });

  // 7 · Fixed route fares (routes that already exist are never duplicated)
  await step("fixed", async () => {
    const cities = ctx.cities, categories = ctx.categories;
    const existing = await getDocs(query(collection(db, "fare_rules"), where("pricingType", "==", "FIXED_ROUTE")));
    const key = (a: string, b: string, c: string) => `${a}>${b}>${c}`;
    const taken = new Set<string>();
    for (const d of existing.docs) {
      const x = d.data();
      taken.add(key(x.originLocationId, x.destinationLocationId, x.vehicleCategoryId));
      taken.add(key(x.destinationLocationId, x.originLocationId, x.vehicleCategoryId));
    }
    const routes = buildFixedRouteCalls({ cities, categories }).filter((r) => {
      const d = r.body.data as { originLocationId: string; destinationLocationId: string; vehicleCategoryId: string };
      return !taken.has(key(d.originLocationId, d.destinationLocationId, d.vehicleCategoryId));
    });
    if (!routes.length) return { status: "skipped", detail: "Every demo route already has a fare" };
    const failures: string[] = [];
    for (const r of routes) {
      try { await saveFixedRouteFare({ reason: DEMO_REASON, data: r.body.data as never }); } catch (e) { failures.push(`${r.label}: ${errText(e)}`); }
    }
    if (failures.length) throw new Error(`${routes.length - failures.length} of ${routes.length} saved. Failed — ${failures.slice(0, 2).join(" · ")}`);
    return { detail: `${routes.length} route fares saved` };
  });

  // 8 · Coupons
  await step("coupons", async () => {
    const snap = await getDocs(collection(db, "coupons"));
    const existing = snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Coupon);
    const ids = ctx.categories.map((c) => c.id);
    const wanted: [string, string, "Amount" | "Percent", number, number, number, string[] | null, "All" | "New", number][] = [
      ["WELCOME100", "Welcome offer — ₹100 off your first ride", "Amount", 100, 100, 1500, null, "New", 5000],
      ["NESAM10", "10% off outstation rides (up to ₹300)", "Percent", 10, 300, 2000, null, "All", 2000],
      ["ROUNDTRIP5", "5% off Round Trips (up to ₹500)", "Percent", 5, 500, 3000, ["Round Trip"], "All", 1000],
    ];
    let added = 0;
    for (const [code, name, type, value, max, minFare, services, audience, totalLimit] of wanted) {
      if (existing.some((c) => (c.code || "").toUpperCase() === code)) continue;
      const draft = { ...emptyCouponDraft(ids), code, name, description: name, termsAndConditions: "Demo coupon. Valid on advance bookings only.", type, value, max, minFare, audience, totalLimit, reason: "Demo data setup", ...(services ? { services } : {}) };
      const problem = validateDraft(draft, existing, null, [], ids.length);
      if (problem) throw new Error(`${code}: ${problem}`);
      await saveCoupon(draft, null, ctx.categories);
      added += 1;
    }
    return { status: added ? "done" : "skipped", detail: added ? `${added} coupons added` : "The demo coupons already exist" };
  });

  // 9 · Legal templates (super admin only on the server)
  await step("legal", async () => {
    const r = await seedLegalDocuments();
    return { status: r.created ? "done" : "skipped", detail: r.created ? `${r.created} templates added — review and publish them in Terms & Privacy` : "The templates already exist" };
  });

  return steps.map((s) => ({ ...s }));
}
