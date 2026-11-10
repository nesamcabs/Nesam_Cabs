// The hero headline for each service on the booking page (user/web/src/lib/serviceSlogan.ts).
import type { HomeService } from '../context/BookingDraft';

export function serviceSlogan(service: HomeService | 'local' | 'pickup', trip: 'One Way' | 'Round Trip' = 'One Way'): readonly [string, string] {
  switch (service) {
    case 'airport':
      return ['Touch down. Ride on.', 'Your airport journey, made easy.'];
    case 'multicity':
      return ['More places on your plan.', 'One cab for every city.'];
    case 'local':
    case 'pickup':
    case 'rental':
      return ['', ''];
    default:
      return trip === 'Round Trip' ? ['Explore more. Return happy.', 'One cab, all the way back.'] : ['A new city. Your next story.', 'One-way rides, endless possibilities.'];
  }
}
