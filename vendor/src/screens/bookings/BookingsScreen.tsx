// Bookings — accepted duties and the assigned team (reference vBookings / s-booking-card): pending-assignment summary,
// Accepted · Upcoming · On Trip · Completed tabs (+ Cancelled history), search and service filter, booking cards.
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/kit/Text';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { Page } from '../../components/shell/Page';
import { Badge, Btn, Dropdown, Empty, Feedback, Grid, KV, Meta, Panel, RouteTitle, SearchBox, SectionLine, Small, Tabs, TextLink, Toolbar } from '../../components/kit/core';
import { dayTime, firstPart, plate, rupees, tripTypeLabel } from '../../components/kit/format';
import { goSection } from '../../navigation/navigationRef';
import { assignDeadline } from '../../services/partnerOps';
import type { VendorBooking } from '../../types/operations';
import type { BookingTab, RootStackParamList } from '../../navigation/types';
import { ExtraTag } from '../trips/parts';
import { liveLabel } from './TripTimeline';
import { payoutOf, STAGE_BADGE, stageOf, type Stage } from './logic';
import { colors, fontFamily } from '../../theme';
import { useLayout } from '../../theme/responsive';

const SERVICES = ['All', 'One Way', 'Round Trip', 'Airport', 'Multicity', 'Local Rental', 'Pickup & Drop'];
const TABS: Stage[] = ['Accepted', 'Upcoming', 'On Trip', 'Completed'];

export function BookingsScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Bookings'>>();
  const d = useVendorData();
  const [tab, setTab] = useState<BookingTab>(route.params?.tab ?? 'Accepted');
  const [seen, setSeen] = useState(route.params?.tab);
  if (route.params?.tab !== seen) { setSeen(route.params?.tab); if (route.params?.tab) setTab(route.params.tab); }
  const [search, setSearch] = useState('');
  const [service, setService] = useState('All');
  const [now] = useState(() => Date.now());

  const counts = useMemo(() => {
    const c: Record<Stage, number> = { Accepted: 0, Upcoming: 0, 'On Trip': 0, Completed: 0, Cancelled: 0 };
    for (const b of d.bookings) c[stageOf(b)]++;
    return c;
  }, [d.bookings]);

  const accepted = d.bookings.filter((b) => stageOf(b) === 'Accepted');
  const deadlines = accepted.map((b) => assignDeadline(b.acceptedAt, b.pickupAt, d.ops, b.assignBy)).filter((x): x is Date => !!x).sort((a, b) => a.getTime() - b.getTime());
  const overdue = deadlines.filter((x) => x.getTime() < now).length;
  const q = search.trim().toLowerCase();
  const list = d.bookings
    .filter((b) => stageOf(b) === tab)
    .filter((b) => service === 'All' || tripTypeLabel(b.tripType) === service)
    .filter((b) => !q || `${b.bookingId} ${b.pickupAddress} ${b.dropAddress} ${b.driverName} ${b.vehicleNumber}`.toLowerCase().includes(q))
    .sort((a, b) => (tab === 'Completed' || tab === 'Cancelled' ? -1 : 1) * ((a.pickupAt?.getTime() ?? 0) - (b.pickupAt?.getTime() ?? 0)));
  const released = tab === 'Cancelled' ? d.requests.filter((r) => r.type === 'cancellation' && r.status === 'Approved' && !d.bookings.some((b) => b.id === r.bookingId)) : [];

  return (
    <Page title="Bookings">
      {tab === 'Accepted' && accepted.length ? (
        <View style={[styles.pending, overdue ? styles.pendingOverdue : null]}>
          <View style={[styles.pendingIcon, overdue ? { backgroundColor: '#FBEAE3' } : null]}>
            <Ionicons name="person-add-outline" size={20} color={overdue ? '#B77F63' : '#8B919C'} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.pendingTitle, overdue ? { color: '#975D43' } : null]}>{accepted.length} {accepted.length === 1 ? 'duty needs' : 'duties need'} assignment</Text>
            {deadlines[0] ? <Text style={styles.pendingSub}>{overdue ? `${overdue} overdue · ` : ''}Next deadline {dayTime(deadlines[0])}</Text> : null}
          </View>
        </View>
      ) : null}
      {tab !== 'Cancelled' ? (
        <Tabs value={tab} onChange={setTab} items={TABS.map((id) => ({ id, label: id, count: counts[id] }))} style={{ marginTop: tab === 'Accepted' && accepted.length ? 4 : 0, marginBottom: 14 }} />
      ) : null}
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search route, Duty ID, driver or vehicle" />
        <Dropdown label="Service type" icon="options-outline" value={service} onChange={setService} options={SERVICES.map((x) => ({ value: x, label: x === 'All' ? 'All services' : x }))} style={{ minWidth: 170 }} />
      </Toolbar>
      {d.errors.bookings ? <Feedback tone="error" message={d.errors.bookings} /> : null}
      {tab === 'Cancelled' ? (
        <SectionLine title="Cancelled history" meta={`${list.length + released.length}`} action={<TextLink title="Back to bookings" icon="arrow-back" onPress={() => setTab('Accepted')} />} />
      ) : (
        <SectionLine
          meta={`${list.length} ${list.length === 1 ? 'booking' : 'bookings'}`}
          action={<TextLink title={`Cancelled history${counts.Cancelled ? ` (${counts.Cancelled})` : ''}`} onPress={() => setTab('Cancelled')} />}
        />
      )}
      {list.length || released.length ? (
        <Grid>
          {[
            ...list.map((b) => <BookingCard key={b.id} b={b} now={now} />),
            ...released.map((r) => (
              <Panel key={r.id}>
                <View style={styles.top}><Small>{dayTime(r.decidedAt)}</Small><Badge label="Cancelled by NESAM" /></View>
                <Text style={styles.route}>{r.route}</Text>
                <Small>{r.bookingCode} · {r.reasonLabel}</Small>
                <KV rows={[[r.finalPenalty ? 'Cancellation charge' : 'No cancellation charge', rupees(r.finalPenalty ?? 0)]]} />
                {r.adminReason ? <Small style={{ marginTop: 6 }}>Office: {r.adminReason}</Small> : null}
              </Panel>
            )),
          ]}
        </Grid>
      ) : (
        <Empty
          icon="ticket-outline"
          title={tab === 'Accepted' ? 'No duties awaiting assignment' : tab === 'Upcoming' ? 'No upcoming bookings' : tab === 'On Trip' ? 'No trips running' : tab === 'Cancelled' ? 'No cancelled bookings' : 'No completed trips'}
          text={tab === 'Accepted' ? 'Accepted duties appear here before driver and vehicle confirmation.' : 'Driver updates and office decisions keep this list up to date.'}
          action={tab === 'Accepted' ? <Btn kind="secondary" icon="map-outline" title="Find a duty" onPress={() => goSection('Trips')} /> : undefined}
        />
      )}
    </Page>
  );
}

