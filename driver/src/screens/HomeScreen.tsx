// Home (reference "Dashboard"): today at a glance and the next / current trip. Open duties live on the Duties page.
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/nx/Text';
import { NxIcon } from '../components/nx/Icon';
import { nx } from '../theme/nx';
import { currentShift } from '../utils/localDuty';
import { useNavigation } from '@react-navigation/native';
import { useDriverData } from '../context/DriverData';
import { NxScreen } from '../components/nx/Shell';
import { NxGrid, useLayout } from '../components/nx/layout';
import { NxBadge, NxButton, NxEmpty, NxInfo, NxMetric, NxPanel, NxSectionHeading, NxTextButton } from '../components/nx/primitives';
import { TripCard } from '../components/nx/TripCard';
import { tripIsActive } from '../components/nx/tripFormat';
import { useNow } from '../hooks/useNow';
import { goTab } from '../navigation/navItems';
import { formatINR } from '../utils/format';

export function HomeScreen() {
  const navigation = useNavigation();
  const { account, nextTrip, upcomingTrips, completedTrips, bookingsError, deviceWarning, earnings, wallet, shifts } = useDriverData();
  const { driver, vehicle } = account;
  const { dashboard } = useLayout();
  const fleet = !!driver.vendorId;
  const now = useNow();
  const current = nextTrip ? tripIsActive(nextTrip) : false;

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
          <NxMetric label="Wallet balance" value={formatINR(wallet.available)} foot="View settlement details" icon="wallet" onPress={() => goTab('Earnings')} />
        )}
        <NxMetric label="Upcoming trips" value={String(upcomingTrips.length).padStart(2, '0')} foot="Your confirmed duties" icon="calendar" onPress={() => goTab('Trip', { tab: 'upcoming' })} />
      </NxGrid>
      <LocalTaxiEntry shift={currentShift(shifts, now)} />
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
          message={fleet ? 'Your fleet operator assigns your duties. They appear here instantly.' : 'Open the Duties tab to find new duties, or review your trip history.'}
          action={<NxButton title="View trip history" variant="secondary" onPress={() => goTab('Trip', { tab: 'completed' })} />}
        />
      )}
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
      {nextSection}
    </NxScreen>
  );
}

const styles = StyleSheet.create({
  flushBottom: { marginTop: 0, marginBottom: 16 },
});

/** The way into Local Taxi from Home: go on local duty, or open the duty that is planned / running. */
function LocalTaxiEntry({ shift }: { shift: ReturnType<typeof currentShift> }) {
  const running = shift?.status === 'Active';
  const planned = shift?.status === 'Scheduled';
  const title = running ? `On local duty · ${shift!.cityName}` : planned ? `Local duty planned · ${shift!.cityName}` : 'Local Taxi';
  const sub = running
    ? 'Take the next Hourly Rental or Pickup & Drop order near you.'
    : planned
      ? 'Do the photo check and slide to start.'
      : 'Go on local duty: Hourly Rental and Pickup & Drop orders, one after another.';
  return (
    <Pressable
      onPress={() => goTab('Local')}
      style={({ pressed }) => [entry.box, running && entry.on, pressed && { opacity: 0.9 }]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
    >
      <View style={[entry.icon, running && { backgroundColor: nx.white }]}>
        <NxIcon name="taxi" size={22} color={nx.red} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={entry.title} numberOfLines={1}>{title}</Text>
        <Text style={entry.sub} numberOfLines={2}>{sub}</Text>
      </View>
      <View style={entry.cta}>
        <Text style={entry.ctaText}>{running || planned ? 'Open' : 'Start'}</Text>
        <NxIcon name="arrow" size={14} color={nx.white} />
      </View>
    </Pressable>
  );
}

const entry = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: nx.redBar, backgroundColor: nx.redSoft },
  on: { borderColor: nx.greenLine, backgroundColor: nx.greenSoft },
  icon: { width: 44, height: 44, borderRadius: 13, backgroundColor: nx.white, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '700', color: nx.ink, letterSpacing: -0.2 },
  sub: { fontSize: 11.5, lineHeight: 16, color: nx.muted, marginTop: 2 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36, paddingHorizontal: 12, borderRadius: 10, backgroundColor: nx.red },
  ctaText: { fontSize: 12, fontWeight: '700', color: nx.white },
});
