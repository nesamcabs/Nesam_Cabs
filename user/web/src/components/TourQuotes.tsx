// The rider's Multicity / tour quote requests (travel-desk enquiries), newest first: where each one
// stands, the price once the travel desk has sent it, and accepting it. Enquiries are not bookings:
// once accepted, the travel desk confirms the vehicle and turns the quote into a booking.
import { useCallback, useEffect, useState } from 'react';
import { ActionError, callFunction } from '@core/services/callables';
import { formatDate, formatINR, formatTime } from '@core/utils/format';
import { Badge, Button, Notice } from './ui';
import { Icon } from './Icon';

interface CustomerEnquiry {
  id: string;
  code: string;
  status: string;
  brand: string | null;
  pickup: string;
  drop: string;
  stops: { name: string }[];
  vehicle?: string;
  pickupAt: string | null;
  estimate: number | null;
  validUntil: string | null;
  convertedBookingId: string | null;
  quoteRevision?: string | null;
}

type Tone = 'green' | 'amber' | 'blue' | 'neutral';

/** What the rider is told about a request; the price shows only once the travel desk has sent it. */
function stageOf(e: CustomerEnquiry): { label: string; tone: Tone; text: string; priced: boolean } {
  const expired = e.status === 'Expired' || (e.status === 'Quote sent' && !!e.validUntil && Date.parse(e.validUntil) < Date.now());
  if (expired) return { label: 'Quote expired', tone: 'amber', text: 'This quote is no longer valid. Call us and we will refresh it.', priced: false };
  switch (e.status) {
    case 'Quote sent':
      return { label: 'Quote ready', tone: 'green', text: 'Your package price is ready. Accept it and the travel desk will confirm your vehicle.', priced: true };
    case 'Customer accepted':
      return { label: 'Accepted', tone: 'blue', text: 'You accepted this quote. The travel desk is assigning your vehicle and will confirm the booking.', priced: true };
    case 'Converted':
      return { label: 'Booked', tone: 'green', text: 'Booking created for office review. Follow its status in My trips.', priced: true };
    case 'Closed':
      return { label: 'Closed', tone: 'neutral', text: 'This request was closed. Call us if you would like to plan it again.', priced: false };
    default:
      return { label: 'Under review', tone: 'amber', text: 'Our travel desk is working out the route and price, and will contact you with your quote.', priced: false };
  }
}

export function TourQuotes({ brand }: { brand: string }) {
  const [rows, setRows] = useState<CustomerEnquiry[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [done, setDone] = useState('');

  const load = useCallback(() => {
    setError('');
    callFunction<Record<string, never>, CustomerEnquiry[]>('getCustomerEnquiries', {})
      .then((list) => setRows(list.filter((e) => e.brand === brand)))
      .catch((err) => setError(err instanceof ActionError ? err.message : 'Your quote requests could not be loaded.'));
  }, [brand]);
  useEffect(load, [load]);

  const accept = async (e: CustomerEnquiry) => {
    if (busyId || e.estimate == null) return;
    setBusyId(e.id);
    setError('');
    setDone('');
    try {
      const res = await callFunction<{ enquiryId: string; expectedEstimate: number; expectedRevision?: string | null }, { message?: string }>('acceptEnquiryQuote', { enquiryId: e.id, expectedEstimate: e.estimate, expectedRevision: e.quoteRevision });
      setDone(res?.message || 'Quote accepted. The travel desk will confirm your booking.');
      load();
    } catch (err) {
      setError(err instanceof ActionError ? err.message : 'The quote could not be accepted. Please try again.');
      load();
    } finally {
      setBusyId('');
    }
  };

  if (!rows?.length && !error) return null;

  return (
    <section className="quotes" aria-labelledby="quotes-title">
      <h2 id="quotes-title" className="quotes__title">
        <Icon name="route" size={16} /> Tour quote requests
      </h2>
      {error ? (
        <p className="quotes__error" role="alert">
          <span>{error}</span>
          <button type="button" className="quotes__retry" onClick={load}>
            Try again
          </button>
        </p>
      ) : null}
      {done ? <Notice tone="success">{done}</Notice> : null}
      {rows?.length ? (
        <ul className="trip-list">
          {rows.map((e) => {
            const stage = stageOf(e);
            const route = [e.pickup, ...(e.stops ?? []).map((s) => s.name), e.drop].filter(Boolean);
            const when = e.pickupAt ? new Date(e.pickupAt) : null;
            const validUntil = stage.priced && e.status === 'Quote sent' && e.validUntil ? ` · Valid until ${formatDate(new Date(e.validUntil))}` : '';
            return (
              <li key={e.id} className="qrow">
                <div className="qrow__main">
                  <p className="qrow__route" title={route.join(' → ')}>{route.join(' → ')}</p>
                  <p className="qrow__status" title={stage.text}>
                    <Badge tone={stage.tone}>{stage.label}</Badge>
                  </p>
                  <p className="qrow__meta">
                    {when ? `${formatDate(when)} · ${formatTime(when)}` : 'Pickup date to be confirmed'}
                    {e.vehicle ? ` · ${e.vehicle}` : ''} · {e.code}
                    {validUntil}
                  </p>
                </div>
                {stage.priced && e.estimate != null ? (
                  <div className="qrow__end">
                    <strong className="num qrow__price">{formatINR(e.estimate)}</strong>
                    {e.status === 'Quote sent' ? (
                      <Button size="sm" variant="primary" loading={busyId === e.id} onClick={() => void accept(e)}>
                        Accept
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
