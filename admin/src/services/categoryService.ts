import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
} from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS, describeDataError } from "./adminFirestoreService";
import type { VehicleCategory, VehicleCategoryFare } from "../types";

export class CategoryActionError extends Error {}

export type BrandImageKey = "nesam" | "people_taxi" | "onewaycarrentals";
export const BRAND_IMAGE_BRANDS: { id: BrandImageKey; name: string }[] = [
  { id: "nesam", name: "NESAM" },
  { id: "people_taxi", name: "People Taxi" },
  { id: "onewaycarrentals", name: "One Way Car Rentals" },
];

export const ALL_BRAND_KEYS: BrandImageKey[] = BRAND_IMAGE_BRANDS.map((b) => b.id);

/** Brands whose site offers a category (older records without the list are offered everywhere). */
export const brandsOfCategory = (cat: Pick<VehicleCategory, "brands">): BrandImageKey[] =>
  Array.isArray(cat.brands) ? cat.brands.filter((b) => ALL_BRAND_KEYS.includes(b)) : ALL_BRAND_KEYS;

export const categoryOffersBrand = (cat: Pick<VehicleCategory, "brands">, brand: BrandImageKey) =>
  brandsOfCategory(cat).includes(brand);

/** What a brand's customers get: hidden everywhere when the category itself is Inactive, otherwise this brand's own switch. */
export const categoryStatusForBrand = (cat: Pick<VehicleCategory, "status" | "brandStatus">, brand: BrandImageKey): "Active" | "Inactive" =>
  cat.status === "Inactive" || cat.brandStatus?.[brand] === "Inactive" ? "Inactive" : "Active";

/** The car picture a brand shows: its own image, else the shared one. */
export const carImageForBrand = (cat: Pick<VehicleCategory, "brandImages" | "imageUrl">, brand: BrandImageKey) =>
  cat.brandImages?.[brand] || cat.imageUrl || "";

export type CategoryForm = Omit<VehicleCategory, "id" | "vehicleCount" | "createdAt" | "updatedAt" | "createdBy" | "fare"> & {
  fare: Required<VehicleCategoryFare>;
};

export type CategoryField =
  | "name"
  | "code"
  | "imageUrl"
  | "iconUrl"
  | "seatingCapacity"
  | "recommendedPassengers"
  | "displayOrder"
  | "nightAllowanceByBrand"
  | `fare.${keyof VehicleCategoryFare}`;

/** The most a night allowance can be, in rupees. */
export const NIGHT_ALLOWANCE_MAX = 100000;

export const FARE_FIELD_LIMITS: Record<keyof VehicleCategoryFare, number> = {
  baseFare: 100000,
  baseKm: 1000,
  perKmRate: 1000,
  minimumFare: 100000,
  driverAllowance: 100000,
  nightAllowance: 100000,
  waitingChargePerHour: 100000,
  extraHourCharge: 100000,
  extraKmCharge: 1000,
  tollIncluded: 1,
  parkingIncluded: 1,
  permitCharge: 100000,
  carrierCharge: 100000,
  outstationPerKmRate: 1000,
  outstationDriverBattaPerDay: 100000,
  outstationMinKmPerDay: 2000,
};

/** "Innova Crysta" → "INNOVA_CRYSTA". */
export const deriveCategoryCode = (value: string) =>
  value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .slice(0, 30)
    .replace(/^_+|_+$/g, "");

