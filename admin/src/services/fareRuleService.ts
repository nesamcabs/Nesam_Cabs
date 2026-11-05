import { collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS, describeDataError } from "./adminFirestoreService";
import type { FareRule, MasterLocation, PricingModel, TravelService, VehicleCategory } from "../types";

export class FareRuleActionError extends Error {}

function assertLegacyEditable(rule: FareRule) {
  if ((rule as FareRule & { managed?: boolean }).managed === true) {
    throw new FareRuleActionError('Use Service & Fare Settings → Fixed route fares to change this fare. That tool preserves its partner payout, tax settings and version history.');
  }
}

/** Fare-rule form: every numeric field is entered by the admin (no invented defaults). */
export interface FareRuleForm {
  name: string;
  code: string;
  serviceId: string;
  vehicleCategoryId: string;
  pricingType: PricingModel;
  originLocationId: string;
  destinationLocationId: string;
  baseFare: number;
  baseKm: number;
  perKmRate: number;
  minimumKmPerDay: number;
  minimumFare: number;
  includedHours: number;
  extraKmRate: number;
  extraHourRate: number;
  driverBatta: number;
  nightChargeEnabled: boolean;
  nightStartTime: string;
  nightEndTime: string;
  nightChargeType: "Fixed" | "Percentage";
  nightChargeValue: number;
  freeWaitingMinutes: number;
  waitingChargePerHour: number;
  tollMode: "Included" | "Excluded" | "Fixed";
  fixedTollAmount: number;
  parkingMode: "Included" | "Excluded" | "Fixed";
  fixedParkingAmount: number;
  permitCharge: number;
  priority: number;
  status: "Active" | "Inactive";
  effectiveFrom: string;
  effectiveUntil: string;
}

export type FareRuleField = keyof FareRuleForm;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_FIELDS: FareRuleField[] = [
  "baseFare", "baseKm", "perKmRate", "minimumKmPerDay", "minimumFare", "includedHours", "extraKmRate", "extraHourRate",
  "driverBatta", "nightChargeValue", "freeWaitingMinutes", "waitingChargePerHour", "fixedTollAmount", "fixedParkingAmount", "permitCharge",
];

/** Two rules overlap when both can be active on the same day for the same scope. */
function periodsOverlap(a: { effectiveFrom?: string; effectiveUntil?: string }, b: { effectiveFrom?: string; effectiveUntil?: string }) {
  const aFrom = a.effectiveFrom || "0000-00-00";
  const aTo = a.effectiveUntil || "9999-12-31";
  const bFrom = b.effectiveFrom || "0000-00-00";
  const bTo = b.effectiveUntil || "9999-12-31";
  return aFrom <= bTo && bFrom <= aTo;
}

