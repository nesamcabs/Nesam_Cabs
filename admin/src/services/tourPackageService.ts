import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS, describeDataError } from "./adminFirestoreService";
import type { ItineraryDay, PackageDeparture, TourPackage, Vendor, VehicleCategory } from "../types";

export class TourPackageActionError extends Error {}

export type PricingModel = TourPackage["pricingModel"];
export type PackageStatus = TourPackage["status"];
export const PRICING_MODELS: PricingModel[] = ["Per Package", "Per Person", "Vehicle Based"];
export const DEPARTURE_STATUSES: PackageDeparture["status"][] = ["Available", "Filling Fast", "Sold Out", "Cancelled"];

export interface PackageForm {
  name: string;
  code: string;
  slug: string;
  shortDescription: string;
  fullDescription: string;
  destinations: string[];
  durationDays: number;
  durationNights: number;
  itinerary: ItineraryDay[];
  pricingModel: PricingModel | "";
  basePrice: number;
  offerPrice: number;
  adultPrice: number;
  childPrice: number;
  allowedVehicleCategoryIds: string[];
  preferredVendorId: string;
  departures: PackageDeparture[];
  inclusions: string[];
  exclusions: string[];
  coverImageUrl: string;
  status: PackageStatus;
  featured: boolean;
  displayOrder: number;
  seoTitle: string;
  seoDescription: string;
}

export type PackageField =
  | "name"
  | "code"
  | "slug"
  | "destinations"
  | "durationDays"
  | "durationNights"
  | "itinerary"
  | "pricingModel"
  | "basePrice"
  | "offerPrice"
  | "adultPrice"
  | "childPrice"
  | "allowedVehicleCategoryIds"
  | "departures"
  | "coverImageUrl"
  | "displayOrder"
  | "seoTitle"
  | "seoDescription";

export const deriveCode = (v: string) => v.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 30).replace(/^_+|_+$/g, "");
export const deriveSlug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60).replace(/^-+|-+$/g, "");

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const upcomingDepartures = (p: Pick<TourPackage, "departures">, today = todayIso()) =>
  (p.departures || []).filter((d) => d.date >= today && d.status !== "Cancelled");

export function validatePackage(f: PackageForm, packages: TourPackage[], editingId: string | null): Partial<Record<PackageField, string>> {
  const e: Partial<Record<PackageField, string>> = {};
  const others = packages.filter((p) => p.id !== editingId);
  const name = f.name.trim();
  const code = deriveCode(f.code || name);
  const slug = deriveSlug(f.slug || name);
  const whole = (n: number) => Number.isInteger(n) && n >= 0;
  if (name.length < 3 || name.length > 80) e.name = "Name must be 3–80 characters.";
  else if (others.some((p) => (p.name || "").trim().toLowerCase() === name.toLowerCase())) e.name = `A package named "${name}" already exists.`;
  if (!code) e.code = "Code must contain letters or numbers.";
  else if (others.some((p) => deriveCode(p.code || p.name || "") === code)) e.code = `Code ${code} is already used.`;
  if (!slug) e.slug = "Slug must contain letters or numbers.";
  else if (others.some((p) => deriveSlug(p.slug || p.name || "") === slug)) e.slug = `Slug "${slug}" is already used.`;
  const stops = f.destinations.map((d) => d.trim()).filter(Boolean);
  if (stops.length < 2) e.destinations = "Add the starting point and at least one destination.";
  if (!Number.isInteger(f.durationDays) || f.durationDays < 1 || f.durationDays > 60) e.durationDays = "Days must be a whole number from 1 to 60.";
  else if (!Number.isInteger(f.durationNights) || f.durationNights < Math.max(0, f.durationDays - 1) || f.durationNights > f.durationDays) {
    e.durationNights = `Nights must be ${Math.max(0, f.durationDays - 1)} or ${f.durationDays} for a ${f.durationDays}-day tour.`;
  }
  if (f.itinerary.length > f.durationDays) e.itinerary = `The itinerary has ${f.itinerary.length} days but the tour lasts ${f.durationDays}.`;
  else if (f.itinerary.some((d) => !d.title.trim())) e.itinerary = "Every itinerary day needs a title.";
  else if (f.status === "Active" && f.itinerary.length === 0) e.itinerary = "Add the itinerary before making the package active.";
  if (!PRICING_MODELS.includes(f.pricingModel as PricingModel)) e.pricingModel = "Choose a pricing model.";
  if (f.pricingModel === "Per Person") {
    if (!(f.adultPrice > 0) || !whole(f.adultPrice)) e.adultPrice = "Enter the adult price in whole rupees.";
    if (!whole(f.childPrice)) e.childPrice = "Enter the child price in whole rupees (0 if free).";
    else if (!e.adultPrice && f.childPrice > f.adultPrice) e.childPrice = "Child price cannot exceed the adult price.";
  } else if (f.pricingModel) {
    if (!(f.basePrice > 0) || !whole(f.basePrice)) e.basePrice = f.pricingModel === "Vehicle Based" ? "Enter the starting price (smallest vehicle) in whole rupees." : "Enter the package price in whole rupees.";
    if (!whole(f.offerPrice)) e.offerPrice = "Offer price must be whole rupees.";
    else if (!e.basePrice && f.offerPrice > 0 && f.offerPrice >= f.basePrice) e.offerPrice = "The offer price must be lower than the regular price.";
  }
  if (f.pricingModel === "Vehicle Based" && f.allowedVehicleCategoryIds.length === 0) e.allowedVehicleCategoryIds = "Choose at least one vehicle category.";
  const today = todayIso();
  // Historical departures already saved may stay; newly added ones must be upcoming.
  const saved = new Map((packages.find((p) => p.id === editingId)?.departures || []).map((d) => [d.id, d.date]));
  for (const d of f.departures) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      e.departures = "Every departure needs a date.";
      break;
    }
    if (d.date < today && saved.get(d.id) !== d.date) {
      e.departures = "New or changed departures must be today or later.";
      break;
    }
    if (d.availableSeats !== undefined && (!Number.isInteger(d.availableSeats) || d.availableSeats < 0)) {
      e.departures = "Seats must be a whole number.";
      break;
    }
  }
  if (!e.departures) {
    const dates = f.departures.map((d) => `${d.date} ${d.time || ""}`);
    if (new Set(dates).size !== dates.length) e.departures = "Two departures have the same date and time.";
  }
  if (f.coverImageUrl && !/^https?:\/\/\S+$/i.test(f.coverImageUrl.trim())) e.coverImageUrl = "Enter a full image link starting with http:// or https://.";
  if (!Number.isInteger(f.displayOrder) || f.displayOrder < 1) e.displayOrder = "Display order must be 1 or more.";
  if (f.seoTitle.length > 70) e.seoTitle = "SEO title should be 70 characters or fewer.";
  if (f.seoDescription.length > 170) e.seoDescription = "SEO description should be 170 characters or fewer.";
  return e;
}

