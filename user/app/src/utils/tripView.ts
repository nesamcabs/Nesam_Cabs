// How a booking is presented to the customer (unit-tested).
import { isActiveStatus } from '../services/rideService';
import type { TripRecord } from '../types';
import { formatINR } from './format';

export type TripTab = 'Upcoming' | 'Completed' | 'Cancelled';

export const tabOfTrip = (t: TripRecord): TripTab => (isActiveStatus(t.status) ? 'Upcoming' : t.status === 'Completed' ? 'Completed' : 'Cancelled');

const DAY_MS = 24 * 3600000;

/**
 * The customer-facing status line and what it means. Exact wording for an advance booking:
 * a booking is never described as "finding a driver" and nothing promises an arrival time.
 */
export function customerStatus(t: TripRecord, now = Date.now()): { label: string; detail: string } {
  if (t.status === 'Rejected') return { label: 'Not accepted', detail: 'NESAM could not accept this booking request.' };
  switch (t.phase) {
    case 'awaiting_review':
      return { label: 'Awaiting review', detail: 'NESAM is reviewing your booking request. We’ll confirm here and by message once it is approved.' };
    case 'arranging':
      return { label: 'Approved — arranging your vehicle', detail: 'Your booking is approved. NESAM is arranging a vehicle and driver, and you’ll see their details here as soon as they are assigned.' };
    case 'partner_confirmed':
      return {
        label: 'Vendor assigned — driver details pending',
        detail: `${t.assignedVendorName || 'A NESAM partner'} will provide your vehicle. Driver and vehicle details will appear here before your pickup.`,
      };
    case 'driver_assigned': {
      const soon = !!t.scheduledAt && t.scheduledAt.getTime() - now <= DAY_MS;
      return {
        label: soon ? 'Upcoming trip' : 'Driver and vehicle assigned',
        detail: soon ? 'Your driver and vehicle are confirmed for your pickup.' : 'Your driver and vehicle are confirmed. We’ll remind you before your pickup.',
      };
    }
    case 'driver_en_route':
      return { label: 'Driver on the way to pickup', detail: 'Your driver has started towards your pickup point.' };
    case 'driver_arrived':
      return { label: 'Driver at pickup', detail: 'Your driver has reached the pickup point.' };
    case 'in_trip':
      return { label: 'Trip in progress', detail: 'Your trip is underway.' };
    case 'completed':
      return { label: 'Completed', detail: 'This trip is complete.' };
    default:
      return { label: 'Cancelled', detail: 'This booking was cancelled.' };
  }
}

/** Status chip text + colours; the text always carries the meaning, colour only reinforces it. */
export function tripStatusChip(t: TripRecord, now = Date.now()): { label: string; fg: string; bg: string } {
  const blue = { fg: '#1D4ED8', bg: '#E0EDFF' };
  const green = { fg: '#15803D', bg: '#DCFCE7' };
  const amber = { fg: '#B45309', bg: '#FEF3C7' };
  const red = { fg: '#B91C1C', bg: '#FEE2E2' };
  const { label } = customerStatus(t, now);
  if (t.status === 'Rejected') return { label, ...red };
  switch (t.phase) {
    case 'awaiting_review':
    case 'arranging':
      return { label, ...amber };
    case 'completed':
      return { label, ...green };
    case 'cancelled':
      return { label, ...red };
    default:
      return { label, ...blue };
  }
}

/** What the customer still has to do about money on this trip. */
export function paymentLabel(t: TripRecord): { text: string; tone: 'muted' | 'success' | 'danger' } {
  if (t.status === 'Cancelled' || t.status === 'Rejected') {
    if (t.refund && t.refund.amount > 0) return { text: `Refund ${t.refund.status.toLowerCase()}: ${formatINR(t.refund.amount)}`, tone: 'muted' };
    return t.cancellationFee > 0 ? { text: `Cancellation fee ${formatINR(t.cancellationFee)}`, tone: 'danger' } : { text: 'No charge', tone: 'muted' };
  }
  if (t.paymentStatus === 'Paid' || (t.paid && t.paid.totalPaid > 0 && t.paid.balanceDue <= 0)) return { text: 'Paid', tone: 'success' };
  if (t.paid && t.paid.totalPaid > 0) return { text: `Balance ${formatINR(t.paid.balanceDue)}`, tone: 'danger' };
  return { text: t.paymentMethod === 'UPI' ? 'Pay by UPI' : 'Pay at drop', tone: 'muted' };
}

