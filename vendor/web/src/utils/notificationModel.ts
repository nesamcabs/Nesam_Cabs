import type { PartnerNotification, NotificationCategory, NotificationSeverity } from '../notificationTypes';

export const CATEGORIES: NotificationCategory[] = ['bookings', 'approvals', 'trips', 'payments', 'penalties', 'general'];

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  bookings: 'Bookings', approvals: 'Approvals', trips: 'Trips', payments: 'Payments', penalties: 'Penalties', general: 'General',
};

interface Raw { type: string; category: string; severity: string; priority: string; sound: string; cta?: unknown; bookingId: string }

/** Records written before categories existed are classified from their type. */
export function categoryOf(n: Raw): NotificationCategory {
  if ((CATEGORIES as string[]).includes(n.category)) return n.category as NotificationCategory;
  switch (n.type) {
    case 'booking': return 'bookings';
    case 'driver':
    case 'vendor':
    case 'approval': return 'approvals';
    case 'trip':
    case 'alert': return 'trips';
    case 'payment':
    case 'payout': return 'payments';
    case 'penalty': return 'penalties';
    default: return 'general';
  }
}

export function severityOf(n: Raw): NotificationSeverity {
  if (n.severity === 'info' || n.severity === 'success' || n.severity === 'warning' || n.severity === 'critical') return n.severity;
  if (n.priority === 'urgent') return 'critical';
  if (n.priority === 'high') return 'warning';
  return 'info';
}

export function soundOf(n: Raw): 'new_booking' | 'approval' | 'general' {
  if (n.sound === 'new_booking' || n.sound === 'approval' || n.sound === 'general') return n.sound;
  return categoryOf(n) === 'approvals' ? 'approval' : 'general';
}

export function ctaOf(n: Raw): { ctaLabel: string; ctaPage: string } {
  const cta = n.cta as { label?: string; page?: string } | null | undefined;
  if (cta?.page) return { ctaLabel: cta.label || 'Open', ctaPage: cta.page };
  switch (categoryOf(n)) {
    case 'bookings': return { ctaLabel: 'View trips', ctaPage: 'dashboard' };
    case 'trips': return { ctaLabel: 'Open trip', ctaPage: 'trip' };
    case 'payments': return { ctaLabel: 'View wallet', ctaPage: 'wallet' };
    case 'penalties': return { ctaLabel: 'View penalty', ctaPage: 'notifications' };
    case 'approvals': return { ctaLabel: 'View profile', ctaPage: 'profile' };
    default: return { ctaLabel: 'Open', ctaPage: 'notifications' };
  }
}

export type Tone = 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'amber' | 'neutral';

/** Popup / badge colour: critical and warnings override the category colour. */
export function toneOf(n: Pick<PartnerNotification, 'category' | 'severity'>): Tone {
  if (n.severity === 'critical') return 'red';
  if (n.severity === 'warning') return n.category === 'trips' ? 'amber' : n.category === 'penalties' ? 'red' : 'orange';
  switch (n.category) {
    case 'bookings': return 'blue';
    case 'approvals': return 'green';
    case 'payments': return n.severity === 'success' ? 'green' : 'purple';
    case 'penalties': return 'red';
    case 'trips': return 'amber';
    default: return 'neutral';
  }
}

export const TONE: Record<Tone, { box: string; bar: string; chip: string; dot: string }> = {
  blue: { box: 'border-blue-300 bg-blue-50', bar: 'bg-blue-600', chip: 'text-blue-800 bg-blue-100', dot: '#2563EB' },
  green: { box: 'border-green-300 bg-green-50', bar: 'bg-green-600', chip: 'text-green-800 bg-green-100', dot: '#16A34A' },
  orange: { box: 'border-orange-300 bg-orange-50', bar: 'bg-orange-500', chip: 'text-orange-800 bg-orange-100', dot: '#F97316' },
  red: { box: 'border-red-300 bg-red-50', bar: 'bg-red-600', chip: 'text-red-800 bg-red-100', dot: '#DC2626' },
  purple: { box: 'border-purple-300 bg-purple-50', bar: 'bg-purple-600', chip: 'text-purple-800 bg-purple-100', dot: '#9333EA' },
  amber: { box: 'border-amber-300 bg-amber-50', bar: 'bg-amber-500', chip: 'text-amber-900 bg-amber-100', dot: '#F59E0B' },
  neutral: { box: 'border-gray-300 bg-white', bar: 'bg-gray-500', chip: 'text-gray-800 bg-gray-100', dot: '#6B7280' },
};