function payload(f: PackageForm, categories: VehicleCategory[], vendors: Vendor[]) {
  const stops = f.destinations.map((d) => d.trim()).filter(Boolean);
  const catIds = f.allowedVehicleCategoryIds.filter((id) => categories.some((c) => c.id === id));
  const vendor = vendors.find((v) => v.id === f.preferredVendorId);
  const perPerson = f.pricingModel === "Per Person";
  return {
    name: f.name.trim(),
    code: deriveCode(f.code || f.name),
    slug: deriveSlug(f.slug || f.name),
    shortDescription: f.shortDescription.trim(),
    fullDescription: f.fullDescription.trim(),
    startingLocation: stops[0] || "",
    endingLocation: stops[stops.length - 1] || "",
    destinations: stops,
    durationDays: f.durationDays,
    durationNights: f.durationNights,
    itinerary: f.itinerary.map((d, i) => ({
      dayNumber: i + 1,
      title: d.title.trim(),
      description: (d.description || "").trim(),
      activities: (d.activities || "").trim(),
      meals: (d.meals || "").trim(),
      stay: (d.stay || "").trim(),
    })),
    pricingModel: f.pricingModel,
    // Per-person packages are listed from the adult price.
    basePrice: perPerson ? f.adultPrice : f.basePrice,
    offerPrice: perPerson ? 0 : f.offerPrice,
    adultPrice: perPerson ? f.adultPrice : 0,
    childPrice: perPerson ? f.childPrice : 0,
    allowedVehicleCategoryIds: catIds,
    allowedVehicleCategoryNames: catIds.map((id) => categories.find((c) => c.id === id)!.name),
    preferredVendorId: vendor ? vendor.id : "",
    preferredVendorName: vendor ? vendor.companyName || vendor.name || "" : "",
    departures: [...f.departures].sort((a, b) => `${a.date}${a.time || ""}`.localeCompare(`${b.date}${b.time || ""}`)),
    inclusions: f.inclusions.map((s) => s.trim()).filter(Boolean),
    exclusions: f.exclusions.map((s) => s.trim()).filter(Boolean),
    coverImageUrl: f.coverImageUrl.trim(),
    status: f.status,
    // Only active packages are shown to customers.
    published: f.status === "Active",
    featured: f.featured,
    displayOrder: f.displayOrder,
    seoTitle: f.seoTitle.trim(),
    seoDescription: f.seoDescription.trim(),
  };
}

