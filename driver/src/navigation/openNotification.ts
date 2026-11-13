// Where a notification's call-to-action leads — one place for the in-app popup, the Notifications page and a tapped push.
// Page keys come from the server (functions notify `cta.page`) or utils/notificationModel ctaOf. A link to a page this
// driver does not have (an owner-driver has no Local Taxi page; a vendor's employee has no Duties or Earnings) lands on
// Home instead of failing silently.
import { navigationRef } from './navigationRef';
import { goTab } from './navItems';

export interface NotificationTarget {
  /** The trip the notification is about (or, for a trip notice that names none, the driver's next trip). */
  tripId?: string;
  /** A vendor's employee (fleet driver). */
  fleet: boolean;
}

export function openNotificationTarget(page: string, { tripId, fleet }: NotificationTarget): void {
  if (!navigationRef.isReady()) return;
  switch (page) {
    case 'dashboard':
    case 'home':
      return goTab('Home');
    case 'marketplace':
    case 'market':
      return goTab(fleet ? 'Home' : 'Marketplace');
    case 'local':
    case 'local-duty':
      return goTab(fleet ? 'Local' : 'Home');
    case 'trip':
    case 'trips':
    case 'booking':
    case 'booking-detail':
      if (tripId) return navigationRef.navigate('TripFlow', { bookingId: tripId });
      return goTab('Trip');
    case 'earnings':
    case 'wallet':
    case 'payouts':
      // Earnings & Wallet is one page.
      return goTab(fleet ? 'Home' : 'Earnings');
    case 'profile':
    case 'penalties':
    case 'documents':
    case 'links':
      return goTab('Profile');
    case 'notifications':
    default:
      return navigationRef.navigate('Notifications');
  }
}
