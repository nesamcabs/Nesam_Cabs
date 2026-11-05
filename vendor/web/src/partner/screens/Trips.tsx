// Trips — "Find your next duty." Open marketplace duties for this vendor (reference wTrips / qDutyRow / accept + bid sheets).
import React, { useMemo, useState } from 'react';
import { usePartner } from '../../state/Partner';
import type { BidProposal, OpenTrip } from '../../types';
import { Icon } from '../Icon';
import { Btn, Check, Dialog, Empty, ErrorLine, ExtraTag, Field, KV, Notice, Obligation, PageHeading } from '../ui';
import { day, dayTime, isoDay, rupees, time } from '../format';
import { docKind, driverDocState, stageOf, vehicleDocState } from '../derive';
import { useWorkspace } from '../Workspace';

const TRIP_TYPES = ['All', 'One Way', 'Round Trip', 'Multicity', 'Local Rental'];
const OPEN_BID = (b: BidProposal) => b.status === 'Pending Review';

/** When a vendor accepting now would have to confirm the driver and vehicle (same rule as the server). */
function assignByIfAcceptedNow(t: OpenTrip, windowH: number, beforeH: number): Date {
  const now = Date.now();
  const byWindow = now + windowH * 3600000;
  const pickup = t.pickupAt?.getTime();
  if (!pickup) return new Date(byWindow);
  const preferred = Math.min(byWindow, pickup - beforeH * 3600000);
  return new Date(preferred > now ? preferred : Math.min(byWindow, pickup));
}

export function useGate() {
  const p = usePartner();
  return p.penalties.find((x) => x.status === 'Pending' && !x.acknowledged) ?? null;
}

const DutyRow: React.FC<{ t: OpenTrip; onAccept: () => void; onBid: () => void; onBidDetail: (b: BidProposal) => void; onOpen?: () => void }> = ({ t, onAccept, onBid, onBidDetail, onOpen }) => {
  const p = usePartner();
  const bid = p.bids.find((b) => b.tripId === t.id && OPEN_BID(b));
  const canAccept = t.mode !== 'bid_review' && t.offeredPayout !== null;
  const canBid = t.mode !== 'accept_offer';
  return (
    <article className="q-duty-row s-duty-row" data-duty={t.bookingId}>
      <div className="q-duty-content">
        <div className="d-duty-pickup">
          <Icon name="calendar-days" /><span className="v-sr">Pickup: </span>
          <time dateTime={t.pickupAt?.toISOString()}>{t.pickupAt ? <>{day(t.pickupAt)} <span aria-hidden="true">·</span> {time(t.pickupAt)}</> : t.travelDate || 'Pickup time on request'}</time>
        </div>
        <h2 className="q-duty-route">{t.pickup.city || t.pickup.address || '—'} <span><Icon name="arrow-right" /></span> {t.drop.city || t.drop.address || '—'}</h2>
        <div className="q-duty-meta d-duty-meta">
          {t.tripType ? <span className="v-badge d-service">{t.tripType}</span> : null}
          <span className="d-category"><Icon name="car-front" /><span className="v-sr">Vehicle category: </span>{t.vehicleCategory || 'Any category'}</span>
        </div>
        {t.distanceKm ? <p className="d-included-km"><Icon name="route" />{Math.round(t.distanceKm)} km included</p> : null}
        <ExtraTag />
        <div className="q-rate"><span>Vendor payout</span><strong>{rupees(t.offeredPayout)}</strong></div>
        {bid ? <p className="q-bid-caption "><Icon name="Offer" />Your bid {rupees(bid.vendorCounterRate)} {bid.autoAcceptConsent ? null : <span>· Consent needed</span>}</p> : null}
        <button type="button" className="v-duty-id s-id" onClick={onOpen}>{t.bookingId}<Icon name="chevron-right" /></button>
      </div>
      <div className="q-duty-actions">
        {canAccept ? <Btn icon="AcceptDuty" onClick={onAccept}>Accept duty</Btn> : null}
        {bid ? <Btn style="bid" icon="Offer" onClick={() => onBidDetail(bid)}>View bid</Btn> : canBid ? <Btn style="bid" icon="Offer" onClick={onBid}>Place bid</Btn> : null}
      </div>
    </article>
  );
};

