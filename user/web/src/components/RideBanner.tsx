import { Link } from 'react-router-dom';
import { useCustomerData } from '@core/context/CustomerData';
import { Icon } from './Icon';

/** The ride in progress, the next booking, or a trip waiting for a rating: one small chip in the middle of the header. */
export function RideBanner() {
  const { liveRide, unratedTrip } = useCustomerData();
  const trip = liveRide ?? unratedTrip;
  if (!trip) return null;
  const live = !!liveRide;
  const label = live ? (trip.status === 'Ongoing' ? 'Trip in progress' : 'Upcoming booking') : 'How was your journey?';
  const route = `${trip.pickup.name} → ${trip.drop.name}`;
  return (
    <Link className={`ride-chip ${live ? '' : 'ride-chip--soft'}`} to={`/ride/${trip.id}`} title={`${label} · ${route}`} aria-label={`${label}: ${route}. ${live ? 'View booking' : 'Rate trip'}`}>
      <Icon name={live ? 'car' : 'star'} size={18} />
      <span className="ride-chip__text">
        <strong>{label}</strong>
        <small>{route}</small>
      </span>
      <Icon name="chevron-right" size={14} />
    </Link>
  );
}
