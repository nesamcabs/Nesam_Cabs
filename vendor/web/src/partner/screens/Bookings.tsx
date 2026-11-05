// Bookings — accepted duties and the assigned team (reference vBookings, booking details, 3-step assignment, cancellation).
import React, { useMemo, useState } from 'react';
import { usePartner } from '../../state/Partner';
import type { PartnerRequestRecord, VendorTrip } from '../../types';
import { Icon } from '../Icon';
import { Badge, Btn, Check, CountTabs, Dialog, Empty, ErrorLine, ExtraTag, Field, KV, Notice, Obligation, PageHeading } from '../ui';
import { carCode, day, dayTime, driverCode, plate, rupees, time } from '../format';
import { assignDeadline, canChangeTeam, driverBlocker, stageOf, stateLabel, vehicleBlocker, type BookingStage } from '../derive';
import { CANCEL_REASONS, quoteCancellation, requestCancellation } from '../services';
import { StatementSheet } from './Money';
import { useWorkspace } from '../Workspace';

const SERVICES = ['All', 'One Way', 'Round Trip', 'Airport', 'Multicity', 'Local Rental'];
const TABS: BookingStage[] = ['Accepted', 'Upcoming', 'On Trip', 'Completed'];
const STAGE_BADGE: Record<BookingStage, ['neutral' | 'green' | 'amber' | 'red', string]> = {
  Accepted: ['amber', 'Accepted'], Upcoming: ['neutral', 'Driver assigned'], 'On Trip': ['red', 'Trip in progress'], Completed: ['green', 'Completed'], Cancelled: ['neutral', 'Cancelled'],
};

const routeOf = (t: VendorTrip) => [t.pickupLabel || t.pickupAddress, t.dropLabel || t.dropAddress];

export const BookingsScreen: React.FC<{ initialTab?: string }> = ({ initialTab }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const [tab, setTab] = useState<BookingStage>((['Accepted', 'Upcoming', 'On Trip', 'Completed', 'Cancelled'] as string[]).includes(initialTab ?? '') ? initialTab as BookingStage : 'Accepted');
  const [search, setSearch] = useState('');
  const [service, setService] = useState('All');

  const counts = useMemo(() => {
    const c: Record<BookingStage, number> = { Accepted: 0, Upcoming: 0, 'On Trip': 0, Completed: 0, Cancelled: 0 };
    for (const t of p.trips) c[stageOf(t)]++;
    return c;
  }, [p.trips]);

  const accepted = p.trips.filter((t) => stageOf(t) === 'Accepted');
  const nextDeadline = accepted.map((t) => assignDeadline(t, p.ops)).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  const q = search.trim().toLowerCase();
  const list = p.trips
    .filter((t) => stageOf(t) === tab)
    .filter((t) => service === 'All' || t.tripType === service)
    .filter((t) => !q || `${t.bookingId} ${t.pickupLabel} ${t.dropLabel} ${t.pickupAddress} ${t.dropAddress}`.toLowerCase().includes(q))
    .sort((a, b) => (tab === 'Completed' ? -1 : 1) * ((a.pickupAt?.getTime() ?? 0) - (b.pickupAt?.getTime() ?? 0)));

  // Duties the office released after an approved partner cancellation are no longer readable as bookings.
  const released = p.requests.filter((r) => r.type === 'cancellation' && r.status === 'Approved' && !p.trips.some((t) => t.id === r.bookingId));

  return (
    <div className="q-bookings">
      <PageHeading title="Bookings" subtitle="Manage accepted duties and your assigned team."
        action={tab === 'Cancelled'
          ? <Btn style="text" icon="chevron-right" onClick={() => setTab('Accepted')}>Accepted bookings</Btn>
          : <Btn style="text" icon="chevron-right" onClick={() => setTab('Cancelled')}>Cancelled history</Btn>} />
      {accepted.length ? (
        <div className={`u-pending-summary ${nextDeadline && nextDeadline.getTime() < Date.now() ? 'u-overdue' : ''}`}>
          <span className="u-pending-symbol"><Icon name="AssignDriver" /></span>
          <div><strong>{accepted.length} {accepted.length === 1 ? 'duty needs' : 'duties need'} assignment</strong>{nextDeadline ? <p>Next deadline {dayTime(nextDeadline)}</p> : null}</div>
        </div>
      ) : null}
      {tab !== 'Cancelled'
        ? <CountTabs label="Booking status" value={tab} onChange={setTab} items={TABS.map((id) => ({ id, label: id, count: counts[id] }))} />
        : <PageHeading title="Cancelled history" subtitle="Office-approved cancellations and cancelled bookings." />}
      <div className="v-toolbar">
        <label className="v-search"><Icon name="search" /><input id="v-search" type="search" aria-label="Search route or Duty ID" placeholder="Search route or Duty ID" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <label className="v-service"><span className="v-sr">Service type</span>
          <select id="v-service" value={service} onChange={(e) => setService(e.target.value)}>{SERVICES.map((s) => <option key={s} value={s}>{s === 'All' ? 'All services' : s}</option>)}</select>
        </label>
      </div>
      {tab === 'Cancelled' ? (
        list.length || released.length ? (
          <div className="v-card-grid">
            {list.map((t) => <BookingCard key={t.id} t={t} />)}
            {released.map((r) => <ReleasedCard key={r.id} r={r} />)}
          </div>
        ) : <Empty title="No cancelled bookings">Driver updates and office decisions keep this list up to date.</Empty>
      ) : list.length ? (
        <div className="v-card-grid">{list.map((t) => <BookingCard key={t.id} t={t} />)}</div>
      ) : (
        <Empty title={`No ${tab.toLowerCase()} bookings`} action={tab === 'Accepted' ? <Btn style="secondary" icon="chevron-right" onClick={() => ws.go('Trips')}>Find duties</Btn> : undefined}>
          {tab === 'Accepted' ? 'Accept a duty from Trips, then assign your driver and vehicle here.' : 'Driver updates and office decisions keep this list up to date.'}
        </Empty>
      )}
    </div>
  );
};

