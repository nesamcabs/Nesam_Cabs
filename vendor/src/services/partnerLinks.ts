// Linking drivers and vehicles to this vendor's fleet (same contract as vendor/web/src/services/partnerLinks.ts).
//   • A driver or vehicle that is not on NESAM yet: an invitation (driver_invites) or a new vehicle record.
//   • One that already is (an owner-driver, another vendor's driver, a car held elsewhere): a request that the driver
//     confirms with a one-time code, finished by the server (functions/src/partnerLinks.ts) or, when it cannot be, by the NESAM office.
// The app never moves a record itself: it asks, shows the status, and enters the code the driver reads out.
import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { ActionError, callFunction } from './callables';
import { describeDataError } from '../utils/retry';

export type LinkStatus = 'Awaiting OTP' | 'Office review' | 'Completed' | 'Rejected' | 'Cancelled';
export type LinkKind = 'driver' | 'vehicle';

export interface PartnerLink {
  id: string;
  kind: LinkKind;
  status: LinkStatus;
  subjectId: string;
  subjectLabel: string;
  /** owner_driver | vendor_driver (drivers only). */
  subjectKind: string;
  fromVendorId: string;
  fromVendorName: string;
  fromType: string;
  toVendorId: string;
  toVendorName: string;
  consent: boolean;
  otpVerified: boolean;
  /** Who the code was sent to (first name + masked number). */
  receiverName: string;
  receiverPhoneMask: string;
  hasReceiver: boolean;
  codeDelivered: boolean;
  method: string;
  blockedReason: string;
  rejectedReason: string;
  officeHelp: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const dateOf = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

export function mapLink(id: string, d: Record<string, unknown>): PartnerLink {
  const otp = (d.otp ?? {}) as Record<string, unknown>;
  return {
    id,
    kind: d.kind === 'vehicle' ? 'vehicle' : 'driver',
    status: (str(d.status) || 'Office review') as LinkStatus,
    subjectId: str(d.subjectId),
    subjectLabel: str(d.subjectLabel),
    subjectKind: str(d.subjectKind),
    fromVendorId: str(d.fromVendorId),
    fromVendorName: str(d.fromVendorName),
    fromType: str(d.fromType),
    toVendorId: str(d.toVendorId),
    toVendorName: str(d.toVendorName),
    consent: d.consent === true,
    otpVerified: d.otpVerified === true,
    receiverName: str(d.receiverName),
    receiverPhoneMask: str(d.receiverPhoneMask),
    hasReceiver: d.hasReceiver === true,
    codeDelivered: otp.delivered === true,
    method: str(d.method),
    blockedReason: str(d.blockedReason),
    rejectedReason: str(d.rejectedReason),
    officeHelp: d.officeHelp === true,
    createdAt: dateOf(d.createdAt),
    updatedAt: dateOf(d.updatedAt),
  };
}

export const linkIsOpen = (l: Pick<PartnerLink, 'status'>) => l.status === 'Awaiting OTP' || l.status === 'Office review';

/** Requests this vendor made (toVendorId) and ones that take a record away from it (fromVendorId). */
export function subscribeToMyLinks(vendorId: string, cb: (links: PartnerLink[]) => void, onError: (message: string) => void): () => void {
  const parts: Record<'to' | 'from', PartnerLink[]> = { to: [], from: [] };
  const emit = () => {
    const merged = new Map<string, PartnerLink>();
    [...parts.to, ...parts.from].forEach((l) => merged.set(l.id, l));
    cb([...merged.values()].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)));
  };
  const listen = (field: 'toVendorId' | 'fromVendorId', key: 'to' | 'from') =>
    onSnapshot(
      query(collection(db, 'partner_links'), where(field, '==', vendorId)),
      (snap) => {
        parts[key] = snap.docs.map((d) => mapLink(d.id, d.data()));
        emit();
      },
      (err) => onError(describeDataError(err)),
    );
  const a = listen('toVendorId', 'to');
  const b = listen('fromVendorId', 'from');
  return () => {
    a();
    b();
  };
}

// ── lookups & requests (server functions) ─────────────────────────────────

export interface DriverLookup {
  found: boolean;
  driverId?: string;
  name?: string;
  phoneMask?: string;
  kind?: 'owner_driver' | 'vendor_driver';
  /** The fleet that currently holds the driver (blank for an owner-driver). */
  fleet?: string;
  mine?: boolean;
  approved?: boolean;
  onHold?: boolean;
  openDuties?: number;
  pendingLinkId?: string;
}

export interface VehicleLookup {
  found: boolean;
  plate?: string;
  vehicleId?: string;
  model?: string;
  category?: string;
  owner?: string;
  mine?: boolean;
  verified?: boolean;
  onHold?: boolean;
  openDuties?: number;
  otpReceiver?: { name: string; phoneMask: string } | null;
  pendingLinkId?: string;
}

export interface LinkRequestResult {
  linkId: string;
  status?: LinkStatus;
  existing?: boolean;
  delivered?: boolean;
  error?: string;
  channels?: { channel: string; status: string }[];
  /** Only the local emulator returns the code; production never does. */
  testCode?: string;
}

export const findDriver = async (phone: string): Promise<DriverLookup> => {
  const result = await callFunction<{ phone: string }, DriverLookup>('findPartnerDriver', { phone });
  if (!result || typeof result !== 'object' || typeof result.found !== 'boolean'
    || (result.found && (typeof result.driverId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.driverId)))) {
    throw new ActionError('The driver lookup service returned an incomplete response. Please try again or contact the NESAM office.', undefined, 'functions/internal', 'invalid-driver-lookup');
  }
  return result;
};
export const findVehicle = (plate: string) => callFunction<{ plate: string }, VehicleLookup>('findPartnerVehicle', { plate });
export const requestDriverLink = async (phone: string, office = false): Promise<LinkRequestResult> => {
  const result = await callFunction<unknown, LinkRequestResult>('requestDriverLink', { phone, office });
  if (!result || typeof result.linkId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.linkId)) {
    throw new ActionError('The linking service did not return a request ID. Check Linking requests before trying again.', undefined, 'functions/internal', 'invalid-driver-link');
  }
  return result;
};
export const requestVehicleLink = (plate: string, office = false) => callFunction<unknown, LinkRequestResult>('requestVehicleLink', { plate, office });
export const verifyLinkCode = (linkId: string, code: string) => callFunction<unknown, { status: LinkStatus; completed: boolean; message: string }>('verifyPartnerLinkOtp', { linkId, code });
export const resendLinkCode = (linkId: string) => callFunction<unknown, { delivered: boolean; error?: string; testCode?: string; sendsLeft: number }>('resendPartnerLinkOtp', { linkId });
export const askOfficeForHelp = (linkId: string, note = '') => callFunction<unknown, { status: LinkStatus }>('requestPartnerLinkHelp', { linkId, note });
export const cancelLink = (linkId: string) => callFunction<unknown, { status: LinkStatus }>('cancelPartnerLink', { linkId });
