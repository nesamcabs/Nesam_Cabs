import type { DriverNotification, NotificationCategory, NotificationSeverity, NotificationSound } from '../types/driver';

export const CATEGORIES: NotificationCategory[] = ['bookings', 'approvals', 'trips', 'payments', 'penalties', 'general'];

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  bookings: 'Bookings',
  approvals: 'Approvals',
  trips: 'Trips',
  payments: 'Payments',
  penalties: 'Penalties',
  general: 'General',
};

interface Raw {
  type: string;
  category: string;
  severity: string;
  priority: string;
  sound: string;
  cta?: unknown;
  bookingId: string;
}

/** Records written before categories existed are classified from their type. */
export function categoryOf(n: Raw): NotificationCategory {
  if ((CATEGORIES as string[]).includes(n.category)) return n.category as NotificationCategory;
  switch (n.type) {
    case 'booking':
      return 'bookings';
    case 'driver':
    case 'vendor':
    case 'approval':
      return 'approvals';
    case 'trip':
    case 'alert':
      return 'trips';
    case 'payment':
    case 'payout':
      return 'payments';
    case 'penalty':
      return 'penalties';
    default:
      return 'general';
  }
}

export function severityOf(n: Raw): NotificationSeverity {
  if (n.severity === 'info' || n.severity === 'success' || n.severity === 'warning' || n.severity === 'critical') return n.severity;
  if (n.priority === 'urgent') return 'critical';
  if (n.priority === 'high') return 'warning';
  return 'info';
}

export function soundOf(n: Raw): NotificationSound {
  if (n.sound === 'new_booking' || n.sound === 'approval' || n.sound === 'general') return n.sound;
  return categoryOf(n) === 'approvals' ? 'approval' : 'general';
}

export function ctaOf(n: Raw): { ctaLabel: string; ctaPage: string } {
  const cta = n.cta as { label?: string; page?: string } | null | undefined;
  if (cta?.page) return { ctaLabel: cta.label || 'Open', ctaPage: cta.page };
  switch (categoryOf(n)) {
    case 'bookings':
      return { ctaLabel: 'View trips', ctaPage: 'dashboard' };
    case 'trips':
      return { ctaLabel: 'Open trip', ctaPage: 'trip' };
    case 'payments':
      return { ctaLabel: 'View wallet', ctaPage: 'wallet' };
    case 'penalties':
      return { ctaLabel: 'View penalty', ctaPage: 'penalties' };
    case 'approvals':
      return { ctaLabel: 'View profile', ctaPage: 'profile' };
    default:
      return { ctaLabel: 'Open', ctaPage: 'notifications' };
  }
}

export type Tone = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'amber' | 'neutral';

/** Popup / badge colour: critical and warnings override the category colour. */
export function toneOf(n: Pick<DriverNotification, 'category' | 'severity'>): Tone {
  if (n.severity === 'critical') return 'red';
  if (n.severity === 'warning') return n.category === 'trips' ? 'amber' : n.category === 'penalties' ? 'red' : 'orange';
  switch (n.category) {
    case 'bookings':
      return 'blue';
    case 'approvals':
      return 'green';
    case 'payments':
      return n.severity === 'success' ? 'green' : 'purple';
    case 'penalties':
      return 'red';
    case 'trips':
      return 'amber';
    default:
      return 'neutral';
  }
}

export const TONE_COLORS: Record<Tone, { bg: string; border: string; bar: string; text: string }> = {
  blue: { bg: '#EFF6FF', border: '#93C5FD', bar: '#2563EB', text: '#1E3A8A' },
  green: { bg: '#F0FDF4', border: '#86EFAC', bar: '#16A34A', text: '#14532D' },
  orange: { bg: '#FFF7ED', border: '#FDBA74', bar: '#F97316', text: '#7C2D12' },
  red: { bg: '#FEF2F2', border: '#FCA5A5', bar: '#DC2626', text: '#7F1D1D' },
  purple: { bg: '#FAF5FF', border: '#D8B4FE', bar: '#9333EA', text: '#581C87' },
  amber: { bg: '#FFFBEB', border: '#FCD34D', bar: '#F59E0B', text: '#78350F' },
  neutral: { bg: '#FFFFFF', border: '#D1D5DB', bar: '#6B7280', text: '#1F2937' },
};