const BookingCard: React.FC<{ t: VendorTrip }> = ({ t }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const st = stageOf(t);
  const [from, to] = routeOf(t);
  const deadline = st === 'Accepted' ? assignDeadline(t, p.ops) : null;
  const [kind, label] = STAGE_BADGE[st];
  return (
    <article className="v-duty-card s-booking-card" data-duty={t.bookingId}>
      <div className="s-booking-top">
        <div className="d-duty-pickup"><Icon name="calendar-days" /><span className="v-sr">Pickup: </span>
          <time dateTime={t.pickupAt?.toISOString()}>{t.pickupAt ? <>{day(t.pickupAt)} <span aria-hidden="true">·</span> {time(t.pickupAt)}</> : t.scheduledTime || '—'}</time>
        </div>
        <Badge kind={kind}>{t.cancellationRequest?.status === 'Pending' ? 'Cancellation under review' : label}</Badge>
      </div>
      <h2 className="q-duty-route">{from || '—'} <Icon name="arrow-right" /> {to || '—'}</h2>
      <div className="q-duty-meta d-duty-meta">
        {t.tripType ? <span className="v-badge d-service">{t.tripType}</span> : null}
        {t.vehicleCategory ? <span className="d-category"><Icon name="car-front" /><span className="v-sr">Vehicle category: </span>{t.vehicleCategory}</span> : null}
      </div>
      {t.includedKm ? <p className="d-included-km"><Icon name="route" />{t.includedKm} km included</p> : null}
      <div className="s-pending-team">
        <span><Icon name="user-round" />{t.driverName || 'Driver pending'}</span>
        <span><Icon name="car-front" />{t.vehicleNumber ? plate(t.vehicleNumber) : 'Vehicle pending'}</span>
      </div>
      {deadline ? <p className={`v-card-note ${deadline.getTime() < Date.now() ? 'v-red-text' : 'v-amber-text'}`}><Icon name="clock-3" />{deadline.getTime() < Date.now() ? 'Assignment overdue since ' : 'Assign by '}{dayTime(deadline)}</p> : null}
      <ExtraTag />
      <div className="s-booking-bottom">
        <div className="q-rate"><span>Vendor payout</span><strong>{rupees(t.vendorPayout)}</strong></div>
        {st === 'Accepted'
          ? <Btn icon="AssignDriver" onClick={() => ws.open({ kind: 'assign', id: t.id }, 'Bookings')}>Assign driver</Btn>
          : st === 'Completed'
            ? <Btn style="secondary" icon="receipt-text" onClick={() => ws.open({ kind: 'booking', id: t.id }, 'Bookings')}>View statement</Btn>
            : <Btn style="secondary" icon="chevron-right" onClick={() => ws.open({ kind: 'booking', id: t.id }, 'Bookings')}>View booking</Btn>}
      </div>
      <button type="button" className="v-duty-id s-id" onClick={() => ws.open({ kind: 'booking', id: t.id }, 'Bookings')}>{t.bookingId}<Icon name="chevron-right" /></button>
    </article>
  );
};

