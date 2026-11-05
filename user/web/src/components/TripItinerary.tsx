import type { TripRecord } from '@core/types';

/** One itinerary view shared by all customer brands; coordinates remain in the booking. */
export function TripItinerary({ trip }: { trip: TripRecord }) {
  if (!trip.itinerary || trip.itinerary.length < 3) return null;
  return <section aria-label="Multicity itinerary" style={{ margin: '16px 0', padding: 16, border: '1px solid #dce3ed', borderRadius: 12, background: '#fff' }}>
    <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>Multicity itinerary</h2>
    <ol style={{ paddingLeft: 24, display: 'grid', gap: 10 }}>
      {trip.itinerary.map((point, index) => <li key={index}><strong>{point.name}</strong><small style={{ display: 'block', color: '#667085' }}>{point.address}</small></li>)}
    </ol>
  </section>;
}
