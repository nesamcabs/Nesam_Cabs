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
        <Icon name="route" size={18} /> Tour quote requests
      </h2>
      {error ? (
        <Notice
          tone="error"
          action={
            <Button size="sm" variant="secondary" onClick={load}>
              Try again
            </Button>
          }
        >
          {error}
        </Notice>
      ) : null}
      {done ? <Notice tone="success">{done}</Notice> : null}
      <div className="quotes__list">
        {(rows ?? []).map((e) => {
          const stage = stageOf(e);
          const route = [e.pickup, ...(e.stops ?? []).map((s) => s.name), e.drop].filter(Boolean);
          const when = e.pickupAt ? new Date(e.pickupAt) : null;
          return (
            <article key={e.id} className="qcard">
              <header className="qcard__head">
                <span className="qcard__code num">{e.code}</span>
                <Badge tone={stage.tone}>{stage.label}</Badge>
              </header>
              <p className="qcard__route">{route.join(' → ')}</p>
              <p className="qcard__meta">
                {when ? `${formatDate(when)} · ${formatTime(when)}` : 'Pickup date to be confirmed'}
                {e.vehicle ? ` · ${e.vehicle}` : ''}
              </p>
              <p className="qcard__text">{stage.text}</p>
              {stage.priced && e.estimate != null ? (
                <div className="qcard__price">
                  <span>
                    Package price <strong className="num">{formatINR(e.estimate)}</strong>
                  </span>
                  {e.status === 'Quote sent' ? (
                    <Button size="sm" variant="primary" loading={busyId === e.id} onClick={() => void accept(e)}>
                      Accept quote
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {stage.priced && e.status === 'Quote sent' && e.validUntil ? (
                <p className="qcard__valid">Valid until {formatDate(new Date(e.validUntil))}</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
