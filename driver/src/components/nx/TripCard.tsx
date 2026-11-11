// The assigned-trip card (reference `.nx-compact-trip`), used for the next / current trip on Home and every upcoming trip
// in My Trips.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import type { TripDetails } from '../../types/driver';
import { useDriverData } from '../../context/DriverData';
import { nx } from '../../theme/nx';
import { NxIcon, type NxIconName } from './Icon';
import { NxBadge, NxButton, NxPanel, NxRouteStack } from './primitives';
import { arrivalWindow, dayLabel, kmText, payoutCaption, payoutLabel, shortDate, tripIsActive, tripStageLabel, tripWhen } from './tripFormat';

export function TripCard({ trip, now, onOpen }: { trip: TripDetails; now: number; onOpen: () => void }) {
  const { cancellations, rules } = useDriverData();
  const pendingCancel = cancellations.some((c) => c.bookingId === trip.id && c.status === 'Pending');
  const when = tripWhen(trip);
  const day = dayLabel(trip.pickupAt, now);
  const active = tripIsActive(trip);
  const ready = arrivalWindow(trip, rules, now).open;
  const cta = pendingCancel ? 'View request' : active ? 'Continue trip' : ready ? 'Start trip' : 'View trip';
  const badge = pendingCancel ? 'Cancellation under review' : tripStageLabel(trip);
  const km = kmText(trip.distanceKm);
  return (
    <NxPanel accent style={styles.card}>
      <View style={styles.top}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.date}>
            {day || when.date}
            {day === 'Today' || day === 'Tomorrow' ? ` · ${shortDate(trip.pickupAt)}` : ''}
          </Text>
          <Text style={styles.time}>{when.time || '—'}</Text>
        </View>
        <NxBadge label={badge} tone={pendingCancel ? 'amber' : active ? 'red' : 'green'} icon={pendingCancel ? 'clock' : active ? 'trip' : 'check'} style={{ maxWidth: 150 }} />
      </View>
      <View style={styles.pad}>
        <NxRouteStack pickup={trip.pickup.address} drop={trip.drop.address} />
        <View style={styles.facts}>
          <Fact icon="car" text={trip.vehicleType || 'Cab'} />
          {km ? <Fact icon="distance" text={km} /> : null}
          {trip.serviceType ? <Fact icon="clock" text={trip.serviceType} /> : null}
          {trip.bookingId ? <Fact icon="document" text={trip.bookingId} /> : null}
        </View>
      </View>
      <View style={styles.bottom}>
        <View style={styles.payout}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.payoutLabel}>Driver payout</Text>
            <Text style={styles.payoutNote} numberOfLines={2}>
              {payoutCaption(trip)}
            </Text>
          </View>
          <Text style={[styles.payoutValue, trip.fleetTrip && { fontSize: 15 }]} numberOfLines={1} adjustsFontSizeToFit>
            {payoutLabel(trip)}
          </Text>
        </View>
        <NxButton title={cta} trailingIcon="arrow" onPress={onOpen} style={{ borderRadius: 11 }} />
      </View>
    </NxPanel>
  );
}

function Fact({ icon, text }: { icon: NxIconName; text: string }) {
  return (
    <View style={styles.fact}>
      <NxIcon name={icon} size={14} color={nx.muted} />
      <Text style={styles.factText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0, marginBottom: 16, overflow: 'hidden' },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 18, paddingHorizontal: 20 },
  date: { fontSize: 11.5, fontWeight: '500', color: nx.muted, marginBottom: 6 },
  time: { fontSize: 27, fontWeight: '700', letterSpacing: -1, color: nx.ink, lineHeight: 33 },
  pad: { paddingHorizontal: 20 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6, marginTop: 4, marginBottom: 15 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' },
  factText: { fontSize: 11.5, color: nx.muted, flexShrink: 1 },
  bottom: { borderTopWidth: 1, borderTopColor: nx.line, paddingTop: 14, paddingHorizontal: 20, paddingBottom: 18, gap: 13 },
  payout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  payoutLabel: { fontSize: 11.5, fontWeight: '600', color: nx.text },
  payoutNote: { fontSize: 10.5, color: nx.muted, marginTop: 2 },
  payoutValue: { fontSize: 24, fontWeight: '700', letterSpacing: -0.7, color: nx.ink, maxWidth: '55%' },
});
