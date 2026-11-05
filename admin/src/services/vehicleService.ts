import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "./firebase";
import { COLLECTIONS, describeDataError } from "./adminFirestoreService";
import type {
  Booking,
  Driver,
  Vehicle,
  VehicleDocStatus,
  VehicleStatus,
} from "../types";

// Same lists and rules as the vendor app (vendor/app/src/config/constants.ts,
// screens/FleetScreen.tsx) so a vehicle is valid in both places.
export const FUEL_TYPES = ["Diesel", "Petrol", "CNG", "Electric"] as const;
export const VEHICLE_STATUSES: VehicleStatus[] = ["Active", "Maintenance", "Inactive"];
export const EXPIRY_WARNING_DAYS = 30;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // storage.rules validUpload()

/** Statuses of a booking during which its vehicle is on the road. */
const ACTIVE_TRIP_STATUSES = ["Assigned", "Ongoing"];

export class VehicleActionError extends Error {}

/** "tn 01-ab 1234" → "TN01AB1234" (comparison key). */
export const regKey = (value: string | undefined | null): string =>
  (value || "").toUpperCase().replace(/[\s-]/g, "");

/** Trimmed, upper-case, single-spaced registration number for storage. */
export const formatRegNumber = (value: string): string =>
  value.trim().toUpperCase().replace(/\s+/g, " ");

const STATE_SERIES = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/;
const BHARAT_SERIES = /^\d{2}BH\d{4}[A-Z]{1,2}$/;

export function validateRegNumber(value: string): string {
  const key = regKey(value);
  if (!key) return "Registration number is required.";
  if (!STATE_SERIES.test(key) && !BHARAT_SERIES.test(key)) {
    return "Enter a valid registration number (e.g. TN 01 AB 1234 or 22 BH 1234 AA).";
  }
  return "";
}

