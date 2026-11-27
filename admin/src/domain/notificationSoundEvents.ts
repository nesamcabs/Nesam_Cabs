// The notification events whose sound the office chooses for the customer, driver and vendor apps (header →
// Notification sounds). An exact copy of the catalogue in functions/src/domain/soundEvents.ts, which decides the
// sound on the server; scripts/notification-sound-settings.test.cjs fails when the two differ. No imports.

export type AppSound = 'new_booking' | 'approval' | 'general';
export const APP_SOUNDS: readonly AppSound[] = ['new_booking', 'approval', 'general'];
export const APP_SOUND_LABEL: Readonly<Record<AppSound, string>> = { new_booking: 'New booking', approval: 'Approval', general: 'General' };
export const isAppSound = (v: unknown): v is AppSound => typeof v === 'string' && (APP_SOUNDS as readonly string[]).includes(v);

export type SoundAudience = 'customer' | 'driver' | 'vendor';
export const SOUND_AUDIENCES: readonly SoundAudience[] = ['customer', 'driver', 'vendor'];

/** The event a notification is, set on the call site (NotifyInput.event). The same key can be listed for several audiences. */
export type SoundEvent =
  | 'booking_received' | 'booking_approved' | 'driver_assigned' | 'trip_started' | 'trip_completed' | 'cancelled' | 'payment' | 'offers'
  | 'new_duty' | 'bid_selected' | 'reassigned' | 'penalty' | 'documents_approved' | 'driver_request';

export interface SoundEventInfo {
  key: SoundEvent;
  label: string;
  /** The sound the server has always used for it (every call site of the event uses this one). */
  defaultSound: AppSound;
  /** false: the server sends no such notification yet, so there is nothing to set. */
  sent: boolean;
  /** Which notifications it covers, in the office's words. */
  covers: string;
}

export const SOUND_EVENTS: Readonly<Record<SoundAudience, readonly SoundEventInfo[]>> = {
  customer: [
    { key: 'booking_received', label: 'Booking received', defaultSound: 'approval', sent: true, covers: '"Booking confirmed" when the customer books, or once their online payment is received' },
    { key: 'booking_approved', label: 'Booking approved', defaultSound: 'approval', sent: true, covers: '"Booking approved" by the office' },
    { key: 'driver_assigned', label: 'Driver assigned', defaultSound: 'approval', sent: true, covers: '"Driver assigned", "Your driver has changed" and "Your booking is with a NESAM partner"' },
    { key: 'trip_started', label: 'Trip started', defaultSound: 'general', sent: true, covers: '"Your trip has started"' },
    { key: 'trip_completed', label: 'Trip completed', defaultSound: 'general', sent: true, covers: '"Trip completed" by the driver or closed by the office' },
    { key: 'cancelled', label: 'Cancelled', defaultSound: 'general', sent: true, covers: '"Booking cancelled" by the office' },
    { key: 'payment', label: 'Payment', defaultSound: 'general', sent: true, covers: 'Refund updates ("Refund processing", "Refund completed" …)' },
    { key: 'offers', label: 'Offers', defaultSound: 'general', sent: true, covers: 'Notices sent to customers from Communication → Send notification' },
  ],
  driver: [
    { key: 'new_duty', label: 'New duty', defaultSound: 'new_booking', sent: true, covers: '"Trip assigned to you", "New trip available" and "Round trip request approved"' },
    { key: 'bid_selected', label: 'Bid selected', defaultSound: 'approval', sent: true, covers: '"Your bid was accepted"' },
    { key: 'cancelled', label: 'Trip cancelled', defaultSound: 'general', sent: true, covers: '"Trip cancelled" by NESAM' },
    { key: 'reassigned', label: 'Trip reassigned', defaultSound: 'general', sent: true, covers: '"Trip reassigned" and "Trip removed from you"' },
    { key: 'penalty', label: 'Penalty', defaultSound: 'general', sent: true, covers: '"Penalty issued" and later penalty decisions' },
    { key: 'payment', label: 'Payment / payout', defaultSound: 'general', sent: false, covers: 'No payment or payout notification is sent to drivers yet' },
    { key: 'documents_approved', label: 'Documents approved', defaultSound: 'approval', sent: true, covers: 'Staff approvals ("You\'re approved", "Account reactivated")' },
  ],
  vendor: [
    { key: 'new_duty', label: 'New duty', defaultSound: 'new_booking', sent: true, covers: '"Trip assigned to your fleet", "Trip assigned to <driver>" and "New trip available"' },
    { key: 'bid_selected', label: 'Bid selected', defaultSound: 'approval', sent: true, covers: '"Your bid was accepted"' },
    { key: 'driver_request', label: 'Driver request', defaultSound: 'general', sent: true, covers: '"Driver requests a round trip"' },
    { key: 'cancelled', label: 'Cancelled', defaultSound: 'general', sent: true, covers: '"Trip cancelled" by NESAM' },
    { key: 'penalty', label: 'Penalty', defaultSound: 'general', sent: true, covers: '"Penalty issued" and later penalty decisions' },
    { key: 'payment', label: 'Payment', defaultSound: 'general', sent: false, covers: 'No payment or payout notification is sent to vendors yet' },
    { key: 'documents_approved', label: 'Documents approved', defaultSound: 'approval', sent: true, covers: 'Staff approvals ("You\'re approved", "Account reactivated")' },
  ],
};

export const eventInfo = (audience: string, event: string): SoundEventInfo | undefined =>
  (SOUND_EVENTS as Record<string, readonly SoundEventInfo[] | undefined>)[audience]?.find((e) => e.key === event);