export function validateCategory(
  form: CategoryForm,
  categories: VehicleCategory[],
  editingId: string | null,
): Partial<Record<CategoryField, string>> {
  const errors: Partial<Record<CategoryField, string>> = {};
  const name = form.name.trim();
  const code = deriveCategoryCode(form.code || form.name);
  if (name.length < 2 || name.length > 50) errors.name = "Name must be 2–50 characters.";
  else if (categories.some((c) => c.id !== editingId && (c.name || "").trim().toLowerCase() === name.toLowerCase())) {
    errors.name = `A category named "${name}" already exists.`;
  }
  if (!code) errors.code = "Code must contain letters or numbers.";
  else if (categories.some((c) => c.id !== editingId && deriveCategoryCode(c.code || c.name || "") === code)) {
    errors.code = `Code ${code} is already used by another category.`;
  }
  if (form.imageUrl && !/^https?:\/\/\S+$/i.test(form.imageUrl.trim())) {
    errors.imageUrl = "Enter a full image link starting with http:// or https://.";
  }
  if (form.iconUrl && !/^https?:\/\/\S+$/i.test(form.iconUrl.trim())) {
    errors.iconUrl = "Enter a valid icon image URL.";
  }
  if (!Number.isInteger(form.seatingCapacity) || form.seatingCapacity < 1 || form.seatingCapacity > 60) {
    errors.seatingCapacity = "Seating must be a whole number from 1 to 60.";
  }
  const rec = form.recommendedPassengers ?? 0;
  if (rec && (!Number.isInteger(rec) || rec < 1 || rec > form.seatingCapacity)) {
    errors.recommendedPassengers = "Recommended passengers must be between 1 and the seating capacity.";
  }
  if (!Number.isInteger(form.displayOrder ?? 1) || (form.displayOrder ?? 1) < 1) {
    errors.displayOrder = "Display order must be a whole number of 1 or more.";
  }
  for (const [brand, amount] of Object.entries(form.nightAllowanceByBrand ?? {})) {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > NIGHT_ALLOWANCE_MAX) {
      const name = BRAND_IMAGE_BRANDS.find((b) => b.id === brand)?.name ?? brand;
      errors.nightAllowanceByBrand = `${name} night allowance must be between 0 and ${NIGHT_ALLOWANCE_MAX.toLocaleString("en-IN")}.`;
      break;
    }
  }
  for (const [key, max] of Object.entries(FARE_FIELD_LIMITS) as [keyof VehicleCategoryFare, number][]) {
    const value = form.fare[key];
    if (typeof value !== "number") continue;
    if (!Number.isFinite(value) || value < 0) errors[`fare.${key}`] = "Must be zero or more.";
    else if (value > max) errors[`fare.${key}`] = `Must not exceed ${max.toLocaleString("en-IN")}.`;
  }
  // Fares are no longer entered on this form (pricing lives in Common price), so a per-km rate is not required here.
  if (!errors["fare.minimumFare"] && form.fare.minimumFare > 0 && form.fare.minimumFare < form.fare.baseFare) {
    errors["fare.minimumFare"] = "Minimum fare cannot be lower than the base fare.";
  }
  return errors;
}

function payloadFrom(form: CategoryForm) {
  return {
    name: form.name.trim(),
    code: deriveCategoryCode(form.code || form.name),
    description: (form.description || "").trim(),
    imageUrl: (form.imageUrl || "").trim(),
    brandImages: Object.fromEntries(
      Object.entries(form.brandImages ?? {}).filter(([, url]) => typeof url === "string" && /^https?:\/\/\S+$/i.test(url.trim())),
    ) as NonNullable<VehicleCategory["brandImages"]>,
    brands: brandsOfCategory(form),
    brandStatus: Object.fromEntries(
      Object.entries(form.brandStatus ?? {}).filter(([brand, s]) => ALL_BRAND_KEYS.includes(brand as BrandImageKey) && s === "Inactive"),
    ) as NonNullable<VehicleCategory["brandStatus"]>,
    // Only brands that offer this category, and only amounts above zero (nothing set = no night allowance).
    nightAllowanceByBrand: Object.fromEntries(
      Object.entries(form.nightAllowanceByBrand ?? {})
        .filter(([brand, amount]) => brandsOfCategory(form).includes(brand as BrandImageKey) && typeof amount === "number" && amount > 0)
        .map(([brand, amount]) => [brand, Math.round((amount as number) * 100) / 100]),
    ) as NonNullable<VehicleCategory["nightAllowanceByBrand"]>,
    iconUrl: (form.iconUrl || "").trim(),
    icon: form.icon || "🚘",
    seatingCapacity: form.seatingCapacity,
    luggageCapacity: typeof form.luggageCapacity === "string" ? form.luggageCapacity.trim() : form.luggageCapacity ?? "",
    acSupported: form.acSupported ?? "Both",
    recommendedPassengers: form.recommendedPassengers || form.seatingCapacity,
    displayOrder: form.displayOrder || 1,
    cngEnabled: form.cngEnabled === true,
    status: form.status,
    fare: { ...form.fare },
  };
}

// ── References ──────────────────────────────────────────────────────────────

export interface CategoryReferences {
  vehicles: number;
  fareRules: number;
  services: number;
  tourPackages: number;
  coupons: number;
}

const matchesCategory = (cat: VehicleCategory, value?: string) => {
  const v = (value || "").trim().toLowerCase();
  return !!v && (v === (cat.name || "").trim().toLowerCase() || v === (cat.code || "").toLowerCase() || v === cat.id.toLowerCase());
};

