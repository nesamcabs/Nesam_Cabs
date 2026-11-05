// Bookings — accepted duties and the assigned team (client reference vBookings, booking details, cancellation request).
import React, { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useVendorData } from '../context/VendorData';
import { EmptyState, Screen, Sheet, TextField, Chip } from '../components/ui';
import { DispatchSheet } from '../components/duty/DispatchSheet';
import { DutyCard, Feedback, KV, Obligation, PageHeading, Panel, PBadge, PButton, UTabs, dayTime, plate, rupees, type Tone } from '../components/partner';
import { CANCEL_REASONS, assignDeadline, quoteCancellation, requestCancellation, type PartnerRequestRecord } from '../services/partnerOps';
import type { VendorBooking } from '../types/operations';
import type { RootStackParamList } from '../navigation/types';
import { colors, space } from '../theme';

export type Stage = 'Accepted' | 'Upcoming' | 'On Trip' | 'Completed' | 'Cancelled';

export function stageOf(b: VendorBooking): Stage {
  if (b.status === 'Completed') return 'Completed';
  if (b.status === 'Cancelled' || b.status === 'Rejected') return 'Cancelled';
  if (b.status === 'Ongoing' || ['Reached Pickup', 'Trip Started', 'Trip Ended'].includes(b.tripSubStatus)) return 'On Trip';
  return b.driverId && b.vehicleId ? 'Upcoming' : 'Accepted';
}
const canChange = (b: VendorBooking) => ['Accepted', 'Upcoming'].includes(stageOf(b)) && (!b.tripSubStatus || b.tripSubStatus === 'Not Started');
const BADGE: Record<Stage, [Tone, string]> = { Accepted: ['amber', 'Accepted'], Upcoming: ['neutral', 'Driver assigned'], 'On Trip': ['red', 'Trip in progress'], Completed: ['green', 'Completed'], Cancelled: ['neutral', 'Cancelled'] };
const SERVICES = ['All', 'One Way', 'Round Trip', 'Airport', 'Multicity', 'Local Rental'];

