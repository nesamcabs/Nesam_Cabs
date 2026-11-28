// Open duties (reference "Available duties"): the duty card, the pickup-date filter and the accept / bid dialog.
// Home and the Duties page share these, so accepting or bidding behaves the same everywhere. The server decides every
// acceptance (acceptMarketplaceTrip) and every bid (submitDutyBid / withdrawDutyBid); the app only presents them.
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useDriverData } from '../../context/DriverData';
import { usePresence } from '../../hooks/usePresence';
import { acceptMarketplaceTrip, DriverActionError, requestRoundTripDuty, submitDutyBid, withdrawBid, withdrawDutyBid, type DriverBid } from '../../services/driverService';
import type { DutyTerms, MarketplaceOffer, TermValue } from '../../types/driver';
import { useOwnPosition } from '../../hooks/useOwnPosition';
import { formatTime12 } from '../../utils/time';
import { kmBetween, placeParts, stateRoute, townOf } from '../../utils/places';
import { DutyTicket, type TicketAction } from './DutyTicket';
import { categoryMatches } from '../../utils/earnings';
import { formatINR } from '../../utils/format';
import { describeError } from '../../utils/retry';
import { nx } from '../../theme/nx';
import { PolicyDialog } from './Cancellation';
import { NxDialog } from './Dialog';
import { NxIcon } from './Icon';
import { NxBadge, NxButton, NxField, NxFormError, NxInfo, NxRouteStack, NxRow, isHovered } from './primitives';
import { useShell } from './Shell';
import { kmText, offerWhen } from './tripFormat';
import { timePackageLine } from '../../utils/timePackage';

/** Offers for the driver's vehicle (or all), the pickup dates among them, and the ones on the chosen date. */
export function useDutyFeed(showAll: boolean, dateFilter: string, typeFilter = 'all') {
  const { offers, account } = useDriverData();
  const vehicleType = account.vehicle.vehicleType;
  const matching = useMemo(() => offers.filter((o) => categoryMatches(o.vehicleCategory, vehicleType)), [offers, vehicleType]);
  const pool = showAll ? offers : matching;
  const dates = useMemo(() => [...new Set(pool.map((o) => offerWhen(o).key).filter(Boolean))], [pool]);
  const types = useMemo(() => [...new Set(pool.map((o) => o.tripType).filter(Boolean))], [pool]);
  const visible = pool.filter((o) => (dateFilter === 'all' || offerWhen(o).key === dateFilter) && (typeFilter === 'all' || o.tripType === typeFilter));
  return { all: offers, matching, pool, dates, types, visible };
}

// ── Duty card ───────────────────────────────────────────────────────────────

/** "in 45 min", "in 3 hr 20 min", "in 9 hr", "in 2 days". */
function untilText(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return h < 6 && r ? `in ${h} hr ${r} min` : `in ${h} hr`;
  const d = Math.round(h / 24);
  return `in ${d} day${d === 1 ? '' : 's'}`;
}