/** Bookings with money to show: completed ones, and cancelled ones that were charged or refunded. */
export function paymentRows(trips: TripRecord[]): TripRecord[] {
  return trips
    .filter((t) => t.status === 'Completed' || t.cancellationFee > 0 || (t.refund && t.refund.amount > 0) || (t.paid && t.paid.totalPaid > 0))
    .sort((a, b) => ((b.completedAt ?? b.cancelledAt ?? b.createdAt)?.getTime() ?? 0) - ((a.completedAt ?? a.cancelledAt ?? a.createdAt)?.getTime() ?? 0));
}

/** The tabs on My Bookings (reference): Ongoing is a live trip, kept apart from Upcoming. */
export type BookingTab = 'Upcoming' | 'Ongoing' | 'Completed' | 'Cancelled';
export const BOOKING_TABS: BookingTab[] = ['Upcoming', 'Ongoing', 'Completed', 'Cancelled'];
export const bookingTabOf = (t: TripRecord): BookingTab => (t.status === 'Ongoing' ? 'Ongoing' : tabOfTrip(t));

export type MilestoneState = 'done' | 'current' | 'todo';
export interface Milestone {
  key: 'confirmed' | 'assigned' | 'arrived' | 'started' | 'completed';
  label: string;
  state: MilestoneState;
  /** One line of what is happening (or happened) at this step; '' when nothing to add. */
  detail: string;
  at: Date | null;
}

const PHASE_RANK: Record<TripRecord['phase'], number> = {
  awaiting_review: 0,
  arranging: 1,
  partner_confirmed: 1,
  driver_assigned: 2,
  driver_en_route: 2,
  driver_arrived: 3,
  in_trip: 4,
  completed: 5,
  cancelled: -1,
};

/**
 * The reference's five customer milestones, driven only by the real booking status and trip stage:
 * Booking Confirmed → Driver Assigned → Driver Arrived → Trip Started → Trip Completed.
 * "Confirmed" is NESAM's approval; before it the booking is awaiting review and the first step says so.
 * Cancelled and rejected bookings have no timeline (callers show the cancellation instead).
 */
export function milestones(t: TripRecord): Milestone[] {
  const rank = PHASE_RANK[t.phase];
  const steps: { key: Milestone['key']; label: string; need: number; at: Date | null }[] = [
    { key: 'confirmed', label: 'Booking Confirmed', need: 1, at: t.approvedAt ?? null },
    { key: 'assigned', label: 'Driver Assigned', need: 2, at: t.assignedAt ?? null },
    { key: 'arrived', label: 'Driver Arrived', need: 3, at: null },
    { key: 'started', label: 'Trip Started', need: 4, at: t.startedAt ?? null },
    { key: 'completed', label: 'Trip Completed', need: 5, at: t.completedAt ?? null },
  ];
  const firstOpen = steps.findIndex((s) => rank < s.need);
  return steps.map((s, i) => {
    const state: MilestoneState = rank >= s.need ? 'done' : i === firstOpen ? 'current' : 'todo';
    let detail = '';
    if (s.key === 'confirmed' && state !== 'done') detail = 'Awaiting NESAM review';
    if (s.key === 'assigned') {
      if (state === 'done') detail = t.driver?.name ? `${t.driver.name}${t.driver.vehicleNumber ? ` · ${t.driver.vehicleNumber}` : ''}` : '';
      else if (state === 'current') detail = t.phase === 'partner_confirmed' ? 'Vendor assigned — driver details pending' : 'NESAM is arranging your vehicle';
    }
    if (s.key === 'arrived' && state === 'current' && t.phase === 'driver_en_route') detail = 'Your driver is on the way';
    if (s.key === 'started' && state === 'current' && t.phase === 'driver_arrived') detail = 'Share your boarding OTP with the driver';
    return { key: s.key, label: s.label, state, detail, at: s.at };
  });
}
