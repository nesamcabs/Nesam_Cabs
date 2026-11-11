import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import type { TripDetails } from '../../types/driver';
import { nx } from '../../theme/nx';
import { NxIcon } from './Icon';
import { NxBadge, NxButton, NxPanel, NxRouteStack } from './primitives';
import { dayLabel, kmText, payoutCaption, payoutLabel, shortDate, tripIsActive, tripStageLabel, tripWhen } from './tripFormat';

/** The trip card used for the next/current trip on Home and for every upcoming trip. */
export function TripCard({ trip, now, onOpen }: { trip: TripDetails; now: number; onOpen: () => void }) {
  const when = tripWhen(trip);
  const day = dayLabel(trip.pickupAt, now);
  const active = tripIsActive(trip);
  // Opens the trip. Starting the journey itself happens inside, step by step, as the server allows each one.
  const cta = active ? 'Continue trip' : 'Open trip';
  const km = kmText(trip.distanceKm);
  return (
    <NxPanel accent style={styles.card}>
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <Text style={styles.date}>
            {day || when.date}
            {day === 'Today' || day === 'Tomorrow' ? ` · ${shortDate(trip.pickupAt)}` : ''}
          </Text>
          <Text style={styles.time}>{when.time || '—'}</Text>
        </View>
        <NxBadge label={tripStageLabel(trip)} tone={active ? 'red' : 'green'} icon={active ? 'trip' : 'check'} />
      </View>
      <View style={styles.pad}>
        <NxRouteStack pickup={trip.pickup.address} drop={trip.drop.address} />
        <View style={styles.facts}>
          <Fact icon="car" text={trip.vehicleType || 'Cab'} />
          {km ? <Fact icon="distance" text={km} /> : null}
          {trip.serviceType ? <Fact icon="clock" text={trip.serviceType} /> : null}
        </View>
      </View>
      <View style={styles.bottom}>
        <View style={styles.payout}>
          <View style={{ flex: 1 }}>
            <Text style={styles.payoutLabel}>Driver payout</Text>
            <Text style={styles.payoutNote}>{payoutCaption(trip)}</Text>
          </View>
          <Text style={styles.payoutValue} numberOfLines={1} adjustsFontSizeToFit>
            {payoutLabel(trip)}
          </Text>
        </View>
        <NxButton title={cta} trailingIcon="arrow" onPress={onOpen} style={{ borderRadius: 11 }} />
      </View>
    </NxPanel>
  );
}

function Fact({ icon, text }: { icon: 'car' | 'distance' | 'clock'; text: string }) {
  return (
    <View style={styles.fact}>
      <NxIcon name={icon} size={13} color={nx.muted} />
      <Text style={styles.factText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0, marginBottom: 16, overflow: 'hidden' },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 16, paddingHorizontal: 17 },
  date: { fontSize: 11, fontWeight: '500', color: nx.muted, marginBottom: 6 },
  time: { fontSize: 27, fontWeight: '800', letterSpacing: -1, color: nx.ink, lineHeight: 32 },
  pad: { paddingHorizontal: 17 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 4, marginBottom: 13 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  factText: { fontSize: 11, color: nx.muted },
  bottom: { borderTopWidth: 1, borderTopColor: nx.line, paddingTop: 13, paddingHorizontal: 17, paddingBottom: 16, gap: 12 },
  payout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  payoutLabel: { fontSize: 11, fontWeight: '600', color: '#424B5A' },
  payoutNote: { fontSize: 10, color: nx.muted, marginTop: 2 },
  payoutValue: { fontSize: 24, fontWeight: '800', letterSpacing: -0.7, color: nx.ink, maxWidth: '55%' },
});