/** Accept, bid and bid-detail sheets shared by the list and the duty page. */
function useDutyDialogs() {
  const p = usePartner();
  const ws = useWorkspace();
  const gate = useGate();
  const [sheet, setSheet] = useState<null | { kind: 'accept'; trip: OpenTrip } | { kind: 'bid'; trip: OpenTrip } | { kind: 'bid-detail'; bid: BidProposal }>(null);

  const node = !sheet ? null
    : sheet.kind === 'accept' ? (gate
      ? <GateSheet trip={sheet.trip} onClose={() => setSheet(null)} onAck={() => { setSheet(null); ws.open({ kind: 'penalty', id: gate.id, returnTo: sheet.trip.id }, 'Wallet'); }} />
      : <AcceptSheet trip={sheet.trip} onClose={() => setSheet(null)} />)
    : sheet.kind === 'bid' ? (gate
      ? <GateSheet trip={sheet.trip} onClose={() => setSheet(null)} onAck={() => { setSheet(null); ws.open({ kind: 'penalty', id: gate.id, returnTo: sheet.trip.id }, 'Wallet'); }} />
      : <BidSheet trip={sheet.trip} existing={p.bids.find((b) => b.tripId === sheet.trip.id && OPEN_BID(b)) ?? null} onClose={() => setSheet(null)} />)
    : <BidDetailSheet bid={sheet.bid} onClose={() => setSheet(null)} onUpdate={(t) => setSheet({ kind: 'bid', trip: t })} />;

  return {
    node,
    accept: (trip: OpenTrip) => setSheet({ kind: 'accept', trip }),
    bid: (trip: OpenTrip) => setSheet({ kind: 'bid', trip }),
    bidDetail: (bid: BidProposal) => setSheet({ kind: 'bid-detail', bid }),
  };
}

