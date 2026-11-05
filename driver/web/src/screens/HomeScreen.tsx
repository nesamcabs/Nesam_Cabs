import React, { useMemo, useState } from 'react';
import { PolicyShort } from '../components/nx/Cancellation';
import type { CancellationPolicy } from '../services/partnerRequests';
import type { DriverAccount, DriverEarningsSummary, MarketplaceOffer, TripDetails } from '../types';
import { Dialog } from '../components/nx/Dialog';
import { Icon } from '../components/nx/Icon';
import { InfoNote, EmptyState, RouteStack, TripCard } from '../components/nx/parts';
import { inr, kmText, offerWhen, placeName } from '../components/nx/format';
import { categoryMatches } from '../utils/offers';

interface HomeScreenProps {
  /** Duty cancellation policy shown before accepting (settings/operations). */
  cancelPolicy?: CancellationPolicy;
  onViewPolicy?: () => void;
  account: DriverAccount;
  now: number;
  online: boolean;
  presenceBusy: boolean;
  /** A trip is assigned or ongoing, so duty status and new trips are locked. */
  hasActiveTrip: boolean;
  trip: TripDetails | null;
  assignedCount: number;
  completedCount: number;
  offers: MarketplaceOffer[];
  acceptingId: string | null;
  onGoOnline: () => void;
  onAccept: (offer: MarketplaceOffer) => Promise<boolean>;
  /** Duties NESAM reviews bids on are taken with a counter amount instead of accepting. */
  onBid: (offer: MarketplaceOffer, rate: number, note: string) => Promise<boolean>;
  onWithdrawBid: (offer: MarketplaceOffer) => Promise<boolean>;
  onOpenTrip: (trip: TripDetails) => void;
  onNavigate: (page: 'trips' | 'profile' | 'earnings' | 'wallet') => void;
  earnings: DriverEarningsSummary;
  /** The server wallet's withdrawable balance. */
  walletAvailable: number;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  account,
  now,
  online,
  presenceBusy,
  hasActiveTrip,
  trip,
  assignedCount,
  completedCount,
  offers,
  acceptingId,
  onGoOnline,
  onAccept,
  onBid,
  onWithdrawBid,
  onOpenTrip,
  onNavigate,
  earnings,
  walletAvailable,
  cancelPolicy,
  onViewPolicy,
}) => {
  const { driver, vehicle } = account;
  const fleet = Boolean(driver.vendorId);
  const [showAll, setShowAll] = useState(false);
  const [dateFilter, setDateFilter] = useState('all');
  const [detail, setDetail] = useState<MarketplaceOffer | null>(null);
  const [bidRate, setBidRate] = useState('');
  const [bidNote, setBidNote] = useState('');
  const [bidError, setBidError] = useState('');
  const [bidBusy, setBidBusy] = useState(false);
  const bidOnly = detail?.mode === 'bid_review';

  const matching = useMemo(() => offers.filter((o) => categoryMatches(o.vehicleCategory, vehicle.vehicleType)), [offers, vehicle.vehicleType]);
  const pool = showAll ? offers : matching;
  const dates = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of pool) {
      const w = offerWhen(o);
      if (w.key && !seen.has(w.key)) seen.set(w.key, o.pickupAt ? o.pickupAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : w.date);
    }
    return [...seen.entries()];
  }, [pool]);
  const visible = pool.filter((o) => dateFilter === 'all' || offerWhen(o).key === dateFilter);
  const active = trip && (trip.subStatus !== 'Not Started' || trip.verificationSubmitted);

  const acceptDetail = async () => {
    if (!detail) return;
    const ok = await onAccept(detail);
    if (ok) setDetail(null);
  };

  const openDetail = (o: MarketplaceOffer) => {
    setDetail(o);
    setBidRate(o.offeredPayout !== null ? String(o.offeredPayout) : '');
    setBidNote('');
    setBidError('');
  };

  const sendBid = async () => {
    if (!detail) return;
    const rate = Number(bidRate);
    if (!Number.isFinite(rate) || rate <= 0 || Math.abs(rate * 100 - Math.round(rate * 100)) > 1e-6) return setBidError('Enter your counter amount in rupees (up to 2 decimals).');
    setBidError('');
    setBidBusy(true);
    try {
      if (await onBid(detail, rate, bidNote)) setDetail(null);
    } finally {
      setBidBusy(false);
    }
  };

  const withdrawBid = async () => {
    if (!detail) return;
    setBidBusy(true);
    try {
      if (await onWithdrawBid(detail)) setDetail(null);
    } finally {
      setBidBusy(false);
    }
  };

  let duties: React.ReactNode;
  if (fleet) {
    duties = (
      <EmptyState icon="car" title="Trips come from your fleet">
        {driver.vendorName || 'Your fleet operator'} takes marketplace trips and assigns them to you. Assigned trips appear on this screen.
      </EmptyState>
    );
  } else if (!online) {
    duties = (
      <EmptyState
        icon="power"
        title="You’re taking a break."
        action={
          <button type="button" className="button primary" onClick={onGoOnline} disabled={presenceBusy}>
            Go online <Icon name="arrow" />
          </button>
        }
      >
        Go online to browse and accept new duties. Your assigned trips stay available.
      </EmptyState>
    );
  } else if (hasActiveTrip) {
    duties = (
      <EmptyState icon="trip" title="Finish your current trip">
        New duties appear here once you complete it.
      </EmptyState>
    );
  } else if (!visible.length) {
    duties = (
      <EmptyState icon="trip" title={pool.length ? 'No duties on this date' : 'You’re all caught up.'}>
        {pool.length ? 'Choose another date to see open duties.' : 'New duties appear here instantly — stay online.'}
      </EmptyState>
    );
  } else {
    duties = (
      <div className="duties-list">
        {visible.map((o) => {
          const w = offerWhen(o);
          const mismatch = !categoryMatches(o.vehicleCategory, vehicle.vehicleType);
          return (
            <article className="panel duty-card" key={o.id}>
              <div className="duty-meta">
                <span className="duty-date">
                  <Icon name="calendar" />
                  {w.date}
                  {w.time ? ` · ${w.time}` : ''}
                </span>
                <span className={`badge ${mismatch ? 'amber' : 'neutral'}`}>{o.mode === 'bid_review' ? 'Bid' : o.vehicleCategory || 'Any vehicle'}</span>
              </div>
              <h3 className="duty-route">
                {placeName(o.pickup.address)} <Icon name="arrow" /> {placeName(o.drop.address)}
              </h3>
              <div className="duty-info">
                <span>
                  <Icon name="car" />
                  {vehicle.vehicleType}
                </span>
                {o.distanceKm > 0 ? (
                  <span>
                    <Icon name="distance" />
                    {kmText(o.distanceKm)}
                  </span>
                ) : null}
              </div>
              {mismatch ? (
                <div className="schedule-note">
                  <Icon name="info" />
                  Booked as {o.vehicleCategory} — accept only if your vehicle qualifies
                </div>
              ) : null}
              <div className="duty-bottom">
                <div className="duty-payout">
                  <small>Driver payout</small>
                  <strong>{o.offeredPayout !== null ? inr(o.offeredPayout) : 'Under review'}</strong>
                </div>
                <button type="button" className={`button ${mismatch ? 'secondary' : 'soft'}`} onClick={() => openDetail(o)}>
                  View details <Icon name="arrow" />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  const detailWhen = detail ? offerWhen(detail) : null;
  const detailAccepting = detail ? acceptingId === detail.id : false;
  const cannotAccept = !online ? (bidOnly ? 'Go online to bid' : 'Go online to accept') : hasActiveTrip ? 'You already have an active trip' : detail && detail.offeredPayout === null ? 'Payout under review' : '';

  const metrics = (
    <div className="metrics" aria-label="Today at a glance">
      {fleet ? (
        <button type="button" className="metric-card primary" onClick={() => onNavigate('trips')}>
          <span className="metric-top">
            Earnings <Icon name="chart" />
          </span>
          <div className="metric-value" style={{ fontSize: 17 }}>Paid by your fleet</div>
          <span className="metric-foot">{driver.vendorName || 'Your fleet operator'} settles your pay</span>
        </button>
      ) : (
        <button type="button" className="metric-card primary" onClick={() => onNavigate('earnings')}>
          <span className="metric-top">
            Today’s earnings <Icon name="chart" />
          </span>
          <div className="metric-value">{inr(earnings.todayEarnings)}</div>
          <span className="metric-foot">Credited, incl. tolls · 7 days {inr(earnings.thisWeekEarnings)}</span>
        </button>
      )}
      <button type="button" className="metric-card" onClick={() => onNavigate('trips')}>
        <span className="metric-top">
          Completed trips <Icon name="check" />
        </span>
        <div className="metric-value">{completedCount}</div>
        <span className="metric-foot">
          {driver.rating !== null ? `Rating ★ ${driver.rating.toFixed(1)}` : 'No ratings yet'} <Icon name="chevron" />
        </span>
      </button>
      {fleet ? null : (
        <button type="button" className="metric-card" onClick={() => onNavigate('wallet')}>
          <span className="metric-top">
            Wallet balance <Icon name="wallet" />
          </span>
          <div className="metric-value">{inr(walletAvailable)}</div>
          <span className="metric-foot">
            Available to withdraw <Icon name="chevron" />
          </span>
        </button>
      )}
      <button type="button" className="metric-card" onClick={() => onNavigate('trips')}>
        <span className="metric-top">
          Upcoming trips <Icon name="calendar" />
        </span>
        <div className="metric-value">{String(assignedCount).padStart(2, '0')}</div>
        <span className="metric-foot">
          Your confirmed duties <Icon name="chevron" />
        </span>
      </button>
    </div>
  );

  return (
    <div className="nx-home">
      {driver.docStatus === 'Rejected' ? (
        <div className="panel page-card" style={{ marginBottom: 18 }} role="alert">
          <div className="card-heading" style={{ marginBottom: 12 }}>
            <div>
              <h2>Document update required</h2>
              <p>{driver.rejectionReason || 'Some of your updated documents were not accepted. Please upload them again.'}</p>
            </div>
            <span className="badge red">
              <Icon name="info" />
              Action needed
            </span>
          </div>
          <button type="button" className="button primary" onClick={() => onNavigate('profile')}>
            View documents <Icon name="arrow" />
          </button>
        </div>
      ) : null}
      {metrics}
      <div className="dashboard-grid">
        <section aria-labelledby="next-trip-heading">
          <div className="section-heading">
            <h2 id="next-trip-heading">{active ? 'Your current trip' : 'Your next trip'}</h2>
            <button type="button" className="text-button" onClick={() => onNavigate('trips')}>
              My Trips ({assignedCount}) <Icon name="chevron" className="icon-sm" />
            </button>
          </div>
          {trip ? (
            <TripCard trip={trip} now={now} onOpen={() => onOpenTrip(trip)} />
          ) : (
            <EmptyState
              icon="check"
              title={completedCount ? 'All assigned trips completed' : 'No active assigned trips'}
              action={
                <button type="button" className="button secondary" onClick={() => onNavigate('trips')}>
                  View trip history
                </button>
              }
            >
              Browse available duties or review your trip history.
            </EmptyState>
          )}
        </section>

        <section aria-labelledby="available-heading">
          <div className="section-heading">
            <div>
              <h2 id="available-heading">
                Available duties <span className="badge red">{fleet || !online || hasActiveTrip ? 0 : visible.length} open</span>
              </h2>
              <p>{showAll ? 'All open duties' : `Duties eligible for your ${vehicle.vehicleType}`}</p>
            </div>
            {!fleet ? (
              <select className="filter-select" aria-label="Filter duties by pickup date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} disabled={!online || hasActiveTrip}>
                <option value="all">All dates</option>
                {dates.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {duties}
          {!fleet && online && !hasActiveTrip ? (
            <p className="list-note" style={{ alignItems: 'center' }}>
              <Icon name="info" />
              <span>
                Payouts are shown before you accept. Tolls, parking and state tax are paid by the customer at actual cost.{' '}
                <button type="button" className="text-button" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 40, verticalAlign: 'middle' }} onClick={() => { setShowAll((v) => !v); setDateFilter('all'); }}>
                  {showAll ? 'Only my category' : `Show all duties (${offers.length})`}
                </button>
              </span>
            </p>
          ) : null}
        </section>
      </div>

      <Dialog
        open={detail !== null}
        onClose={() => setDetail(null)}
        eyebrow={detail?.bookingId ?? ''}
        title="Available duty"
        locked={detailAccepting || bidBusy}
        footer={
          bidOnly ? (
            <>
              <button type="button" className="button primary full" onClick={() => void sendBid()} disabled={Boolean(cannotAccept) || bidBusy}>
                {bidBusy ? 'Sending…' : cannotAccept || 'Send bid for review'} <Icon name="check" />
              </button>
              <button type="button" className="text-button" style={{ justifySelf: 'center' }} onClick={() => void withdrawBid()} disabled={bidBusy}>
                Withdraw my earlier bid
              </button>
              <p className="dialog-footnote">NESAM reviews bids. The duty is assigned to you only if your bid is accepted.</p>
            </>
          ) : (
            <>
              <button type="button" className="button primary full" onClick={() => void acceptDetail()} disabled={Boolean(cannotAccept) || acceptingId !== null}>
                {detailAccepting ? 'Accepting…' : cannotAccept || 'Accept duty'} <Icon name="check" />
              </button>
              <p className="dialog-footnote">Accepting assigns this duty to you right away.</p>
              {cancelPolicy && onViewPolicy ? <PolicyShort policy={cancelPolicy} onView={onViewPolicy} /> : null}
            </>
          )
        }
      >
        {detail ? (
          <>
            <div className="detail-payout">
              <div>
                <small>{bidOnly ? 'NESAM offer' : 'Your payout'}</small>
              </div>
              <strong>{detail.offeredPayout !== null ? inr(detail.offeredPayout) : 'Under review'}</strong>
            </div>
            <RouteStack pickup={detail.pickup.address} drop={detail.drop.address} />
            <div className="detail-list">
              <div className="detail-line">
                <span>Pickup date</span>
                <strong>{detailWhen?.date}</strong>
              </div>
              {detailWhen?.time ? (
                <div className="detail-line">
                  <span>Pickup time</span>
                  <strong>{detailWhen.time} IST</strong>
                </div>
              ) : null}
              <div className="detail-line">
                <span>Vehicle / route</span>
                <strong>
                  {detail.vehicleCategory || 'Any vehicle'}
                  {detail.distanceKm > 0 ? ` · ${kmText(detail.distanceKm)} estimate` : ''}
                </strong>
              </div>
            </div>
            {bidOnly ? (
              <div className="nx-bid-form">
                <label className="nx-cancel-field" htmlFor="bid-rate">
                  Your counter amount (₹)
                  <input id="bid-rate" type="number" inputMode="decimal" min={1} step="0.01" value={bidRate} onChange={(e) => { setBidRate(e.target.value); setBidError(''); }} />
                </label>
                <label className="nx-cancel-field" htmlFor="bid-note">
                  Note for NESAM (optional)
                  <textarea id="bid-note" maxLength={300} value={bidNote} onChange={(e) => setBidNote(e.target.value)} />
                </label>
                <div className="nx-cancel-error" role="alert">{bidError}</div>
              </div>
            ) : null}
            <InfoNote>Toll, parking and state tax are paid by the customer at actual cost. Record tolls with their receipt at the end of the trip.</InfoNote>
            {!categoryMatches(detail.vehicleCategory, vehicle.vehicleType) ? (
              <InfoNote tone="amber">Booked as {detail.vehicleCategory}. Accept only if your {vehicle.vehicleType} qualifies.</InfoNote>
            ) : null}
            {hasActiveTrip ? <InfoNote tone="amber">You already have an active trip. Finish it before accepting another.</InfoNote> : null}
          </>
        ) : null}
      </Dialog>
    </div>
  );
};
