// Trips — available duties ordered by pickup time (reference qTrips): attention banners,
// trip type / date filters, then duties grouped by pickup day with Accept and Bid actions.
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { useInbox } from '../../context/Inbox';
import { Page } from '../../components/shell/Page';
import { Btn, Dropdown, Empty, Feedback, Notice, TextLink } from '../../components/kit/core';
import { isoDay, marketType, rupees, weekdayText } from '../../components/kit/format';
import { goSection } from '../../navigation/navigationRef';
import { DutyDialogs, DutyRow, OPEN_BID, useNow, type DutyAction } from './parts';
import { useLayout } from '../../theme/responsive';

const TYPES = ['All', 'One Way', 'Round Trip', 'Airport', 'Multicity', 'Local Rental', 'Pickup & Drop'];

export function TripsScreen() {
  const navigation = useNavigation();
  const d = useVendorData();
  const [listWidth, setListWidth] = useState(0);
  const columns = listWidth >= 1260 ? 3 : listWidth >= 720 ? 2 : 1;
  const { unacknowledged } = useInbox();
  const { wide } = useLayout();
  const [type, setType] = useState('All');
  const [date, setDate] = useState('All');
  const [action, setAction] = useState<DutyAction | null>(null);
  const now = useNow(60000);

  const dates = useMemo(() => [...new Set(d.marketTrips.map((t) => isoDay(t.pickupMs)).filter(Boolean))].sort().slice(0, 14), [d.marketTrips]);

  const groups = useMemo(() => {
    const list = d.marketTrips
      // Pickup passed or the offer closed: the server refuses these as expired.
      .filter((t) => (!t.pickupMs || t.pickupMs > now) && !(t.cutoffMs && t.cutoffMs < now && t.mode !== 'bid_review'))
      .filter((t) => type === 'All' || marketType(t) === type)
      .filter((t) => date === 'All' || isoDay(t.pickupMs) === date)
      .sort((a, b) => (a.pickupMs || Infinity) - (b.pickupMs || Infinity) || a.bookingId.localeCompare(b.bookingId));
    const map = new Map<string, typeof list>();
    for (const t of list) {
      const k = isoDay(t.pickupMs) || 'later';
      map.set(k, [...(map.get(k) ?? []), t]);
    }
    return [...map.entries()];
  }, [d.marketTrips, type, date, now]);

  const openBids = d.bids.filter((b) => b.status === OPEN_BID);
  const gate = unacknowledged[0] ?? null;
  const pendingAssign = d.awaitingDispatch.length;
  const docAlerts = d.vehicles.filter((v) => v.docStatus === 'Rejected').length + d.drivers.filter((x) => x.docStatus === 'Rejected' || x.approvalStatus === 'Rejected').length;
  const filtered = type !== 'All' || date !== 'All';
  const clear = () => { setType('All'); setDate('All'); };

  return (
    <Page controls={false}>
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

      {/* One toolbar: trip type, pickup date and My bids, so the first duty starts near the top. Phones drop the filter icons. */}
      <View style={styles.filters}>
        <Dropdown label="Trip type" icon={wide ? 'options-outline' : undefined} value={type} onChange={setType} options={TYPES.map((t) => ({ value: t, label: t === 'All' ? 'All trips' : t }))} style={[styles.filter, wide ? { width: 190 } : { flex: 1, minWidth: 0 }]} />
        <Dropdown label="Pickup date" icon={wide ? 'calendar-outline' : undefined} value={date} onChange={setDate} options={[{ value: 'All', label: 'All dates' }, ...dates.map((k) => ({ value: k, label: weekdayText(new Date(`${k}T12:00:00+05:30`)) }))]} style={[styles.filter, wide ? { width: 190 } : { flex: 1, minWidth: 0 }]} />
        {wide ? <View style={{ flex: 1 }} /> : null}
        <Btn kind="secondary" small title={`My bids${openBids.length ? ` (${openBids.length})` : ''}`} onPress={() => navigation.navigate('MyBids')} style={styles.bids} />
      </View>
      {filtered ? <View style={{ marginTop: -4, marginBottom: 8, alignItems: 'flex-end' }}><TextLink title="Clear filters" icon="close" onPress={clear} /></View> : null}

      {d.errors.market ? <Feedback tone="error" message={d.errors.market} /> : null}
      {groups.length === 0 ? (
        <Empty icon="map-outline" title={filtered ? 'No duties for this selection' : 'No duties available right now'}
          text={filtered ? 'Choose another trip type or pickup date.' : 'New duties appear here as soon as NESAM publishes them. You will also get a notification.'}
          action={filtered ? <Btn kind="secondary" icon="options-outline" title="Clear filters" onPress={clear} /> : undefined} />
      ) : (
        // Phones show one ticket to a row; wider screens set them side by side, so a ticket never stretches across the page.
        <View style={styles.list} onLayout={(e) => setListWidth(e.nativeEvent.layout.width)}>
          {groups.flatMap(([, list]) => list).map((t) => (
            <View key={t.id} style={{ width: columns > 1 ? Math.floor((listWidth - 14 * (columns - 1)) / columns) : '100%' }}>
              <DutyRow list trip={t} bid={openBids.find((b) => b.tripId === t.id)} onAction={setAction} />
            </View>
          ))}
        </View>
      )}
      <DutyDialogs action={action} setAction={setAction} onAccepted={() => goSection('Bookings', { tab: 'Accepted' })} />
    </Page>
  );
}

const styles = StyleSheet.create({
  list: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 14 },
  filters: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -4, marginBottom: 12 },
  filter: { minHeight: 42, paddingHorizontal: 11 },
  bids: { minHeight: 42, paddingHorizontal: 12, borderRadius: 12 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 20, marginBottom: 6 },
});
