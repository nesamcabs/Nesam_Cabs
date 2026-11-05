// Trips — "Find your next duty." Open marketplace duties (client reference wTrips / accept + bid sheets).
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useVendorData } from '../context/VendorData';
import { useInbox } from '../context/Inbox';
import { Chip, EmptyState, Screen, Sheet, TextField } from '../components/ui';
import { DutyCard, Feedback, GateBanner, KV, Obligation, PageHeading, PButton, dayText, dayTime, rupees } from '../components/partner';
import { acceptOfferedRate, submitCounterBid, withdrawBid } from '../services/vendorService';
import type { MarketTrip, VendorBid } from '../types/operations';
import { colors, space } from '../theme';

const TYPES = ['All', 'One Way', 'Round Trip', 'Multicity', 'Local Rental'];
const isoDay = (ms: number) => (ms ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(ms)) : 'later');
const typeOf = (t: MarketTrip) => {
  const raw = `${t.tripType} ${t.service}`.toLowerCase();
  return /round/.test(raw) ? 'Round Trip' : /rental|local|hour/.test(raw) ? 'Local Rental' : /multi/.test(raw) ? 'Multicity' : /airport/.test(raw) ? 'Airport' : /one|drop|outstation/.test(raw) ? 'One Way' : t.tripType || t.service;
};

function assignByIfAcceptedNow(t: MarketTrip, windowH: number, beforeH: number): Date {
  const now = Date.now();
  const byWindow = now + windowH * 3600000;
  if (!t.pickupMs) return new Date(byWindow);
  const preferred = Math.min(byWindow, t.pickupMs - beforeH * 3600000);
  return new Date(preferred > now ? preferred : Math.min(byWindow, t.pickupMs));
}

