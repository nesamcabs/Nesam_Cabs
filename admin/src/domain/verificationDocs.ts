/**
 * Every document a partner uploaded, gathered for the Verification page. Pure: it only reads the stored records.
 * Drivers and vehicles keep download URLs; vendor onboarding keeps Storage paths (resolved when shown).
 */
import type { PartnerKind, Raw } from "./partners";

export interface VerifyDoc {
  /** Stable key within one record. */
  key: string;
  group: string;
  label: string;
  url?: string;
  path?: string;
  contentType?: string;
  expiry?: string;
  /** Approval is blocked while a required document is not on file. */
  required: boolean;
}

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");

export const isUploaded = (d: VerifyDoc) => !!(d.url || d.path);

/** One slot with a single URL. Optional slots that are empty are left out. */
function slot(out: VerifyDoc[], group: string, key: string, label: string, url: unknown, required: boolean, expiry?: unknown) {
  if (str(url) || required) out.push({ key: `${group}:${key}`, group, label, url: str(url) || undefined, required, expiry: str(expiry) || undefined });
}

/** One slot holding a list of vendor uploads ({ path, name, contentType }). */
function files(out: VerifyDoc[], group: string, key: string, label: string, list: unknown, required: boolean, expiry?: unknown) {
  const rows = Array.isArray(list) ? list.map(bag).filter((f) => str(f.path)) : [];
  if (!rows.length) {
    if (required) out.push({ key: `${group}:${key}`, group, label, required, expiry: str(expiry) || undefined });
    return;
  }
  rows.forEach((f, i) =>
    out.push({ key: `${group}:${key}:${str(f.path)}`, group, label: rows.length > 1 ? `${label} ${i + 1}` : label, path: str(f.path), contentType: str(f.contentType), required, expiry: str(expiry) || undefined }),
  );
}

function driverDocs(r: Raw, vendorDriver: boolean, privateData: Bag): VerifyDoc[] {
  const out: VerifyDoc[] = [];
  const li = bag(r.licenseInfo);
  const vi = bag(r.vehicleInfo);
  // Older applications kept identity on the driver record; current ones keep it in driver_private.
  const id = { ...bag(r.identity), ...bag(privateData.identity) };
  const ownCab = !vendorDriver && !!str(vi.vehicleNumber);

  slot(out, "Driver", "selfie", "Selfie", r.photoUrl, true);
  slot(out, "Driver", "dl-front", "Licence front", li.frontPhotoUrl, true, li.expiryDate || r.licenseExpiry);
  slot(out, "Driver", "dl-back", "Licence back", li.backPhotoUrl, !vendorDriver);
  slot(out, "Driver", "dl-renewed", "Renewed licence", li.renewedDocUrl, false, r.licenseExpiry);

  slot(out, "Identity", "aadhaar-front", "Aadhaar front", id.aadhaarFrontUrl, false);
  slot(out, "Identity", "aadhaar-back", "Aadhaar back", id.aadhaarBackUrl, false);
  slot(out, "Identity", "pan", "PAN card", id.panPhotoUrl, false);

  slot(out, "Vehicle", "rc", "RC", vi.rcDocUrl, ownCab);
  slot(out, "Vehicle", "insurance", "Insurance", vi.insuranceDocUrl, ownCab, vi.insuranceExpiry);
  slot(out, "Vehicle", "fitness", "Fitness (FC)", vi.fitnessDocUrl, ownCab, vi.fitnessExpiry);
  slot(out, "Vehicle", "permit", "Permit", vi.statePermitDocUrl, ownCab, vi.permitExpiry);
  slot(out, "Vehicle", "front", "Front (plate)", vi.frontPhotoUrl, ownCab);
  slot(out, "Vehicle", "rear", "Rear", vi.rearPhotoUrl, false);
  slot(out, "Vehicle", "side", "Side", vi.sidePhotoUrl, false);
  slot(out, "Vehicle", "interior", "Interior", vi.interiorPhotoUrl, false);
  return out;
}

