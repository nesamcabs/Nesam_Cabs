// Duties: the live "right now" feed (presence-gated) and My Bookings, advance/scheduled work a driver may
// claim or — for a vendor driver's one exception, an Outstation Round Trip — request, online or offline.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useDriverData } from '../context/DriverData';
import { NxScreen, useShell } from '../components/nx/Shell';
import { NxGrid, useLayout } from '../components/nx/layout';
import { NxButton, NxEmpty, NxInfo, NxNote, NxPills, NxSelectButton } from '../components/nx/primitives';
import { DateFilterDialog, DutyCard, DutyDialog, MyBidsDialog, TypeFilterDialog, useDutyFeed } from '../components/nx/Duties';
import { useMyBids } from '../hooks/useMyBids';
import { usePresence } from '../hooks/usePresence';
import type { MarketplaceOffer } from '../types/driver';
import { isVendorDriver } from '../utils/driverRole';
import { goTab } from '../navigation/navItems';

type Scope = 'matching' | 'all';
type MainTab = 'duties' | 'bookings';

export default function MarketplaceScreen() {
  const navigation = useNavigation();
  const { notify } = useShell();
  const { account, activeTrip, offersError, myBookingsOffers, pendingTripRequestBookingIds } = useDriverData();
  const { driver, vehicle } = account;
  const presence = usePresence(notify);
  const { mode } = useLayout();
  const vendorDriver = isVendorDriver(driver);
  const [mainTab, setMainTab] = useState<MainTab>(vendorDriver ? 'bookings' : 'duties');
  const [scope, setScope] = useState<Scope>('matching');
  const [dateFilter, setDateFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [bidsOpen, setBidsOpen] = useState(false);
  const myBids = useMyBids(driver.id);
  const [detail, setDetail] = useState<MarketplaceOffer | null>(null);
  const feed = useDutyFeed(scope === 'all', dateFilter, typeFilter);
  const detailPending = detail ? pendingTripRequestBookingIds.has(detail.id) : false;

  const bookingsBody = myBookingsOffers.length ? (
    <NxGrid columns={mode === 'sidebar' ? 2 : mode === 'rail' ? 2 : 1} gap={14}>
      {myBookingsOffers.map((o) => (
        <DutyCard key={o.id} offer={o} pending={pendingTripRequestBookingIds.has(o.id)} onOpen={() => setDetail(o)} />
      ))}
    </NxGrid>
  ) : (
    <NxEmpty
      icon="trip"
      title={vendorDriver ? 'No round trips open to request' : 'No bookings to claim right now'}
      message={
        vendorDriver
          ? 'An Outstation Round Trip your fleet has not yet assigned appears here — request it and your fleet decides.'
          : 'Outstation, Multicity and scheduled Hourly Rental bookings appear here as they are approved — online or offline.'
      }
    />
  );

  if (vendorDriver) {
    return (
      <NxScreen subtitle={`${myBookingsOffers.length} round trip${myBookingsOffers.length === 1 ? '' : 's'} open to request.`}>
        <NxEmpty
          icon="car"
          title="Local pickups & hourly rentals"
          message={`${driver.vendorName || 'Your fleet operator'} assigns most trips directly. Go on Local Duty to take local pickup/drop and hourly rentals yourself.`}
          action={<NxButton title="Open Local Duty" trailingIcon="arrow" onPress={() => goTab('Local')} />}
        />
        <NxNote>Outstation Round Trip is the one duty you may request directly here — your fleet still approves it before it's assigned to you.</NxNote>
        {bookingsBody}
        <DutyDialog offer={detail} scheduled requestOnly pending={detailPending} onClose={() => setDetail(null)} />
      </NxScreen>
    );
  }

  let body: React.ReactNode;
  if (!presence.online) {
    body = (
      <NxEmpty
        icon="power"
        title="You’re offline"
        message="Go online to view, bid on and accept duties in real time. Your assigned trips stay available."
        action={<NxButton title="Go online" trailingIcon="arrow" loading={presence.busy} onPress={() => void presence.change('Online')} />}
      />
    );
  } else if (activeTrip) {
    body = <NxEmpty icon="trip" title="Finish your current trip" message="Open duties appear here again once your active trip is complete." action={<NxButton title="Open current trip" trailingIcon="arrow" onPress={() => navigation.navigate('TripFlow', { bookingId: activeTrip.id })} />} />;
  } else if (!feed.visible.length) {
    body = (
      <NxEmpty
        icon="trip"
        title={feed.pool.length ? 'No duties for these filters' : 'No open duties right now'}
        message={feed.pool.length ? 'Try another trip type, date or category.' : 'New duties appear here in real time. Keep the app open and stay online.'}
        action={
          dateFilter !== 'all' || typeFilter !== 'all' ? (
            <NxButton title="Clear filters" variant="secondary" onPress={() => { setDateFilter('all'); setTypeFilter('all'); }} />
          ) : scope === 'matching' && feed.all.length > 0 ? (
            <NxButton title={`View other categories (${feed.all.length})`} variant="secondary" onPress={() => setScope('all')} />
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <NxGrid columns={mode === 'sidebar' ? 2 : mode === 'rail' ? 2 : 1} gap={14}>
        {feed.visible.map((o) => (
          <DutyCard key={o.id} offer={o} onOpen={() => setDetail(o)} />
        ))}
      </NxGrid>
    );
  }

  return (
    <NxScreen subtitle={mainTab === 'duties' ? `${presence.online && !activeTrip ? feed.visible.length : 0} open dut${feed.visible.length === 1 ? 'y' : 'ies'} for you right now.` : `${myBookingsOffers.length} booking${myBookingsOffers.length === 1 ? '' : 's'} to claim.`}>
      <NxPills<MainTab>
        label="View"
        fill
        value={mainTab}
        onChange={setMainTab}
        style={{ marginBottom: 20 }}
        options={[
          { value: 'duties', label: 'Duties' },
          { value: 'bookings', label: `My Bookings${myBookingsOffers.length ? ` (${myBookingsOffers.length})` : ''}` },
        ]}
      />
      {mainTab === 'duties' ? (
        <>
          <View style={styles.filters}>
            <NxPills<Scope>
              scroll
              label="Duty category"
              value={scope}
              onChange={(v) => {
                setScope(v);
                setDateFilter('all');
              }}
              style={{ marginBottom: 0, flexShrink: 1 }}
              options={[
                { value: 'matching', label: `${vehicle.vehicleType || 'My vehicle'} (${feed.matching.length})` },
                { value: 'all', label: `All categories (${feed.all.length})` },
              ]}
            />
            <NxSelectButton label={dateFilter === 'all' ? 'All dates' : dateFilter} disabled={!feed.dates.length} onPress={() => setFilterOpen(true)} accessibilityLabel="Filter duties by pickup date" />
          </View>
          <View style={styles.filters}>
            <NxSelectButton label={typeFilter === 'all' ? 'All trip types' : typeFilter} disabled={!feed.types.length} onPress={() => setTypeOpen(true)} accessibilityLabel="Filter duties by trip type" />
            <NxButton title={`My bids${myBids.pending.length ? ` (${myBids.pending.length})` : ''}`} icon="document" variant="secondary" compact onPress={() => setBidsOpen(true)} />
          </View>
          {offersError ? <NxInfo tone="red" style={{ marginTop: 0, marginBottom: 14 }}>{offersError}</NxInfo> : null}
          {body}
          <NxNote>Payouts shown are the agreed driver rates. Toll, parking and state tax are paid by the customer at actual cost.</NxNote>
        </>
      ) : (
        bookingsBody
      )}
      <DutyDialog
        offer={detail}
        scheduled={mainTab === 'bookings'}
        pending={detailPending}
        onClose={() => setDetail(null)}
        onAccepted={(o) => navigation.navigate('TripFlow', { bookingId: o.bookingId || o.id })}
      />
      <TypeFilterDialog visible={typeOpen} onClose={() => setTypeOpen(false)} types={feed.types} value={typeFilter} onChange={setTypeFilter} />
      <MyBidsDialog visible={bidsOpen} onClose={() => setBidsOpen(false)} bids={myBids.bids} loaded={myBids.loaded} />
      <DateFilterDialog visible={filterOpen} onClose={() => setFilterOpen(false)} dates={feed.dates} value={dateFilter} onChange={setDateFilter} />
    </NxScreen>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 20 },
});
