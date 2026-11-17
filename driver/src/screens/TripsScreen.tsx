// My Trips (reference "My Trips"): upcoming, completed and cancelled duties. Every card opens the trip page.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { Text } from '../components/nx/Text';
import { CancelledRequestCard } from '../components/nx/Cancellation';
import { useNow } from '../hooks/useNow';
import { useDriverData } from '../context/DriverData';
import { NxScreen } from '../components/nx/Shell';
import { NxGrid } from '../components/nx/layout';
import { NxBadge, NxButton, NxEmpty, NxNote, NxPanel, NxPills, NxTextButton, placeName } from '../components/nx/primitives';
import { NxIcon } from '../components/nx/Icon';
import { TripCard } from '../components/nx/TripCard';
import { payoutLabel, tripIsActive, tripStageLabel, tripWhen } from '../components/nx/tripFormat';
import { goTab } from '../navigation/navItems';
import type { TabParamList } from '../navigation/types';
import type { TripDetails } from '../types/driver';
import { tripEarningStatus } from '../utils/ledger';
import { formatINR } from '../utils/format';
import { formatDate } from '../utils/time';
import { nx } from '../theme/nx';

type Tab = 'upcoming' | 'active' | 'completed' | 'cancelled';
const SETTLED: Record<string, string> = { pending: 'Settlement pending', available: 'Settled', cancelled: 'Reversed' };

export function TripsScreen({ route }: Partial<BottomTabScreenProps<TabParamList, 'Trip'>>) {
  const navigation = useNavigation();
  const { upcomingTrips: assigned, completedTrips, cancelledTrips, ledger, cancellations } = useDriverData();
  // A trip that has been started (photos, heading to pickup, on trip) sits under Active; the rest are upcoming.
  const activeTrips = assigned.filter(tripIsActive);
  const upcomingTrips = assigned.filter((t) => !tripIsActive(t));
  const released = cancellations.filter((r) => r.status === 'Approved' && !cancelledTrips.some((t) => t.id === r.bookingId));
  const wanted = route?.params?.tab;
  const [tab, setTab] = useState<Tab>(wanted ?? 'upcoming');
  const [seen, setSeen] = useState(wanted);
  // A Home tile can ask for a tab; follow it each time it changes.
  if (wanted !== seen) {
    setSeen(wanted);
    if (wanted) setTab(wanted);
  }
  const now = useNow();
  const open = (t: TripDetails) => navigation.navigate('TripFlow', { bookingId: t.id });

  let body: React.ReactNode;
  if (tab === 'active') {
    body = activeTrips.length ? (
      <NxGrid columns={2} gap={18}>
        {activeTrips.map((t) => (
          <TripCard key={t.id} trip={t} now={now} onOpen={() => open(t)} />
        ))}
      </NxGrid>
    ) : (
      <NxEmpty icon="trip" title="No active trip" message="A trip you have started will appear here until it is completed." />
    );
  } else if (tab === 'upcoming') {
    body = upcomingTrips.length ? (
      <NxGrid columns={2} gap={18}>
        {upcomingTrips.map((t) => (
          <TripCard key={t.id} trip={t} now={now} onOpen={() => open(t)} />
        ))}
      </NxGrid>
    ) : (
      <NxEmpty icon="trip" title="No upcoming duties" message="Accepted duties will appear here." action={<NxButton title="Find a duty" trailingIcon="arrow" onPress={() => goTab('Marketplace')} />} />
    );
  } else if (tab === 'completed') {
    body = completedTrips.length ? (
      <NxGrid columns={2} gap={18}>
        {completedTrips.map((t) => (
          <CompletedCard key={t.id} trip={t} status={tripEarningStatus(ledger, t.id)} onOpen={() => open(t)} />
        ))}
      </NxGrid>
    ) : (
      <NxEmpty icon="check" title="No completed trips yet" message="Finished trips and their settlement status will appear here." />
    );
  } else {
    body =
      cancelledTrips.length || released.length ? (
        <NxGrid columns={2} gap={18}>
          {cancelledTrips.map((t) => (
            <CancelledCard key={t.id} trip={t} onOpen={() => open(t)} />
          ))}
          {released.map((r) => (
            <CancelledRequestCard key={r.id} request={r} />
          ))}
        </NxGrid>
      ) : (
        <NxEmpty icon="shield" title="No cancelled duties" message="Admin-approved cancellations will appear here." />
      );
  }

  return (
    <NxScreen>
      <NxPills<Tab>
        fill
        label="Trip list"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'upcoming', label: `Upcoming (${upcomingTrips.length})` },
          { value: 'active', label: `Active (${activeTrips.length})` },
          { value: 'completed', label: `Completed (${completedTrips.length})` },
          { value: 'cancelled', label: `Cancelled (${cancelledTrips.length + released.length})` },
        ]}
      />
      {activeTrips[0] && tab === 'upcoming' ? (
        <View style={styles.strip}>
          <NxIcon name="navigate" size={18} color={nx.green} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.stripTitle}>You have a trip in progress</Text>
            <Text style={styles.stripSub} numberOfLines={1}>
              {tripStageLabel(activeTrips[0])} · {placeName(activeTrips[0].pickup.address)} → {placeName(activeTrips[0].drop.address)}
            </Text>
          </View>
          <NxTextButton title="Resume" trailingIcon="chevron" color={nx.green} onPress={() => open(activeTrips[0]!)} />
        </View>
      ) : null}
      {body}
      <NxNote>Duty changes and cancellation requests are reviewed by NESAM. Call the office from Help if you need a change.</NxNote>
    </NxScreen>
  );
}