function vehicleDocs(r: Raw): VerifyDoc[] {
  const out: VerifyDoc[] = [];
  slot(out, "Papers", "rc", "RC", r.rcDocUrl, true);
  slot(out, "Papers", "insurance", "Insurance", r.insuranceDocUrl, true, r.insuranceExpiry);
  slot(out, "Papers", "permit", "Permit", r.statePermitDocUrl, true, r.permitExpiry);
  slot(out, "Papers", "fitness", "Fitness (FC)", r.fitnessDocUrl, false, r.fitnessExpiry);
  slot(out, "Papers", "puc", "PUC", r.pucDocUrl, false, r.pucExpiry);
  slot(out, "Photos", "photo", "Vehicle photo", r.photoUrl, false);
  slot(out, "Photos", "carrier", "Roof carrier", r.roofCarrierPhotoUrl, false);
  return out;
}

/** The same documents firestore.rules and the duty functions require (vendorDocsComplete). */
function vendorDocs(r: Raw): VerifyDoc[] {
  const out: VerifyDoc[] = [];
  const d = bag(r.documents);
  const f = bag(r.fleet);
  files(out, "Owner & business", "id", "Owner ID", bag(d.identityProof).files, true);
  files(out, "Owner & business", "business", "Business proof", bag(d.businessRegistration).files, false);

  const vehicles = Array.isArray(f.vehicles) ? f.vehicles.map(bag) : [];
  if (vehicles.length) {
    for (const v of vehicles) {
      const group = str(v.registrationNumber) || "Vehicle";
      files(out, group, "rc", "RC", v.rcFiles, true);
      files(out, group, "insurance", "Insurance", v.insuranceFiles, true, v.insuranceUpto);
      files(out, group, "fitness", "Fitness (FC)", v.fitnessFiles, true, v.fitnessUpto);
      files(out, group, "permit", "Permit", v.permitFiles, true, v.permitUpto);
      files(out, group, "front", "Vehicle front", v.frontPhotoFiles, true);
    }
  } else {
    files(out, "Fleet", "rc", "RC", f.rcFiles, true);
    files(out, "Fleet", "insurance", "Insurance", f.insuranceFiles, true);
    files(out, "Fleet", "fitness", "Fitness (FC)", f.fcFiles, true);
    files(out, "Fleet", "permit", "Permit", f.permitFiles, true);
    files(out, "Fleet", "front", "Vehicle photo", f.vehiclePhotos, true);
  }
  return out;
}

export function partnerDocuments(kind: PartnerKind, r: Raw, privateData: Bag = {}): VerifyDoc[] {
  if (kind === "vendor") return vendorDocs(r);
  if (kind === "vehicle") return vehicleDocs(r);
  return driverDocs(r, kind === "vendor-driver", privateData);
}

export interface Readiness {
  uploaded: number;
  checked: number;
  /** Why "Approve" is not available yet; empty when it is. */
  blocker: string;
}

/** Approval needs every required document on file and every uploaded one opened by the reviewer. */
export function readiness(docs: VerifyDoc[], seen: ReadonlySet<string>, missingDetails: string[] = []): Readiness {
  const uploaded = docs.filter(isUploaded);
  const checked = uploaded.filter((d) => seen.has(d.key)).length;
  const missing = [...missingDetails, ...docs.filter((d) => d.required && !isUploaded(d)).map((d) => (d.group === "Driver" || d.group === "Papers" ? d.label : `${d.label} (${d.group})`))];
  const blocker = missing.length
    ? `Not uploaded: ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ` and ${missing.length - 4} more` : ""}.`
    : !uploaded.length
      ? "No documents uploaded yet."
      : checked < uploaded.length
        ? `Open every document to approve — ${uploaded.length - checked} left.`
        : "";
  return { uploaded: uploaded.length, checked, blocker };
}