export function BookingCard({ b, now }: { b: VendorBooking; now: number }) {
  const navigation = useNavigation();
  const d = useVendorData();
  const { wide } = useLayout();
  const st = stageOf(b);
  const deadline = st === 'Accepted' ? assignDeadline(b.acceptedAt, b.pickupAt, d.ops, b.assignBy) : null;
  const late = !!deadline && deadline.getTime() < now;
  const cancelPending = b.cancellationRequest?.status === 'Pending' || d.requests.some((r) => r.bookingId === b.id && r.type === 'cancellation' && r.status === 'Pending');
  const [label, tone] = late ? ['Assignment overdue', 'red' as const] : cancelPending ? ['Cancellation under review', 'amber' as const]
    : st === 'On Trip' && !b.trip.startedAt && b.trip.reachedPickupAt ? ['Driver at pickup', 'blue' as const] : STAGE_BADGE[st];
  const open = () => navigation.navigate('Booking', { id: b.id });
  return (
    <Panel style={{ paddingVertical: wide ? 22 : 18, paddingHorizontal: wide ? 24 : 18, flexGrow: 1 }}>
      <View style={styles.top}>
        <View style={styles.date}><Ionicons name="calendar-outline" size={15} color="#6F7785" /><Text style={styles.dateText}>{b.pickupAt ? dayTime(b.pickupAt) : [b.date, b.time].filter(Boolean).join(' · ')}</Text></View>
        <Badge label={label} tone={tone} />
      </View>
      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`Open booking ${b.bookingId}`}>
        <RouteTitle from={firstPart(b.pickupAddress)} to={firstPart(b.dropAddress)} size={18} />
      </Pressable>
      <Meta items={[{ icon: 'car-outline', text: b.vehicleCategory || 'Vehicle' }, b.includedKm ? { icon: 'git-commit-outline', text: `${b.includedKm} km` } : null, { text: tripTypeLabel(b.tripType), badge: true }]} />
      {st === 'Accepted' || b.driverId ? (
        <View style={styles.team}>
          <View style={styles.teamItem}><Ionicons name={b.driverId ? 'person' : 'person-outline'} size={15} color="#6F7785" /><Text style={styles.teamText}>{b.driverName || 'Driver pending'}</Text></View>
          <View style={styles.teamItem}><Ionicons name="car-outline" size={15} color="#6F7785" /><Text style={styles.teamText}>{b.vehicleNumber ? plate(b.vehicleNumber) : 'Vehicle pending'}</Text></View>
        </View>
      ) : null}
      {deadline ? (
        <View style={[styles.deadline, late && styles.deadlineLate]}>
          <Ionicons name={late ? 'warning-outline' : 'time-outline'} size={14} color={late ? '#A66D42' : colors.warning} />
          <Text style={[styles.deadlineText, late && { color: '#A66D42' }]}>{late ? 'Assignment deadline missed · ' : 'Assign by '}{dayTime(deadline)}</Text>
        </View>
      ) : st === 'Upcoming' || st === 'On Trip' ? (
        <View style={styles.liveRow}>
          {st === 'On Trip' ? <View style={styles.liveDot} /> : <Ionicons name="radio-outline" size={14} color="#8B919C" />}
          <Text style={[styles.liveText, st === 'On Trip' && { color: '#B81C2A' }]}>{liveLabel(b)}</Text>
        </View>
      ) : st === 'Completed' && b.trip.totalKm ? (
        <Small style={{ marginTop: 10 }}>{b.trip.totalKm.toLocaleString('en-IN')} km driven{b.trip.endedAt ? ` · completed ${dayTime(b.trip.endedAt)}` : ''}</Small>
      ) : null}
      {st !== 'Cancelled' ? <ExtraTag /> : null}
      <View style={{ flex: 1 }} />
      <View style={styles.bottom}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.rateLabel}>Vendor payout</Text>
          <Text style={styles.rate}>{rupees(payoutOf(b))}</Text>
        </View>
        {st === 'Accepted'
          ? <Btn title="Assign driver" icon="person-add" onPress={() => navigation.navigate('Assign', { id: b.id })} />
          : <Btn kind="secondary" title={st === 'Completed' ? 'View statement' : 'View booking'} icon="open-outline" onPress={open} />}
      </View>
      <Pressable onPress={open} accessibilityRole="link" style={{ marginTop: 12 }}><Text style={styles.code}>{b.bookingId} ›</Text></Pressable>
    </Panel>
  );
}