function CompletedCard({ trip, status, onOpen }: { trip: TripDetails; status: string; onOpen: () => void }) {
  const settled = status === 'available';
  const badge = trip.fleetTrip ? 'Settled by fleet' : status ? SETTLED[status] || status : 'Settlement pending';
  const date = trip.completedAt ? formatDate(trip.completedAt) : tripWhen(trip).date;
  return (
    <NxPanel style={styles.card}>
      <View style={styles.meta}>
        <Text style={styles.metaText}>{date}</Text>
        <NxBadge label={badge} tone={settled || trip.fleetTrip ? 'green' : 'amber'} />
      </View>
      <Text style={styles.route} numberOfLines={2}>
        {placeName(trip.pickup.address)} → {placeName(trip.drop.address)}
      </Text>
      <Text style={styles.info}>{trip.bookingId} · Completed</Text>
      <View style={styles.bottom}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.metaText}>{trip.fleetTrip ? 'Paid by your fleet' : settled ? 'Driver earnings credited' : 'Driver payout under review'}</Text>
          <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
            {payoutLabel(trip)}
          </Text>
        </View>
        <NxButton title="Trip summary" trailingIcon="arrow" variant="secondary" compact onPress={onOpen} />
      </View>
    </NxPanel>
  );
}

function CancelledCard({ trip, onOpen }: { trip: TripDetails; onOpen: () => void }) {
  const when = tripWhen(trip);
  return (
    <NxPanel style={styles.card}>
      <View style={styles.meta}>
        <Text style={styles.metaText}>
          {when.date}
          {when.time ? ` · ${when.time}` : ''}
        </Text>
        <NxBadge label="Cancelled" tone="neutral" />
      </View>
      <Text style={styles.route} numberOfLines={2}>
        {placeName(trip.pickup.address)} → {placeName(trip.drop.address)}
      </Text>
      <Text style={styles.info}>{trip.bookingId}</Text>
      <View style={styles.bottom}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.metaText}>Cancelled by NESAM</Text>
          <Text style={styles.amount}>{formatINR(0)}</Text>
        </View>
        <NxButton title="View details" trailingIcon="arrow" variant="secondary" compact onPress={onOpen} />
      </View>
    </NxPanel>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, marginBottom: 17, borderRadius: 13, borderWidth: 1, borderColor: '#D6EEE2', backgroundColor: nx.greenSoft },
  stripTitle: { fontSize: 12, fontWeight: '700', color: nx.green },
  stripSub: { fontSize: 10.5, color: nx.green, marginTop: 1 },
  card: { padding: 20, marginBottom: 0, flex: 1 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  metaText: { fontSize: 11.5, color: nx.muted },
  route: { fontSize: 15.5, fontWeight: '700', letterSpacing: -0.4, color: nx.ink, marginTop: 10 },
  info: { fontSize: 11.5, color: nx.muted, marginTop: 6 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderTopWidth: 1, borderTopColor: nx.lineSoft, paddingTop: 13, marginTop: 15 },
  amount: { fontSize: 20, fontWeight: '700', letterSpacing: -0.5, color: nx.ink, marginTop: 2 },
});
