// Where a notification's call-to-action (in-app popup, Alerts list or push tap) leads. Page names come from the server
// (functions notifications `cta.page`) and utils/notificationModel ctaOf.
import { goSection, navigationRef } from './navigationRef';

export function openPage(page: string, bookingId?: string): void {
  if (!navigationRef.isReady()) return;
  switch (page) {
    case 'market':
    case 'marketplace':
      return goSection('Trips');
    case 'bids':
      return navigationRef.navigate('MyBids');
    case 'trip':
    case 'trips':
    case 'booking':
    case 'booking-detail':
    case 'bookings':
      if (bookingId) return navigationRef.navigate('Booking', { id: bookingId });
      return goSection('Bookings');
    case 'assign':
      if (bookingId) return navigationRef.navigate('Assign', { id: bookingId });
      return goSection('Bookings', { tab: 'Accepted' });
    case 'wallet':
    case 'payouts':
      return goSection('Wallet');
    case 'earnings':
    case 'statements':
      return goSection('Earnings');
    case 'drivers':
      return goSection('Fleet', { tab: 'Drivers' });
    case 'fleet':
    case 'vehicles':
      return goSection('Fleet', { tab: 'Vehicles' });
    case 'documents':
      return navigationRef.navigate('Documents');
    case 'links':
    case 'partner-links':
      return goSection('Fleet', { tab: 'Vehicles', swap: Date.now() });
    case 'requests':
    case 'helpdesk':
      return goSection('Helpdesk');
    case 'profile':
    case 'account':
      return goSection('Account');
    case 'penalties':
      return goSection('Wallet', { tab: 'Penalties' });
    default:
      return navigationRef.navigate('Alerts');
  }
}