export async function savePackage(f: PackageForm, existing: TourPackage | null, categories: VehicleCategory[], vendors: Vendor[], actorId: string) {
  const data = payload(f, categories, vendors);
  try {
    if (existing) {
      await updateDoc(doc(db, COLLECTIONS.TOUR_PACKAGES, existing.id), { ...data, updatedAt: serverTimestamp() });
      return existing.id;
    }
    const ref = doc(collection(db, COLLECTIONS.TOUR_PACKAGES));
    await setDoc(ref, { ...data, id: ref.id, createdBy: actorId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return ref.id;
  } catch (err) {
    throw new TourPackageActionError(describeDataError(err));
  }
}

/** Copies a package as an unpublished draft with a unique name, code and slug. */
export async function duplicatePackage(p: TourPackage, packages: TourPackage[], actorId: string) {
  const names = new Set(packages.map((x) => (x.name || "").trim().toLowerCase()));
  const codes = new Set(packages.map((x) => deriveCode(x.code || x.name || "")));
  const slugs = new Set(packages.map((x) => deriveSlug(x.slug || x.name || "")));
  const base = deriveCode(p.code || p.name);
  const baseSlug = deriveSlug(p.slug || p.name);
  // The suffix is kept inside the 30/60-character limits so every candidate is distinct.
  let pick: { name: string; code: string; slug: string } | null = null;
  for (let n = 1; n <= 99 && !pick; n++) {
    const suffix = n === 1 ? "COPY" : `COPY_${n}`;
    const candidate = {
      name: `${p.name} (Copy${n === 1 ? "" : ` ${n}`})`,
      code: `${base.slice(0, 29 - suffix.length)}_${suffix}`,
      slug: `${baseSlug.slice(0, 59 - suffix.length)}-${suffix.toLowerCase().replace("_", "-")}`,
    };
    if (!names.has(candidate.name.toLowerCase()) && !codes.has(candidate.code) && !slugs.has(candidate.slug)) pick = candidate;
  }
  if (!pick) throw new TourPackageActionError("Too many copies of this package already exist. Rename an existing copy first.");
  const ref = doc(collection(db, COLLECTIONS.TOUR_PACKAGES));
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = p;
  const name = pick.name;
  try {
    await setDoc(ref, {
      ...rest,
      id: ref.id,
      name,
      code: pick.code,
      slug: pick.slug,
      status: "Draft",
      published: false,
      featured: false,
      departures: [],
      createdBy: actorId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { id: ref.id, name };
  } catch (err) {
    throw new TourPackageActionError(describeDataError(err));
  }
}

export async function setPackageStatus(p: TourPackage, status: PackageStatus) {
  if (status === "Active" && !(p.itinerary || []).length) throw new TourPackageActionError("Add the itinerary before activating this package.");
  if (status === "Active" && !(Number(p.basePrice) > 0)) throw new TourPackageActionError("Set the package price before activating it.");
  try {
    await updateDoc(doc(db, COLLECTIONS.TOUR_PACKAGES, p.id), { status, published: status === "Active", updatedAt: serverTimestamp() });
  } catch (err) {
    throw new TourPackageActionError(describeDataError(err));
  }
}

export async function findPackageReferences(p: TourPackage) {
  try {
    const [coupons, reviews] = await Promise.all([
      getDocs(query(collection(db, COLLECTIONS.COUPONS), where("tourPackageIds", "array-contains", p.id))),
      getDocs(query(collection(db, COLLECTIONS.REVIEWS), where("tourPackageId", "==", p.id))),
    ]);
    return { coupons: coupons.size, reviews: reviews.size };
  } catch (err) {
    throw new TourPackageActionError(describeDataError(err));
  }
}

/** Deletes a package that nothing references; otherwise it must be archived. */
export async function deletePackage(p: TourPackage) {
  const r = await findPackageReferences(p);
  const used = [r.coupons && `${r.coupons} coupon${r.coupons === 1 ? "" : "s"}`, r.reviews && `${r.reviews} review${r.reviews === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
  if (used) throw new TourPackageActionError(`"${p.name}" is referenced by ${used}. Archive it instead.`);
  if (upcomingDepartures(p).length) throw new TourPackageActionError(`"${p.name}" has upcoming departures. Cancel them or archive the package instead.`);
  try {
    await deleteDoc(doc(db, COLLECTIONS.TOUR_PACKAGES, p.id));
  } catch (err) {
    throw new TourPackageActionError(describeDataError(err));
  }
}