const ReleasedCard: React.FC<{ r: PartnerRequestRecord }> = ({ r }) => (
  <article className="v-duty-card s-booking-card">
    <div className="s-booking-top"><span className="v-small v-muted">{dayTime(r.decidedAt)}</span><Badge>Cancelled by NESAM</Badge></div>
    <h2 className="q-duty-route">{r.route}</h2>
    <p className="v-small v-muted">{r.bookingCode} · {r.reasonLabel}</p>
    <div className="s-booking-bottom">
      <div className="q-rate"><span>{r.finalPenalty ? 'Cancellation charge' : 'No cancellation charge'}</span><strong>{rupees(r.finalPenalty ?? 0)}</strong></div>
    </div>
    {r.adminReason ? <p className="v-small v-muted">{r.adminReason}</p> : null}
  </article>
);

export const BookingDetail: React.FC<{ id: string }> = ({ id }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const [sheet, setSheet] = useState<'' | 'cancel' | 'terms' | 'statement'>('');
  const t = p.trips.find((x) => x.id === id);
  if (!t) {
    const r = p.requests.find((x) => x.bookingId === id && x.type === 'cancellation');
    return (
      <>
        <PageHeading title="Booking details" subtitle={r?.bookingCode ?? id} action={<Btn style="secondary" icon="arrow-left" onClick={() => ws.go('Bookings')}>Bookings</Btn>} />
        <Empty title={r?.status === 'Approved' ? 'Duty cancelled by NESAM' : 'Booking not found'}>
          {r?.status === 'Approved' ? `${r.adminReason} Charge: ${rupees(r.finalPenalty ?? 0)}.` : 'This booking is no longer assigned to your business.'}
        </Empty>
      </>
    );
  }
  const st = stageOf(t);
  const [stLabel, stKind] = stateLabel(t);
  const [from, to] = routeOf(t);
  const deadline = assignDeadline(t, p.ops);
  const changeable = canChangeTeam(t);
  const req = p.requests.find((r) => r.bookingId === t.id && r.type === 'cancellation') ?? null;
  const due = p.dues.find((d) => d.id === t.id) ?? null;
  const response = t.driverResponse;

  return (
    <>
      <PageHeading title="Booking details" subtitle={t.bookingId} action={<Btn style="secondary" icon="arrow-left" onClick={() => ws.go('Bookings')}>Bookings</Btn>} />
      <div className="v-detail-grid">
        <div className="v-stack">
          <section className="v-panel w-booking-route">
            <div className="v-between">
              <div className="v-inline">{t.tripType ? <Badge>{t.tripType}</Badge> : null}{t.vehicleCategory ? <Badge>{t.vehicleCategory}</Badge> : null}</div>
              <Badge kind={stKind}>{stLabel}</Badge>
            </div>
            <div className="v-route-stack">
              <div><i /><strong>{from || '—'}<small>Pickup · {t.pickupAt ? `${day(t.pickupAt)} · ${time(t.pickupAt)}` : t.scheduledTime || '—'}</small></strong></div>
              <div><i /><strong>{to || '—'}<small>{t.completedAt ? `Trip ended · ${dayTime(t.completedAt)}` : 'Drop'}</small></strong></div>
            </div>
            <KV rows={[...(t.includedKm ? [['Included distance', `${t.includedKm} km`] as [string, string]] : []), ['Vehicle category', t.vehicleCategory || '—']]} />
          </section>

          {req && req.status !== 'Approved' ? <CancellationStatus r={req} /> : null}

          {st === 'Accepted' ? (
            <section className="v-panel s-assignment-entry">
              <div className="v-between"><h2>Driver assignment</h2><Badge kind="amber">Pending</Badge></div>
              <p className="s-assignment-caption">Choose your driver, then the vehicle. Review the duty terms before confirming.</p>
              <Obligation deadline={deadline ? dayTime(deadline) : 'Before pickup'} penalty={p.ops.missedAssignmentPenalty} />
              <Btn icon="AssignDriver" onClick={() => ws.open({ kind: 'assign', id: t.id })}>Assign driver</Btn>
            </section>
          ) : st === 'Upcoming' ? (
            <section className="v-panel s-assignment-entry">
              <div className="v-between"><h2>Assigned team</h2><Badge kind="green">Confirmed</Badge></div>
              <div className="s-pending-team"><span><Icon name="user-round" />{t.driverName || 'Driver'}</span><span><Icon name="car-front" />{plate(t.vehicleNumber)}</span></div>
              {changeable ? <Btn icon="AssignDriver" onClick={() => ws.open({ kind: 'assign', id: t.id })}>Change driver or vehicle</Btn> : null}
            </section>
          ) : t.driverId ? (
            <section className="v-panel">
              <h2>Assigned driver &amp; vehicle</h2>
              <KV mt rows={[['Driver', t.driverName || '—'], ['Driver ID', driverCode(t.driverId)], ['Vehicle', plate(t.vehicleNumber) || '—'], ['Car ID', t.vehicleId ? carCode(t.vehicleId) : '—']]} />
            </section>
          ) : null}

          {t.driverId && st !== 'Cancelled' ? (
            <section className="v-panel">
              <h2>Driver response</h2>
              <div className="w-response-steps">
                <Badge kind="green">Sent</Badge>
                <Badge kind={response?.viewedAt ? 'green' : 'neutral'}>{response?.viewedAt ? 'Viewed' : 'Not viewed'}</Badge>
                <Badge kind={response?.acknowledgedAt || st === 'On Trip' || st === 'Completed' ? 'green' : 'neutral'}>{response?.acknowledgedAt || st === 'On Trip' || st === 'Completed' ? 'Acknowledged' : 'Awaiting acknowledgement'}</Badge>
              </div>
              <p className="v-small v-muted v-mt">Trip start and end updates come from the assigned driver’s app. Customer contact unlocks 8 hours before pickup.</p>
              <KV mt rows={[
                ['Trip progress', t.tripSubStatus || 'Not started'],
                ['Vehicle photos', t.verificationSubmitted ? `Submitted${t.verificationRisk ? ` · ${t.verificationRisk} risk` : ''}` : 'Not yet'],
                ['Customer', t.customerName || '—'],
                ['Customer mobile', t.customerPhoneMasked || 'Shared with the driver before pickup'],
              ]} />
            </section>
          ) : null}

          {st === 'On Trip' ? (
            <section className="v-panel"><h2>Trip in progress</h2><p className="v-small v-muted v-mt">Contact the office for any driver or vehicle change during a running trip.</p>
              <div className="v-action-row v-mt"><a className="v-button v-secondary q-button" href={`tel:${p.ops.supportPhone}`}><Icon name="phone" /><span>Call NESAM office</span></a></div>
            </section>
          ) : null}

          {changeable && !req ? (
            <section className="v-panel">
              <h2>Need office assistance?</h2>
              <div className="v-action-row v-mt">
                <Btn style="secondary" icon="circle-x" onClick={() => setSheet('cancel')}>Request cancellation</Btn>
                <Btn style="text" icon="chevron-right" onClick={() => ws.go('Helpdesk')}>24/7 Helpdesk</Btn>
              </div>
            </section>
          ) : null}
        </div>

        <aside className="v-detail-side">
          <section className="v-panel">
            <span className="v-eyebrow">VENDOR PAYOUT</span>
            <div className="v-big-amount">{rupees(t.vendorPayout)}</div>
            <p className="v-small v-muted">Agreed payout for this duty</p>
            {st === 'Completed' ? (
              <>
                <div className="w-bill-status v-mt">
                  <Badge kind={t.paymentStatus === 'Paid' ? 'green' : 'amber'}>{t.paymentStatus === 'Paid' ? 'Final bill closed' : 'Final bill pending'}</Badge>
                  <Badge kind={due?.status === 'Paid' ? 'green' : 'amber'}>{due ? ({ Paid: 'Bank settled', Wallet: 'Wallet posted', Processing: 'Processing', Due: 'Settlement pending', 'On Hold': 'On hold', Failed: 'Payout failed' } as Record<string, string>)[due.status] ?? due.status : 'Settlement pending'}</Badge>
                </div>
                <Btn style="secondary" icon="receipt-text" onClick={() => setSheet('statement')}>View statement</Btn>
              </>
            ) : (
              <Notice title="Final accounts after trip" icon="receipt-text">Cash reported by the driver is adjusted only after office verification.</Notice>
            )}
            {t.paymentStatus ? <KV mt rows={[['Customer payment', t.paymentStatus], ['Paid so far', rupees(t.totalPaid)], ['Balance due', rupees(t.balanceDue)]]} /> : null}
            <div className="v-trip-terms">
              <h3>Included &amp; extra costs</h3>
              <p>{t.includedKm ? `${t.includedKm} km included. ` : ''}Toll, parking and state tax are extra. Record customer reimbursements separately from fare collection. Any amount due from NESAM requires office approval and supporting receipts.</p>
            </div>
            <Btn style="text" icon="chevron-right" onClick={() => setSheet('terms')}>Accepted duty terms</Btn>
          </section>
        </aside>
      </div>
      {sheet === 'cancel' ? <CancellationSheet trip={t} onClose={() => setSheet('')} /> : null}
      {sheet === 'terms' ? <TermsSheet trip={t} onClose={() => setSheet('')} /> : null}
      {sheet === 'statement' ? <StatementSheet tripId={t.id} onClose={() => setSheet('')} /> : null}
    </>
  );
};

