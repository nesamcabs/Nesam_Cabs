// My bids (reference vBids: All / Open / Allocated / Closed) and Duty details for one available duty.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { Page } from '../../components/shell/Page';
import { Text } from '../../components/kit/Text';
import { colors, fontFamily } from '../../theme';
import { Badge, BulletList, Between, Btn, Empty, Grid, H2, KV, Notice, Panel, RouteStack, RouteTitle, Small, Tabs } from '../../components/kit/core';
import { dayTime, marketFrom, marketPickup, marketTo, marketType, numericDate, rupees, timeText } from '../../components/kit/format';
import { goSection } from '../../navigation/navigationRef';
import type { RootStackParamList } from '../../navigation/types';
import { bidLabel, bidTone, canAccept, canBid, DutyDialogs, isBidding, isFixed, OPEN_BID, opensToVendorsAt, useNow, type DutyAction } from './parts';
import type { MarketTrip } from '../../types/operations';

type BidTab = 'All' | 'Open' | 'Allocated' | 'Closed';

export function MyBidsScreen() {
  const navigation = useNavigation();
  const d = useVendorData();
  const [tab, setTab] = useState<BidTab>('All');
  const [action, setAction] = useState<DutyAction | null>(null);
  const group = (s: string): BidTab => (s === OPEN_BID ? 'Open' : s === 'Accepted' ? 'Allocated' : 'Closed');
  const count = (t: BidTab) => d.bids.filter((b) => t === 'All' || group(b.status) === t).length;
  const list = d.bids.filter((b) => tab === 'All' || group(b.status) === tab);
  const bookingFor = (id: string) => d.bookings.find((b) => b.id === id || b.bookingId === id);

  return (
    <Page title="My bids" subtitle="Your quotes and NESAM's decisions.">
      <Tabs value={tab} onChange={setTab} items={(['All', 'Open', 'Allocated', 'Closed'] as BidTab[]).map((id) => ({ id, label: id, count: count(id) }))} />
      {d.errors.bids ? <Notice tone="red" title="Bids could not load" text={d.errors.bids} /> : null}
      {list.length === 0 ? (
        <Empty icon="document-text-outline" title="No bids here" text="Place a bid from an available duty on Trips." action={<Btn kind="secondary" icon="arrow-back" title="Go to Trips" onPress={() => goSection('Trips')} />} />
      ) : (
        <Grid>
          {list.map((b) => {
            const t = d.marketTrips.find((x) => x.id === b.tripId);
            const booking = bookingFor(b.bookingId);
            return (
              <Panel key={b.id}>
                <Between><Small>{t?.bookingId || booking?.bookingId || b.bookingId}</Small><Badge label={bidLabel(b.status)} tone={bidTone(b.status)} /></Between>
                <View style={{ marginTop: 10 }}>
                  {t ? <RouteTitle from={marketFrom(t)} to={marketTo(t)} size={17} /> : booking ? <RouteTitle from={booking.pickupAddress.split(',')[0]} to={booking.dropAddress.split(',')[0]} size={17} /> : <H2>Duty {b.bookingId}</H2>}
                </View>
                {t ? <Small style={{ marginTop: 6 }}>{dayTime(marketPickup(t))} · {t.vehicleCategory} · {marketType(t)}</Small> : null}
                <KV rows={[['Your minimum payout', rupees(b.vendorCounterRate)], ['Current offer', rupees(t?.offeredPayout ?? b.offeredPayout)], ['Submitted', dayTime(b.submittedAt)], b.status === OPEN_BID && t?.cutoffMs ? ['Valid until', dayTime(new Date(t.cutoffMs))] : null]} />
                {b.status === OPEN_BID && !b.autoAcceptConsent ? <Notice tone="amber" title="Action needed" text="Update the bid and confirm the allocation terms." style={{ marginTop: 12 }} /> : null}
                <View style={{ marginTop: 14, flexDirection: 'row' }}>
                  {b.status === 'Accepted' && booking ? <Btn title="Open booking" icon="ticket-outline" onPress={() => navigation.navigate('Booking', { id: booking.id })} />
                    : b.status === OPEN_BID ? <Btn kind="secondary" title="View bid" icon="open-outline" onPress={() => setAction({ kind: 'bid-detail', bid: b })} />
                    : t ? <Btn kind="secondary" title="View duty" icon="open-outline" onPress={() => navigation.navigate('Duty', { id: t.id })} /> : null}
                </View>
              </Panel>
            );
          })}
        </Grid>
      )}
      <DutyDialogs action={action} setAction={setAction} onAccepted={() => goSection('Bookings', { tab: 'Accepted' })} />
    </Page>
  );
}

export function DutyScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'Duty'>>();
  const navigation = useNavigation();
  const d = useVendorData();
  const [action, setAction] = useState<DutyAction | null>(null);
  const t = d.marketTrips.find((x) => x.id === params.id);
  if (!t) {
    const booking = d.bookings.find((b) => b.id === params.id || b.bookingId === params.id);
    return (
      <Page title="Duty details">
        <Empty icon="map-outline" title={booking ? 'This duty is in your bookings' : 'Duty unavailable'}
          text={booking ? 'It has been allocated to your business.' : 'It may have been taken by another partner or withdrawn by NESAM.'}
          action={booking ? <Btn title="Open booking" icon="ticket-outline" onPress={() => navigation.navigate('Booking', { id: booking.id })} /> : <Btn kind="secondary" icon="arrow-back" title="Back to Trips" onPress={() => goSection('Trips')} />} />
      </Page>
    );
  }
  return <DutyDetail t={t} setAction={setAction} action={action} />;
}

