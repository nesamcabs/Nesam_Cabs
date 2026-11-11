export type NotificationCategory = 'bookings' | 'approvals' | 'trips' | 'payments' | 'penalties' | 'general';
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';
export type NotificationSound = 'new_booking' | 'approval' | 'general';

export interface PartnerNotification {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  createdAtMs: number;
  category: NotificationCategory;
  severity: NotificationSeverity;
  sound: NotificationSound;
  bookingId: string;
  bookingCode: string;
  ctaLabel: string;
  ctaPage: string;
  /** false = quiet inbox entry (no popup or tone). */
  popup: boolean;
}

export type PenaltyStatus = 'Pending' | 'Acknowledged' | 'Paid' | 'Deducted' | 'Waived' | 'Disputed';

export interface PartnerPenalty {
  id: string;
  amount: number;
  category: string;
  reason: string;
  description: string;
  bookingCode: string;
  bookingId: string;
  incidentDate: string;
  status: PenaltyStatus;
  acknowledged: boolean;
  acknowledgedAt: Date | null;
  disputeNote: string;
  issuedAt: Date | null;
  issuedByName: string;
}