export const TripsScreen: React.FC = () => {
  const p = usePartner();
  const ws = useWorkspace();
  const gate = useGate();
  const dialogs = useDutyDialogs();
  const [type, setType] = useState('All');
  const [date, setDate] = useState('');

  const pendingAssign = p.trips.filter((t) => stageOf(t) === 'Accepted').length;
  const docAlerts = p.drivers.filter((d) => docKind(driverDocState(d)) !== 'green' && driverDocState(d) !== 'Pending').length
    + p.vehicles.filter((v) => docKind(vehicleDocState(v)) !== 'green' && vehicleDocState(v) !== 'Pending').length;

  const groups = useMemo(() => {
    const list = p.openTrips
      .filter((t) => type === 'All' || t.tripType === type)
      .filter((t) => !date || isoDay(t.pickupAt) === date)
      .sort((a, b) => (a.pickupAt?.getTime() ?? Infinity) - (b.pickupAt?.getTime() ?? Infinity));
    const map = new Map<string, OpenTrip[]>();
    for (const t of list) {
      const k = isoDay(t.pickupAt) || 'later';
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return [...map.entries()];
  }, [p.openTrips, type, date]);

  const depositActive = p.deposit?.status === 'Active';

  return (
    <>
      <PageHeading title="Trips" subtitle="Find your next duty." />
      <div className="s-balance-summary">
        <button type="button" onClick={() => ws.go('Wallet')}>
          <Icon name="Wallet" />
          <span>Wallet<strong className={p.wallet.available < 0 ? 'q-negative' : ''}>{rupees(p.wallet.available)}</strong></span>
          <Icon name="chevron-right" />
        </button>
        <button type="button" onClick={() => ws.go('Wallet')}>
          <Icon name="shield-check" />
          <span>Security deposit<strong>{p.deposit ? (depositActive ? 'Active' : p.deposit.status) : 'Not recorded'}</strong></span>
          <i className={`s-status-dot ${depositActive ? 's-active' : ''}`} />
        </button>
      </div>

      {gate ? (
        <div className="q-gate-banner">
          <Icon name="circle-alert" />
          <div><strong>New duty acceptance needs attention</strong><p>Acknowledge your penalty notice before accepting a new duty.</p></div>
          <Btn style="secondary" icon="check-check" onClick={() => ws.open({ kind: 'penalty', id: gate.id }, 'Wallet')}>Acknowledge</Btn>
        </div>
      ) : null}

      {pendingAssign || docAlerts ? (
        <div className="q-quick-links">
          {pendingAssign ? <Btn style="text" icon="chevron-right" onClick={() => ws.go('Bookings', 'Accepted')}>{`${pendingAssign} assignment${pendingAssign === 1 ? '' : 's'} pending`}</Btn> : null}
          {docAlerts ? <Btn style="text" icon="chevron-right" onClick={() => ws.open({ kind: 'documents' }, 'Fleet')}>{`${docAlerts} document alert${docAlerts === 1 ? '' : 's'}`}</Btn> : null}
        </div>
      ) : null}

      <div className="s-trip-filters">
        <label className="v-service">
          <span>Trip type</span>
          <select id="v-service" value={type} onChange={(e) => setType(e.target.value)}>
            {TRIP_TYPES.map((s) => <option key={s} value={s}>{s === 'All' ? 'All trip types' : s}</option>)}
          </select>
        </label>
        <label className="q-date-field">
          <span>Pickup date</span>
          <input type="date" id="q-date" aria-label="Pickup date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {date ? <Btn style="text" icon="x" onClick={() => setDate('')}>Clear date</Btn> : null}
      </div>

      <div className="q-duty-list">
        {groups.length === 0 ? (
          p.openTrips.length
            ? <Empty title="No duties for this selection" action={<Btn style="secondary" icon="refresh-cw" onClick={() => { setType('All'); setDate(''); }}>Clear filters</Btn>}>Try another pickup date or trip type.</Empty>
            : <Empty title="No matching duties">New duties will appear here as soon as NESAM publishes them.</Empty>
        ) : groups.map(([k, list]) => (
          <section key={k} className="q-date-group" data-date={k}>
            <div className="q-date-heading"><h2>{k === 'later' ? 'Pickup date to be confirmed' : day(list[0]!.pickupAt)}</h2><span>{list.length} {list.length === 1 ? 'duty' : 'duties'}</span></div>
            {list.map((t) => (
              <DutyRow key={t.id} t={t} onAccept={() => dialogs.accept(t)} onBid={() => dialogs.bid(t)} onBidDetail={dialogs.bidDetail} onOpen={() => ws.open({ kind: 'duty', id: t.id }, 'Trips')} />
            ))}
          </section>
        ))}
      </div>
      {dialogs.node}
    </>
  );
};

export const DutyDetail: React.FC<{ id: string }> = ({ id }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const dialogs = useDutyDialogs();
  const t = p.openTrips.find((x) => x.id === id);
  if (!t) {
    const mine = p.trips.find((x) => x.id === id);
    return (
      <>
        <PageHeading title="Duty details" subtitle={id} action={<Btn style="secondary" icon="arrow-left" onClick={() => ws.go('Trips')}>Trips</Btn>} />
        <Empty title={mine ? 'This duty is in your Bookings' : 'This duty is no longer available'}
          action={mine ? <Btn icon="chevron-right" onClick={() => ws.open({ kind: 'booking', id }, 'Bookings')}>Open booking</Btn> : undefined}>
          {mine ? 'Assign your driver and vehicle from the booking.' : 'Another partner has taken it or NESAM withdrew it.'}
        </Empty>
      </>
    );
  }
  return (
    <>
      <PageHeading title="Duty details" subtitle={t.bookingId} action={<Btn style="secondary" icon="arrow-left" onClick={() => ws.go('Trips')}>Trips</Btn>} />
      <DutyRow t={t} onAccept={() => dialogs.accept(t)} onBid={() => dialogs.bid(t)} onBidDetail={dialogs.bidDetail} />
      <div className="v-stack v-mt">
        <section className="v-panel">
          <h2>Duty information</h2>
          <KV mt rows={[
            ['Pickup', dayTime(t.pickupAt)],
            ['Pickup area', t.pickup.address || '—'],
            ['Drop area', t.drop.address || '—'],
            ['Trip type', t.tripType || '—'],
            ['Vehicle category', t.vehicleCategory || '—'],
            ...(t.distanceKm ? [['Included distance', `${Math.round(t.distanceKm)} km`] as [string, string]] : []),
            ...(t.cutoffAt ? [['Offer closes', dayTime(t.cutoffAt)] as [string, string]] : []),
            ['How to take it', t.mode === 'bid_review' ? 'Bid — reviewed by NESAM' : t.mode === 'accept_offer' ? 'Accept the payout shown' : 'Accept or bid'],
          ]} />
        </section>
        {t.terms ? (
          <section className="v-panel">
            <h2>Published duty terms</h2>
            <KV mt rows={[
              ...Object.entries(t.terms.items).map(([k, v]) => [({ driverBata: 'Driver bata', toll: 'Toll', parking: 'Parking', stateTax: 'State tax', nightAllowance: 'Night allowance' } as Record<string, string>)[k] ?? k, v] as [string, string]),
              ...(t.terms.partnerExtraKm ? [['Extra km (partner)', `${rupees(t.terms.partnerExtraKm)} / km`] as [string, string]] : []),
            ]} />
          </section>
        ) : null}
      </div>
      {dialogs.node}
    </>
  );
};

const GateSheet: React.FC<{ trip: OpenTrip; onClose: () => void; onAck: () => void }> = ({ trip, onClose, onAck }) => (
  <Dialog title="Before accepting this duty" onClose={onClose}>
    <p className="v-modal-intro">{trip.bookingId} · {trip.route}</p>
    <Notice title="Action required" kind="amber" icon="circle-alert">Acknowledge your penalty notice before accepting a new duty.</Notice>
    <Btn full icon="check-check" onClick={onAck}>Acknowledge notice</Btn>
    <p className="s-dialog-explainer">Existing accepted and running duties continue. Return to this duty after resolving the requirement.</p>
  </Dialog>
);

const AcceptSheet: React.FC<{ trip: OpenTrip; onClose: () => void }> = ({ trip, onClose }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const by = assignByIfAcceptedNow(trip, p.ops.assignmentWindowHours, p.ops.assignBeforePickupHours);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await p.actions.acceptOffer(trip);
      onClose();
      ws.go('Bookings', 'Accepted');
      ws.say(`Duty ${trip.bookingId} accepted. Assign your driver and vehicle by ${dayTime(by)}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Accept duty" onClose={onClose} busy={busy}>
      <p className="v-modal-intro">{trip.route}</p>
      <KV rows={[['Pickup', dayTime(trip.pickupAt)], ['Vehicle category', trip.vehicleCategory || '—'], ['Trip type', trip.tripType || '—'], ['Vendor payout', rupees(trip.offeredPayout)]]} />
      <Obligation deadline={dayTime(by)} penalty={p.ops.missedAssignmentPenalty} />
      <p className="s-dialog-explainer">After acceptance, assign a driver, choose the vehicle and confirm the duty terms in Bookings.</p>
      <ErrorLine message={error} />
      <form onSubmit={submit}><Btn submit full icon="AcceptDuty" busy={busy}>Accept duty</Btn></form>
    </Dialog>
  );
};

const BidSheet: React.FC<{ trip: OpenTrip; existing: BidProposal | null; onClose: () => void }> = ({ trip, existing, onClose }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const [amount, setAmount] = useState(existing ? String(existing.vendorCounterRate) : '');
  const [note, setNote] = useState(existing?.biddingNote ?? '');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const validUntil = trip.cutoffAt ?? trip.pickupAt;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rate = Number(amount);
    if (!Number.isSafeInteger(rate) || rate <= 0) { setError('Enter your expected payout in whole rupees.'); return; }
    if (!consent) { setError('Confirm the automatic acceptance and assignment terms to place a bid.'); return; }
    setBusy(true);
    setError('');
    try {
      await p.actions.submitBid(trip, rate, note, true);
      onClose();
      ws.say(existing ? 'Bid updated.' : `Bid of ${rupees(rate)} placed for ${trip.bookingId}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={existing ? 'Update bid' : 'Place bid'} onClose={onClose} busy={busy}>
      <p className="v-modal-intro">{trip.route}</p>
      <div className="s-bid-offer"><span>Current vendor payout</span><strong>{rupees(trip.offeredPayout)}</strong></div>
      <form onSubmit={submit}>
        <Field label="Your expected payout (₹)">
          <input name="amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required min={1} max={1000000} step={1} placeholder={trip.offeredPayout ? `e.g. ${Math.round(trip.offeredPayout * 1.2)}` : 'e.g. 1800'} />
        </Field>
        {validUntil ? <p className="s-bid-valid"><Icon name="clock-3" />Valid until {dayTime(validUntil)}</p> : null}
        <Obligation deadlineLabel="Assignment window" deadline={`${p.ops.assignmentWindowHours} hours after auto acceptance`}
          help={`Confirm at least ${p.ops.assignBeforePickupHours} hour${p.ops.assignBeforePickupHours === 1 ? '' : 's'} before pickup where possible. Urgent duties must be assigned before pickup.`}
          penalty={p.ops.missedAssignmentPenalty} />
        <Field label="Note for the NESAM team (optional)">
          <textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Check checked={consent} onChange={setConsent}>
          Automatically accept this duty for my business when the approved payout reaches my bid or higher. I will confirm the driver and vehicle within the shown assignment window and understand the penalty for missing it.
        </Check>
        <ErrorLine message={error} />
        <Btn submit full icon="Offer" busy={busy}>{existing ? 'Update bid' : 'Place bid'}</Btn>
      </form>
    </Dialog>
  );
};

const BidDetailSheet: React.FC<{ bid: BidProposal; onClose: () => void; onUpdate: (t: OpenTrip) => void }> = ({ bid, onClose, onUpdate }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const trip = p.openTrips.find((t) => t.id === bid.tripId) ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const withdraw = async () => {
    setBusy(true);
    setError('');
    try {
      await p.actions.withdrawBid(bid);
      onClose();
      ws.say('Bid withdrawn.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Your bid" onClose={onClose} busy={busy}>
      <div className="v-between"><span className="v-badge v-neutral">{bid.bookingId || bid.tripId}</span><span className="v-badge v-neutral">{bid.status === 'Pending Review' ? 'Submitted' : bid.status}</span></div>
      <h3 className="v-modal-route">{trip?.route ?? bid.bookingId}</h3>
      <KV rows={[['Your minimum payout', rupees(bid.vendorCounterRate)], ['Current office offer', rupees(trip?.offeredPayout ?? bid.offeredPayout)], ...(bid.submittedAt ? [['Submitted', dayTime(bid.submittedAt)] as [string, string]] : [])]} />
      {bid.biddingNote ? <p className="v-small v-muted">Note: {bid.biddingNote}</p> : null}
      {!bid.autoAcceptConsent ? <Notice title="Auto allocation consent needed" icon="file-pen-line">Authorize automatic acceptance to update this bid.</Notice> : null}
      <ErrorLine message={error} />
      <div className="v-action-row v-mt">
        {trip && bid.status === 'Pending Review' ? <Btn icon="pencil" onClick={() => onUpdate(trip)}>Update bid</Btn> : null}
        {bid.status === 'Pending Review' ? <Btn style="secondary" icon="x" busy={busy} onClick={withdraw}>Withdraw bid</Btn> : null}
      </div>
    </Dialog>
  );
};
