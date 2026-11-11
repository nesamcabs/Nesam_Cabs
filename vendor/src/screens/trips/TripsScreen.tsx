// Trips — available duties ordered by pickup time (reference qTrips): wallet + deposit summary, attention banners,
// search / trip type / vehicle / date filters, then duties grouped by pickup day with Accept and Bid actions.
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { useInbox } from '../../context/Inbox';
import { Page } from '../../components/shell/Page';
import { Btn, Dropdown, Empty, Feedback, Notice, SearchBox, SectionLine, TextLink, Toolbar } from '../../components/kit/core';
import { isoDay, marketFrom, marketTo, marketType, rupees, weekdayText } from '../../components/kit/format';
import { goSection } from '../../navigation/navigationRef';
import { DutyDialogs, DutyRow, OPEN_BID, useNow, type DutyAction } from './parts';
import { colors, fontFamily } from '../../theme';
import { useLayout } from '../../theme/responsive';

const TYPES = ['All', 'One Way', 'Round Trip', 'Airport', 'Multicity', 'Local Rental', 'Pickup & Drop'];

export function TripsScreen() {
  const navigation = useNavigation();
  const d = useVendorData();
  const { unacknowledged } = useInbox();
  const { wide } = useLayout();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('All');
  const [category, setCategory] = useState('All');
  const [date, setDate] = useState('All');
  const [action, setAction] = useState<DutyAction | null>(null);
  const now = useNow(60000);

  const categories = useMemo(() => ['All', ...new Set(d.marketTrips.map((t) => t.vehicleCategory).filter(Boolean))], [d.marketTrips]);
  const dates = useMemo(() => [...new Set(d.marketTrips.map((t) => isoDay(t.pickupMs)).filter(Boolean))].sort().slice(0, 14), [d.marketTrips]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = d.marketTrips
      // Pickup passed or the offer closed: the server refuses these as expired.
      .filter((t) => (!t.pickupMs || t.pickupMs > now) && !(t.cutoffMs && t.cutoffMs < now && t.mode !== 'bid_review'))
      .filter((t) => type === 'All' || marketType(t) === type)
      .filter((t) => category === 'All' || t.vehicleCategory === category)
      .filter((t) => date === 'All' || isoDay(t.pickupMs) === date)
      .filter((t) => !q || `${t.bookingId} ${t.route} ${marketFrom(t)} ${marketTo(t)} ${t.pickup.address} ${t.drop.address}`.toLowerCase().includes(q))
      .sort((a, b) => (a.pickupMs || Infinity) - (b.pickupMs || Infinity) || a.bookingId.localeCompare(b.bookingId));
    const map = new Map<string, typeof list>();
    for (const t of list) {
      const k = isoDay(t.pickupMs) || 'later';
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return [...map.entries()];
  }, [d.marketTrips, type, category, date, search, now]);

  const openBids = d.bids.filter((b) => b.status === OPEN_BID);
  const gate = unacknowledged[0] ?? null;
  const pendingAssign = d.awaitingDispatch.length;
  const docAlerts = d.vehicles.filter((v) => v.docStatus === 'Rejected').length + d.drivers.filter((x) => x.docStatus === 'Rejected' || x.approvalStatus === 'Rejected').length;
  const depositActive = d.deposit?.status === 'Active';
  const filtered = search || type !== 'All' || category !== 'All' || date !== 'All';
  const clear = () => { setSearch(''); setType('All'); setCategory('All'); setDate('All'); };
  const total = groups.reduce((n, [, l]) => n + l.length, 0);

  return (
    <Page
      controls={false}
      title="Trips"
      subtitle="Available duties, ordered by pickup time."
      action={<Btn kind="secondary" small={!wide} icon="document-text-outline" title={`My bids${openBids.length ? ` (${openBids.length})` : ''}`} onPress={() => navigation.navigate('MyBids')} />}
    >
      <View style={[styles.balance, !wide && { paddingHorizontal: 13 }]}>
        <Pressable style={styles.balanceItem} onPress={() => goSection('Wallet')} accessibilityRole="button" accessibilityLabel="Working wallet">
          <Ionicons name="wallet-outline" size={wide ? 22 : 20} color="#70849A" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.balanceLabel}>Working wallet</Text>
            <Text style={[styles.balanceValue, d.wallet.available < 0 && { color: colors.danger }]} numberOfLines={1}>{rupees(d.wallet.available)}</Text>
          </View>
          {wide ? <Ionicons name="chevron-forward" size={14} color="#A5B0BD" /> : null}
        </Pressable>
        <View style={styles.rule} />
        <Pressable style={styles.balanceItem} onPress={() => goSection('Wallet')} accessibilityRole="button" accessibilityLabel="Security deposit">
          <Ionicons name="shield-checkmark-outline" size={wide ? 22 : 20} color="#70849A" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.balanceLabel}>Security deposit</Text>
            <Text style={[styles.deposit, !depositActive && { color: colors.muted }]} numberOfLines={1}>{d.deposit ? (depositActive ? 'Active' : d.deposit.status) : 'Not recorded'}</Text>
          </View>
          <View style={[styles.dot, depositActive && { backgroundColor: '#3B9472' }]} />
        </Pressable>
      </View>

      {gate ? (
        <Notice tone="amber" icon="alert-circle-outline" title="New duty acceptance needs attention" text={`Acknowledge the ${rupees(gate.amount)} penalty notice before accepting a new duty.`} style={{ marginBottom: 12 }}
          action={<Btn kind="secondary" small icon="checkmark-done" title="Acknowledge" onPress={() => navigation.navigate('Penalty', { id: gate.id })} />} />
      ) : null}
      {d.wallet.available < 0 ? (
        <Notice tone="red" icon="wallet-outline" title="Outstanding balance" text={`Your working wallet is ${rupees(d.wallet.available)}. Upcoming earnings settle this first, or pay your dues now.`} style={{ marginBottom: 12 }}
          action={<Btn kind="secondary" small icon="card-outline" title="Pay dues" onPress={() => goSection('Wallet')} />} />
      ) : null}
      {pendingAssign || docAlerts ? (
        <View style={styles.quick}>
          {pendingAssign ? <TextLink title={`${pendingAssign} assignment${pendingAssign === 1 ? '' : 's'} pending`} onPress={() => goSection('Bookings', { tab: 'Accepted' })} /> : null}
          {docAlerts ? <TextLink title={`${docAlerts} document alert${docAlerts === 1 ? '' : 's'}`} onPress={() => navigation.navigate('Documents')} /> : null}
        </View>
      ) : null}

      <View style={{ height: 6 }} />
      <Toolbar>
        <SearchBox value={search} onChange={setSearch} placeholder="Search route or Duty ID" />
        <Dropdown label="Trip type" icon="options-outline" value={type} onChange={setType} options={TYPES.map((t) => ({ value: t, label: t === 'All' ? 'All trip types' : t }))} style={wide ? { width: 170 } : undefined} />
        <Dropdown label="Vehicle category" icon="car-outline" value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, label: c === 'All' ? 'All vehicles' : c }))} style={wide ? { width: 170 } : undefined} />
        <Dropdown label="Pickup date" icon="calendar-outline" value={date} onChange={setDate} options={[{ value: 'All', label: 'All dates' }, ...dates.map((k) => ({ value: k, label: weekdayText(new Date(`${k}T12:00:00+05:30`)) }))]} style={wide ? { width: 175 } : undefined} />
      </Toolbar>
      {filtered ? <View style={{ marginTop: -8, marginBottom: 10, alignItems: 'flex-end' }}><TextLink title="Clear filters" icon="close" onPress={clear} /></View> : null}

      {d.errors.market ? <Feedback tone="error" message={d.errors.market} /> : null}
      <SectionLine title="Available duties" meta={`${total} ${total === 1 ? 'duty' : 'duties'}`} />
      {groups.length === 0 ? (
        <Empty icon="map-outline" title={filtered ? 'No duties for this selection' : 'No duties available right now'}
          text={filtered ? 'Choose another pickup date, vehicle or route.' : 'New duties appear here as soon as NESAM publishes them. You will also get a notification.'}
          action={filtered ? <Btn kind="secondary" icon="options-outline" title="Clear filters" onPress={clear} /> : undefined} />
      ) : (
        groups.map(([k, list]) => (
          <View key={k} style={{ marginBottom: 14 }}>
            <View style={styles.dateHead}>
              <Text style={styles.dateTitle}>{k === 'later' ? 'Pickup date to be confirmed' : weekdayText(new Date(list[0]!.pickupMs))}</Text>
              <Text style={styles.dateCount}>{list.length} {list.length === 1 ? 'duty' : 'duties'}</Text>
            </View>
            {list.map((t) => <DutyRow key={t.id} trip={t} bid={openBids.find((b) => b.tripId === t.id)} onAction={setAction} />)}
          </View>
        ))
      )}
      <DutyDialogs action={action} setAction={setAction} onAccepted={() => goSection('Bookings', { tab: 'Accepted' })} />
    </Page>
  );
}

const styles = StyleSheet.create({
  balance: { flexDirection: 'row', backgroundColor: colors.card, borderWidth: 1, borderColor: '#DEE6EF', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 19, marginBottom: 14, maxWidth: 780 },
  balanceItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0, minHeight: 44 },
  rule: { width: 1, backgroundColor: '#E5EAF0', marginHorizontal: 18 },
  balanceLabel: { fontFamily, fontSize: 11, color: '#63758A' },
  balanceValue: { fontFamily, fontSize: 18, fontWeight: '600', color: '#33485F', marginTop: 2, letterSpacing: -0.3 },
  deposit: { fontFamily, fontSize: 14, fontWeight: '600', color: '#35775D', marginTop: 3 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#BDAD8E' },
  quick: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 20, marginBottom: 6 },
  dateHead: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  dateTitle: { fontFamily, fontSize: 14, fontWeight: '600', color: '#33465D' },
  dateCount: { fontFamily, fontSize: 11.5, color: '#708096' },
});
