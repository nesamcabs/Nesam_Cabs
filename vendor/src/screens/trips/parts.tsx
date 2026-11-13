// Marketplace duty row (the reference's q-duty-row) and the accept / bid dialogs used on Trips, Duty details and My bids.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/kit/Text';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { useInbox } from '../../context/Inbox';
import { Sheet, TextField } from '../../components/ui';
import { Badge, Btn, Check, Feedback, KV, Notice, RouteTitle, Small } from '../../components/kit/core';
import { DutyCard } from '../../components/kit/DutyCard';
import { dayTime, marketFrom, marketPickup, marketTo, marketType, rupees, timeText, numericDate } from '../../components/kit/format';
import { flash } from '../../components/kit/flash';
import { acceptOfferedRate, isEligibleVehicle, submitCounterBid, withdrawBid } from '../../services/vendorService';
import type { FleetDriver, FleetVehicle, MarketTrip, VendorBid } from '../../types/operations';
import { colors, fontFamily } from '../../theme';

export const OPEN_BID = 'Pending Review';

/** How a duty was published: a fixed payout to accept, or bidding (the payout rises over time and vendors bid the lowest they accept). */
export const isBidding = (t: MarketTrip) => t.mode === 'bid_review';
export const isFixed = (t: MarketTrip) => t.mode === 'accept_offer';
/** "5% every 1 hour": how the payout of a bidding duty rises ('' when it does not). */
export const risesText = (t: MarketTrip) => {
  if (!(t.stepPercent > 0) || !(t.intervalMinutes > 0)) return '';
  const m = t.intervalMinutes;
  const every = m % 60 === 0 ? (m === 60 ? '1 hour' : `${m / 60} hours`) : `${m} min`;
  return `${t.stepPercent}% every ${every}`;
};

/** Any duty with a payout can be accepted at that payout: the fixed offer, or a bidding duty's current payout. */
export const canAccept = (t: MarketTrip) => t.offeredPayout > 0;

/** When a duty opens to vendors (release waves offer it to owner-drivers first); 0 = already open. */
export const opensToVendorsAt = (t: MarketTrip, releaseSeconds: number, now = Date.now()) => {
  const at = t.publishedMs && releaseSeconds ? t.publishedMs + releaseSeconds * 1000 : 0;
  return at > now ? at : 0;
};

