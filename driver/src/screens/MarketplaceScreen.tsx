// Duties: every open duty the driver can accept or bid on, with category and pickup-date filters.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useDriverData } from '../context/DriverData';
import { NxScreen, useShell } from '../components/nx/Shell';
import { NxGrid, useLayout } from '../components/nx/layout';
import { NxButton, NxEmpty, NxInfo, NxNote, NxPills, NxSelectButton } from '../components/nx/primitives';
import { DateFilterDialog, DutyCard, DutyDialog, useDutyFeed } from '../components/nx/Duties';
import { usePresence } from '../hooks/usePresence';
import type { MarketplaceOffer } from '../types/driver';

type Scope = 'matching' | 'all';

export default function MarketplaceScreen() {
  const navigation = useNavigation();
  const { notify } = useShell();
  const { account, activeTrip, offersError } = useDriverData();
  const { driver, vehicle } = account;
  const presence = usePresence(notify);
  const { mode } = useLayout();
  const [scope, setScope] = useState<Scope>('matching');
  const [dateFilter, setDateFilter] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [detail, setDetail] = useState<MarketplaceOffer | null>(null);
  const feed = useDutyFeed(scope === 'all', dateFilter);

  if (driver.vendorId) {
    return (
      <NxScreen>
        <NxEmpty icon="car" title="Trips are assigned by your fleet" message={`${driver.vendorName || 'Your fleet operator'} takes duties and assigns them to you directly.`} />
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
        title={feed.pool.length ? 'No duties on this date' : 'No open duties right now'}
        message={feed.pool.length ? 'Try another date or category.' : 'New duties appear here in real time. Keep the app open and stay online.'}
        action={
          dateFilter !== 'all' ? (
            <NxButton title="Show all dates" variant="secondary" onPress={() => setDateFilter('all')} />
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
    <NxScreen subtitle={`${presence.online && !activeTrip ? feed.visible.length : 0} open dut${feed.visible.length === 1 ? 'y' : 'ies'} for you right now.`}>
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
      {offersError ? <NxInfo tone="red" style={{ marginTop: 0, marginBottom: 14 }}>{offersError}</NxInfo> : null}
      {body}
      <NxNote>Payouts shown are the agreed driver rates. Toll, parking and state tax are paid by the customer at actual cost.</NxNote>
      <DutyDialog offer={detail} onClose={() => setDetail(null)} onAccepted={(o) => navigation.navigate('TripFlow', { bookingId: o.bookingId || o.id })} />
      <DateFilterDialog visible={filterOpen} onClose={() => setFilterOpen(false)} dates={feed.dates} value={dateFilter} onChange={setDateFilter} />
    </NxScreen>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 20 },
});