const styles = StyleSheet.create({
  pending: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.card, borderWidth: 1, borderColor: '#DEE7F2', borderRadius: 11, paddingVertical: 15, paddingHorizontal: 17, marginBottom: 4 },
  pendingOverdue: { backgroundColor: '#FFF8F5', borderColor: '#EFD9CF' },
  pendingIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F6F7F9', alignItems: 'center', justifyContent: 'center' },
  pendingTitle: { fontFamily, fontSize: 13.5, fontWeight: '600', color: '#6F7785' },
  pendingSub: { fontFamily, fontSize: 11.5, color: '#8B919C', marginTop: 3 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' },
  date: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  dateText: { fontFamily, fontSize: 12, color: '#6F7785', fontWeight: '500' },
  route: { fontFamily, fontSize: 16, fontWeight: '600', color: colors.ink, marginBottom: 4 },
  team: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, rowGap: 6, marginTop: 15 },
  teamItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  teamText: { fontFamily, fontSize: 12, color: '#6F7785' },
  deadline: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 11 },
  deadlineLate: { backgroundColor: '#FFF6ED', borderRadius: 8, paddingVertical: 9, paddingHorizontal: 11 },
  deadlineText: { fontFamily, fontSize: 11.5, color: colors.warning, fontWeight: '500', flexShrink: 1 },
  bottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, borderTopWidth: 1, borderTopColor: '#F1F2F5', marginTop: 16, paddingTop: 15 },
  rateLabel: { fontFamily, fontSize: 11.5, color: '#6F7785' },
  rate: { fontFamily, fontSize: 24, fontWeight: '700', color: '#424B5A', marginTop: 4, letterSpacing: -0.5 },
  code: { fontFamily, fontSize: 10.5, color: '#6F7785' },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 11 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  liveText: { fontFamily, fontSize: 12, color: '#6F7785', fontWeight: '500', flexShrink: 1 },
});