/** Re-renders every `ms` so countdowns and closing offers stay current. */
export function useNow(ms = 15000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
export const canBid = (t: MarketTrip, now = Date.now()) => t.mode !== 'accept_offer' && (!t.cutoffMs || now < t.cutoffMs) && (!t.pickupMs || now < t.pickupMs);

export function assignByIfAcceptedNow(t: MarketTrip, windowH: number, beforeH: number): Date {
  const now = Date.now();
  const byWindow = now + windowH * 3600000;
  if (!t.pickupMs) return new Date(byWindow);
  const preferred = Math.min(byWindow, t.pickupMs - beforeH * 3600000);
  return new Date(preferred > now ? preferred : Math.min(byWindow, t.pickupMs));
}

export function ExtraTag() {
  return (
    <View style={styles.extra}>
      <Ionicons name="receipt-outline" size={14} color="#8B919C" />
      <Text style={styles.extraText}>Toll, parking, state permit & hill charges<Text style={styles.extraStrong}> · the driver collects them from the customer and gives a receipt</Text></Text>
    </View>
  );
}

/** Why the vendor may not be able to staff this duty right now (shown before accepting or bidding; the server re-checks at assignment). */
export function fleetWarning(t: MarketTrip, vehicles: FleetVehicle[], drivers: FleetDriver[]): string {
  const ready = vehicles.filter(isEligibleVehicle);
  const wanted = (t.vehicleCategory || '').trim().toLowerCase();
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const w = norm(wanted);
  const matching = w ? ready.filter((v) => { const c = norm(v.category || ''); return !!c && (c.includes(w) || w.includes(c)); }) : ready;
  const team = drivers.filter((d) => d.approvalStatus === 'Approved' && d.fleetStatus !== 'Suspended');
  if (!ready.length) return 'You have no approved vehicle in service yet. You will not be able to assign this duty.';
  if (!matching.length) return `You have no approved ${t.vehicleCategory} in service. The duty needs one of that category.`;
  if (!team.length) return 'You have no approved driver yet. You will not be able to assign this duty.';
  return '';
}

export type DutyAction = { kind: 'accept'; trip: MarketTrip } | { kind: 'bid'; trip: MarketTrip } | { kind: 'bid-detail'; bid: VendorBid };

/**
 * One available duty. In the list (`list`) it is a compact, easy-to-read row with no buttons: pickup time and Duty ID, the route, a
 * one-line summary and the payout; tapping it opens the duty, where it is accepted or bid on. On the duty page the same card is
 * shown with its Accept / Place bid actions underneath.
 */
export function DutyRow({ trip: t, bid, onAction, list }: { trip: MarketTrip; bid?: VendorBid; onAction: (a: DutyAction) => void; list?: boolean }) {
  const navigation = useNavigation();
  const { ops } = useVendorData();
  const now = useNow();
  const pickup = marketPickup(t);
  const opensAt = opensToVendorsAt(t, ops.vendorReleaseSeconds, now);
  const accept = canAccept(t) && !opensAt;
  const bidOpen = canBid(t, now) && !opensAt;
  const extras = [t.addOns?.roofCarrier ? 'Roof carrier' : '', t.addOns?.pets ? 'Pet travel' : ''].filter(Boolean).join(' · ');
  const open = () => navigation.navigate('Duty', { id: t.id });
  // The list keeps to what decides whether to open a duty: date and time, place, service, vehicle and payout. The duty page adds distance and extras.
  // The service type and the car are on separate lines.
  // The car name the admin gave the category ("Wagon R or Similar"); VendorData falls back to the class ("Hatchback").
  const car = t.carName || t.vehicleCategory || 'Any vehicle';
  const km = t.distanceKm ? `${Math.round(t.distanceKm)} km` : '';
  const carLine = list ? car : [car, extras].filter(Boolean).join('  ·  ');
  const dateText = pickup ? numericDate(pickup) : t.travelDate || '';
  // One line saying where this duty stands for this vendor (nothing when it is simply open).
  const closes = t.cutoffMs ? `Bidding closes ${dayTime(new Date(t.cutoffMs))}` : '';
  const status = opensAt ? `Opens to vendors at ${timeText(new Date(opensAt))}`
    : isBidding(t) && !bidOpen ? 'Bidding closed'
    : isBidding(t) ? closes
    : '';

  const card = (
    <DutyCard
      date={dateText || '—'}
      time={pickup ? timeText(pickup) : t.pickup.time || '—'}
      from={marketFrom(t)}
      to={marketTo(t)}
      service={marketType(t)}
      distance={km}
      vehicle={carLine}
      payout={t.offeredPayout > 0 ? rupees(t.offeredPayout) : 'Your quote'}
      payoutLabel={isBidding(t) ? 'Payout' : isFixed(t) ? 'Fixed payout' : 'Vendor payout'}
      badge={isBidding(t) ? <Badge label="Bidding" tone="blue" /> : isFixed(t) ? <Badge label="Fixed payout" tone="green" /> : undefined}
      compact
      fuel={t.fuelType}
      onPress={list ? open : undefined}
      accessibilityLabel={`${marketFrom(t)} to ${marketTo(t)}, vendor payout ${rupees(t.offeredPayout)}. Open duty`}
    >
      {status || !list ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4 }}>
          {list ? null : <Text style={styles.code} numberOfLines={1}>{t.bookingId}</Text>}
          {status ? <Text style={[styles.status, bid ? { color: '#2F5BD3' } : opensAt ? { color: '#946000' } : null]} numberOfLines={1}>{status}</Text> : null}
        </View>
      ) : null}
    </DutyCard>
  );

  if (list) return card;
  return (
    <View style={{ gap: 10 }}>
      {card}
      {accept || bid || bidOpen ? (
        <View style={styles.actionsRow}>
          {accept ? <Btn title="Accept duty" icon="checkmark-done" onPress={() => onAction({ kind: 'accept', trip: t })} style={{ flex: 1 }} /> : null}
          {bid ? <Btn kind="bid" title={`My bid ${rupees(bid.vendorCounterRate)}`} icon="create-outline" onPress={() => onAction({ kind: 'bid-detail', bid })} style={{ flex: 1 }} />
            : bidOpen ? <Btn kind="bid" title="Place bid" icon="trending-up" onPress={() => onAction({ kind: 'bid', trip: t })} style={{ flex: 1 }} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** Accept the posted payout. Blocked while a penalty notice waits for acknowledgement. */
export function AcceptDialog({ trip, onClose, onDone }: { trip: MarketTrip; onClose: () => void; onDone: () => void }) {
  const d = useVendorData();
  const navigation = useNavigation();
  const { unacknowledged } = useInbox();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const by = assignByIfAcceptedNow(trip, d.ops.assignmentWindowHours, d.ops.assignBeforePickupHours);
  const gate = unacknowledged[0];

  if (gate) {
    return (
      <Sheet visible onClose={onClose} title="Before accepting this duty">
        <Notice tone="amber" icon="alert-circle-outline" title="New duty acceptance needs attention" text="Acknowledge your penalty notice before accepting a new duty. Existing accepted and running duties continue." />
        <Btn title="Open penalty notice" icon="checkmark-done" full style={{ marginTop: 16 }} onPress={() => { onClose(); navigation.navigate('Penalty', { id: gate.id }); }} />
      </Sheet>
    );
  }

  const accept = async () => {
    if (!agree) { setError('Confirm the assignment deadline and duty terms to accept.'); return; }
    setBusy(true); setError('');
    try {
      await acceptOfferedRate(d.identity, trip);
      flash(`Duty ${trip.bookingId} accepted. Assign your driver and vehicle by ${dayTime(by)}.`);
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet visible onClose={onClose} title="Accept this duty?" dismissible={!busy}>
      <RouteTitle from={marketFrom(trip)} to={marketTo(trip)} size={17} />
      <Small>{trip.bookingId} · {marketType(trip)}</Small>
      <View style={styles.offer}>
        <Text style={styles.offerLabel}>Agreed vendor payout</Text>
        <Text style={styles.offerValue}>{rupees(trip.offeredPayout)}</Text>
      </View>
      <KV rows={[['Pickup', marketPickup(trip) ? dayTime(marketPickup(trip)) : trip.travelDate || '—'], ['Vehicle category', trip.vehicleCategory || '—'], trip.distanceKm ? ['Included distance', `${Math.round(trip.distanceKm)} km`] : null]} />
      <View style={styles.obligation}>
        <View style={styles.obRow}><Ionicons name="time-outline" size={17} color="#8B919C" /><Text style={styles.obText}>Assign driver & vehicle by<Text style={styles.obStrong}>{'\n'}{dayTime(by)}</Text></Text></View>
        <View style={styles.obRow}><Ionicons name="alert-circle-outline" size={17} color="#8B919C" /><Text style={styles.obText}>Missed assignment deadline<Text style={styles.obStrong}>{'\n'}{rupees(d.ops.missedAssignmentPenalty)} penalty after office review</Text></Text></View>
      </View>
      {fleetWarning(trip, d.vehicles, d.drivers) ? <Notice tone="red" icon="car-outline" title="Check your fleet first" text={`${fleetWarning(trip, d.vehicles, d.drivers)} Missing the assignment deadline leads to a ${rupees(d.ops.missedAssignmentPenalty)} penalty.`} style={{ marginBottom: 10 }} /> : null}
      <Check checked={agree} onChange={setAgree} label="I accept this duty at the payout shown and will confirm a verified driver and vehicle before the deadline." />
      <Feedback tone="error" message={error} />
      <Btn title="Accept duty" icon="checkmark-done" busy={busy} full onPress={() => void accept()} style={{ marginTop: 8 }} />
    </Sheet>
  );
}

/** Quote a payout; NESAM reviews bids (awardMarketplaceBid) and, if it accepts yours, allocates the duty at your quote. */
export function BidDialog({ trip, onClose, onDone }: { trip: MarketTrip; onClose: () => void; onDone: () => void }) {
  const d = useVendorData();
  const existing = d.bids.find((b) => b.tripId === trip.id && b.status === OPEN_BID) ?? null;
  const [amount, setAmount] = useState(existing ? String(existing.vendorCounterRate) : '');
  const [note, setNote] = useState(existing?.biddingNote ?? '');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const validUntil = trip.cutoffMs || trip.pickupMs;
  const submit = async () => {
    const rate = Number(amount);
    if (!Number.isSafeInteger(rate) || rate <= 0) { setError('Enter your expected payout in whole rupees.'); return; }
    if (!consent) { setError('Confirm the allocation and assignment terms to place a bid.'); return; }
    setBusy(true); setError('');
    try {
      await submitCounterBid(d.identity, trip, rate, note, true);
      flash(existing ? 'Bid updated.' : `Bid of ${rupees(rate)} placed for ${trip.bookingId}.`);
      onDone();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet visible onClose={onClose} title={existing ? 'Update bid' : 'Place bid'} dismissible={!busy}>
      <RouteTitle from={marketFrom(trip)} to={marketTo(trip)} size={17} />
      <View style={styles.offer}>
        <Text style={styles.offerLabel}>{risesText(trip) ? 'Current payout (rising)' : 'Current vendor payout'}</Text>
        <Text style={styles.offerValue}>{trip.offeredPayout > 0 ? rupees(trip.offeredPayout) : '—'}</Text>
      </View>
      <TextField label="Your total payout quote (₹)" value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, '').slice(0, 7))} keyboardType="number-pad" placeholder={trip.offeredPayout ? `e.g. ${Math.round(trip.offeredPayout * 1.15)}` : 'e.g. 1800'} />
      {validUntil ? <View style={styles.valid}><Ionicons name="time-outline" size={15} color="#6F7785" /><Text style={styles.validText}>Valid until {dayTime(new Date(validUntil))}</Text></View> : null}
      <View style={styles.obligation}>
        <View style={styles.obRow}><Ionicons name="time-outline" size={17} color="#8B919C" /><Text style={styles.obText}>Assignment window<Text style={styles.obStrong}>{'\n'}{d.ops.assignmentWindowHours} hours after NESAM allocates it</Text></Text></View>
        <Text style={styles.windowHelp}>Confirm at least {d.ops.assignBeforePickupHours} hour before pickup where possible. Missing the window: {rupees(d.ops.missedAssignmentPenalty)} after office review.</Text>
      </View>
      {fleetWarning(trip, d.vehicles, d.drivers) ? <Notice tone="amber" icon="car-outline" title="Check your fleet first" text={fleetWarning(trip, d.vehicles, d.drivers)} style={{ marginBottom: 12 }} /> : null}
      <TextField label="Note for the NESAM team (optional)" value={note} onChangeText={setNote} maxLength={300} multiline />
      <Check checked={consent} onChange={setConsent} label="If NESAM accepts my bid, the duty is allocated to my business at this payout. I will confirm the driver and vehicle within the assignment window." />
      <Feedback tone="error" message={error} />
      <Btn title={existing ? 'Update bid' : 'Submit bid'} kind="primary" icon="trending-up" busy={busy} full onPress={() => void submit()} style={{ marginTop: 8 }} />
    </Sheet>
  );
}

export function BidDetailDialog({ bid, onClose, onUpdate }: { bid: VendorBid; onClose: () => void; onUpdate: (t: MarketTrip) => void }) {
  const d = useVendorData();
  const trip = d.marketTrips.find((t) => t.id === bid.tripId) ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = bid.status === OPEN_BID;
  const withdraw = async () => {
    setBusy(true); setError('');
    try { await withdrawBid(bid); flash('Bid withdrawn.'); onClose(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet visible onClose={onClose} title="Your bid" dismissible={!busy}>
      {trip ? <RouteTitle from={marketFrom(trip)} to={marketTo(trip)} size={17} /> : <Text style={styles.offerLabel}>{bid.bookingId}</Text>}
      <View style={styles.offer}>
        <Text style={styles.offerLabel}>Your minimum payout</Text>
        <Text style={styles.offerValue}>{rupees(bid.vendorCounterRate)}</Text>
      </View>
      <KV rows={[['Status', bidLabel(bid.status)], ['Current office offer', rupees(trip?.offeredPayout ?? bid.offeredPayout)], ['Submitted', dayTime(bid.submittedAt)], bid.biddingNote ? ['Your note', bid.biddingNote] : null]} />
      {open && !bid.autoAcceptConsent ? <Notice tone="amber" title="Allocation terms not confirmed" text="Update this bid and confirm the allocation terms so NESAM can allocate the duty to you." style={{ marginTop: 14 }} /> : null}
      <Feedback tone="error" message={error} />
      {open ? (
        <View style={styles.dialogActions}>
          {trip ? <Btn title="Update bid" icon="create-outline" onPress={() => onUpdate(trip)} style={{ flex: 1 }} /> : null}
          <Btn title="Withdraw" kind="secondary" icon="close" busy={busy} onPress={() => void withdraw()} style={{ flex: 1 }} />
        </View>
      ) : null}
    </Sheet>
  );
}

export const bidLabel = (status: string) => (status === OPEN_BID ? 'Submitted · awaiting office' : status === 'Accepted' ? 'Allocated to you' : status);
export const bidTone = (status: string): 'amber' | 'green' | 'neutral' | 'red' => (status === OPEN_BID ? 'amber' : status === 'Accepted' ? 'green' : status === 'Rejected' ? 'red' : 'neutral');

/** Hosts whichever dialog a duty action asked for. */
export function DutyDialogs({ action, setAction, onAccepted }: { action: DutyAction | null; setAction: (a: DutyAction | null) => void; onAccepted?: () => void }) {
  if (!action) return null;
  if (action.kind === 'accept') return <AcceptDialog trip={action.trip} onClose={() => setAction(null)} onDone={() => { setAction(null); onAccepted?.(); }} />;
  if (action.kind === 'bid') return <BidDialog trip={action.trip} onClose={() => setAction(null)} onDone={() => setAction(null)} />;
  return <BidDetailDialog bid={action.bid} onClose={() => setAction(null)} onUpdate={(t) => setAction({ kind: 'bid', trip: t })} />;
}

const styles = StyleSheet.create({
  item: { backgroundColor: colors.card, borderWidth: 1, borderColor: '#DCE3EC', borderRadius: 12, marginBottom: 10, overflow: 'hidden' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 13, paddingLeft: 15, paddingRight: 12 },
  main: { flex: 1, minWidth: 0 },
  topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  when: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  time: { fontFamily, fontSize: 12.5, fontWeight: '700', color: '#334155', flexShrink: 0 },
  code: { fontFamily, fontSize: 11.5, color: '#6B7685', letterSpacing: 0.2, marginTop: 4 },
  route: { fontFamily, fontSize: 16, fontWeight: '700', color: '#0F172A', lineHeight: 22, marginTop: 5 },
  bottomLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10 },
  carLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EEF1F5' },
  carText: { flex: 1, minWidth: 0, fontFamily, fontSize: 14.5, fontWeight: '600', color: '#334155', lineHeight: 20 },
  summary: { fontFamily, fontSize: 12.5, color: '#475569', lineHeight: 18 },
  // The service type leads in bold red, with the distance beside it.
  serviceLine: { flex: 1, minWidth: 0, fontFamily, fontSize: 17, fontWeight: '800', color: colors.primary, lineHeight: 23 },
  km: { fontWeight: '600', color: '#475569', fontSize: 15 },
  // Compact red amount tag: a micro label over the figure, sized to its content so the route keeps the width.
  amount: { alignItems: 'flex-start', backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10 },
  amountLabel: { fontFamily, fontSize: 8, fontWeight: '600', color: 'rgba(255,255,255,0.82)', letterSpacing: 0.8 },
  amountValue: { fontFamily, fontSize: 15, fontWeight: '700', color: colors.white, letterSpacing: -0.2, marginTop: 1 },
  status: { fontFamily, fontSize: 11, fontWeight: '600', color: '#6B7685', flexShrink: 1 },
  actionsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 15, paddingBottom: 15 },
  extra: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 11, flexWrap: 'wrap' },
  extraText: { fontFamily, fontSize: 11, color: '#6F7785', lineHeight: 18, flexShrink: 1 },
  extraStrong: { color: '#426E91', fontWeight: '500' },
  offer: { padding: 17, borderWidth: 1, borderColor: '#E0E8F2', backgroundColor: '#F6F7F9', borderRadius: 10, marginTop: 16, marginBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  offerLabel: { fontFamily, fontSize: 12, color: '#6F7785' },
  offerValue: { fontFamily, fontSize: 23, fontWeight: '700', color: '#424B5A', letterSpacing: -0.5 },
  explainer: { fontFamily, fontSize: 12.5, lineHeight: 20, color: '#6F7785', marginTop: 12 },
  valid: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: -6, marginBottom: 12 },
  validText: { fontFamily, fontSize: 11.5, color: '#6F7785' },
  obligation: { borderWidth: 1, borderColor: '#E0E7EF', backgroundColor: '#F6F7F9', borderRadius: 10, padding: 15, marginVertical: 14, gap: 12 },
  obRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  obText: { fontFamily, flex: 1, fontSize: 11.5, lineHeight: 18, color: '#6F7785' },
  obStrong: { fontSize: 12.5, color: '#6F7785', fontWeight: '600' },
  windowHelp: { fontFamily, fontSize: 11.5, lineHeight: 19, color: '#8B919C' },
  dialogActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
});