/** Normalised view of a vehicle document, tolerant of legacy fields. */
export interface FleetVehicle {
  id: string;
  vehicleNumber: string;
  category: string;
  categoryId: string;
  make: string;
  model: string;
  year: string;
  seatingCapacity: number;
  fuelType: string;
  status: VehicleStatus;
  docStatus: VehicleDocStatus;
  rejectionReason: string;
  vendorId: string;
  vendorName: string;
  assignedDriverId: string;
  assignedDriverName: string;
  rcNumber: string;
  rcDocUrl: string;
  insuranceExpiry: string;
  insuranceDocUrl: string;
  fitnessExpiry: string;
  fitnessDocUrl: string;
  permitExpiry: string;
  statePermitDocUrl: string;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function mapVehicle(v: Vehicle): FleetVehicle {
  const status = VEHICLE_STATUSES.includes(v.status as VehicleStatus)
    ? (v.status as VehicleStatus)
    : // Legacy prototype values ("Available", "On Trip", "Reserved") mean in service.
      v.status === "Maintenance"
      ? "Maintenance"
      : "Active";
  const docStatus: VehicleDocStatus =
    v.docStatus === "Approved" || v.docStatus === "Rejected" ? v.docStatus : "Pending";
  const seats = Number(v.seatingCapacity ?? v.seats);
  return {
    id: v.id,
    vehicleNumber: text(v.vehicleNumber) || text(v.number),
    category: text(v.category),
    categoryId: text(v.categoryId),
    make: text(v.make),
    model: text(v.model) || text(v.name),
    year: text(v.year),
    seatingCapacity: Number.isFinite(seats) && seats > 0 ? seats : 0,
    fuelType: text(v.fuelType) || text(v.fuel),
    status,
    docStatus,
    rejectionReason: text(v.rejectionReason),
    vendorId: text(v.vendorId),
    vendorName: text(v.vendorName),
    assignedDriverId: text(v.assignedDriverId),
    assignedDriverName: text(v.assignedDriverName),
    rcNumber: text(v.rcNumber),
    rcDocUrl: text(v.rcDocUrl),
    insuranceExpiry: text(v.insuranceExpiry),
    insuranceDocUrl: text(v.insuranceDocUrl),
    fitnessExpiry: text(v.fitnessExpiry),
    fitnessDocUrl: text(v.fitnessDocUrl),
    permitExpiry: text(v.permitExpiry),
    statePermitDocUrl: text(v.statePermitDocUrl),
  };
}

// ── Compliance ──────────────────────────────────────────────────────────────

export type ComplianceState = "Valid" | "Expiring" | "Expired" | "Missing";

/** Local calendar date as YYYY-MM-DD (expiry dates are stored this way). */
export function todayIso(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

export const isIsoDate = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00`).getTime());

export function daysUntil(iso: string, now = new Date()): number | null {
  if (!isIsoDate(iso)) return null;
  const start = new Date(`${todayIso(now)}T00:00:00`).getTime();
  return Math.round((new Date(`${iso}T00:00:00`).getTime() - start) / 86400000);
}

/**
 * State of one document. A document with an expiry date is judged on the date
 * (the vendor app treats "expires today" as expired); one without is judged
 * on whether the file exists.
 */
export function documentState(
  fileUrl: string,
  expiry?: string,
  now = new Date(),
): ComplianceState {
  if (expiry !== undefined) {
    // A document that expires must have its expiry date recorded.
    const days = daysUntil(expiry, now);
    if (days === null) return "Missing";
    if (days <= 0) return "Expired";
    if (!fileUrl) return "Missing";
    return days <= EXPIRY_WARNING_DAYS ? "Expiring" : "Valid";
  }
  return fileUrl ? "Valid" : "Missing";
}

export interface VehicleDocumentRow {
  key: "rc" | "insurance" | "permit" | "fitness";
  label: string;
  short: string;
  required: boolean;
  number?: string;
  expiry?: string;
  url: string;
  state: ComplianceState;
}

export function vehicleDocuments(v: FleetVehicle, now = new Date()): VehicleDocumentRow[] {
  const rows: VehicleDocumentRow[] = [
    {
      key: "rc",
      label: "Registration Certificate (RC)",
      short: "RC",
      required: true,
      number: v.rcNumber,
      url: v.rcDocUrl,
      state: v.rcNumber && v.rcDocUrl ? "Valid" : "Missing",
    },
    {
      key: "insurance",
      label: "Insurance policy",
      short: "Ins",
      required: true,
      expiry: v.insuranceExpiry,
      url: v.insuranceDocUrl,
      state: documentState(v.insuranceDocUrl, v.insuranceExpiry, now),
    },
    {
      key: "permit",
      label: "Taxi / tourist permit",
      short: "Permit",
      required: true,
      expiry: v.permitExpiry,
      url: v.statePermitDocUrl,
      state: documentState(v.statePermitDocUrl, v.permitExpiry, now),
    },
    {
      key: "fitness",
      label: "Fitness certificate (FC)",
      short: "FC",
      required: false,
      expiry: v.fitnessExpiry,
      url: v.fitnessDocUrl,
      state:
        !v.fitnessExpiry && !v.fitnessDocUrl
          ? "Missing"
          : documentState(v.fitnessDocUrl, v.fitnessExpiry || undefined, now),
    },
  ];
  return rows;
}

/** Reasons the vehicle's documents cannot be approved yet ([] = approvable). */
export function approvalBlockers(v: FleetVehicle, now = new Date()): string[] {
  return vehicleDocuments(v, now)
    .filter((d) =>
      d.required
        ? d.state === "Missing" || d.state === "Expired"
        : d.state === "Expired",
    )
    .map((d) => `${d.label}: ${d.state === "Expired" ? "expired" : "missing"}`);
}

// ── Availability (derived from bookings) ────────────────────────────────────

/**
 * The live trip this vehicle is on. Dispatch records the vehicle's document id
 * (assignedVehicleId); bookings dispatched before that only carry the number.
 */
export function activeTripFor(v: FleetVehicle, bookings: Booking[]): Booking | null {
  const key = regKey(v.vehicleNumber);
  return (
    bookings.find(
      (b) =>
        ACTIVE_TRIP_STATUSES.includes(b.status) &&
        (b.assignedVehicleId ? b.assignedVehicleId === v.id : !!key && regKey(b.assignedVehicleNumber) === key),
    ) ?? null
  );
}

export type Availability =
  | "Available"
  | "On Trip"
  | "Awaiting Approval"
  | "Documents Rejected"
  | "Maintenance"
  | "Inactive";

export function availabilityOf(v: FleetVehicle, bookings: Booking[]): Availability {
  if (activeTripFor(v, bookings)) return "On Trip";
  if (v.status === "Maintenance") return "Maintenance";
  if (v.status === "Inactive") return "Inactive";
  if (v.docStatus === "Rejected") return "Documents Rejected";
  if (v.docStatus !== "Approved") return "Awaiting Approval";
  return "Available";
}

// ── Drivers ─────────────────────────────────────────────────────────────────

/**
 * Drivers who may drive this vehicle: approved, not suspended by their fleet,
 * and from the same owner (the vendor's own drivers, or independent drivers
 * for a NESAM-owned vehicle).
 */
export function eligibleDrivers(vendorId: string, drivers: Driver[]): Driver[] {
  return drivers
    .filter(
      (d) =>
        d.status === "Approved" &&
        d.fleetStatus !== "Suspended" &&
        (d.vendorId || "") === vendorId,
    )
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

// ── Writes ──────────────────────────────────────────────────────────────────

export interface VehicleInput {
  vehicleNumber: string;
  vendorId: string;
  vendorName: string;
  categoryId: string;
  category: string;
  make: string;
  model: string;
  year: string;
  seatingCapacity: number;
  fuelType: string;
  status: VehicleStatus;
  assignedDriverId: string;
  rcNumber: string;
  rcDocUrl: string;
  insuranceExpiry: string;
  insuranceDocUrl: string;
  fitnessExpiry: string;
  fitnessDocUrl: string;
  permitExpiry: string;
  statePermitDocUrl: string;
}

export type VehicleFieldErrors = Partial<Record<keyof VehicleInput, string>>;

export function validateVehicleInput(
  input: VehicleInput,
  context: {
    vehicles: FleetVehicle[];
    editingId: string | null;
    currentYear?: number;
  },
): VehicleFieldErrors {
  const errors: VehicleFieldErrors = {};
  const regError = validateRegNumber(input.vehicleNumber);
  if (regError) errors.vehicleNumber = regError;
  else {
    const key = regKey(input.vehicleNumber);
    const dup = context.vehicles.find((v) => v.id !== context.editingId && regKey(v.vehicleNumber) === key);
    if (dup) {
      errors.vehicleNumber = `${dup.vehicleNumber} is already registered${dup.vendorName ? ` to ${dup.vendorName}` : ""}.`;
    }
  }
  if (!input.categoryId && !input.category) errors.categoryId = "Choose a vehicle category.";
  if (!input.make.trim()) errors.make = "Make is required.";
  if (!input.model.trim()) errors.model = "Model is required.";
  const year = Number(input.year);
  const maxYear = (context.currentYear ?? new Date().getFullYear()) + 1;
  if (!/^\d{4}$/.test(input.year.trim()) || year < 1990 || year > maxYear) {
    errors.year = `Enter a year between 1990 and ${maxYear}.`;
  }
  if (!Number.isInteger(input.seatingCapacity) || input.seatingCapacity < 2 || input.seatingCapacity > 60) {
    errors.seatingCapacity = "Seats must be a whole number between 2 and 60.";
  }
  if (!(FUEL_TYPES as readonly string[]).includes(input.fuelType)) errors.fuelType = "Choose a fuel type.";
  for (const key of ["insuranceExpiry", "permitExpiry", "fitnessExpiry"] as const) {
    if (input[key] && !isIsoDate(input[key])) errors[key] = "Enter a valid date.";
  }
  return errors;
}

/** Prototype-only fields removed on update so every reader sees one schema. */
const LEGACY_FIELD_REMOVALS = {
  number: deleteField(),
  seats: deleteField(),
  fuel: deleteField(),
  driver: deleteField(),
  name: deleteField(),
  rate: deleteField(),
  docs: deleteField(),
};

function vehiclePayload(input: VehicleInput, driverName: string) {
  return {
    vehicleNumber: formatRegNumber(input.vehicleNumber),
    vendorId: input.vendorId,
    vendorName: input.vendorId ? input.vendorName : "",
    categoryId: input.categoryId,
    category: input.category,
    make: input.make.trim(),
    model: input.model.trim(),
    year: input.year.trim(),
    seatingCapacity: input.seatingCapacity,
    fuelType: input.fuelType,
    status: input.status,
    assignedDriverId: input.assignedDriverId,
    assignedDriverName: input.assignedDriverId ? driverName : "",
    rcNumber: input.rcNumber.trim().toUpperCase(),
    rcDocUrl: input.rcDocUrl,
    insuranceExpiry: input.insuranceExpiry,
    insuranceDocUrl: input.insuranceDocUrl,
    fitnessExpiry: input.fitnessExpiry,
    fitnessDocUrl: input.fitnessDocUrl,
    permitExpiry: input.permitExpiry,
    statePermitDocUrl: input.statePermitDocUrl,
  };
}

/** New document id for a vehicle (used to name its storage folder). */
export const newVehicleId = () => doc(collection(db, COLLECTIONS.VEHICLES)).id;

/**
 * Creates or updates a vehicle and keeps the driver pairing consistent on
 * both documents in one batch: the chosen driver's previous vehicle and the
 * vehicle's previous driver are released.
 */
export async function saveVehicle(params: {
  id: string;
  input: VehicleInput;
  existing: FleetVehicle | null;
  vehicles: FleetVehicle[];
  drivers: Driver[];
  bookings: Booking[];
}): Promise<void> {
  const { id, input, existing, vehicles, drivers, bookings } = params;
  const trip = existing ? activeTripFor(existing, bookings) : null;
  if (trip && existing) {
    if (regKey(input.vehicleNumber) !== regKey(existing.vehicleNumber)) {
      throw new VehicleActionError(`The registration number cannot change while the vehicle is on trip ${trip.bookingId || trip.id}.`);
    }
    if (input.assignedDriverId !== existing.assignedDriverId) {
      throw new VehicleActionError(`Change the driver after trip ${trip.bookingId || trip.id} ends.`);
    }
    if (input.status !== "Active") {
      throw new VehicleActionError(`The vehicle is on trip ${trip.bookingId || trip.id}. Change its status after the trip ends.`);
    }
  }
  if (existing && existing.vendorId !== input.vendorId && existing.assignedDriverId && input.assignedDriverId) {
    throw new VehicleActionError("Unassign the driver before moving this vehicle to another owner.");
  }

  let driver: Driver | null = null;
  if (input.assignedDriverId) {
    driver = drivers.find((d) => d.id === input.assignedDriverId) ?? null;
    const allowed = eligibleDrivers(input.vendorId, drivers).some((d) => d.id === input.assignedDriverId);
    if (!driver || (!allowed && input.assignedDriverId !== existing?.assignedDriverId)) {
      throw new VehicleActionError("The selected driver is not an approved driver of this vehicle's owner.");
    }
    const drivingElsewhere = bookings.find(
      (b) =>
        ACTIVE_TRIP_STATUSES.includes(b.status) &&
        b.assignedDriverId === driver!.id &&
        regKey(b.assignedVehicleNumber) !== regKey(input.vehicleNumber),
    );
    if (drivingElsewhere && input.assignedDriverId !== existing?.assignedDriverId) {
      throw new VehicleActionError(`${driver.name} is on trip ${drivingElsewhere.bookingId || drivingElsewhere.id} in another vehicle.`);
    }
  }

  const batch = writeBatch(db);
  const stamp = serverTimestamp();
  const vehicleRef = doc(db, COLLECTIONS.VEHICLES, id);
  const payload = { ...vehiclePayload(input, driver?.name || ""), updatedAt: stamp };
  if (existing) {
    batch.update(vehicleRef, { ...payload, ...LEGACY_FIELD_REMOVALS });
  } else {
    batch.set(vehicleRef, {
      id,
      ...payload,
      // Admin-registered vehicles still go through document review.
      docStatus: "Pending",
      rejectionReason: "",
      createdAt: stamp,
    });
  }

  const previousDriverId = existing?.assignedDriverId || "";
  const newDriverId = input.assignedDriverId;
  const regNumber = formatRegNumber(input.vehicleNumber);
  if (previousDriverId && previousDriverId !== newDriverId && drivers.some((d) => d.id === previousDriverId)) {
    batch.update(doc(db, COLLECTIONS.DRIVERS, previousDriverId), {
      assignedVehicleId: "",
      assignedVehicleNumber: "",
      updatedAt: stamp,
    });
  }
  if (newDriverId && driver) {
    batch.update(doc(db, COLLECTIONS.DRIVERS, newDriverId), {
      assignedVehicleId: id,
      assignedVehicleNumber: regNumber,
      updatedAt: stamp,
    });
    // Release the vehicle this driver was paired with before.
    for (const other of vehicles) {
      if (other.id !== id && other.assignedDriverId === newDriverId) {
        batch.update(doc(db, COLLECTIONS.VEHICLES, other.id), {
          assignedDriverId: "",
          assignedDriverName: "",
          updatedAt: stamp,
        });
      }
    }
  }
  try {
    await batch.commit();
  } catch (err) {
    throw new VehicleActionError(describeDataError(err));
  }
}

export async function reviewVehicleDocuments(
  v: FleetVehicle,
  decision: "Approved" | "Rejected",
  reason: string,
): Promise<void> {
  if (decision === "Approved") {
    const blockers = approvalBlockers(v);
    if (blockers.length) throw new VehicleActionError(`Cannot approve yet — ${blockers.join("; ")}.`);
  } else if (!reason.trim()) {
    throw new VehicleActionError("Give the vendor a reason so they know what to fix.");
  }
  try {
    await updateDoc(doc(db, COLLECTIONS.VEHICLES, v.id), {
      docStatus: decision,
      rejectionReason: decision === "Rejected" ? reason.trim() : "",
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    throw new VehicleActionError(describeDataError(err));
  }
}

export async function setVehicleStatus(
  v: FleetVehicle,
  status: VehicleStatus,
  bookings: Booking[],
): Promise<void> {
  const trip = activeTripFor(v, bookings);
  if (trip && status !== "Active") {
    throw new VehicleActionError(`The vehicle is on trip ${trip.bookingId || trip.id}. Change its status after the trip ends.`);
  }
  try {
    await updateDoc(doc(db, COLLECTIONS.VEHICLES, v.id), { status, updatedAt: serverTimestamp() });
  } catch (err) {
    throw new VehicleActionError(describeDataError(err));
  }
}

/** Deletes a vehicle that is not on a trip and has no driver paired. */
export async function deleteVehicle(v: FleetVehicle, bookings: Booking[]): Promise<void> {
  const trip = activeTripFor(v, bookings);
  if (trip) throw new VehicleActionError(`The vehicle is on trip ${trip.bookingId || trip.id} and cannot be removed.`);
  if (v.assignedDriverId) {
    throw new VehicleActionError(`Unassign ${v.assignedDriverName || "the driver"} before removing this vehicle.`);
  }
  try {
    await deleteDoc(doc(db, COLLECTIONS.VEHICLES, v.id));
  } catch (err) {
    throw new VehicleActionError(describeDataError(err));
  }
}

export type VehicleDocKind = "rc" | "insurance" | "permit" | "fitness";

/**
 * Uploads a vehicle document. Vendor vehicles use the vendor's folder (same
 * layout as the vendor app); NESAM-owned vehicles use fleet/{vehicleId}.
 */
export async function uploadVehicleDocument(
  vehicleId: string,
  vendorId: string,
  kind: VehicleDocKind,
  file: File,
): Promise<string> {
  const okType = file.type.startsWith("image/") || file.type === "application/pdf";
  if (!okType) throw new VehicleActionError("Upload an image or a PDF.");
  if (file.size === 0) throw new VehicleActionError("The selected file is empty.");
  if (file.size >= MAX_UPLOAD_BYTES) throw new VehicleActionError("Files must be smaller than 10 MB.");
  const ext = (file.name.split(".").pop() || (file.type === "application/pdf" ? "pdf" : "jpg"))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 5);
  const safeId = vehicleId.replace(/[^A-Za-z0-9_-]/g, "");
  const path = vendorId
    ? `vendors/${vendorId}/vehicles/${safeId}/${kind}-${Date.now()}.${ext}`
    : `fleet/${safeId}/${kind}-${Date.now()}.${ext}`;
  try {
    const result = await uploadBytes(ref(storage, path), file, { contentType: file.type });
    return await getDownloadURL(result.ref);
  } catch (err) {
    const code = (err as { code?: string })?.code ?? "";
    if (code === "storage/unauthorized") {
      throw new VehicleActionError("You do not have permission to upload this document. Make sure the storage rules are deployed.");
    }
    throw new VehicleActionError("Upload failed. Check your connection and try again.");
  }
}
