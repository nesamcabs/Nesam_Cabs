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
import type { LocationType, MasterLocation, TourPackage } from "../types";
import { CITIES_BY_STATE } from "../domain/placeDirectory";
import { GST_STATES } from "../domain/gstStates";

export class LocationActionError extends Error {}

export const LOCATION_TYPES: LocationType[] = ["City", "Area / Locality", "Airport", "Railway Station", "Bus Stand", "Landmark", "Tourist Place", "Other"];

export interface LocationForm {
  name: string;
  code: string;
  type: LocationType;
  state: string;
  district: string;
  city: string;
  area: string;
  pincode: string;
  address: string;
  parentLocationId: string;
  lat: string;
  lng: string;
  placeId: string;
  pickupEnabled: boolean;
  dropEnabled: boolean;
  onlineBookingEnabled: boolean;
  adminBookingEnabled: boolean;
  serviceIds: string[];
  status: "Active" | "Inactive";
  displayOrder: number;
}

export type LocationField = "name" | "code" | "type" | "state" | "city" | "pincode" | "lat" | "lng" | "parentLocationId" | "displayOrder" | "usage";

const norm = (s: string | undefined) => (s || "").trim().toLowerCase();
export const deriveLocationCode = (s: string) => s.replace(/[^a-z0-9]/gi, "").slice(0, 10).toUpperCase();

/** Ids of the location and every location beneath it (cycle guard for parents). */
function descendants(id: string, locations: MasterLocation[]): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of locations) {
      if (l.parentLocationId && out.has(l.parentLocationId) && !out.has(l.id)) {
        out.add(l.id);
        grew = true;
      }
    }
  }
  return out;
}

export function validateLocation(f: LocationForm, locations: MasterLocation[], editingId: string | null): Partial<Record<LocationField, string>> {
  const e: Partial<Record<LocationField, string>> = {};
  const others = locations.filter((l) => l.id !== editingId);
  const name = f.name.trim();
  if (name.length < 2 || name.length > 80) e.name = "Name must be 2–80 characters.";
  else if (others.some((l) => norm(l.name) === norm(name) && norm(l.city) === norm(f.city))) e.name = `"${name}" already exists in ${f.city.trim() || "this city"}.`;
  const code = f.code.trim() ? f.code.trim().toUpperCase() : deriveLocationCode(name);
  if (f.code.trim() && !/^[A-Z0-9_-]{2,12}$/.test(code)) e.code = "Code must be 2–12 letters, numbers, - or _.";
  else if (code && others.some((l) => (l.code || "").toUpperCase() === code)) e.code = `Code ${code} is already used.`;
  if (!LOCATION_TYPES.includes(f.type)) e.type = "Choose a location type.";
  if (!f.state.trim()) e.state = "State is required.";
  if (!f.city.trim()) e.city = "City / town is required.";
  if (f.pincode.trim() && !/^[1-9]\d{5}$/.test(f.pincode.trim())) e.pincode = "Enter a valid 6-digit PIN code.";
  const hasLat = f.lat.trim() !== "";
  const hasLng = f.lng.trim() !== "";
  if (hasLat !== hasLng) {
    e[hasLat ? "lng" : "lat"] = "Enter both latitude and longitude, or neither.";
  } else if (hasLat) {
    const lat = Number(f.lat);
    const lng = Number(f.lng);
    // Same service area the booking backend accepts (functions/src/commerce.ts).
    if (!Number.isFinite(lat) || lat < 6.5 || lat > 35.7) e.lat = "Latitude must be within India (6.5 to 35.7).";
    if (!Number.isFinite(lng) || lng < 68.1 || lng > 97.4) e.lng = "Longitude must be within India (68.1 to 97.4).";
  }
  if (f.parentLocationId) {
    if (!locations.some((l) => l.id === f.parentLocationId)) e.parentLocationId = "The parent location no longer exists.";
    else if (editingId && descendants(editingId, locations).has(f.parentLocationId)) e.parentLocationId = "A location cannot sit inside itself or one of its own sub-locations.";
  }
  if (!Number.isInteger(f.displayOrder) || f.displayOrder < 1) e.displayOrder = "Display order must be 1 or more.";
  if (f.status === "Active" && !f.pickupEnabled && !f.dropEnabled) e.usage = "An active location must allow pickup or drop.";
  return e;
}