const TERM_NAMES: [keyof DutyTerms, string][] = [['driverBata', 'Driver Bata'], ['toll', 'Toll'], ['parking', 'Parking'], ['stateTax', 'State Tax']];
const joinNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}` : names[0] ?? '');

/**
 * What a duty's pay covers and what the customer pays on top: from the terms it was published on, or, without them, the
 * standing rules (an outstation fare carries the driver's bata; toll, parking and state tax are paid by the customer).
 */
export function dutyTags(o: Pick<MarketplaceOffer, 'terms' | 'tripType' | 'service'>): { included: string; extras: string } {
  const terms = o.terms;
  if (terms) {
    const pick = (v: TermValue) => TERM_NAMES.filter(([key]) => terms[key] === v).map(([, name]) => name);
    const included = pick('Included');
    const extras = pick('At actuals');
    return { included: included.length ? `${joinNames(included)} Included` : '', extras: extras.length ? `${joinNames(extras)} Extra` : '' };
  }
  const outstation = !/local|rental|airport/i.test(`${o.tripType} ${o.service}`);
  return { included: outstation ? 'Driver Bata Included' : '', extras: 'Toll, Parking & State Tax Extra' };
}

const dayOf = (at: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(at);

/** Which part of a duty a card button opens: taking it at the offer, or sending a counter amount. */
export type DutyIntent = 'accept' | 'bid';

/**
 * One open duty, as a ticket: the route with its states and time to pickup, date and trip type, car and fuel, the pickup
 * point and how far it is, what the pay covers, then the driver pay and Accept (a bidding duty: Place bid and Accept with
 * the pay on it). The ticket and its buttons open the duty (the accept / bid dialog).
 */
export function DutyCard({ offer, onOpen, pending, requestOnly }: { offer: MarketplaceOffer; onOpen: (intent?: DutyIntent) => void; pending?: boolean; requestOnly?: boolean }) {
  const { account } = useDriverData();
  const vehicleType = account.vehicle.vehicleType;
  const here = useOwnPosition();
  // The time to pickup counts down while the list stays open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const w = offerWhen(offer);
  const at = offer.pickupMs ? new Date(offer.pickupMs) : null;
  const untilMs = at ? at.getTime() - now : 0;
  const pay = formatINR(offer.offeredPayout);
  const tags = dutyTags(offer);
  const from = townOf(offer.pickup.address);
  const to = townOf(offer.drop.address);
  const { lat, lng } = offer.pickup;
  // A duty's pickup position is rounded to about a kilometre, so the distance is a whole number.
  const away = here && lat != null && lng != null ? kmBetween(here, { lat, lng }) : null;
  const awayText = away === null ? '' : away < 1 ? 'Nearby' : `~${Math.round(away)} km`;
  const openPickup = () => {
    const query = lat != null && lng != null ? `${lat},${lng}` : encodeURIComponent(offer.pickup.address);
    void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
  };
  // A bidding duty can also be taken at its offer: Place bid, then Accept carrying the pay.
  const actions: TicketAction[] = pending
    ? [{ label: 'View request', icon: 'time-outline', tone: 'quiet', onPress: () => onOpen() }]
    : requestOnly ? [{ label: 'Request trip', icon: 'checkmark-done', tone: 'accept', onPress: () => onOpen('accept') }]
    : offer.mode === 'bid_review' ? [
      { label: 'Place bid', icon: 'trending-up', tone: 'bid', onPress: () => onOpen('bid') },
      { label: 'Accept', icon: 'checkmark-done', tone: 'accept', amount: pay, onPress: () => onOpen('accept') },
    ]
    : [{ label: 'Accept duty', icon: 'checkmark-done', tone: 'accept', onPress: () => onOpen('accept') }];
  const lines = [
    offer.timePackage ? timePackageLine(offer.timePackage) : '',
    offer.via?.length ? `Via ${offer.via.join(', ')}` : '',
    [offer.addOns?.roofCarrier ? 'Roof carrier required' : '', offer.addOns?.pets ? 'Pet travel' : ''].filter(Boolean).join(' · '),
    pending ? 'Pending approval' : '',
  ].filter(Boolean);

  return (
    <View style={styles.cardWrap}>
      <DutyTicket
        from={from}
        to={to}
        region={stateRoute(offer.pickup.address, offer.drop.address)}
        eta={untilMs > 0 ? untilText(untilMs) : undefined}
        time={at ? formatTime12(at) : w.time}
        date={at ? dayOf(at) : w.date}
        service={offer.tripType || offer.service || 'Duty'}
        duration={offer.duration || undefined}
        distance={kmText(offer.distanceKm) || undefined}
        vehicle={offer.vehicleCategory || vehicleType || 'Any vehicle'}
        fuel={offer.fuelType ? (offer.fuelType === 'cng' ? 'CNG' : 'Diesel / Petrol') : undefined}
        point={placeParts(offer.pickup.address).join(', ') || from}
        pointAction={{ label: awayText || 'Map', accessibilityLabel: awayText ? `Pickup ${away! < 1 ? 'is nearby' : `about ${Math.round(away!)} kilometres away`}. Open it on the map` : 'Open the pickup on the map', onPress: openPickup }}
        included={tags.included}
        extras={tags.extras}
        payout={pay}
        payoutLabel="Driver pay"
        actions={actions}
        onPress={() => onOpen()}
        accessibilityLabel={`${from} to ${to}, ${pay}. Open duty`}
      >
        {lines.length ? (
          <View style={styles.lines}>
            {lines.map((line) => <Text key={line} style={[styles.line, line === 'Pending approval' && { color: nx.amber }]} numberOfLines={2}>{line}</Text>)}
          </View>
        ) : null}
      </DutyTicket>
    </View>
  );
}

// ── Date filter ─────────────────────────────────────────────────────────────

export function DateFilterDialog({ visible, onClose, dates, value, onChange }: { visible: boolean; onClose: () => void; dates: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <NxDialog visible={visible} onClose={onClose} eyebrow="Available duties" title="Filter by pickup date">
      {['all', ...dates].map((d) => {
        const on = value === d;
        return (
          <Pressable
            key={d}
            style={(s) => [styles.option, isHovered(s) && { backgroundColor: nx.page }]}
            onPress={() => {
              onChange(d);
              onClose();
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.optionText, on && { color: nx.red }]}>{d === 'all' ? 'All dates' : d}</Text>
            {on ? <NxIcon name="check" size={16} color={nx.red} /> : null}
          </Pressable>
        );
      })}
    </NxDialog>
  );
}

/** The same pick-one list for the trip type (One Way, Round Trip, Local Rental, …). */
export function TypeFilterDialog({ visible, onClose, types, value, onChange }: { visible: boolean; onClose: () => void; types: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <NxDialog visible={visible} onClose={onClose} eyebrow="Available duties" title="Filter by trip type">
      {['all', ...types].map((t) => {
        const on = value === t;
        return (
          <Pressable
            key={t}
            style={(s) => [styles.option, isHovered(s) && { backgroundColor: nx.page }]}
            onPress={() => {
              onChange(t);
              onClose();
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.optionText, on && { color: nx.red }]}>{t === 'all' ? 'All trip types' : t}</Text>
            {on ? <NxIcon name="check" size={16} color={nx.red} /> : null}
          </Pressable>
        );
      })}
    </NxDialog>
  );
}

// ── My bids ─────────────────────────────────────────────────────────────────

const BID_TEXT: Record<string, { label: string; tone: 'amber' | 'green' | 'neutral' | 'red' }> = {
  'Pending Review': { label: 'Awaiting NESAM review', tone: 'amber' },
  Awarded: { label: 'Awarded to you', tone: 'green' },
  Accepted: { label: 'Awarded to you', tone: 'green' },
  Rejected: { label: 'Not selected', tone: 'neutral' },
  Withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

/** Every bid the driver has placed, with its status; one under review can be withdrawn. */
export function MyBidsDialog({ visible, onClose, bids, loaded }: { visible: boolean; onClose: () => void; bids: DriverBid[]; loaded: boolean }) {
  const { notify } = useShell();
  const [busyId, setBusyId] = useState('');
  const withdraw = async (b: DriverBid) => {
    setBusyId(b.id + b.tripId);
    try {
      await withdrawBid(b);
      notify('ok', 'Your bid was withdrawn.');
    } catch (e) {
      notify('error', e instanceof DriverActionError ? e.message : describeError(e, 'Your bid could not be withdrawn.'));
    } finally {
      setBusyId('');
    }
  };
  return (
    <NxDialog visible={visible} onClose={onClose} eyebrow="Available duties" title="My bids" footer={<NxButton title="Done" variant="secondary" onPress={onClose} />}>
      {!loaded ? <Text style={styles.optionText}>Loading your bids…</Text> : null}
      {loaded && !bids.length ? <Text style={styles.optionText}>No bids yet. Open a bidding duty and send your expected payout.</Text> : null}
      {bids.map((b) => {
        const t = BID_TEXT[b.status] ?? { label: b.status, tone: 'neutral' as const };
        return (
          <View key={b.tripId + b.id} style={styles.bid}>
            <View style={styles.bidTop}>
              <Text style={styles.bidCode}>{b.bookingId}</Text>
              <NxBadge label={t.label} tone={t.tone} />
            </View>
            <NxRow label="Your minimum payout" value={formatINR(b.counterRate)} />
            <NxRow label="NESAM offer when you bid" value={formatINR(b.offeredPayout)} />
            {b.note ? <Text style={styles.bidNote}>{b.note}</Text> : null}
            {b.status === 'Pending Review' ? <NxButton title={busyId === b.id + b.tripId ? 'Withdrawing…' : 'Withdraw bid'} variant="secondary" compact loading={busyId === b.id + b.tripId} onPress={() => void withdraw(b)} style={{ marginTop: 10 }} /> : null}
          </View>
        );
      })}
    </NxDialog>
  );
}

// ── Accept / bid dialog ─────────────────────────────────────────────────────

/**
 * Duty details with Accept (or, for duties NESAM reviews, a counter bid). `onAccepted` runs after a successful accept.
 * `scheduled` is for the My Bookings tab (advance/scheduled offers): being online and having no active trip stop an
 * on-demand duty, but never a trip booked for later — the server's own schedule-overlap check is the real gate.
 * `requestOnly` additionally asks a vendor driver's own fleet for the trip instead of claiming it outright.
 */
export function DutyDialog({ offer, onClose, onAccepted, scheduled, requestOnly, pending, intent }: { offer: MarketplaceOffer | null; onClose: () => void; onAccepted?: (offer: MarketplaceOffer) => void; scheduled?: boolean; requestOnly?: boolean; pending?: boolean; intent?: DutyIntent }) {
  const { account, activeTrip, cancelPolicy } = useDriverData();
  const { notify } = useShell();
  const presence = usePresence(notify);
  const { driver, vehicle } = account;
  const [accepting, setAccepting] = useState(false);
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [forId, setForId] = useState<string | null>(null);
  // A new offer resets the form (state is derived during render, the React-recommended pattern).
  if (offer && offer.id !== forId) {
    setForId(offer.id);
    setRate(offer.offeredPayout > 0 ? String(offer.offeredPayout) : '');
    setNote('');
    setError('');
  }
  // A bidding duty opens its bid form, unless "Accept duty" was chosen: then it is taken at the current offer.
  const bid = !requestOnly && offer?.mode === 'bid_review' && intent !== 'accept';
  const blocked = scheduled ? '' : !presence.online ? (bid ? 'Go online to bid' : 'Go online to accept') : activeTrip ? 'Finish your active trip first' : '';

  const accept = async () => {
    if (!offer || (!scheduled && activeTrip)) return;
    setAccepting(true);
    try {
      if (requestOnly) {
        await requestRoundTripDuty(offer);
        onClose();
        notify('ok', 'Request sent. Your fleet will approve or decline it.');
      } else {
        await acceptMarketplaceTrip(driver, vehicle.vehicleNumber, offer);
        onClose();
        notify('ok', 'Duty assigned. Take the vehicle photos before you head to the pickup.');
      }
      onAccepted?.(offer);
    } catch (e) {
      notify('error', e instanceof DriverActionError ? e.message : describeError(e, requestOnly ? 'This trip could not be requested.' : 'This duty is no longer available.'));
    } finally {
      setAccepting(false);
    }
  };

  const sendBid = async () => {
    if (!offer) return;
    const value = Number(rate);
    if (!Number.isFinite(value) || value <= 0 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) {
      setError('Enter your counter amount in rupees (up to 2 decimals).');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await submitDutyBid(offer, value, note);
      onClose();
      notify('ok', 'Bid sent. NESAM reviews bids and will notify you if it is accepted.');
    } catch (e) {
      setError(e instanceof DriverActionError ? e.message : describeError(e, 'Your bid could not be sent.'));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!offer) return;
    setBusy(true);
    try {
      await withdrawDutyBid(offer);
      onClose();
      notify('ok', 'Your bid was withdrawn.');
    } catch (e) {
      setError(e instanceof DriverActionError ? e.message : describeError(e, 'Your bid could not be withdrawn.'));
    } finally {
      setBusy(false);
    }
  };

  const p = cancelPolicy;
  const policyLine = `Cancellation: ${formatINR(0)} within ${p.graceHours} h of accepting · ${formatINR(p.afterGraceCharge)} after · ${formatINR(p.lastMinuteCharge)} within ${p.lastMinuteHours} h of pickup. Valid reasons may be waived.`;
  const w = offer ? offerWhen(offer) : null;

  return (
    <>
      <NxDialog
        visible={offer !== null && !policyOpen}
        onClose={onClose}
        eyebrow={offer?.bookingId || 'Duty details'}
        title={requestOnly ? 'Round trip request' : bid ? 'Duty bidding' : 'Available duty'}
        locked={accepting || busy}
        footer={
          bid ? (
            <>
              <NxButton title={busy ? 'Sending…' : blocked || 'Send bid for review'} trailingIcon="check" loading={busy} disabled={!!blocked} onPress={() => void sendBid()} />
              <NxButton title="Withdraw my earlier bid" variant="ghost" compact disabled={busy} onPress={() => void withdraw()} />
              <Text style={styles.footnote}>NESAM reviews bids. The duty is assigned to you only if your bid is accepted.</Text>
            </>
          ) : requestOnly ? (
            <>
              <NxButton title={pending ? 'Request sent' : accepting ? 'Sending…' : 'Request this trip'} trailingIcon="check" loading={accepting} disabled={pending} onPress={() => void accept()} />
              <Text style={styles.footnote}>{pending ? "Waiting for your fleet to approve or decline it." : "Sent to your fleet for approval. It's yours only once they approve it."}</Text>
            </>
          ) : (
            <>
              <NxButton title={accepting ? 'Accepting…' : blocked || 'Accept duty'} trailingIcon="check" loading={accepting} disabled={!!blocked} onPress={() => void accept()} />
              <Text style={styles.policy}>
                {policyLine}{' '}
                <Text style={styles.policyLink} onPress={() => setPolicyOpen(true)} accessibilityRole="link">
                  View policy
                </Text>
              </Text>
            </>
          )
        }
      >
        {offer && w ? (
          <>
            <View style={styles.payoutBox}>
              <View style={{ flexShrink: 1 }}>
                <Text style={styles.payoutBoxLabel}>{bid ? 'NESAM offer' : 'Your base payout'}</Text>
                <Text style={styles.payoutBoxNote}>{bid ? 'Send a counter amount below' : 'Driver allowance included'}</Text>
              </View>
              <Text style={styles.payoutBoxValue}>{formatINR(offer.offeredPayout)}</Text>
            </View>
            <NxRouteStack pickup={offer.pickup.address} drop={offer.drop.address} via={offer.via} compact />
            <View style={{ marginTop: 6 }}>
              <NxRow label="Pickup date" value={w.date} />
              {w.time ? <NxRow label="Pickup time" value={`${w.time} IST`} /> : null}
              <NxRow label="Vehicle / route" value={`${offer.vehicleCategory || 'Any vehicle'}${offer.distanceKm > 0 ? ` · ${kmText(offer.distanceKm)} estimate` : ''}`} last />
            </View>
            {bid ? (
              <>
                <NxField label="Your counter amount (₹)" value={rate} onChangeText={(t) => { setRate(t.replace(/[^\d.]/g, '').slice(0, 9)); setError(''); }} keyboardType="decimal-pad" />
                <NxField label="Note for NESAM (optional)" value={note} onChangeText={(t) => setNote(t.slice(0, 300))} multiline />
                <NxFormError message={error} />
              </>
            ) : null}
            <NxInfo>Toll, parking and state tax are extra. Collect separately against actual receipts and record them at the end of the trip.</NxInfo>
            {!scheduled && activeTrip ? <NxInfo tone="amber" icon="clock">You already have an active trip. Finish it before accepting another.</NxInfo> : null}
          </>
        ) : null}
      </NxDialog>
      <PolicyDialog visible={offer !== null && policyOpen} onClose={() => setPolicyOpen(false)} policy={cancelPolicy} />
    </>
  );
}

const styles = StyleSheet.create({
  cardWrap: { marginBottom: 12 },
  lines: { gap: 3, paddingHorizontal: 4 },
  line: { fontSize: 11.5, fontWeight: '600', color: '#5B6472' },
  option: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  optionText: { fontSize: 13.5, fontWeight: '600', color: nx.ink },
  bid: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  bidTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 },
  bidCode: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: nx.muted },
  bidNote: { fontSize: 11.5, color: nx.muted, marginTop: 6 },
  footnote: { fontSize: 11, color: nx.muted, textAlign: 'center' },
  policy: { fontSize: 11, lineHeight: 18, color: nx.muted, paddingTop: 12, borderTopWidth: 1, borderTopColor: nx.line },
  policyLink: { color: nx.red, fontWeight: '600' },
  payoutBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: nx.redSoft, borderRadius: 12, padding: 17, marginBottom: 4 },
  payoutBoxLabel: { fontSize: 12, color: '#A6515A', fontWeight: '600' },
  payoutBoxNote: { fontSize: 11, color: '#A6515A', marginTop: 3, opacity: 0.85 },
  payoutBoxValue: { fontSize: 25, fontWeight: '700', letterSpacing: -0.7, color: nx.red },
});
