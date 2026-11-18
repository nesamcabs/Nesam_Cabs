// Which services the admin has switched off (Admin → Services). The booking server refuses them as well; this only lets the form say so first.
// A service with no record, or one that is switched on, is available. Read from the public mirror every site already uses for its service content.
import { useEffect, useState } from 'react';
import { subscribePublicContent, type PublicContent } from '@core/services/catalogService';

export type ServiceKey = 'One Way' | 'Round Trip' | 'Airport Taxi' | 'Local Rental' | 'Pickup & Drop' | 'Multicity';
const TYPE: Record<ServiceKey, string> = {
  'One Way': 'One Way Taxi', 'Round Trip': 'Outstation Cab', 'Airport Taxi': 'Airport Taxi',
  'Local Rental': 'Local Rental', 'Pickup & Drop': 'Local Pickup & Drop', Multicity: 'Multicity',
};
export const UNAVAILABLE_TEXT = 'Currently unavailable';

export function useServiceAvailability() {
  const [rows, setRows] = useState<PublicContent[]>([]);
  useEffect(() => subscribePublicContent('services', setRows), []);
  /** True when this service has a record and none of its records is open for online booking. */
  const off = (key: ServiceKey): boolean => {
    const mine = rows.filter((r) => r.serviceType === TYPE[key]);
    return mine.length > 0 && !mine.some((r) => r.onlineBookingEnabled === true);
  };
  return { off };
}