export function BookingsScreen() {
  const navigation = useNavigation();
  const d = useVendorData();
  const [tab, setTab] = useState<Stage>('Accepted');
  const [search, setSearch] = useState('');
  const [service, setService] = useState('All');
  const [dispatch, setDispatch] = useState<VendorBooking | null>(null);
  const [notice, setNotice] = useState('');
  const [now] = useState(() => Date.now());

  const counts = useMemo(() => {
    const c: Record<Stage, number> = { Accepted: 0, Upcoming: 0, 'On Trip': 0, Completed: 0, Cancelled: 0 };
    for (const b of d.bookings) c[stageOf(b)]++;
    return c;
  }, [d.bookings]);
  const accepted = d.bookings.filter((b) => stageOf(b) === 'Accepted');
  const next = accepted.map((b) => assignDeadline(b.acceptedAt, b.pickupAt, d.ops, b.assignBy)).filter((x): x is Date => !!x).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const q = search.trim().toLowerCase();
  const list = d.bookings.filter((b) => stageOf(b) === tab).filter((b) => service === 'All' || b.tripType === service)
    .filter((b) => !q || `${b.bookingId} ${b.pickupAddress} ${b.dropAddress}`.toLowerCase().includes(q))
    .sort((a, b) => (tab === 'Completed' ? -1 : 1) * ((a.pickupAt?.getTime() ?? 0) - (b.pickupAt?.getTime() ?? 0)));
  const released = d.requests.filter((r) => r.type === 'cancellation' && r.status === 'Approved' && !d.bookings.some((b) => b.id === r.bookingId));

  return (
    <Screen edges={[]}>
      <PageHeading title="Bookings" subtitle="Manage accepted duties and your assigned team."
        action={<PButton style="text" icon="chevron-forward" title={tab === 'Cancelled' ? 'Accepted' : 'Cancelled history'} onPress={() => setTab(tab === 'Cancelled' ? 'Accepted' : 'Cancelled')} />} />
      <Feedback message={notice} />
      {accepted.length ? (
        <Panel style={styles.pending}>
          <Text style={styles.pendingTitle}>{accepted.length} {accepted.length === 1 ? 'duty needs' : 'duties need'} assignment</Text>
          {next ? <Text style={styles.small}>Next deadline {dayTime(next)}</Text> : null}
        </Panel>
      ) : null}
      {tab !== 'Cancelled' ? (
        <UTabs value={tab} onChange={setTab} items={(['Accepted', 'Upcoming', 'On Trip', 'Completed'] as Stage[]).map((id) => ({ id, label: id, count: counts[id] }))} />
      ) : <Text style={styles.section}>Cancelled history</Text>}
      <TextField placeholder="Search route or Duty ID" value={search} onChangeText={setSearch} accessibilityLabel="Search route or Duty ID" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        {SERVICES.map((s) => <Chip key={s} label={s === 'All' ? 'All services' : s} active={service === s} onPress={() => setService(s)} />)}
      </ScrollView>
      {d.errors.bookings ? <Feedback tone="error" message={d.errors.bookings} /> : null}
      {list.length || (tab === 'Cancelled' && released.length) ? (
        <>
          {list.map((b) => {
            const st = stageOf(b);
            const deadline = st === 'Accepted' ? assignDeadline(b.acceptedAt, b.pickupAt, d.ops, b.assignBy) : null;
            return (
              <DutyCard key={b.id} pickupAt={b.pickupAt} pickupText={[b.date, b.time].filter(Boolean).join(' · ')} from={b.pickupAddress} to={b.dropAddress} tripType={b.tripType}
                category={b.vehicleCategory} km={b.includedKm || undefined} payout={b.payoutRecorded ? b.vendorPayout : null} code={b.bookingId}
                badge={<PBadge label={b.cancellationRequest?.status === 'Pending' ? 'Cancellation under review' : BADGE[st][1]} tone={BADGE[st][0]} />}
                team={[b.driverName || 'Driver pending', b.vehicleNumber ? plate(b.vehicleNumber) : 'Vehicle pending']}
                note={deadline ? <Text style={[styles.deadline, deadline.getTime() < now && { color: colors.danger }]}>{deadline.getTime() < now ? 'Assignment overdue since ' : 'Assign by '}{dayTime(deadline)}</Text> : null}
                onOpen={() => navigation.navigate('BookingDetail', { id: b.id })}
                footer={st === 'Accepted'
                  ? <PButton title="Assign driver" icon="person-add-outline" onPress={() => setDispatch(b)} />
                  : <PButton title={st === 'Completed' ? 'View statement' : 'View booking'} style="secondary" icon="chevron-forward" onPress={() => navigation.navigate('BookingDetail', { id: b.id })} />} />
            );
          })}
          {tab === 'Cancelled' ? released.map((r) => (
            <Panel key={r.id}>
              <View style={styles.between}><Text style={styles.small}>{dayTime(r.decidedAt)}</Text><PBadge label="Cancelled by NESAM" /></View>
              <Text style={styles.route}>{r.route}</Text>
              <Text style={styles.small}>{r.bookingCode} · {r.reasonLabel}</Text>
              <KV rows={[[r.finalPenalty ? 'Cancellation charge' : 'No cancellation charge', rupees(r.finalPenalty ?? 0)]]} />
              {r.adminReason ? <Text style={styles.small}>{r.adminReason}</Text> : null}
            </Panel>
          )) : null}
        </>
      ) : (
        <EmptyState title={tab === 'Cancelled' ? 'No cancelled bookings' : `No ${tab.toLowerCase()} bookings`}
          message={tab === 'Accepted' ? 'Accept a duty from Trips, then assign your driver and vehicle here.' : 'Driver updates and office decisions keep this list up to date.'} />
      )}
      {dispatch ? (
        <DispatchSheet booking={dispatch} onClose={() => setDispatch(null)} onDone={(name) => { setDispatch(null); setNotice(`${name} confirmed for ${dispatch.bookingId}. The driver has been notified.`); }}
          onAddDriver={() => { setDispatch(null); navigation.navigate('Tabs', { screen: 'Fleet', params: { tab: 'Drivers' } }); }} />
      ) : null}
    </Screen>
  );
}

