// Duties: the live "right now" feed (presence-gated) and My Bookings, advance/scheduled work a driver may
// claim or — for a vendor driver's one exception, an Outstation Round Trip — request, online or offline.
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/nx/Text';
import { NxIcon, type NxIconName } from '../components/nx/Icon';
import { nx } from '../theme/nx';
import { useNavigation } from '@react-navigation/native';
import { useDriverData } from '../context/DriverData';
import { NxScreen, useShell } from '../components/nx/Shell';
import { NxGrid, useLayout } from '../components/nx/layout';
import { NxButton, NxEmpty, NxInfo, NxNote, NxTextButton, isHovered } from '../components/nx/primitives';
import { DateFilterDialog, DutyCard, DutyDialog, MyBidsDialog, TypeFilterDialog, useDutyFeed, type DutyIntent } from '../components/nx/Duties';
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
  const [intent, setIntent] = useState<DutyIntent | undefined>(undefined);
  /** Opens a duty: its details, or straight at "Accept duty" / "Place bid". */
  const openDuty = (o: MarketplaceOffer, i?: DutyIntent) => {
    setIntent(i);
    setDetail(o);
  };
  const feed = useDutyFeed(scope === 'all', dateFilter, typeFilter);
  const detailPending = detail ? pendingTripRequestBookingIds.has(detail.id) : false;

  const bookingsBody = myBookingsOffers.length ? (
    <NxGrid columns={mode === 'sidebar' ? 2 : mode === 'rail' ? 2 : 1} gap={14}>
      {myBookingsOffers.map((o) => (
        <DutyCard key={o.id} offer={o} pending={pendingTripRequestBookingIds.has(o.id)} requestOnly={vendorDriver} onOpen={(i) => openDuty(o, i)} />
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
        <DutyDialog offer={detail} scheduled requestOnly pending={detailPending} intent={intent} onClose={() => setDetail(null)} />
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
      <NoDuties
        title={feed.pool.length ? 'No duties match your filters' : 'No duties available at present'}
        message={feed.pool.length ? 'Select a different trip type, pickup date or category.' : 'New duties will appear here automatically. Please keep the app open and stay online.'}
        live={!offersError}
        action={
          dateFilter !== 'all' || typeFilter !== 'all' ? (
            <NxButton title="Clear filters" variant="secondary" compact onPress={() => { setDateFilter('all'); setTypeFilter('all'); }} />
          ) : scope === 'matching' && feed.all.length > 0 ? (
            <NxButton title={`View other categories (${feed.all.length})`} variant="secondary" compact onPress={() => setScope('all')} />
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <>
        <NxGrid columns={mode === 'sidebar' ? 2 : mode === 'rail' ? 2 : 1} gap={14}>
          {feed.visible.map((o) => (
            <DutyCard key={o.id} offer={o} onOpen={(i) => openDuty(o, i)} />
          ))}
        </NxGrid>
        <NxNote>Payouts shown are the agreed driver rates. Toll, parking and state tax are paid by the customer at actual cost.</NxNote>
      </>
    );
  }
  const openCount = presence.online && !activeTrip ? feed.visible.length : 0;

  return (
    <NxScreen subtitle={mainTab === 'duties' ? `${presence.online && !activeTrip ? feed.visible.length : 0} open dut${feed.visible.length === 1 ? 'y' : 'ies'} for you right now.` : `${myBookingsOffers.length} booking${myBookingsOffers.length === 1 ? '' : 's'} to claim.`}>
      {/* The two views, as underline tabs: lighter than buttons, so the page starts calm. */}
      <View style={styles.tabs} accessibilityRole="tablist" accessibilityLabel="View">
        {([['duties', 'Duties', 0], ['bookings', 'My Bookings', myBookingsOffers.length]] as const).map(([value, label, count]) => {
          const on = mainTab === value;
          return (
            <Pressable key={value} onPress={() => setMainTab(value)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[styles.tab, on && styles.tabOn]}>
              <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1}>{label}</Text>
              {count ? (
                <View style={[styles.tabCount, on && { backgroundColor: nx.red }]}>
                  <Text style={[styles.tabCountText, on && { color: nx.white }]}>{count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {mainTab === 'duties' ? (
        <>
          <View style={styles.head}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.headTitle} accessibilityRole="header">Available duties</Text>
              <Text style={styles.headCaption}>{openCount} open for you</Text>
            </View>
            <NxTextButton title={`My bids${myBids.pending.length ? ` (${myBids.pending.length})` : ''}`} icon="document" trailingIcon="chevron" onPress={() => setBidsOpen(true)} />
          </View>
          {/* Every filter in one card: the vehicle category above, trip type and pickup date below. */}
          <View style={styles.filterCard}>
            <View style={styles.segments} accessibilityRole="tablist" accessibilityLabel="Duty category">
              {([['matching', `${vehicle.vehicleType || 'My vehicle'} (${feed.matching.length})`], ['all', `All categories (${feed.all.length})`]] as const).map(([value, label]) => {
                const on = scope === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => {
                      setScope(value);
                      setDateFilter('all');
                    }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    style={[styles.segment, on && styles.segmentOn]}
                  >
                    <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.filters}>
              <FilterSelect icon="list" caption="Trip type" label={typeFilter === 'all' ? 'All types' : typeFilter} disabled={!feed.types.length} onPress={() => setTypeOpen(true)} accessibilityLabel="Filter duties by trip type" />
              <View style={styles.filterDivider} />
              <FilterSelect icon="calendar" caption="Pickup date" label={dateFilter === 'all' ? 'All dates' : dateFilter} disabled={!feed.dates.length} onPress={() => setFilterOpen(true)} accessibilityLabel="Filter duties by pickup date" />
            </View>
          </View>
          {offersError ? <NxInfo tone="red" style={{ marginTop: 0, marginBottom: 14 }}>{offersError}</NxInfo> : null}
          {body}
        </>
      ) : (
        bookingsBody
      )}
      <DutyDialog
        offer={detail}
        scheduled={mainTab === 'bookings'}
        pending={detailPending}
        intent={intent}
        onClose={() => setDetail(null)}
        onAccepted={(o) => navigation.navigate('TripFlow', { bookingId: o.bookingId || o.id })}
      />
      <TypeFilterDialog visible={typeOpen} onClose={() => setTypeOpen(false)} types={feed.types} value={typeFilter} onChange={setTypeFilter} />
      <MyBidsDialog visible={bidsOpen} onClose={() => setBidsOpen(false)} bids={myBids.bids} loaded={myBids.loaded} />
      <DateFilterDialog visible={filterOpen} onClose={() => setFilterOpen(false)} dates={feed.dates} value={dateFilter} onChange={setDateFilter} />
    </NxScreen>
  );
}

/** A filter that opens its list (trip type, pickup date): what it filters above, the current choice below; half the row each. */
function FilterSelect({ icon, caption, label, onPress, disabled, accessibilityLabel }: { icon: NxIconName; caption: string; label: string; onPress: () => void; disabled?: boolean; accessibilityLabel: string }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={(s) => [styles.select, isHovered(s) && !disabled && { backgroundColor: nx.page }]}
    >
      <NxIcon name={icon} size={16} color={disabled ? nx.subtle : nx.red} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.selectCaption} numberOfLines={1}>{caption}</Text>
        <Text style={[styles.selectText, disabled && { color: nx.muted }]} numberOfLines={1}>{label}</Text>
      </View>
      {disabled ? null : (
        <View style={{ transform: [{ rotate: '90deg' }] }}>
          <NxIcon name="chevron" size={13} color={nx.muted} />
        </View>
      )}
    </Pressable>
  );
}

/** Nothing to show in the live feed. `live` says the feed is still listening, so an empty list does not look broken. */
function NoDuties({ title, message, live, action }: { title: string; message: string; live: boolean; action?: React.ReactNode }) {
  return (
    <View style={styles.none}>
      <View style={styles.noneRing}>
        <View style={styles.noneCore}>
          <NxIcon name="trip" size={22} color={nx.red} />
        </View>
      </View>
      <Text style={styles.noneTitle}>{title}</Text>
      <Text style={styles.noneText}>{message}</Text>
      {live ? (
        <View style={styles.live}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>Live updates on</Text>
        </View>
      ) : null}
      {action ? <View style={{ marginTop: 14 }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: nx.line, marginBottom: 18 },
  tab: { flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderBottomWidth: 2.5, borderBottomColor: 'transparent', marginBottom: -1 },
  tabOn: { borderBottomColor: nx.red },
  tabText: { fontSize: 13.5, fontWeight: '600', color: nx.muted, flexShrink: 1 },
  tabTextOn: { fontWeight: '700', color: nx.ink },
  tabCount: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: nx.line },
  tabCountText: { fontSize: 10.5, fontWeight: '700', color: nx.muted },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  headTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.4, color: nx.ink },
  headCaption: { fontSize: 12, color: nx.muted, marginTop: 1 },
  filterCard: { backgroundColor: nx.white, borderWidth: 1, borderColor: nx.line, borderRadius: 14, padding: 6, marginBottom: 16 },
  segments: { flexDirection: 'row', backgroundColor: nx.page, borderRadius: 10, padding: 3, gap: 3 },
  segment: { flex: 1, minWidth: 0, minHeight: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  segmentOn: { backgroundColor: nx.white, shadowColor: '#162033', shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segmentText: { fontSize: 12.5, fontWeight: '600', color: nx.muted },
  segmentTextOn: { fontWeight: '700', color: nx.ink },
  filters: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  filterDivider: { width: 1, height: 28, backgroundColor: nx.line },
  select: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 46, paddingHorizontal: 10, borderRadius: 8 },
  selectCaption: { fontSize: 10, color: nx.muted },
  selectText: { fontSize: 12.5, fontWeight: '700', color: nx.ink },
  none: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 24 },
  noneRing: { width: 76, height: 76, borderRadius: 38, borderWidth: 1, borderColor: nx.redBar, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  noneCore: { width: 56, height: 56, borderRadius: 28, backgroundColor: nx.redSoft, alignItems: 'center', justifyContent: 'center' },
  noneTitle: { fontSize: 15, fontWeight: '700', color: nx.ink, textAlign: 'center' },
  noneText: { fontSize: 12, lineHeight: 19, color: nx.muted, textAlign: 'center', maxWidth: 280, marginTop: 6 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, backgroundColor: nx.greenSoft },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: nx.green },
  liveText: { fontSize: 11, fontWeight: '700', color: nx.green },
});