/** One available duty: how it was published, the Accept / bid actions, then everything about it in a single Duty information panel. */
function DutyDetail({ t, action, setAction }: { t: MarketTrip; action: DutyAction | null; setAction: (a: DutyAction | null) => void }) {
  const d = useVendorData();
  const now = useNow();
  const bid = d.bids.find((b) => b.tripId === t.id && b.status === OPEN_BID);
  const pickup = marketPickup(t);
  const opensAt = opensToVendorsAt(t, d.ops.vendorReleaseSeconds, now);
  const accept = canAccept(t) && !opensAt;
  const bidOpen = canBid(t, now) && !opensAt;
  const payout = t.offeredPayout > 0 ? rupees(t.offeredPayout) : 'Your quote';
  const mode = isBidding(t) ? 'Bidding' : isFixed(t) ? 'Fixed payout' : '';
  return (
    <Page title="Duty details" subtitle={t.bookingId}>
      {isFixed(t) ? (
        <Notice tone="green" icon="checkmark-circle-outline" title="Fixed payout" style={{ marginBottom: 14 }}
          text={`Accept ${rupees(t.offeredPayout)} to take this duty. The first eligible vendor to accept gets it.`} />
      ) : null}

      {opensAt ? <Notice tone="amber" icon="time-outline" title="Not open to vendors yet" text={`Opens to vendors at ${timeText(new Date(opensAt))}.`} style={{ marginBottom: 14 }} /> : null}
      {accept || bid || bidOpen ? (
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
          {accept ? <Btn title="Accept duty" icon="checkmark-done" onPress={() => setAction({ kind: 'accept', trip: t })} style={{ flex: 1 }} /> : null}
          {bid ? <Btn kind="bid" title={`My bid ${rupees(bid.vendorCounterRate)}`} icon="create-outline" onPress={() => setAction({ kind: 'bid-detail', bid })} style={{ flex: 1 }} />
            : bidOpen ? <Btn kind="bid" title="Place bid" icon="trending-up" onPress={() => setAction({ kind: 'bid', trip: t })} style={{ flex: 1 }} /> : null}
        </View>
      ) : isBidding(t) && !bidOpen && !opensAt ? <Notice tone="neutral" title="Bidding closed" text="This duty no longer takes bids." style={{ marginBottom: 14 }} /> : null}

      <Grid>
        <Panel>
          <Between><H2>Duty information</H2>{mode ? <Badge label={mode} tone={isBidding(t) ? 'blue' : 'green'} /> : null}</Between>
          <RouteStack from={t.pickup.address || marketFrom(t)} fromSub={`Pickup · ${numericDate(pickup)} · ${pickup ? timeText(pickup) : t.pickup.time || '—'}`} to={t.drop.address || marketTo(t)} toSub={t.drop.city || undefined} />
          <KV rows={[
            ['Duty ID', t.bookingId],
            ['Pickup date', pickup ? numericDate(pickup) : t.travelDate || '—'],
            ['Pickup time', pickup ? timeText(pickup) : t.pickup.time || '—'],
            ['Trip type', marketType(t)],
            t.via?.length ? ['Tour cities', [marketFrom(t), ...t.via, marketTo(t)].join(' → ')] : null,
            ['Vehicle category', t.vehicleCategory || '—'],
            t.fuelType ? ['Fuel', t.fuelType === 'cng' ? 'CNG' : 'Diesel / Petrol'] : null,
            t.distanceKm ? ['Included distance', `${Math.round(t.distanceKm)} km`] : null,
            [isBidding(t) ? 'Current payout' : 'Vendor payout', payout],
            t.cutoffMs ? ['Offer closes', dayTime(new Date(t.cutoffMs))] : null,
            isBidding(t) ? ['Bids so far', String(t.bidCount)] : null,
            bid ? ['Your bid', `${rupees(bid.vendorCounterRate)} · ${bid.autoAcceptConsent ? 'allocates when the payout reaches it' : 'update to confirm'}`] : null,
          ]} />
        </Panel>
        <Panel>
          <H2>Charges</H2>
          {t.addOns?.roofCarrier || t.addOns?.pets ? (
            <>
              <Text style={styles.chargeHead}>Included in your payout</Text>
              <BulletList items={[...(t.addOns?.roofCarrier ? ['Roof carrier (required for this trip)'] : []), ...(t.addOns?.pets ? ['Pet travel (customer travels with a pet)'] : [])]} />
            </>
          ) : null}
          <Text style={[styles.chargeHead, { marginTop: t.addOns?.roofCarrier || t.addOns?.pets ? 18 : 12 }]}>Excluded · collected from the customer</Text>
          <Small style={{ marginBottom: 10 }}>The driver collects these from the customer and gives the customer a receipt for each one.</Small>
          <BulletList items={['Toll', 'Parking', 'State permit / tax', 'Hill charges']} />
        </Panel>
      </Grid>
      <DutyDialogs action={action} setAction={setAction} onAccepted={() => goSection('Bookings', { tab: 'Accepted' })} />
    </Page>
  );
}

const styles = StyleSheet.create({
  chargeHead: { fontFamily, fontSize: 13, fontWeight: '700', color: colors.ink, marginTop: 12, marginBottom: 6 },
});