const CancellationStatus: React.FC<{ r: PartnerRequestRecord }> = ({ r }) => (
  <section className="v-panel">
    <div className="v-between"><h2>{r.status === 'Declined' ? 'Cancellation request declined' : 'Cancellation under review'}</h2><Badge kind="amber">{r.status === 'Declined' ? 'Declined' : 'Pending'}</Badge></div>
    <p className="v-small v-muted v-mt">{r.status === 'Declined' ? 'This duty remains assigned. No cancellation charge has been deducted.' : 'The duty remains assigned until the office approves. Call NESAM if the pickup is approaching.'}</p>
    <KV mt rows={[['Reason', r.reasonLabel], ['Requested', dayTime(r.requestedAt)], [r.status === 'Declined' ? 'Cancellation charge' : 'Potential charge', rupees(r.status === 'Declined' ? 0 : r.quotedPenalty)], ...(r.adminReason ? [['Office remarks', r.adminReason] as [string, string]] : [])]} />
  </section>
);

const TermsSheet: React.FC<{ trip: VendorTrip; onClose: () => void }> = ({ trip, onClose }) => {
  const p = usePartner();
  const c = p.ops.cancellation;
  const deadline = assignDeadline(trip, p.ops);
  return (
    <Dialog title="Accepted duty terms" onClose={onClose}>
      <p className="v-modal-intro">{trip.bookingId} · {routeOf(trip).join(' → ')}</p>
      <KV rows={[
        ['Agreed vendor payout', rupees(trip.vendorPayout)],
        ...(trip.includedKm ? [['Included distance', `${trip.includedKm} km`] as [string, string]] : []),
        ['Trip type', trip.tripType || '—'],
        ['Assignment deadline', deadline ? dayTime(deadline) : '—'],
        ['Missed assignment deadline', rupees(p.ops.missedAssignmentPenalty)],
        [`Cancellation within ${c.graceHours} h of accepting`, rupees(0)],
        [`Cancellation after ${c.graceHours} h of accepting`, rupees(c.afterGraceCharge)],
        [`Cancellation within ${c.lastMinuteHours} h of pickup`, rupees(c.lastMinuteCharge)],
      ]} />
      <section className="w-terms v-mt">
        <p>Office-confirmed penalties are recorded in the working wallet. Acknowledge a new notice before accepting another duty. Contact the helpdesk for clarification.</p>
        <p>Toll, parking and state tax are extra. Record customer reimbursements separately from fare collection. Any amount due from NESAM requires office approval and supporting receipts.</p>
        <p>Only the confirmed driver and vehicle can operate the duty. Changes before trip start require a new final confirmation.</p>
        <small>Valid reasons may be waived by the NESAM office. The last-minute rule takes priority over the acceptance grace period.</small>
      </section>
    </Dialog>
  );
};