export function BookingDetailScreen() {
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'BookingDetail'>>();
  const d = useVendorData();
  const [sheet, setSheet] = useState<'' | 'cancel' | 'dispatch' | 'terms'>('');
  const [notice, setNotice] = useState('');
  const b = d.bookings.find((x) => x.id === params.id);
  const req = d.requests.find((r) => r.bookingId === params.id && r.type === 'cancellation') ?? null;
  if (!b) {
    return (
      <Screen edges={[]}>
        <PageHeading title="Booking details" subtitle={req?.bookingCode ?? params.id} />
        <EmptyState title={req?.status === 'Approved' ? 'Duty cancelled by NESAM' : 'Booking not found'} message={req?.status === 'Approved' ? `${req.adminReason} Charge: ${rupees(req.finalPenalty ?? 0)}.` : 'This booking is no longer assigned to your business.'} />
      </Screen>
    );
  }
  const st = stageOf(b);
  const deadline = assignDeadline(b.acceptedAt, b.pickupAt, d.ops, b.assignBy);
  const due = d.dues.find((x) => x.id === b.id) ?? null;
  const r = b.driverResponse;
  return (
    <Screen edges={[]}>
      <PageHeading title="Booking details" subtitle={b.bookingId} />
      <Feedback message={notice} />
      <Panel>
        <View style={styles.between}>
          <View style={{ flexDirection: 'row', gap: 6 }}>{b.tripType ? <PBadge label={b.tripType} /> : null}{b.vehicleCategory ? <PBadge label={b.vehicleCategory} /> : null}</View>
          <PBadge label={BADGE[st][1]} tone={BADGE[st][0]} />
        </View>
        <Text style={styles.route}>{b.pickupAddress} → {b.dropAddress}</Text>
        <KV rows={[['Pickup', b.pickupAt ? dayTime(b.pickupAt) : [b.date, b.time].filter(Boolean).join(' · ') || '—'], ...(b.includedKm ? [['Included distance', `${b.includedKm} km`] as [string, string]] : []), ['Vehicle category', b.vehicleCategory || '—']]} />
      </Panel>

      {req && req.status !== 'Approved' ? <CancellationStatus r={req} /> : null}

      {st === 'Accepted' ? (
        <Panel>
          <View style={styles.between}><Text style={styles.h2}>Driver assignment</Text><PBadge label="Pending" tone="amber" /></View>
          <Text style={styles.small}>Choose your driver, then the vehicle. Review the duty terms before confirming.</Text>
          <Obligation value={deadline ? dayTime(deadline) : 'Before pickup'} penalty={d.ops.missedAssignmentPenalty} />
          <PButton title="Assign driver" icon="person-add-outline" onPress={() => setSheet('dispatch')} />
        </Panel>
      ) : b.driverId ? (
        <Panel>
          <View style={styles.between}><Text style={styles.h2}>{st === 'Upcoming' ? 'Assigned team' : 'Assigned driver & vehicle'}</Text>{st === 'Upcoming' ? <PBadge label="Confirmed" tone="green" /> : null}</View>
          <KV rows={[['Driver', b.driverName || '—'], ['Vehicle', b.vehicleNumber ? plate(b.vehicleNumber) : '—'], ['Customer', b.customerName || '—'], ['Customer mobile', b.customerPhoneMasked || 'Shared with the driver before pickup']]} />
          {canChange(b) ? <PButton title="Change driver or vehicle" icon="swap-horizontal-outline" style="secondary" onPress={() => setSheet('dispatch')} containerStyle={{ marginTop: space.md }} /> : null}
        </Panel>
      ) : null}

      {b.driverId && st !== 'Cancelled' ? (
        <Panel>
          <Text style={styles.h2}>Driver response</Text>
          <View style={[styles.chips, { marginTop: 10 }]}>
            <PBadge label="Sent" tone="green" />
            <PBadge label={r?.viewedAt ? 'Viewed' : 'Not viewed'} tone={r?.viewedAt ? 'green' : 'neutral'} />
            <PBadge label={r?.acknowledgedAt || st === 'On Trip' || st === 'Completed' ? 'Acknowledged' : 'Awaiting acknowledgement'} tone={r?.acknowledgedAt || st === 'On Trip' || st === 'Completed' ? 'green' : 'neutral'} />
          </View>
          <Text style={[styles.small, { marginTop: 8 }]}>Trip start and end updates come from the assigned driver’s app. Customer contact unlocks 8 hours before pickup.</Text>
        </Panel>
      ) : null}

      {st === 'On Trip' ? (
        <Panel>
          <Text style={styles.h2}>Trip in progress</Text>
          <Text style={styles.small}>Contact the office for any driver or vehicle change during a running trip.</Text>
          <PButton title="Call NESAM office" icon="call-outline" style="secondary" onPress={() => void Linking.openURL(`tel:${d.ops.supportPhone}`)} containerStyle={{ marginTop: space.md }} />
        </Panel>
      ) : null}

      {canChange(b) && !req ? (
        <Panel>
          <Text style={styles.h2}>Need office assistance?</Text>
          <View style={[styles.chips, { marginTop: 10 }]}>
            <PButton title="Request cancellation" icon="close-circle-outline" style="secondary" onPress={() => setSheet('cancel')} />
            <PButton title="24/7 Helpdesk" style="text" icon="chevron-forward" onPress={() => navigation.navigate('Helpdesk')} />
          </View>
        </Panel>
      ) : null}

      <Panel>
        <Text style={styles.eyebrow}>VENDOR PAYOUT</Text>
        <Text style={styles.big}>{rupees(b.payoutRecorded ? b.vendorPayout : null)}</Text>
        <Text style={styles.small}>Agreed payout for this duty</Text>
        {st === 'Completed' ? (
          <KV rows={[
            ['Final bill', b.paymentStatus === 'Paid' ? 'Closed' : 'Pending'],
            ['Settlement', due ? ({ Paid: 'Bank settled', Wallet: 'Wallet posted', Processing: 'Processing', Due: 'Settlement pending', 'On Hold': 'On hold', Failed: 'Payout failed' } as Record<string, string>)[due.status] ?? due.status : 'Settlement pending'],
            ...(due ? [['Fare retained by driver / vendor', rupees(due.collectedByPartner)] as [string, string], ['Trip adjustment', `${due.amount >= 0 ? '+' : '−'}${rupees(Math.abs(due.amount))}`] as [string, string]] : []),
          ]} />
        ) : <Text style={[styles.small, { marginTop: 8 }]}>Final accounts after trip. Cash reported by the driver is adjusted only after office verification.</Text>}
        <Text style={[styles.small, { marginTop: 10 }]}>{b.includedKm ? `${b.includedKm} km included. ` : ''}Toll, parking and state tax are extra. Record customer reimbursements separately from fare collection. Any amount due from NESAM requires office approval and supporting receipts.</Text>
        <PButton title="Accepted duty terms" style="text" icon="chevron-forward" onPress={() => setSheet('terms')} />
      </Panel>

      {sheet === 'cancel' ? <CancellationSheet booking={b} onClose={() => setSheet('')} onDone={(m) => { setSheet(''); setNotice(m); }} /> : null}
      {sheet === 'dispatch' ? <DispatchSheet booking={b} onClose={() => setSheet('')} onDone={(name) => { setSheet(''); setNotice(`${name} confirmed. The driver has been notified.`); }} /> : null}
      {sheet === 'terms' ? (
        <Sheet visible onClose={() => setSheet('')} title="Accepted duty terms">
          <KV rows={[
            ['Agreed vendor payout', rupees(b.payoutRecorded ? b.vendorPayout : null)],
            ['Assignment deadline', deadline ? dayTime(deadline) : '—'],
            ['Missed assignment deadline', rupees(d.ops.missedAssignmentPenalty)],
            [`Cancellation within ${d.ops.cancellation.graceHours} h of accepting`, rupees(0)],
            [`Cancellation after ${d.ops.cancellation.graceHours} h of accepting`, rupees(d.ops.cancellation.afterGraceCharge)],
            [`Cancellation within ${d.ops.cancellation.lastMinuteHours} h of pickup`, rupees(d.ops.cancellation.lastMinuteCharge)],
          ]} />
          <Text style={[styles.small, { marginTop: space.md }]}>Office-confirmed penalties are recorded in the working wallet. Only the confirmed driver and vehicle can operate the duty. Valid reasons may be waived by the NESAM office.</Text>
        </Sheet>
      ) : null}
    </Screen>
  );
}