export function TripsScreen() {
  const navigation = useNavigation();
  const d = useVendorData();
  const { unacknowledged } = useInbox();
  const gate = unacknowledged[0] ?? null;
  const [type, setType] = useState('All');
  const [date, setDate] = useState('');
  const [sheet, setSheet] = useState<null | { kind: 'accept' | 'bid'; trip: MarketTrip } | { kind: 'bid-detail'; bid: VendorBid }>(null);
  const [notice, setNotice] = useState('');

  const dates = useMemo(() => [...new Set(d.marketTrips.map((t) => isoDay(t.pickupMs)).filter((x) => x !== 'later'))].sort().slice(0, 6), [d.marketTrips]);
  const groups = useMemo(() => {
    const list = d.marketTrips
      .filter((t) => type === 'All' || typeOf(t) === type)
      .filter((t) => !date || isoDay(t.pickupMs) === date)
      .sort((a, b) => (a.pickupMs || Infinity) - (b.pickupMs || Infinity));
    const map = new Map<string, MarketTrip[]>();
    for (const t of list) map.set(isoDay(t.pickupMs), [...(map.get(isoDay(t.pickupMs)) ?? []), t]);
    return [...map.entries()];
  }, [d.marketTrips, type, date]);

  const pendingAssign = d.awaitingDispatch.length;
  const docAlerts = d.vehicles.filter((v) => v.docStatus === 'Rejected').length + d.drivers.filter((x) => x.docStatus === 'Rejected' || x.approvalStatus === 'Rejected').length;
  const depositActive = d.deposit?.status === 'Active';

  return (
    <Screen edges={[]}>
      <PageHeading title="Trips" subtitle="Find your next duty." />
      <Feedback message={notice} />
      <View style={styles.balance}>
        <Pressable style={styles.balanceItem} onPress={() => navigation.navigate('Tabs', { screen: 'Wallet' })} accessibilityRole="button">
          <Ionicons name="wallet-outline" size={20} color={colors.muted} />
          <View style={{ flex: 1 }}><Text style={styles.balanceLabel}>Wallet</Text><Text style={[styles.balanceValue, d.wallet.available < 0 && { color: colors.danger }]}>{rupees(d.wallet.available)}</Text></View>
          <Ionicons name="chevron-forward" size={16} color={colors.faint} />
        </Pressable>
        <View style={styles.balanceRule} />
        <Pressable style={styles.balanceItem} onPress={() => navigation.navigate('Tabs', { screen: 'Wallet' })} accessibilityRole="button">
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.muted} />
          <View style={{ flex: 1 }}><Text style={styles.balanceLabel}>Security deposit</Text><Text style={[styles.depositValue, !depositActive && { color: colors.muted }]}>{d.deposit ? (depositActive ? 'Active' : d.deposit.status) : 'Not recorded'}</Text></View>
          <View style={[styles.dot, depositActive && { backgroundColor: colors.success }]} />
        </Pressable>
      </View>

      {gate ? (
        <GateBanner title="New duty acceptance needs attention" message="Acknowledge your penalty notice before accepting a new duty."
          action={<PButton title="Acknowledge" style="secondary" icon="checkmark-done-outline" onPress={() => navigation.navigate('Penalties')} />} />
      ) : null}
      {pendingAssign || docAlerts ? (
        <View style={styles.quick}>
          {pendingAssign ? <PButton style="text" icon="chevron-forward" title={`${pendingAssign} assignment${pendingAssign === 1 ? '' : 's'} pending`} onPress={() => navigation.navigate('Tabs', { screen: 'Bookings' })} /> : null}
          {docAlerts ? <PButton style="text" icon="chevron-forward" title={`${docAlerts} document alert${docAlerts === 1 ? '' : 's'}`} onPress={() => navigation.navigate('Documents')} /> : null}
        </View>
      ) : null}

      <Text style={styles.filterLabel}>Trip type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 4 }}>
        {TYPES.map((t) => <Chip key={t} label={t === 'All' ? 'All trip types' : t} active={type === t} onPress={() => setType(t)} />)}
      </ScrollView>
      {dates.length ? (
        <>
          <Text style={styles.filterLabel}>Pickup date</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 4 }}>
            <Chip label="All dates" active={!date} onPress={() => setDate('')} />
            {dates.map((k) => <Chip key={k} label={dayText(new Date(`${k}T12:00:00+05:30`))} active={date === k} onPress={() => setDate(k)} />)}
          </ScrollView>
        </>
      ) : null}

      {d.errors.market ? <Feedback tone="error" message={d.errors.market} /> : null}
      {groups.length === 0 ? (
        <EmptyState title={d.marketTrips.length ? 'No duties for this selection' : 'No matching duties'} message={d.marketTrips.length ? 'Try another pickup date or trip type.' : 'New duties will appear here as soon as NESAM publishes them.'} />
      ) : groups.map(([k, list]) => (
        <View key={k} style={{ marginTop: space.md }}>
          <View style={styles.groupHead}><Text style={styles.groupTitle}>{k === 'later' ? 'Pickup date to be confirmed' : dayText(new Date(list[0]!.pickupMs))}</Text><Text style={styles.groupCount}>{list.length} {list.length === 1 ? 'duty' : 'duties'}</Text></View>
          {list.map((t) => {
            const bid = d.bids.find((b) => b.tripId === t.id && b.status === 'Pending Review');
            const canAccept = t.mode !== 'bid_review' && t.offeredPayout > 0;
            return (
              <DutyCard key={t.id} pickupAt={t.pickupMs ? new Date(t.pickupMs) : null} pickupText={[t.travelDate, t.pickup.time].filter(Boolean).join(' · ')} from={t.pickup.city || t.pickup.address} to={t.drop.city || t.drop.address}
                tripType={typeOf(t)} category={t.vehicleCategory} km={t.distanceKm ? Math.round(t.distanceKm) : undefined} payout={t.offeredPayout} code={t.bookingId}
                note={bid ? <Text style={styles.bidNote}>Your bid {rupees(bid.vendorCounterRate)}{bid.autoAcceptConsent ? '' : ' · Consent needed'}</Text> : null}
                footer={
                  <>
                    {canAccept ? <PButton title="Accept duty" icon="checkmark-circle-outline" onPress={() => setSheet({ kind: 'accept', trip: t })} /> : null}
                    {bid ? <PButton title="View bid" style="bid" icon="trending-up-outline" onPress={() => setSheet({ kind: 'bid-detail', bid })} />
                      : t.mode !== 'accept_offer' ? <PButton title="Place bid" style="bid" icon="trending-up-outline" onPress={() => setSheet({ kind: 'bid', trip: t })} /> : null}
                  </>
                } />
            );
          })}
        </View>
      ))}

      {sheet && (sheet.kind === 'accept' || sheet.kind === 'bid') && gate ? (
        <Sheet visible onClose={() => setSheet(null)} title="Before accepting this duty">
          <Text style={styles.intro}>{sheet.trip.bookingId} · {sheet.trip.route}</Text>
          <GateBanner title="Action required" message="Acknowledge your penalty notice before accepting a new duty." action={null} />
          <PButton title="Acknowledge notice" icon="checkmark-done-outline" full onPress={() => { setSheet(null); navigation.navigate('Penalties'); }} />
          <Text style={[styles.help, { marginTop: space.md }]}>Existing accepted and running duties continue. Return to this duty after resolving the requirement.</Text>
        </Sheet>
      ) : sheet?.kind === 'accept' ? (
        <AcceptSheet trip={sheet.trip} onClose={() => setSheet(null)} onDone={(m) => { setSheet(null); setNotice(m); navigation.navigate('Tabs', { screen: 'Bookings' }); }} />
      ) : sheet?.kind === 'bid' ? (
        <BidSheet trip={sheet.trip} onClose={() => setSheet(null)} onDone={(m) => { setSheet(null); setNotice(m); }} />
      ) : sheet?.kind === 'bid-detail' ? (
        <BidDetailSheet bid={sheet.bid} onClose={() => setSheet(null)} onDone={(m) => { setSheet(null); setNotice(m); }}
          onUpdate={(t) => setSheet({ kind: 'bid', trip: t })} />
      ) : null}
    </Screen>
  );
}

