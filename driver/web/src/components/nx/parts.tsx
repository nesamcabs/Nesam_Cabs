import React from 'react';
import type { TripDetails } from '../../types';
import { Icon } from './Icon';
import { dayLabel, kmText, payoutLabel, payoutNote, placeName, shortDate, tripIsActive, tripStageLabel, tripWhen } from './format';

/** Text after the first comma ("Koyambedu Bus Terminus, Chennai, TN" → "Chennai, TN"); the whole address when there is none. */
export function placeDetail(address: string | undefined): string {
  const a = (address ?? '').trim();
  const i = a.indexOf(',');
  return i > 0 && i < a.length - 1 ? a.slice(i + 1).trim() : a;
}

export const RouteStack: React.FC<{ pickup: string; drop: string }> = ({ pickup, drop }) => (
  <div className="route-stack">
    <div className="route-stop">
      <span className="route-dot" />
      <div>
        <strong>{placeName(pickup)}</strong>
        <p>{placeDetail(pickup)}</p>
      </div>
    </div>
    <div className="route-stop">
      <span className="route-dot" />
      <div>
        <strong>{placeName(drop)}</strong>
        <p>{placeDetail(drop)}</p>
      </div>
    </div>
  </div>
);

/** The compact trip card used for the next/current trip on Home and for every upcoming trip. */
export const TripCard: React.FC<{ trip: TripDetails; now: number; onOpen: () => void }> = ({ trip, now, onOpen }) => {
  const when = tripWhen(trip);
  const day = dayLabel(trip.pickupAt, now);
  const active = tripIsActive(trip);
  // Opens the trip. Starting the journey itself happens inside, step by step, as the server allows each one.
  const cta = active ? 'Continue trip' : 'Open trip';
  const km = kmText(trip.distanceKm);
  return (
    <article className="panel next-card nx-compact-trip">
      <div className="next-top">
        <div>
          <div className="pickup-date">
            {day || when.date}
            {day === 'Today' || day === 'Tomorrow' ? ` · ${shortDate(trip.pickupAt)}` : ''}
          </div>
          <div className="pickup-time">{when.time || '—'}</div>
        </div>
        <span className={`badge ${active ? 'red' : 'green'}`}>
          <Icon name={active ? 'trip' : 'check'} />
          {tripStageLabel(trip)}
        </span>
      </div>
      <RouteStack pickup={trip.pickup.address} drop={trip.drop.address} />
      <div className="trip-facts">
        <span>
          <Icon name="car" />
          {trip.vehicleType || 'Cab'}
        </span>
        {km ? (
          <span>
            <Icon name="distance" />
            {km}
          </span>
        ) : null}
        {trip.serviceType ? (
          <span>
            <Icon name="clock" />
            {trip.serviceType}
          </span>
        ) : null}
      </div>
      <div className="next-bottom">
        <div className="nx-card-payout">
          <div>
            <small>Driver payout</small>
            <span>{payoutNote(trip)}</span>
          </div>
          <strong>{payoutLabel(trip)}</strong>
        </div>
        <button type="button" className="button primary full" onClick={onOpen}>
          {cta} <Icon name="arrow" />
        </button>
      </div>
    </article>
  );
};

export const EmptyState: React.FC<{ icon: Parameters<typeof Icon>[0]['name']; title: string; children?: React.ReactNode; action?: React.ReactNode }> = ({
  icon,
  title,
  children,
  action,
}) => (
  <div className="panel empty-state">
    <div className="empty-illustration">
      <Icon name={icon} />
    </div>
    <h3>{title}</h3>
    {children ? <p>{children}</p> : null}
    {action}
  </div>
);

export const InfoNote: React.FC<{ tone?: 'neutral' | 'amber'; children: React.ReactNode; role?: 'alert' | 'status' }> = ({ tone = 'neutral', children, role }) => (
  <div className={`info-note ${tone === 'amber' ? 'amber' : ''}`} role={role}>
    <Icon name="info" />
    <span>{children}</span>
  </div>
);