function CancellationStatus({ r }: { r: PartnerRequestRecord }) {
  return (
    <Panel style={{ borderColor: colors.warningBorder }}>
      <View style={styles.between}><Text style={styles.h2}>{r.status === 'Declined' ? 'Cancellation request declined' : 'Cancellation under review'}</Text><PBadge label={r.status === 'Declined' ? 'Declined' : 'Pending'} tone="amber" /></View>
      <Text style={styles.small}>{r.status === 'Declined' ? 'This duty remains assigned. No cancellation charge has been deducted.' : 'The duty remains assigned until the office approves. Call NESAM if the pickup is approaching.'}</Text>
      <KV rows={[['Reason', r.reasonLabel], ['Requested', dayTime(r.requestedAt)], [r.status === 'Declined' ? 'Cancellation charge' : 'Potential charge', rupees(r.status === 'Declined' ? 0 : r.quotedPenalty)], ...(r.adminReason ? [['Office remarks', r.adminReason] as [string, string]] : [])]} />
    </Panel>
  );
}

/** Cancellation request; the charge shown is the server's quote at the moment of submission. */
export function CancellationSheet({ booking, onClose, onDone }: { booking: VendorBooking | null; onClose: () => void; onDone: (m: string) => void }) {
  const d = useVendorData();
  const eligible = d.bookings.filter((b) => canChange(b) && !d.requests.some((r) => r.bookingId === b.id && r.type === 'cancellation'));
  const [id, setId] = useState(booking?.id ?? '');
  const b = d.bookings.find((x) => x.id === id) ?? null;
  const [quote, setQuote] = useState(() => (b ? quoteCancellation(b.pickupAt, b.acceptedAt, d.ops.cancellation) : null));
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choose = (x: VendorBooking) => { setId(x.id); setQuote(quoteCancellation(x.pickupAt, x.acceptedAt, d.ops.cancellation)); };
  const submit = async () => {
    if (!b) return;
    if (!reason) { setError('Select a reason.'); return; }
    if (details.trim().length < 10) { setError('Describe the issue in at least 10 characters.'); return; }
    if (!quote) { setError('This duty has no pickup time. Call the NESAM office.'); return; }
    setBusy(true); setError('');
    try { await requestCancellation(b.id, reason, details, quote.amount); onDone('Request sent. Await office review; the duty remains assigned.'); }
    catch (e) {
      const x = (e as { details?: { code?: string; amount?: number; ruleLabel?: string } }).details;
      if (x?.code === 'quote-changed' && typeof x.amount === 'number') setQuote({ amount: x.amount, rule: x.ruleLabel ?? '' });
      setError((e as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <Sheet visible onClose={onClose} title="Cancellation" dismissible={!busy}>
      {!b ? (
        eligible.length ? (
          <>
            <Text style={styles.small}>Select a duty</Text>
            {eligible.map((x) => (
              <Pressable key={x.id} onPress={() => choose(x)} style={styles.pick} accessibilityRole="button">
                <Text style={styles.pickTitle}>{x.bookingId}</Text><Text style={styles.small}>{x.pickupAddress} → {x.dropAddress}</Text>
              </Pressable>
            ))}
          </>
        ) : <EmptyState title="No eligible duties" message="There are no duties available for this request. Running trips are changed by calling the office." />
      ) : (
        <>
          <Text style={styles.small}>{b.bookingId} · {b.pickupAddress} → {b.dropAddress}</Text>
          <Panel style={{ backgroundColor: colors.warningSoft, borderColor: colors.warningBorder, marginTop: space.sm }}>
            <Text style={styles.h3}>Office approval is required</Text>
            <Text style={styles.small}>The existing duty and assignment remain active until approval.</Text>
          </Panel>
          <KV rows={[['Proposed cancellation charge', rupees(quote?.amount ?? 0)], ...(quote?.rule ? [['Window', quote.rule] as [string, string]] : [])]} />
          <Text style={[styles.small, { marginTop: space.md }]}>Reason</Text>
          <View style={styles.chips}>{CANCEL_REASONS.map(([k, v]) => <Chip key={k} label={v} active={reason === k} onPress={() => setReason(k)} />)}</View>
          <TextField label="Reason for office review" value={details} onChangeText={setDetails} multiline maxLength={500} />
          <Text style={styles.small}>By submitting, you confirm you reviewed the proposed charge and understand this is a cancellation request.</Text>
          <Feedback tone="error" message={error} />
          <PButton title="Submit request" icon="arrow-forward" full busy={busy} onPress={() => void submit()} containerStyle={{ marginTop: space.md }} />
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pending: { backgroundColor: colors.warningSoft, borderColor: colors.warningBorder },
  pendingTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  small: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  section: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: space.md },
  chipsScroll: { flexGrow: 0 },
  chips: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingRight: space.lg },
  deadline: { fontSize: 12, color: colors.warning, fontWeight: '600', marginTop: 8 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  route: { fontSize: 18, fontWeight: '600', color: colors.ink, marginTop: 10 },
  h2: { fontSize: 16, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  h3: { fontSize: 14, fontWeight: '700', color: colors.warning },
  eyebrow: { fontSize: 11, letterSpacing: 1.2, color: colors.muted, fontWeight: '600' },
  big: { fontSize: 30, fontWeight: '700', color: colors.ink, marginTop: 6 },
  pick: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginTop: 8 },
  pickTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
});