export function validateFareRule(f: FareRuleForm, rules: FareRule[], editingId: string | null): Partial<Record<FareRuleField, string>> {
  const e: Partial<Record<FareRuleField, string>> = {};
  const name = f.name.trim();
  if (name.length < 3 || name.length > 80) e.name = "Name must be 3–80 characters.";
  else if (rules.some((r) => r.id !== editingId && (r.name || "").trim().toLowerCase() === name.toLowerCase())) e.name = "Another fare rule already has this name.";
  if (f.code.trim() && rules.some((r) => r.id !== editingId && (r.code || "").toUpperCase() === f.code.trim().toUpperCase())) e.code = "This code is already used.";
  if (!f.vehicleCategoryId) e.vehicleCategoryId = "Choose a vehicle category.";
  for (const k of AMOUNT_FIELDS) {
    const v = f[k] as number;
    if (!Number.isFinite(v) || v < 0) e[k] = "Must be zero or more.";
    else if (v > 1000000) e[k] = "Value is too large.";
  }
  switch (f.pricingType) {
    case "FIXED_ROUTE":
      if (!f.originLocationId || !f.destinationLocationId) e.originLocationId = "Choose both origin and destination.";
      else if (f.originLocationId === f.destinationLocationId) e.destinationLocationId = "Origin and destination must differ.";
      if (!(f.baseFare > 0)) e.baseFare = "Enter the fixed route fare.";
      break;
    case "HOURLY_RENTAL":
      if (!(f.baseFare > 0)) e.baseFare = "Enter the package price.";
      if (!(f.includedHours > 0)) e.includedHours = "Enter the hours included in the package.";
      if (!(f.baseKm > 0)) e.baseKm = "Enter the km included in the package.";
      if (!(f.extraKmRate > 0 || f.perKmRate > 0)) e.extraKmRate = "Enter the rate for extra km.";
      break;
    case "PER_DAY":
      if (!(f.perKmRate > 0)) e.perKmRate = "Enter the per-km rate.";
      if (!(f.minimumKmPerDay > 0)) e.minimumKmPerDay = "Enter the minimum km billed per day.";
      break;
    case "PER_KM":
    case "BASE_PLUS_PER_KM":
      if (!(f.perKmRate > 0)) e.perKmRate = "Enter the per-km rate.";
      break;
    default:
      e.pricingType = "Choose a pricing model.";
  }
  if (f.nightChargeEnabled) {
    if (!TIME_RE.test(f.nightStartTime) || !TIME_RE.test(f.nightEndTime)) e.nightStartTime = "Enter the night window as HH:MM.";
    if (!(f.nightChargeValue > 0)) e.nightChargeValue = "Enter the night charge.";
    else if (f.nightChargeType === "Percentage" && f.nightChargeValue > 100) e.nightChargeValue = "A percentage cannot exceed 100.";
  }
  if (f.tollMode === "Fixed" && !(f.fixedTollAmount > 0)) e.fixedTollAmount = "Enter the fixed toll amount.";
  if (f.parkingMode === "Fixed" && !(f.fixedParkingAmount > 0)) e.fixedParkingAmount = "Enter the fixed parking amount.";
  if (!Number.isInteger(f.priority) || f.priority < 1 || f.priority > 99) e.priority = "Priority must be a whole number from 1 (highest) to 99.";
  if (f.effectiveFrom && !DATE_RE.test(f.effectiveFrom)) e.effectiveFrom = "Enter a valid date.";
  if (f.effectiveUntil && !DATE_RE.test(f.effectiveUntil)) e.effectiveUntil = "Enter a valid date.";
  if (!e.effectiveFrom && !e.effectiveUntil && f.effectiveFrom && f.effectiveUntil && f.effectiveUntil < f.effectiveFrom) {
    e.effectiveUntil = "The end date is before the start date.";
  }
  if (f.status === "Active" && !Object.keys(e).length) {
    const clash = rules.find(
      (r) =>
        r.id !== editingId &&
        r.status === "Active" &&
        r.vehicleCategoryId === f.vehicleCategoryId &&
        (r.serviceId || "") === f.serviceId &&
        r.pricingType === f.pricingType &&
        (r.priority ?? 1) === f.priority &&
        (f.pricingType !== "FIXED_ROUTE" || (r.originLocationId === f.originLocationId && r.destinationLocationId === f.destinationLocationId)) &&
        periodsOverlap(r, f),
    );
    if (clash) e.priority = `Active rule "${clash.name}" covers the same scope, period and priority. Change the priority or dates, or deactivate one.`;
  }
  return e;
}

/** Firestore rejects undefined: unused optional fields are stored as "" or 0. */
function payload(f: FareRuleForm, ctx: { services: TravelService[]; categories: VehicleCategory[]; locations: MasterLocation[] }) {
  const svc = ctx.services.find((s) => s.id === f.serviceId);
  const cat = ctx.categories.find((c) => c.id === f.vehicleCategoryId);
  const route = f.pricingType === "FIXED_ROUTE";
  const origin = route ? ctx.locations.find((l) => l.id === f.originLocationId) : undefined;
  const dest = route ? ctx.locations.find((l) => l.id === f.destinationLocationId) : undefined;
  const nums = Object.fromEntries(AMOUNT_FIELDS.map((k) => [k, Number(f[k]) || 0]));
  return {
    ...nums,
    name: f.name.trim(),
    code: f.code.trim().toUpperCase(),
    serviceId: svc ? svc.id : "",
    serviceName: svc ? svc.name : "",
    vehicleCategoryId: f.vehicleCategoryId,
    vehicleCategoryName: cat ? cat.name : "",
    pricingType: f.pricingType,
    originLocationId: origin ? origin.id : "",
    originLocationName: origin ? origin.name : "",
    destinationLocationId: dest ? dest.id : "",
    destinationLocationName: dest ? dest.name : "",
    nightChargeEnabled: f.nightChargeEnabled,
    nightStartTime: f.nightChargeEnabled ? f.nightStartTime : "",
    nightEndTime: f.nightChargeEnabled ? f.nightEndTime : "",
    nightChargeType: f.nightChargeType,
    tollMode: f.tollMode,
    parkingMode: f.parkingMode,
    priority: f.priority,
    status: f.status,
    effectiveFrom: f.effectiveFrom,
    effectiveUntil: f.effectiveUntil,
  };
}