/** Vehicles belonging to a category (by id, or by name/code for older records). */
export function vehiclesInCategory<T extends { categoryId?: string; category?: string }>(cat: VehicleCategory, vehicles: T[]): T[] {
  return vehicles.filter((v) => (v.categoryId ? v.categoryId === cat.id : matchesCategory(cat, v.category)));
}

export async function findCategoryReferences(
  cat: VehicleCategory,
  vehicles: { categoryId?: string; category?: string }[],
): Promise<CategoryReferences> {
  const count = async (coll: string, field: string, op: "==" | "array-contains") =>
    (await getDocs(query(collection(db, coll), where(field, op, cat.id)))).size;
  try {
    const [fareRules, services, tourPackages, coupons] = await Promise.all([
      count(COLLECTIONS.FARE_RULES, "vehicleCategoryId", "=="),
      count(COLLECTIONS.SERVICES, "allowedVehicleCategoryIds", "array-contains"),
      count(COLLECTIONS.TOUR_PACKAGES, "allowedVehicleCategoryIds", "array-contains"),
      count(COLLECTIONS.COUPONS, "vehicleCategoryIds", "array-contains"),
    ]);
    return { vehicles: vehiclesInCategory(cat, vehicles).length, fareRules, services, tourPackages, coupons };
  } catch (err) {
    throw new CategoryActionError(describeDataError(err));
  }
}

export function describeReferences(r: CategoryReferences): string {
  const parts = [
    [r.vehicles, "vehicle"],
    [r.fareRules, "fare rule"],
    [r.services, "service"],
    [r.tourPackages, "tour package"],
    [r.coupons, "coupon"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, label]) => `${n} ${label}${n === 1 ? "" : "s"}`);
  return parts.join(", ");
}

// ── Writes ──────────────────────────────────────────────────────────────────

async function commitInChunks(updates: { ref: DocumentReference; data: Record<string, unknown> }[]) {
  for (let i = 0; i < updates.length; i += 400) {
    const batch = writeBatch(db);
    for (const u of updates.slice(i, i + 400)) batch.update(u.ref, u.data);
    await batch.commit();
  }
}

/** Keeps the denormalised category name in step on every linked record. */
async function propagateRename(cat: VehicleCategory, oldName: string, newName: string) {
  const stamp = serverTimestamp();
  const updates: { ref: DocumentReference; data: Record<string, unknown> }[] = [];
  const seen = new Set<string>();
  const add = (ref: DocumentReference, data: Record<string, unknown>) => {
    if (seen.has(ref.path)) return;
    seen.add(ref.path);
    updates.push({ ref, data: { ...data, updatedAt: stamp } });
  };
  const renameIn = (names: unknown) =>
    Array.isArray(names) ? names.map((n) => (n === oldName ? newName : n)) : names;

  const [byId, byName, rules, services, packages, coupons] = await Promise.all([
    getDocs(query(collection(db, COLLECTIONS.VEHICLES), where("categoryId", "==", cat.id))),
    getDocs(query(collection(db, COLLECTIONS.VEHICLES), where("category", "==", oldName))),
    getDocs(query(collection(db, COLLECTIONS.FARE_RULES), where("vehicleCategoryId", "==", cat.id))),
    getDocs(query(collection(db, COLLECTIONS.SERVICES), where("allowedVehicleCategoryIds", "array-contains", cat.id))),
    getDocs(query(collection(db, COLLECTIONS.TOUR_PACKAGES), where("allowedVehicleCategoryIds", "array-contains", cat.id))),
    getDocs(query(collection(db, COLLECTIONS.COUPONS), where("vehicleCategoryIds", "array-contains", cat.id))),
  ]);
  for (const d of byId.docs) add(d.ref, { category: newName });
  // Older vehicles only carry the name; link them to the category id as well.
  for (const d of byName.docs) if (!d.data().categoryId) add(d.ref, { category: newName, categoryId: cat.id });
  for (const d of rules.docs) add(d.ref, { vehicleCategoryName: newName });
  for (const d of services.docs) add(d.ref, { allowedVehicleCategoryNames: renameIn(d.data().allowedVehicleCategoryNames) ?? [] });
  for (const d of packages.docs) add(d.ref, { allowedVehicleCategoryNames: renameIn(d.data().allowedVehicleCategoryNames) ?? [] });
  for (const d of coupons.docs) {
    if (Array.isArray(d.data().vehicleCategoryNames)) add(d.ref, { vehicleCategoryNames: renameIn(d.data().vehicleCategoryNames) });
  }
  await commitInChunks(updates);
  return updates.length;
}

/**
 * Creates (auto id) or updates a category. Returns how many linked records had
 * their stored category name updated after a rename.
 */