/** Firestore rejects `undefined`; optional fields are stored as "" / null. */
function payload(f: LocationForm, locations: MasterLocation[]) {
  const name = f.name.trim();
  const parent = locations.find((l) => l.id === f.parentLocationId);
  const hasGeo = f.lat.trim() !== "" && f.lng.trim() !== "";
  return {
    name,
    normalizedName: name.toLowerCase(),
    code: f.code.trim() ? f.code.trim().toUpperCase() : deriveLocationCode(name),
    type: f.type,
    state: f.state.trim(),
    district: f.district.trim(),
    city: f.city.trim(),
    area: f.area.trim(),
    pincode: f.pincode.trim(),
    address: f.address.trim(),
    parentLocationId: parent ? parent.id : "",
    parentLocationName: parent ? parent.name : "",
    lat: hasGeo ? Number(f.lat) : null,
    lng: hasGeo ? Number(f.lng) : null,
    placeId: f.placeId.trim(),
    pickupEnabled: f.pickupEnabled,
    dropEnabled: f.dropEnabled,
    onlineBookingEnabled: f.onlineBookingEnabled,
    adminBookingEnabled: f.adminBookingEnabled,
    serviceIds: f.serviceIds,
    status: f.status,
    displayOrder: f.displayOrder,
  };
}

async function commitInChunks(updates: { ref: DocumentReference; data: Record<string, unknown> }[]) {
  for (let i = 0; i < updates.length; i += 400) {
    const batch = writeBatch(db);
    for (const u of updates.slice(i, i + 400)) batch.update(u.ref, u.data);
    await batch.commit();
  }
}

async function propagateRename(id: string, newName: string) {
  const stamp = serverTimestamp();
  const [origins, destinations, children] = await Promise.all([
    getDocs(query(collection(db, COLLECTIONS.FARE_RULES), where("originLocationId", "==", id))),
    getDocs(query(collection(db, COLLECTIONS.FARE_RULES), where("destinationLocationId", "==", id))),
    getDocs(query(collection(db, COLLECTIONS.LOCATIONS), where("parentLocationId", "==", id))),
  ]);
  const byPath = new Map<string, { ref: DocumentReference; data: Record<string, unknown> }>();
  const add = (ref: DocumentReference, data: Record<string, unknown>) => {
    const cur = byPath.get(ref.path);
    byPath.set(ref.path, { ref, data: { ...(cur?.data || {}), ...data, updatedAt: stamp } });
  };
  origins.docs.forEach((d) => add(d.ref, { originLocationName: newName }));
  destinations.docs.forEach((d) => add(d.ref, { destinationLocationName: newName }));
  children.docs.forEach((d) => add(d.ref, { parentLocationName: newName }));
  await commitInChunks([...byPath.values()]);
  return byPath.size;
}