function AcceptSheet({ trip, onClose, onDone }: { trip: MarketTrip; onClose: () => void; onDone: (m: string) => void }) {
  const d = useVendorData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const by = assignByIfAcceptedNow(trip, d.ops.assignmentWindowHours, d.ops.assignBeforePickupHours);
  const accept = async () => {
    setBusy(true); setError('');
    try { await acceptOfferedRate(d.identity, trip); onDone(`Duty ${trip.bookingId} accepted. Assign your driver and vehicle by ${dayTime(by)}.`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet visible onClose={onClose} title="Accept duty" dismissible={!busy}>
      <Text style={styles.intro}>{trip.route}</Text>
      <KV rows={[['Pickup', trip.pickupMs ? dayTime(new Date(trip.pickupMs)) : trip.travelDate || '—'], ['Vehicle category', trip.vehicleCategory || '—'], ['Trip type', typeOf(trip) || '—'], ['Vendor payout', rupees(trip.offeredPayout)]]} />
      <Obligation value={dayTime(by)} penalty={d.ops.missedAssignmentPenalty} />
      <Text style={styles.help}>After acceptance, assign a driver, choose the vehicle and confirm the duty terms in Bookings.</Text>
      <Feedback tone="error" message={error} />
      <PButton title="Accept duty" icon="checkmark-circle-outline" busy={busy} full onPress={() => void accept()} containerStyle={{ marginTop: space.md }} />
    </Sheet>
  );
}

function BidSheet({ trip, onClose, onDone }: { trip: MarketTrip; onClose: () => void; onDone: (m: string) => void }) {
  const d = useVendorData();
  const existing = d.bids.find((b) => b.tripId === trip.id && b.status === 'Pending Review') ?? null;
  const [amount, setAmount] = useState(existing ? String(existing.vendorCounterRate) : '');
  const [note, setNote] = useState(existing?.biddingNote ?? '');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const validUntil = trip.cutoffMs || trip.pickupMs;
  const submit = async () => {
    const rate = Number(amount);
    if (!Number.isSafeInteger(rate) || rate <= 0) { setError('Enter your expected payout in whole rupees.'); return; }
    if (!consent) { setError('Confirm the automatic acceptance and assignment terms to place a bid.'); return; }
    setBusy(true); setError('');
    try { await submitCounterBid(d.identity, trip, rate, note, true); onDone(existing ? 'Bid updated.' : `Bid of ${rupees(rate)} placed for ${trip.bookingId}.`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet visible onClose={onClose} title={existing ? 'Update bid' : 'Place bid'} dismissible={!busy}>
      <Text style={styles.intro}>{trip.route}</Text>
      <View style={styles.offer}><Text style={styles.help}>Current vendor payout</Text><Text style={styles.offerValue}>{rupees(trip.offeredPayout)}</Text></View>
      <TextField label="Your expected payout (₹)" value={amount} onChangeText={(v) => setAmount(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder={trip.offeredPayout ? `e.g. ${Math.round(trip.offeredPayout * 1.2)}` : 'e.g. 1800'} />
      {validUntil ? <Text style={styles.help}>Valid until {dayTime(new Date(validUntil))}</Text> : null}
      <Obligation label="Assignment window" value={`${d.ops.assignmentWindowHours} hours after auto acceptance`} help={`Confirm at least ${d.ops.assignBeforePickupHours} hour before pickup where possible. Urgent duties must be assigned before pickup.`} penalty={d.ops.missedAssignmentPenalty} />
      <TextField label="Note for the NESAM team (optional)" value={note} onChangeText={setNote} maxLength={300} multiline />
      <View style={styles.consent}>
        <Switch value={consent} onValueChange={setConsent} trackColor={{ true: colors.primary, false: colors.border }} accessibilityLabel="Automatic acceptance consent" />
        <Text style={[styles.help, { flex: 1 }]}>Automatically accept this duty for my business when the approved payout reaches my bid or higher. I will confirm the driver and vehicle within the shown assignment window and understand the penalty for missing it.</Text>
      </View>
      <Feedback tone="error" message={error} />
      <PButton title={existing ? 'Update bid' : 'Place bid'} icon="trending-up-outline" busy={busy} full onPress={() => void submit()} containerStyle={{ marginTop: space.md }} />
    </Sheet>
  );
}

function BidDetailSheet({ bid, onClose, onDone, onUpdate }: { bid: VendorBid; onClose: () => void; onDone: (m: string) => void; onUpdate: (t: MarketTrip) => void }) {
  const d = useVendorData();
  const trip = d.marketTrips.find((t) => t.id === bid.tripId) ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const withdraw = async () => {
    setBusy(true); setError('');
    try { await withdrawBid(bid); onDone('Bid withdrawn.'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet visible onClose={onClose} title="Your bid" dismissible={!busy}>
      <Text style={styles.intro}>{trip?.route ?? bid.bookingId}</Text>
      <KV rows={[['Status', bid.status === 'Pending Review' ? 'Submitted' : bid.status], ['Your minimum payout', rupees(bid.vendorCounterRate)], ['Current office offer', rupees(trip?.offeredPayout ?? bid.offeredPayout)], ['Submitted', dayTime(bid.submittedAt)]]} />
      {!bid.autoAcceptConsent ? <GateBanner title="Auto allocation consent needed" message="Authorize automatic acceptance to update this bid." action={null} /> : null}
      <Feedback tone="error" message={error} />
      <View style={{ flexDirection: 'row', gap: 10, marginTop: space.md }}>
        {trip ? <PButton title="Update bid" icon="create-outline" onPress={() => onUpdate(trip)} /> : null}
        <PButton title="Withdraw bid" style="secondary" icon="close" busy={busy} onPress={() => void withdraw()} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  balance: { flexDirection: 'row', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, marginBottom: space.md },
  balanceItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, minHeight: 64 },
  balanceRule: { width: 1, backgroundColor: colors.border, marginVertical: 12 },
  balanceLabel: { fontSize: 11, color: colors.muted },
  balanceValue: { fontSize: 17, fontWeight: '700', color: colors.ink },
  depositValue: { fontSize: 14, fontWeight: '700', color: colors.success },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.faint },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: space.sm },
  filterLabel: { fontSize: 12, color: colors.text, marginTop: space.sm, marginBottom: 6 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: space.sm },
  groupTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  groupCount: { fontSize: 11, color: colors.muted },
  bidNote: { fontSize: 12, color: colors.primary, fontWeight: '600', marginTop: 8 },
  intro: { fontSize: 14, color: colors.text, marginBottom: space.sm },
  help: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  offer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.bg, borderRadius: 12, padding: 14, marginBottom: space.md },
  offerValue: { fontSize: 20, fontWeight: '700', color: colors.ink },
  consent: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: space.sm },
});
