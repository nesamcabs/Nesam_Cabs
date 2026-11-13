// My bids (reference vBids: All / Open / Allocated / Closed) and Duty details for one available duty.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { Page } from '../../components/shell/Page';
import { Badge, Between, Btn, Empty, Grid, H2, KV, Notice, Panel, RouteStack, RouteTitle, Small, Tabs } from '../../components/kit/core';
import { dayTime, marketFrom, marketPickup, marketTo, marketType, rupees } from '../../components/kit/format';
import { goSection } from '../../navigation/navigationRef';
import type { RootStackParamList } from '../../navigation/types';
import { bidLabel, bidTone, DutyDialogs, DutyRow, isBidding, isFixed, OPEN_BID, risesText, type DutyAction } from './parts';

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
      <Notice tone="blue" title="A submitted bid does not confirm a duty" text="NESAM reviews every bid. If yours is accepted, the duty is allocated to you at your quote and appears in Bookings with an assignment deadline." />
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
  const bid = d.bids.find((b) => b.tripId === t.id && b.status === OPEN_BID);
  return (
    <Page title="Duty details" subtitle={t.bookingId}>
      <DutyRow trip={t} bid={bid} onAction={setAction} />
      {isBidding(t) ? (
        <Notice tone="blue" icon="trending-up-outline" title="Bidding duty" style={{ marginBottom: 14 }}
          text={`Enter the lowest payout you will accept${risesText(t) ? `. The payout rises ${risesText(t)}; the duty is allocated to you automatically when it reaches your amount` : ''}.${t.cutoffMs ? ` Bidding closes ${dayTime(new Date(t.cutoffMs))}.` : ''}`} />
      ) : isFixed(t) ? (
        <Notice tone="green" icon="checkmark-circle-outline" title="Fixed payout" style={{ marginBottom: 14 }}
          text={`Accept ${rupees(t.offeredPayout)} to take this duty. The first eligible vendor to accept gets it.`} />
      ) : null}
      <Grid>
        <Panel>
          <H2>Duty information</H2>
          <RouteStack from={t.pickup.address || marketFrom(t)} fromSub={`Pickup · ${dayTime(marketPickup(t))}`} to={t.drop.address || marketTo(t)} toSub={t.drop.city || undefined} />
          <KV rows={[['Trip type', marketType(t)], ['Vehicle category', t.vehicleCategory || '—'], t.distanceKm ? ['Included distance', `${Math.round(t.distanceKm)} km`] : null, t.cutoffMs ? ['Offer closes', dayTime(new Date(t.cutoffMs))] : null, ['Bids so far', String(t.bidCount)]]} />
        </Panel>
        <Panel>
          <H2>Included & extra costs</H2>
          <Small style={{ marginTop: 10 }}>{t.distanceKm ? `${Math.round(t.distanceKm)} km included. ` : ''}Toll, parking and state permit are reimbursed separately against office-approved receipts. Customer contact unlocks 8 hours before pickup.</Small>
          {t.addOns?.roofCarrier || t.addOns?.pets ? (
            <KV rows={[t.addOns.roofCarrier ? ['Roof carrier', 'Required'] : null, t.addOns.pets ? ['Pet travel', 'Customer travels with a pet'] : null]} />
          ) : null}
          <Notice tone="neutral" icon="shield-checkmark-outline" title="Only verified drivers and vehicles" text="After accepting, assign a NESAM-approved driver and an approved vehicle of this category before the deadline." style={{ marginTop: 14 }} />
        </Panel>
      </Grid>
      <DutyDialogs action={action} setAction={setAction} onAccepted={() => goSection('Bookings', { tab: 'Accepted' })} />
    </Page>
  );
}