/** Cancellation request (Helpdesk or booking page). The charge shown is the server's quote at submission. */
export const CancellationSheet: React.FC<{ trip: VendorTrip | null; onClose: () => void }> = ({ trip: initial, onClose }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const eligible = p.trips.filter((t) => canChangeTeam(t) && !p.requests.some((r) => r.bookingId === t.id && r.type === 'cancellation'));
  const [tripId, setTripId] = useState(initial?.id ?? '');
  const [chosen, setChosen] = useState(!!initial);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trip = p.trips.find((t) => t.id === tripId) ?? null;
  const [quote, setQuote] = useState(() => (trip ? quoteCancellation(trip.pickupAt, trip.acceptedAt, p.ops.cancellation) : null));

  if (!chosen || !trip) {
    return (
      <Dialog title="Cancellation" onClose={onClose}>
        {eligible.length ? (
          <form onSubmit={(e) => { e.preventDefault(); const t = p.trips.find((x) => x.id === tripId); if (t) { setQuote(quoteCancellation(t.pickupAt, t.acceptedAt, p.ops.cancellation)); setChosen(true); } }}>
            <Field label="Duty">
              <select value={tripId} required onChange={(e) => setTripId(e.target.value)}>
                <option value="">Select a duty</option>
                {eligible.map((t) => <option key={t.id} value={t.id}>{t.bookingId} · {routeOf(t).join(' → ')}</option>)}
              </select>
            </Field>
            <Btn submit full icon="arrow-right">Continue</Btn>
          </form>
        ) : <Empty title="No eligible duties">There are no duties available for this request. Running trips are changed by calling the office.</Empty>}
      </Dialog>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) { setError('Select a reason.'); return; }
    if (details.trim().length < 10) { setError('Describe the issue in at least 10 characters.'); return; }
    if (!quote) { setError('This duty has no pickup time. Call the NESAM office.'); return; }
    setBusy(true);
    setError('');
    try {
      await requestCancellation(trip.id, reason, details, quote.amount);
      onClose();
      ws.say('Request sent. Await office review; the duty remains assigned.');
    } catch (err) {
      const details2 = (err as { details?: { code?: string; amount?: number; ruleLabel?: string } }).details;
      if (details2?.code === 'quote-changed' && typeof details2.amount === 'number') {
        setQuote({ amount: details2.amount, rule: details2.ruleLabel ?? '' });
        setAck(false);
      }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Cancellation" onClose={onClose} busy={busy}>
      <p className="v-modal-intro">{trip.bookingId} · {routeOf(trip).join(' → ')}</p>
      <Notice title="Office approval is required" kind="amber" icon="clock-3">The existing duty and assignment remain active until approval.</Notice>
      <form onSubmit={submit}>
        <KV rows={[['Proposed cancellation charge', rupees(quote?.amount ?? 0)], ...(quote?.rule ? [['Window', quote.rule] as [string, string]] : [])]} />
        <Field label="Reason">
          <select value={reason} required onChange={(e) => setReason(e.target.value)}>
            <option value="">Select a reason</option>
            {CANCEL_REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Reason for office review"><textarea rows={3} maxLength={500} minLength={10} required value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
        <Check checked={ack} onChange={setAck}>I have reviewed the proposed charge and understand this is a cancellation request.</Check>
        <ErrorLine message={error} />
        <Btn submit full icon="arrow-right" busy={busy} disabled={!ack}>Submit request</Btn>
      </form>
    </Dialog>
  );
};

/** Three steps: driver → vehicle → review & confirm (reference sAssignment). */
export const AssignWizard: React.FC<{ id: string }> = ({ id }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const t = p.trips.find((x) => x.id === id);
  const [step, setStep] = useState(1);
  const [driverId, setDriverId] = useState(t?.driverId ?? '');
  const [vehicleId, setVehicleId] = useState(t?.vehicleId ?? '');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!t) return <Empty title="Booking not found">This booking is no longer assigned to your business.</Empty>;
  if (!canChangeTeam(t)) {
    return <><PageHeading title="Assign driver" subtitle={t.bookingId} /><Empty title="The team can no longer be changed" action={<Btn onClick={() => ws.open({ kind: 'booking', id })}>Open booking</Btn>}>The trip has started or closed. Call the NESAM office for changes.</Empty></>;
  }
  const driver = p.drivers.find((d) => d.id === driverId) ?? null;
  const vehicle = p.vehicles.find((v) => v.id === vehicleId) ?? null;
  const deadline = assignDeadline(t, p.ops);
  const [from, to] = routeOf(t);
  const c = p.ops.cancellation;

  const next = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (step === 1) {
      if (!driver) { setError('Choose a driver.'); return; }
      // Prefer the driver's paired vehicle when it can serve this duty.
      if (!vehicleId && driver.assignedVehicleId && !vehicleBlocker(p.vehicles.find((v) => v.id === driver.assignedVehicleId)!, t, p.trips)) setVehicleId(driver.assignedVehicleId);
      setStep(2);
      return;
    }
    if (step === 2) { if (!vehicle) { setError('Choose a vehicle.'); return; } setStep(3); return; }
    if (!accepted || !driver || !vehicle) return;
    setBusy(true);
    try {
      await p.actions.assign(t.id, driver.id, vehicle.id);
      ws.open({ kind: 'booking', id: t.id });
      ws.say(`${driver.name} and ${plate(vehicle.vehicleNumber)} confirmed for ${t.bookingId}. The driver has been notified.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const steps = ['Driver', 'Vehicle', 'Confirm'];
  return (
    <>
      <PageHeading title="Assign driver" subtitle={t.bookingId} />
      <div className="s-assignment-layout">
        <section className="s-wizard-main">
          <ol className="s-steps" aria-label="Assignment steps">
            {steps.map((label, i) => (
              <li key={label} className={i + 1 < step ? 's-done' : i + 1 === step ? 's-current' : ''} aria-current={i + 1 === step ? 'step' : undefined}>
                <span>{i + 1 < step ? <Icon name="check" /> : i + 1}</span><strong>{label}</strong>
              </li>
            ))}
          </ol>
          <div className="s-duty-heading"><span>{dayTime(t.pickupAt)}{t.vehicleCategory ? ` · ${t.vehicleCategory}` : ''}</span><h2>{from} <Icon name="arrow-right" /> {to}</h2></div>
          <form className={`v-panel ${step === 3 ? 's-confirm-form' : 's-step-form'}`} onSubmit={next}>
            <span className="v-eyebrow">STEP {step} OF 3</span>
            {step === 1 ? (
              <>
                <h2>Choose your driver</h2>
                <p className="s-assignment-caption">Only drivers linked to your business are listed.</p>
                <Field label="Driver">
                  <select id="s-assignment-entity" required value={driverId} onChange={(e) => { setDriverId(e.target.value); setVehicleId(''); }}>
                    <option value="">Select a driver</option>
                    {p.drivers.map((d) => { const why = driverBlocker(d, t, p.trips); return <option key={d.id} value={d.id} disabled={!!why}>{d.name || d.phone} · {driverCode(d.id, d.code)}{why ? ` — ${why}` : ''}</option>; })}
                  </select>
                </Field>
                <p className="s-field-help">Documents and schedule must be valid for the full trip.</p>
                {!p.drivers.length ? <Btn style="text" icon="chevron-right" onClick={() => ws.open({ kind: 'add', what: 'driver' }, 'Fleet')}>Add a driver</Btn> : null}
              </>
            ) : step === 2 ? (
              <>
                <h2>Choose the vehicle</h2>
                <p className="s-assignment-caption">Choose a verified {t.vehicleCategory || 'vehicle'} for this duty.</p>
                <Field label="Vehicle">
                  <select id="s-assignment-entity" required value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                    <option value="">Select a vehicle</option>
                    {p.vehicles.map((v) => { const why = vehicleBlocker(v, t, p.trips); return <option key={v.id} value={v.id} disabled={!!why}>{plate(v.vehicleNumber)} · {[v.make, v.model].filter(Boolean).join(' ') || v.category}{v.seatingCapacity ? ` · ${v.seatingCapacity} passengers` : ''}{why ? ` — ${why}` : ''}</option>; })}
                  </select>
                </Field>
                {driver ? <div className="s-selected-person"><Icon name="user-round-check" /><span>{driver.name}<small>{driverCode(driver.id, driver.code)}</small></span></div> : null}
                <p className="s-field-help">Documents and schedule must be valid for the full trip.</p>
              </>
            ) : (
              <>
                <h2>Review &amp; confirm</h2>
                <div className="s-final-pair">
                  <div><Icon name="AssignDriver" /><span>Driver<strong>{driver?.name}</strong><small>{driver ? driverCode(driver.id, driver.code) : ''}</small></span></div>
                  <div><Icon name="Fleet" /><span>Vehicle<strong>{vehicle ? plate(vehicle.vehicleNumber) : ''}</strong><small>{vehicle ? `${vehicle.model || vehicle.category} · ${carCode(vehicle.id, vehicle.code)}` : ''}</small></span></div>
                </div>
                <section className="w-terms">
                  <div className="v-between"><h3>Duty terms &amp; penalty details</h3></div>
                  <KV mt rows={[
                    ['Agreed vendor payout', rupees(t.vendorPayout)],
                    ...(t.includedKm ? [['Included distance', `${t.includedKm} km`] as [string, string]] : []),
                    [`Cancellation after ${c.graceHours} h of accepting`, rupees(c.afterGraceCharge)],
                    [`Cancellation within ${c.lastMinuteHours} h of pickup`, rupees(c.lastMinuteCharge)],
                    ['Assignment deadline', deadline ? dayTime(deadline) : '—'],
                    ['Missed assignment deadline', rupees(p.ops.missedAssignmentPenalty)],
                  ]} />
                  <p>Office-confirmed penalties are recorded in the working wallet. Acknowledge a new notice before accepting another duty. Contact the helpdesk for clarification.</p>
                  <p>Toll, parking and state tax are extra. Record customer reimbursements separately from fare collection. Any amount due from NESAM requires office approval and supporting receipts.</p>
                  <p>Only the confirmed driver and vehicle can operate the duty. Changes before trip start require a new final confirmation.</p>
                </section>
                <Check checked={accepted} onChange={setAccepted}>I have checked the driver, vehicle, payout, duty terms and penalty details, and accept this assignment.</Check>
              </>
            )}
            <ErrorLine message={error} />
            <div className="s-wizard-actions">
              {step > 1 ? <Btn style="secondary" icon="arrow-left" onClick={() => setStep(step - 1)}>Back</Btn> : null}
              <Btn submit full icon={step === 3 ? 'shield-check' : 'arrow-right'} busy={busy} disabled={step === 3 && !accepted}>
                {step === 1 ? 'Continue to vehicle' : step === 2 ? 'Review assignment' : 'Confirm assignment'}
              </Btn>
            </div>
          </form>
        </section>
        <aside className="s-assignment-summary">
          <section className="v-panel">
            <span className="v-eyebrow">AGREED VENDOR PAYOUT</span>
            <strong>{rupees(t.vendorPayout)}</strong>
            <p>{t.includedKm ? `${t.includedKm} km included · ` : ''}{t.tripType}</p>
            <div className="s-summary-rule" />
            <p>Driver and vehicle details are shared with NESAM and the customer after final confirmation.</p>
          </section>
        </aside>
      </div>
    </>
  );
};
