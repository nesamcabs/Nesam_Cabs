import React, { useMemo, useState } from 'react';
import type { DriverEarningsSummary, LedgerEntry, TripDetails } from '../types';
import { Icon } from '../components/nx/Icon';
import { EmptyState } from '../components/nx/parts';
import { inr, placeName } from '../components/nx/format';
import { isEarning, tripEarningStatus } from '../services/driverEarnings';

interface EarningsScreenProps {
  earnings: DriverEarningsSummary;
  completedTrips: TripDetails[];
  ledger: LedgerEntry[];
  /** Fleet drivers are paid by their vendor, not by NESAM. */
  fleetDriver: boolean;
  fleetName?: string;
}

const STATUS_LABEL: Record<string, string> = { pending: 'Awaiting payment', available: 'In wallet', cancelled: 'Reversed' };

const dayName = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

export const EarningsScreen: React.FC<EarningsScreenProps> = ({ earnings, completedTrips, ledger, fleetDriver, fleetName }) => {
  const [period, setPeriod] = useState<'today' | 'week'>('today');

  // Credited earnings for the last 7 days, oldest first.
  const days = useMemo(() => {
    const out: { label: string; key: string; value: number }[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      out.push({ label: dayName(d), key: d.toDateString(), value: 0 });
    }
    for (const e of ledger) {
      if (!isEarning(e) || !e.createdAt) continue;
      const slot = out.find((d) => d.key === e.createdAt!.toDateString());
      if (slot) slot.value += e.amount;
    }
    return out;
  }, [ledger]);

  const max = Math.max(1, ...days.map((d) => d.value));
  const range = `${days[0].label} – ${days[6].label}`;
  const waiting = completedTrips.filter((t) => tripEarningStatus(ledger, t.id) !== 'available' && !t.fleetTrip);
  const waitingTotal = waiting.reduce((s, t) => s + (t.driverEarnings ?? 0), 0);
  const recent = completedTrips.slice(0, 8);

  if (fleetDriver) {
    return (
      <div className="two-columns">
        <section className="panel page-card">
          <div className="card-heading">
            <div>
              <h2>Paid by your fleet</h2>
              <p>{fleetName || 'Your fleet operator'}</p>
            </div>
            <span className="badge neutral">Fleet driver</span>
          </div>
          <div className="info-note">
            <Icon name="info" />
            <span>{fleetName || 'Your fleet operator'} receives the payout for trips you drive for them and settles your pay directly. NESAM does not hold a wallet balance for you.</span>
          </div>
        </section>
        <section className="panel page-card">
          <div className="card-heading">
            <div>
              <h2>Completed trips</h2>
              <p>{completedTrips.length} trip{completedTrips.length === 1 ? '' : 's'}</p>
            </div>
            <Icon name="chart" />
          </div>
          <TripLedger trips={recent} ledger={ledger} fleetDriver />
        </section>
      </div>
    );
  }

  const isWeek = period === 'week';
  return (
    <>
      <div className="page-tabs" role="group" aria-label="Earnings period">
        <button type="button" className={`pill-button ${!isWeek ? 'active' : ''}`} aria-pressed={!isWeek} onClick={() => setPeriod('today')}>
          Today
        </button>
        <button type="button" className={`pill-button ${isWeek ? 'active' : ''}`} aria-pressed={isWeek} onClick={() => setPeriod('week')}>
          Last 7 days
        </button>
      </div>
      <div className="two-columns">
        <section className="panel page-card">
          <div className="card-heading">
            <div>
              <h2>{isWeek ? 'Credited weekly earnings' : 'Today’s credited earnings'}</h2>
              <p>{isWeek ? range : dayName(new Date())}</p>
            </div>
            <span className="badge green">Credited</span>
          </div>
          <div className="chart-total">{inr(isWeek ? earnings.thisWeekEarnings : earnings.todayEarnings)}</div>
          {isWeek ? (
            <div className="chart" role="img" aria-label={`Credited daily earnings, ${range}: ${days.map((d) => `${d.label} ${Math.round(d.value)} rupees`).join(', ')}.`}>
              {days.map((d, i) => (
                <div className="bar-column" key={d.key}>
                  <div className="bar-track">
                    <div className={`bar ${i === 6 ? 'current' : ''}`} style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }} />
                  </div>
                  <small>{d.label.slice(0, 6)}</small>
                </div>
              ))}
            </div>
          ) : (
            <div className="info-note">
              <Icon name="info" />
              <span>The payout for a trip is credited once NESAM verifies the trip fare. Approved toll receipts are reimbursed in full.</span>
            </div>
          )}
          <div className="detail-list">
            <div className="detail-line">
              <span>This month</span>
              <strong>{inr(earnings.thisMonthEarnings)}</strong>
            </div>
            <div className="detail-line">
              <span>Lifetime</span>
              <strong>{inr(earnings.lifetimeEarnings)}</strong>
            </div>
            {earnings.tollReimbursements > 0 ? (
              <div className="detail-line">
                <span>Toll reimbursements</span>
                <strong>{inr(earnings.tollReimbursements)}</strong>
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel page-card">
          <div className="card-heading">
            <div>
              <h2>Pending settlement review</h2>
              <p>
                {waiting.length} completed trip{waiting.length === 1 ? '' : 's'} not credited yet
              </p>
            </div>
            <Icon name="clock" />
          </div>
          <div className="chart-total">{inr(waitingTotal)}</div>
          <p className="profile-note">Agreed driver payouts only. NESAM verifies customer collections before settlement.</p>
        </section>

        <section className="panel page-card">
          <div className="card-heading">
            <div>
              <h2>Completed trips</h2>
              <p>
                {completedTrips.length} trip{completedTrips.length === 1 ? '' : 's'}
              </p>
            </div>
            <Icon name="chart" />
          </div>
          <TripLedger trips={recent} ledger={ledger} fleetDriver={false} />
        </section>
      </div>
    </>
  );
};

function TripLedger({ trips, ledger, fleetDriver }: { trips: TripDetails[]; ledger: LedgerEntry[]; fleetDriver: boolean }) {
  if (!trips.length) {
    return (
      <EmptyState icon="check" title="No completed trips yet">
        Finished trips and their payouts will appear here.
      </EmptyState>
    );
  }
  return (
    <div className="ledger-list">
      {trips.map((t) => {
        const status = tripEarningStatus(ledger, t.id);
        const date = t.completedAt ? dayName(t.completedAt) : t.scheduledDate || '—';
        return (
          <div className="ledger-item" key={t.id}>
            <div className="ledger-icon">
              <Icon name="car" />
            </div>
            <div>
              <strong>
                {placeName(t.pickup.address)} → {placeName(t.drop.address)}
              </strong>
              <small>
                {t.bookingId} · {date}
                {t.tollCharges > 0 ? ` · tolls ${inr(t.tollCharges)}${t.tollsApproved ? '' : ' (awaiting approval)'}` : ''}
              </small>
            </div>
            <div className="ledger-amount">
              <strong>{fleetDriver ? 'Fleet' : t.driverEarnings !== null ? `+${inr(t.driverEarnings)}` : '—'}</strong>
              <small>{fleetDriver ? 'Settled by fleet' : status ? STATUS_LABEL[status] || status : 'Not credited yet'}</small>
            </div>
          </div>
        );
      })}
    </div>
  );
}
