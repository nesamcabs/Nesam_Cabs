import React from 'react';
import { CancelledCard as RequestCancelledCard } from '../components/nx/Cancellation';
import type { DriverCancellation } from '../services/partnerRequests';
import type { LedgerEntry, TripDetails } from '../types';
import { Icon } from '../components/nx/Icon';
import { EmptyState, TripCard } from '../components/nx/parts';
import { inr, payoutLabel, placeName, tripWhen } from '../components/nx/format';
import { tripEarningStatus } from '../services/driverEarnings';

export type TripsTab = 'upcoming' | 'completed' | 'cancelled';

interface TripsScreenProps {
  tab: TripsTab;
  onTab: (tab: TripsTab) => void;
  now: number;
  upcoming: TripDetails[];
  completed: TripDetails[];
  cancelled: TripDetails[];
  /** Duties NESAM cancelled after an approved request; the booking itself is no longer assigned to this driver. */
  cancelledRequests?: DriverCancellation[];
  ledger: LedgerEntry[];
  onOpenTrip: (trip: TripDetails) => void;
  onBrowse: () => void;
}

const SETTLED_STATUS: Record<string, string> = { pending: 'Awaiting payment', available: 'In wallet', cancelled: 'Reversed' };

const CompletedCard: React.FC<{ trip: TripDetails; ledger: LedgerEntry[]; onOpen: () => void }> = ({ trip, ledger, onOpen }) => {
  const when = tripWhen(trip);
  const status = tripEarningStatus(ledger, trip.id);
  const settled = status === 'available';
  const badge = trip.fleetTrip ? 'Settled by fleet' : status ? SETTLED_STATUS[status] || status : 'Settlement pending';
  const date = trip.completedAt ? trip.completedAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : when.date;
  return (
    <article className="panel completed-card">
      <div className="duty-meta">
        <span>{date}</span>
        <span className={`badge ${settled || trip.fleetTrip ? 'green' : 'amber'}`}>{badge}</span>
      </div>
      <h3 className="duty-route">
        {placeName(trip.pickup.address)} <Icon name="arrow" /> {placeName(trip.drop.address)}
      </h3>
      <p className="duty-info">{trip.bookingId} · Completed</p>
      <div className="duty-bottom">
        <div className="duty-payout">
          <small>{trip.fleetTrip ? 'Paid by your fleet' : settled ? 'Driver earnings credited' : 'Driver payout'}</small>
          <strong>{payoutLabel(trip)}</strong>
        </div>
        <button type="button" className="button secondary" onClick={onOpen}>
          Trip summary <Icon name="arrow" />
        </button>
      </div>
    </article>
  );
};

const CancelledCard: React.FC<{ trip: TripDetails; onOpen: () => void }> = ({ trip, onOpen }) => {
  const when = tripWhen(trip);
  return (
    <article className="panel completed-card">
      <div className="duty-meta">
        <span>
          {when.date}
          {when.time ? ` · ${when.time}` : ''}
        </span>
        <span className="badge neutral">Cancelled</span>
      </div>
      <h3 className="duty-route">
        {placeName(trip.pickup.address)} <Icon name="arrow" /> {placeName(trip.drop.address)}
      </h3>
      <p className="duty-info">{trip.bookingId}</p>
      <div className="duty-bottom">
        <div className="duty-payout">
          <small>Cancelled by NESAM</small>
          <strong>{inr(0)}</strong>
        </div>
        <button type="button" className="button secondary" onClick={onOpen}>
          View details <Icon name="arrow" />
        </button>
      </div>
    </article>
  );
};

export const TripsScreen: React.FC<TripsScreenProps> = ({ tab, onTab, now, upcoming, completed, cancelled, cancelledRequests = [], ledger, onOpenTrip, onBrowse }) => {
  const released = cancelledRequests.filter((r) => r.status === 'Approved' && !cancelled.some((t) => t.id === r.bookingId));
  const tabs: [TripsTab, string, number][] = [
    ['upcoming', 'Upcoming', upcoming.length],
    ['completed', 'Completed', completed.length],
    ['cancelled', 'Cancelled', cancelled.length + released.length],
  ];
  return (
    <>
      <div className="page-tabs" role="group" aria-label="Trip list">
        {tabs.map(([key, label, count]) => (
          <button key={key} type="button" className={`pill-button ${tab === key ? 'active' : ''}`} aria-pressed={tab === key} onClick={() => onTab(key)}>
            {label} ({count})
          </button>
        ))}
      </div>
      {tab === 'upcoming' ? (
        upcoming.length ? (
          <div className="trip-list">
            {upcoming.map((t) => (
              <TripCard key={t.id} trip={t} now={now} onOpen={() => onOpenTrip(t)} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon="trip"
            title="No upcoming duties"
            action={
              <button type="button" className="button primary" onClick={onBrowse}>
                Browse duties
              </button>
            }
          >
            Accepted duties will appear here.
          </EmptyState>
        )
      ) : tab === 'cancelled' ? (
        cancelled.length || released.length ? (
          <div className="trip-list">
            {cancelled.map((t) => (
              <CancelledCard key={t.id} trip={t} onOpen={() => onOpenTrip(t)} />
            ))}
            {released.map((r) => <RequestCancelledCard key={r.id} request={r} />)}
          </div>
        ) : (
          <EmptyState icon="shield" title="No cancelled duties">
            Admin-approved cancellations will appear here.
          </EmptyState>
        )
      ) : completed.length ? (
        <div className="trip-list">
          {completed.map((t) => (
            <CompletedCard key={t.id} trip={t} ledger={ledger} onOpen={() => onOpenTrip(t)} />
          ))}
        </div>
      ) : (
        <EmptyState icon="check" title="No completed trips yet">
          Finished trips and their settlement status will appear here.
        </EmptyState>
      )}
      <p className="list-note">
        <Icon name="info" />
        Duty changes and cancellations are handled by NESAM. Call the office from Help if you need a change.
      </p>
    </>
  );
};
