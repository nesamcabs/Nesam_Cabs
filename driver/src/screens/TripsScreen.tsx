// My Trips: upcoming, completed and cancelled duties (reference "My Trips"). Opens the trip flow for any of them.
import React, { useState } from 'react';
import { CancelledRequestCard } from '../components/nx/Cancellation';
import { StyleSheet, View } from 'react-native';
import { Text } from '../components/nx/Text';
import { useNow } from '../hooks/useNow';
import { useNavigation } from '@react-navigation/native';
import { useDriverData } from '../context/DriverData';
import { NxScreen } from '../components/nx/Shell';
import { NxColumns } from '../components/nx/layout';
import { NxIcon } from '../components/nx/Icon';
import { NxBadge, NxButton, NxEmpty, NxPanel, NxPills, placeName } from '../components/nx/primitives';
import { TripCard } from '../components/nx/TripCard';
import { payoutLabel, tripWhen } from '../components/nx/tripFormat';
import type { TripDetails } from '../types/driver';
import { tripEarningStatus } from '../utils/ledger';
import { formatINR } from '../utils/format';
import { formatDate } from '../utils/time';
import { nx } from '../theme/nx';

type Tab = 'upcoming' | 'completed' | 'cancelled';
const SETTLED: Record<string, string> = { pending: 'Awaiting payment', available: 'In wallet', cancelled: 'Reversed' };

export function TripsScreen() {
  const navigation = useNavigation();
  const { upcomingTrips, completedTrips, cancelledTrips, ledger, cancellations } = useDriverData();
  const released = cancellations.filter((r) => r.status === 'Approved' && !cancelledTrips.some((t) => t.id === r.bookingId));
  const [tab, setTab] = useState<Tab>('upcoming');
  const now = useNow();
  const open = (t: TripDetails) => navigation.navigate('TripFlow', { bookingId: t.id });

  return (
    <NxScreen title="My Trips" subtitle="Duty History & Schedule">
      <NxPills<Tab>
        scroll
        label="Trip list"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'upcoming', label: `Upcoming (${upcomingTrips.length})` },
          { value: 'completed', label: `Completed (${completedTrips.length})` },
          { value: 'cancelled', label: `Cancelled (${cancelledTrips.length + released.length})` },
        ]}
      />
      {tab === 'upcoming' ? (
        upcomingTrips.length ? (
          <NxColumns>{upcomingTrips.map((t) => <TripCard key={t.id} trip={t} now={now} onOpen={() => open(t)} />)}</NxColumns>
        ) : (
          <NxEmpty
            icon="trip"
            title="No upcoming duties"
            message="Accepted duties will appear here."
            action={<NxButton title="Browse duties" onPress={() => navigation.navigate('Tabs', { screen: 'Home' })} />}
          />
        )
      ) : tab === 'cancelled' ? (
        cancelledTrips.length || released.length ? (
          <NxColumns>
            {cancelledTrips.map((t) => <CancelledCard key={t.id} trip={t} onOpen={() => open(t)} />)}
            {released.map((r) => <CancelledRequestCard key={r.id} request={r} />)}
          </NxColumns>
        ) : (
          <NxEmpty icon="shield" title="No cancelled duties" message="Admin-approved cancellations will appear here." />
        )
      ) : completedTrips.length ? (
        <NxColumns>{completedTrips.map((t) => <CompletedCard key={t.id} trip={t} status={tripEarningStatus(ledger, t.id)} onOpen={() => open(t)} />)}</NxColumns>
      ) : (
        <NxEmpty icon="check" title="No completed trips yet" message="Finished trips and their settlement status will appear here." />
      )}
      <View style={styles.note}>
        <NxIcon name="info" size={14} color={nx.muted} />
        <Text style={styles.noteText}>Duty changes and cancellations are handled by NESAM. Call the office from Help if you need a change.</Text>
      </View>
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
        <Text style={styles.metaDate}>{date}</Text>
        <NxBadge label={badge} tone={settled || trip.fleetTrip ? 'green' : 'amber'} />
      </View>
      <Text style={styles.route}>
        {placeName(trip.pickup.address)} → {placeName(trip.drop.address)}
      </Text>
      <Text style={styles.info}>{trip.bookingId} · Completed</Text>
      <View style={styles.bottom}>
        <View style={{ flex: 1 }}>
          <Text style={styles.metaDate}>{trip.fleetTrip ? 'Paid by your fleet' : settled ? 'Driver earnings credited' : 'Driver payout'}</Text>
          <Text style={styles.amount} numberOfLines={1}>
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
        <Text style={styles.metaDate}>
          {when.date}
          {when.time ? ` · ${when.time}` : ''}
        </Text>
        <NxBadge label="Cancelled" tone="neutral" />
      </View>
      <Text style={styles.route}>
        {placeName(trip.pickup.address)} → {placeName(trip.drop.address)}
      </Text>
      <Text style={styles.info}>{trip.bookingId}</Text>
      <View style={styles.bottom}>
        <View style={{ flex: 1 }}>
          <Text style={styles.metaDate}>Cancelled by NESAM</Text>
          <Text style={styles.amount}>{formatINR(0)}</Text>
        </View>
        <NxButton title="View details" trailingIcon="arrow" variant="secondary" compact onPress={onOpen} />
      </View>
    </NxPanel>
  );
}

const styles = StyleSheet.create({
  card: { padding: 17, marginBottom: 12, borderRadius: 15 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  metaDate: { fontSize: 11, color: nx.muted },
  route: { fontSize: 15, fontWeight: '700', letterSpacing: -0.4, color: nx.ink, marginTop: 8 },
  info: { fontSize: 11, color: nx.muted, marginTop: 7 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 14 },
  amount: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5, color: nx.ink },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 4 },
  noteText: { flex: 1, fontSize: 11, lineHeight: 19.8, color: nx.muted },
});
