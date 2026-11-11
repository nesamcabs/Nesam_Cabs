// Home (reference "Dashboard"): today at a glance, the next / current trip and the duties open to accept.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useDriverData } from '../context/DriverData';
import { NxScreen, useShell } from '../components/nx/Shell';
import { NxGrid, NxTwoPane, useLayout } from '../components/nx/layout';
import { NxBadge, NxButton, NxEmpty, NxInfo, NxMetric, NxNote, NxPanel, NxSectionHeading, NxSelectButton, NxTextButton } from '../components/nx/primitives';
import { TripCard } from '../components/nx/TripCard';
import { DateFilterDialog, DutyCard, DutyDialog, useDutyFeed } from '../components/nx/Duties';
import { tripIsActive } from '../components/nx/tripFormat';
import { usePresence } from '../hooks/usePresence';
import { useNow } from '../hooks/useNow';
import { goTab } from '../navigation/navItems';
import type { MarketplaceOffer } from '../types/driver';
import { formatINR } from '../utils/format';
import { Text } from '../components/nx/Text';
import { nx } from '../theme/nx';

/** Home shows the first few duties; the Duties page lists them all. */
const HOME_DUTY_LIMIT = 4;

export function HomeScreen() {
  const navigation = useNavigation();
  const { notify } = useShell();
  const { account, activeTrip, nextTrip, upcomingTrips, completedTrips, offersError, bookingsError, deviceWarning, earnings, wallet } = useDriverData();
  const { driver, vehicle } = account;
  const presence = usePresence(notify);
  const { dashboard } = useLayout();
  const fleet = !!driver.vendorId;
  const now = useNow();
  const [showAll, setShowAll] = useState(false);
  const [dateFilter, setDateFilter] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [detail, setDetail] = useState<MarketplaceOffer | null>(null);
  const feed = useDutyFeed(showAll, dateFilter);
  const hasActive = !!activeTrip;
  const current = nextTrip ? tripIsActive(nextTrip) : false;
  const canBrowse = !fleet && presence.online && !hasActive;

  const metrics = (
    <View style={{ marginBottom: 26 }} accessibilityLabel="Today at a glance">
      <NxGrid columns={dashboard ? 4 : 2} phoneColumns={2} gap={dashboard ? 14 : 10}>
        {fleet ? (
          <NxMetric label="Earnings" value="Paid by fleet" foot={`${driver.vendorName || 'Your fleet'} settles your pay`} icon="chart" accent small />
        ) : (
          <NxMetric label="Today’s earnings" value={formatINR(earnings.todayEarnings)} foot={`7 days ${formatINR(earnings.thisWeekEarnings)}`} icon="chart" accent onPress={() => goTab('Earnings')} />
        )}
        <NxMetric label="Completed trips" value={String(completedTrips.length).padStart(2, '0')} foot={driver.rating != null ? `Rating ★ ${driver.rating.toFixed(1)}` : 'No ratings yet'} icon="check" onPress={() => goTab('Trip', { tab: 'completed' })} />
        {fleet ? (
          <NxMetric label="Vehicle" value={vehicle.vehicleNumber || 'Assigned by fleet'} foot={vehicle.vehicleType || 'Fleet vehicle'} icon="car" small />
        ) : (
          <NxMetric label="Wallet balance" value={formatINR(wallet.available)} foot="View settlement details" icon="wallet" onPress={() => goTab('Wallet')} />
        )}
        <NxMetric label="Upcoming trips" value={String(upcomingTrips.length).padStart(2, '0')} foot="Your confirmed duties" icon="calendar" onPress={() => goTab('Trip', { tab: 'upcoming' })} />
      </NxGrid>
    </View>
  );

  const nextSection = (
    <>
      <NxSectionHeading
        title={current ? 'Your current trip' : 'Your next trip'}
        right={<NxTextButton title={`My Trips (${upcomingTrips.length})`} trailingIcon="chevron" onPress={() => goTab('Trip')} />}
      />
      {nextTrip ? (
        <TripCard trip={nextTrip} now={now} onOpen={() => navigation.navigate('TripFlow', { bookingId: nextTrip.id })} />
      ) : (
        <NxEmpty
          icon="check"
          title={completedTrips.length ? 'All assigned trips completed' : 'No active assigned trips'}
          message={fleet ? 'Your fleet operator assigns your duties. They appear here instantly.' : 'Browse available duties or review your trip history.'}
          action={<NxButton title="View trip history" variant="secondary" onPress={() => goTab('Trip', { tab: 'completed' })} />}
        />
      )}
    </>
  );

  let duties: React.ReactNode;
  if (fleet) {
    duties = <NxEmpty icon="car" title="Trips come from your fleet" message={`${driver.vendorName || 'Your fleet operator'} takes duties and assigns them to you. Assigned trips appear on this screen.`} />;
  } else if (!presence.online) {
    duties = (
      <NxEmpty
        icon="power"
        title="You’re taking a break."
        message="Go online to browse and accept new duties. Your assigned trips stay available."
        action={<NxButton title="Go online" trailingIcon="arrow" loading={presence.busy} onPress={() => void presence.change('Online')} />}
      />
    );
  } else if (hasActive) {
    duties = <NxEmpty icon="trip" title="Finish your current trip" message="New duties appear here once you complete it." />;
  } else if (!feed.visible.length) {
    duties = (
      <NxEmpty
        icon="trip"
        title={feed.pool.length ? 'No duties on this date' : 'You’re all caught up.'}
        message={feed.pool.length ? 'Choose another date to see open duties.' : 'New duties appear here instantly — stay online.'}
        action={feed.pool.length ? <NxButton title="Show all dates" variant="secondary" onPress={() => setDateFilter('all')} /> : undefined}
      />
    );
  } else {
    duties = (
      <>
        {feed.visible.slice(0, HOME_DUTY_LIMIT).map((o) => (
          <DutyCard key={o.id} offer={o} onOpen={() => setDetail(o)} />
        ))}
        {feed.visible.length > HOME_DUTY_LIMIT ? <NxButton title={`View all ${feed.visible.length} duties`} variant="secondary" trailingIcon="arrow" onPress={() => goTab('Marketplace')} /> : null}
      </>
    );
  }

  const dutiesSection = (
    <>
      <NxSectionHeading
        title="Available duties"
        badge={fleet ? undefined : <NxBadge label={`${canBrowse ? feed.visible.length : 0} open`} tone="red" />}
        caption={fleet ? 'Assigned by your fleet operator' : showAll ? 'All open duties' : `Duties eligible for your ${vehicle.vehicleType || 'vehicle'}`}
        right={
          fleet ? null : (
            <NxSelectButton
              label={dateFilter === 'all' ? 'All dates' : dateFilter}
              disabled={!canBrowse}
              onPress={() => setFilterOpen(true)}
              accessibilityLabel={`Filter duties by pickup date: ${dateFilter === 'all' ? 'all dates' : dateFilter}`}
            />
          )
        }
      />
      {offersError ? <NxInfo tone="red" style={styles.flush}>{offersError}</NxInfo> : null}
      {duties}
      {canBrowse ? (
        <NxNote>
          Payouts are shown before you accept. Toll, parking & state tax are extra, as applicable.{' '}
          <Text
            style={styles.link}
            onPress={() => {
              setShowAll((v) => !v);
              setDateFilter('all');
            }}
            accessibilityRole="button"
          >
            {showAll ? 'Only my category' : `Show all duties (${feed.all.length})`}
          </Text>
        </NxNote>
      ) : null}
    </>
  );

  return (
    <NxScreen>
      {driver.docStatus === 'Rejected' ? (
        <NxPanel style={{ borderColor: '#F7CDD3' }}>
          <NxSectionHeading
            title="Document update required"
            caption={driver.rejectionReason || 'Some of your updated documents were not accepted. Please upload them again.'}
            right={<NxBadge label="Action needed" tone="red" icon="alert" />}
          />
          <NxButton title="Update documents" trailingIcon="arrow" onPress={() => navigation.navigate('UpdateDocuments')} />
        </NxPanel>
      ) : null}
      {driver.fleetSuspended ? (
        <NxInfo tone="red" icon="alert" style={styles.flushBottom}>
          {driver.vendorName || 'Your fleet operator'} has put you on hold. You will not get new duties until they reactivate you — please contact them.
        </NxInfo>
      ) : null}
      {deviceWarning ? <NxInfo tone="amber" icon="shield" style={styles.flushBottom}>{deviceWarning}</NxInfo> : null}
      {bookingsError ? <NxInfo tone="red" style={styles.flushBottom}>{bookingsError}</NxInfo> : null}
      {metrics}
      <NxTwoPane left={nextSection} right={dutiesSection} />
      <DutyDialog offer={detail} onClose={() => setDetail(null)} />
      <DateFilterDialog visible={filterOpen} onClose={() => setFilterOpen(false)} dates={feed.dates} value={dateFilter} onChange={setDateFilter} />
    </NxScreen>
  );
}

const styles = StyleSheet.create({
  flush: { marginTop: 0, marginBottom: 12 },
  flushBottom: { marginTop: 0, marginBottom: 16 },
  link: { color: nx.red, fontWeight: '700' },
});