export async function saveCategory(form: CategoryForm, existing: VehicleCategory | null): Promise<{ id: string; renamed: number }> {
  const data = payloadFrom(form);
  try {
    if (!existing) {
      const ref = doc(collection(db, COLLECTIONS.VEHICLE_CATEGORIES));
      await setDoc(ref, { ...data, id: ref.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      return { id: ref.id, renamed: 0 };
    }
    await updateDoc(doc(db, COLLECTIONS.VEHICLE_CATEGORIES, existing.id), { ...data, updatedAt: serverTimestamp() });
  } catch (err) {
    throw new CategoryActionError(describeDataError(err));
  }
  if (existing.name.trim() === data.name) return { id: existing.id, renamed: 0 };
  try {
    return { id: existing.id, renamed: await propagateRename(existing, existing.name.trim(), data.name) };
  } catch (err) {
    throw new CategoryActionError(
      `The category was saved, but linked records still show the old name (${describeDataError(err)}). Save again to retry.`,
    );
  }
}

/** Saves only a car image link of a category (used by the bulk image upload). */
export async function setCategoryImage(cat: VehicleCategory, imageUrl: string, brand?: BrandImageKey): Promise<void> {
  try {
    // One brand's own image, or (no brand) the shared image every brand falls back to.
    const field = brand ? { [`brandImages.${brand}`]: imageUrl } : { imageUrl };
    await updateDoc(doc(db, COLLECTIONS.VEHICLE_CATEGORIES, cat.id), { ...field, updatedAt: serverTimestamp() });
  } catch (err) {
    throw new CategoryActionError(describeDataError(err));
  }
}

/** Offers a category on a brand's site, or stops offering it there. Other brands are untouched. */
export async function setCategoryBrand(cat: VehicleCategory, brand: BrandImageKey, offered: boolean): Promise<void> {
  const current = brandsOfCategory(cat);
  const brands = offered ? [...new Set([...current, brand])] : current.filter((b) => b !== brand);
  try {
    await updateDoc(doc(db, COLLECTIONS.VEHICLE_CATEGORIES, cat.id), { brands, updatedAt: serverTimestamp() });
  } catch (err) {
    throw new CategoryActionError(describeDataError(err));
  }
}

/**
 * Hides or shows a category on one brand's site only. A category that is Inactive everywhere is switched back on for this
 * brand alone: the other brands that offer it are kept hidden so they do not appear by surprise.
 */
export async function setCategoryBrandStatus(cat: VehicleCategory, brand: BrandImageKey, status: "Active" | "Inactive"): Promise<void> {
  const brandStatus: Record<string, "Inactive"> = {};
  for (const b of ALL_BRAND_KEYS) if (cat.brandStatus?.[b] === "Inactive") brandStatus[b] = "Inactive";
  const update: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (status === "Inactive") brandStatus[brand] = "Inactive";
  else {
    delete brandStatus[brand];
    if (cat.status === "Inactive") {
      update.status = "Active";
      for (const b of ALL_BRAND_KEYS) if (b !== brand) brandStatus[b] = "Inactive";
    }
  }
  update.brandStatus = brandStatus;
  try {
    await updateDoc(doc(db, COLLECTIONS.VEHICLE_CATEGORIES, cat.id), update);
  } catch (err) {
    throw new CategoryActionError(describeDataError(err));
  }
}

export async function setCategoryStatus(cat: VehicleCategory, status: "Active" | "Inactive"): Promise<void> {
  // Fares come from Service & Fare Settings → Fares (by rate class), so a category no longer needs its own per-km rate to be active.
  try {
    await updateDoc(doc(db, COLLECTIONS.VEHICLE_CATEGORIES, cat.id), { status, updatedAt: serverTimestamp() });
  } catch (err) {
    throw new CategoryActionError(describeDataError(err));
  }
}

/** Deletes a category nothing refers to; otherwise explains what uses it. */
export async function deleteCategory(
  cat: VehicleCategory,
  vehicles: { categoryId?: string; category?: string }[],
): Promise<void> {
  const refs = await findCategoryReferences(cat, vehicles);
  const used = describeReferences(refs);
  if (used) {
    throw new CategoryActionError(
      `"${cat.name}" is used by ${used}. Deactivate it instead, or move those records to another category first.`,
    );
  }
  try {
    await deleteDoc(doc(db, COLLECTIONS.VEHICLE_CATEGORIES, cat.id));
  } catch (err) {
    throw new CategoryActionError(describeDataError(err));
  }
}