export async function saveFareRule(
  f: FareRuleForm,
  existing: FareRule | null,
  ctx: { services: TravelService[]; categories: VehicleCategory[]; locations: MasterLocation[] },
  actorId: string,
): Promise<string> {
  if (existing) assertLegacyEditable(existing);
  const data = payload(f, ctx);
  try {
    if (existing) {
      await updateDoc(doc(db, COLLECTIONS.FARE_RULES, existing.id), { ...data, updatedAt: serverTimestamp() });
      return existing.id;
    }
    const ref = doc(collection(db, COLLECTIONS.FARE_RULES));
    await setDoc(ref, { ...data, id: ref.id, createdBy: actorId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  } catch (err) {
    throw new FareRuleActionError(describeDataError(err));
  }
}

export async function setFareRuleStatus(rule: FareRule, status: "Active" | "Inactive", rules: FareRule[]) {
  assertLegacyEditable(rule);
  if (status === "Active") {
    const form = formFromRule(rule);
    const errors = validateFareRule({ ...form, status: "Active" }, rules, rule.id);
    const first = Object.values(errors)[0];
    if (first) throw new FareRuleActionError(`Cannot activate: ${first}`);
  }
  try {
    await updateDoc(doc(db, COLLECTIONS.FARE_RULES, rule.id), { status, updatedAt: serverTimestamp() });
  } catch (err) {
    throw new FareRuleActionError(describeDataError(err));
  }
}

/** Copies a rule as an inactive draft so it never clashes with the original. */
export async function duplicateFareRule(rule: FareRule, rules: FareRule[], actorId: string) {
  assertLegacyEditable(rule);
  let n = 1;
  let name = `${rule.name} (Copy)`;
  while (rules.some((r) => (r.name || "").trim().toLowerCase() === name.toLowerCase()) && n < 99) name = `${rule.name} (Copy ${++n})`;
  const ref = doc(collection(db, COLLECTIONS.FARE_RULES));
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = rule;
  try {
    await setDoc(ref, { ...rest, id: ref.id, name, code: "", status: "Inactive", createdBy: actorId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return name;
  } catch (err) {
    throw new FareRuleActionError(describeDataError(err));
  }
}

/** Fare rules are configuration only (bookings store their own price), so they can be deleted. */
export async function deleteFareRule(rule: FareRule) {
  assertLegacyEditable(rule);
  try {
    await deleteDoc(doc(db, COLLECTIONS.FARE_RULES, rule.id));
  } catch (err) {
    throw new FareRuleActionError(describeDataError(err));
  }
}

export function formFromRule(r: FareRule): FareRuleForm {
  return {
    name: r.name || "",
    code: r.code || "",
    serviceId: r.serviceId || "",
    vehicleCategoryId: r.vehicleCategoryId || "",
    pricingType: r.pricingType || "BASE_PLUS_PER_KM",
    originLocationId: r.originLocationId || "",
    destinationLocationId: r.destinationLocationId || "",
    baseFare: r.baseFare || 0,
    baseKm: r.baseKm || 0,
    perKmRate: r.perKmRate || 0,
    minimumKmPerDay: r.minimumKmPerDay || 0,
    minimumFare: r.minimumFare || 0,
    includedHours: r.includedHours || 0,
    extraKmRate: r.extraKmRate || 0,
    extraHourRate: r.extraHourRate || 0,
    driverBatta: r.driverBatta || 0,
    nightChargeEnabled: Boolean(r.nightChargeEnabled),
    nightStartTime: r.nightStartTime || "",
    nightEndTime: r.nightEndTime || "",
    nightChargeType: r.nightChargeType || "Percentage",
    nightChargeValue: r.nightChargeValue || 0,
    freeWaitingMinutes: r.freeWaitingMinutes || 0,
    waitingChargePerHour: r.waitingChargePerHour || 0,
    tollMode: r.tollMode || "Excluded",
    fixedTollAmount: r.fixedTollAmount || 0,
    parkingMode: r.parkingMode || "Excluded",
    fixedParkingAmount: r.fixedParkingAmount || 0,
    permitCharge: r.permitCharge || 0,
    priority: r.priority || 1,
    status: r.status || "Inactive",
    effectiveFrom: r.effectiveFrom || "",
    effectiveUntil: r.effectiveUntil || "",
  };
}

export const emptyFareRuleForm = (): FareRuleForm => ({
  ...formFromRule({ id: "", name: "", vehicleCategoryId: "", pricingType: "BASE_PLUS_PER_KM", baseFare: 0, baseKm: 0, perKmRate: 0, driverBatta: 0, status: "Active" }),
  status: "Active",
});