/** Adds every built-in city that is not in the location master yet, as an active City (fixed ids, so running it again adds nothing twice). */
export async function seedBuiltInCities(existing: MasterLocation[], actorId: string): Promise<number> {
  const have = new Set(existing.filter((l) => l.type === "City").map((l) => (l.name || l.city).trim().toLowerCase()));
  const rows: { id: string; name: string; state: string; code: string }[] = [];
  for (const [stateCode, names] of Object.entries(CITIES_BY_STATE)) {
    const state = GST_STATES.find(([c]) => c === stateCode)?.[1] ?? stateCode;
    for (const name of names) {
      if (have.has(name.toLowerCase())) continue;
      rows.push({ id: `city_${stateCode}_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, name, state, code: deriveLocationCode(name) });
    }
  }
  if (!rows.length) return 0;
  try {
    let order = existing.reduce((m, l) => Math.max(m, l.displayOrder || 0), 0);
    for (let i = 0; i < rows.length; i += 400) {
      const batch = writeBatch(db);
      for (const r of rows.slice(i, i + 400)) {
        order += 1;
        batch.set(doc(db, COLLECTIONS.LOCATIONS, r.id), {
          id: r.id, name: r.name, normalizedName: r.name.toLowerCase(), code: r.code, type: "City", state: r.state, district: "", city: r.name, area: "", pincode: "", address: "",
          parentLocationId: "", parentLocationName: "", lat: null, lng: null, placeId: "", pickupEnabled: true, dropEnabled: true, onlineBookingEnabled: true, adminBookingEnabled: true,
          serviceIds: [], status: "Active", displayOrder: order, createdBy: actorId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
  } catch (err) {
    throw new LocationActionError(describeDataError(err));
  }
  return rows.length;
}

export async function saveLocation(f: LocationForm, existing: MasterLocation | null, locations: MasterLocation[], actorId: string) {
  const data = payload(f, locations);
  try {
    if (!existing) {
      const ref = doc(collection(db, COLLECTIONS.LOCATIONS));
      await setDoc(ref, { ...data, id: ref.id, createdBy: actorId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      return { id: ref.id, renamed: 0 };
    }
    await updateDoc(doc(db, COLLECTIONS.LOCATIONS, existing.id), { ...data, updatedAt: serverTimestamp() });
  } catch (err) {
    throw new LocationActionError(describeDataError(err));
  }
  if ((existing.name || "").trim() === data.name) return { id: existing.id, renamed: 0 };
  try {
    return { id: existing.id, renamed: await propagateRename(existing.id, data.name) };
  } catch (err) {
    throw new LocationActionError(`The location was saved, but linked fare rules still show the old name (${describeDataError(err)}). Save again to retry.`);
  }
}

export async function setLocationStatus(loc: MasterLocation, status: "Active" | "Inactive") {
  try {
    await updateDoc(doc(db, COLLECTIONS.LOCATIONS, loc.id), { status, updatedAt: serverTimestamp() });
  } catch (err) {
    throw new LocationActionError(describeDataError(err));
  }
}

export interface LocationReferences {
  fareRules: number;
  coupons: number;
  children: number;
  /** Packages mention locations by name only; informational. */
  packages: number;
}

export async function findLocationReferences(loc: MasterLocation, packages: TourPackage[]): Promise<LocationReferences> {
  try {
    const [origins, dests, coupons, children] = await Promise.all([
      getDocs(query(collection(db, COLLECTIONS.FARE_RULES), where("originLocationId", "==", loc.id))),
      getDocs(query(collection(db, COLLECTIONS.FARE_RULES), where("destinationLocationId", "==", loc.id))),
      getDocs(query(collection(db, COLLECTIONS.COUPONS), where("locationIds", "array-contains", loc.id))),
      getDocs(query(collection(db, COLLECTIONS.LOCATIONS), where("parentLocationId", "==", loc.id))),
    ]);
    const ruleIds = new Set([...origins.docs, ...dests.docs].map((d) => d.id));
    const n = norm(loc.name);
    return {
      fareRules: ruleIds.size,
      coupons: coupons.size,
      children: children.size,
      packages: packages.filter((p) => norm(p.startingLocation) === n || norm(p.endingLocation) === n || (p.destinations || []).some((d) => norm(d) === n)).length,
    };
  } catch (err) {
    throw new LocationActionError(describeDataError(err));
  }
}

/** Blocks deletion while fare rules, coupons or sub-locations point at the location by id. */
export async function deleteLocation(loc: MasterLocation, packages: TourPackage[]) {
  const r = await findLocationReferences(loc, packages);
  const used = (
    [
      [r.fareRules, "fare rule"],
      [r.coupons, "coupon"],
      [r.children, "sub-location"],
    ] as [number, string][]
  )
    .filter(([n]) => n > 0)
    .map(([n, l]) => `${n} ${l}${n === 1 ? "" : "s"}`)
    .join(", ");
  if (used) throw new LocationActionError(`"${loc.name}" is used by ${used}. Deactivate it instead, or update those records first.`);
  try {
    await deleteDoc(doc(db, COLLECTIONS.LOCATIONS, loc.id));
  } catch (err) {
    throw new LocationActionError(describeDataError(err));
  }
}
