// The hourly-rental package clock: time left of the booked hours, ticking every second once the customer has boarded
// (the server's Trip Started stamp), then the time over the package. Shown on Local Taxi and on the trip page.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { nxText } from './primitives';
import { useNow } from '../../hooks/useNow';
import type { TripDetails } from '../../types/driver';
import { formatINR } from '../../utils/format';
import { clockText, rentalClock } from '../../utils/localDuty';
import { nx } from '../../theme/nx';

export function RentalClock({ trip }: { trip: TripDetails }) {
  const now = useNow(1000);
  const hours = trip.rentalHours ?? 0;
  const c = rentalClock(trip.tripStartedAt, hours, now);
  const over = c.overtimeMs > 0;
  return (
    <View style={[styles.clock, over && { backgroundColor: nx.redSoft, borderColor: nx.redBar }]}>
      <View style={styles.spread}>
        <Text style={styles.clockLabel}>{!c.started ? 'Rental package' : over ? 'Package time over' : 'Time left'}</Text>
        <Text style={nxText.small}>
          {hours ? `${hours} h` : '—'}
          {trip.includedKm ? ` · ${trip.includedKm} km incl.` : ''}
        </Text>
      </View>
      <Text style={[styles.clockValue, over && { color: nx.red }]} accessibilityLiveRegion="polite">
        {!c.started ? `${hours}:00:00` : over ? `+${clockText(c.overtimeMs)}` : clockText(c.remainingMs)}
      </Text>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${Math.round(c.progress * 100)}%` }, over && { backgroundColor: nx.red }]} />
      </View>
      <Text style={[nxText.small, { marginTop: 8 }]}>
        {!c.started
          ? 'The clock starts when the customer boards and you slide to start. Stay with the customer for the booked hours.'
          : over
            ? `Extra time is recorded on the trip${trip.extraHourRate ? ` (booked extra-hour rate ${formatINR(trip.extraHourRate)})` : ''} and billed by the office.`
            : `Used ${clockText(c.elapsedMs)} of ${hours} h. End the trip when the customer is done or the time is up.`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  clock: { marginTop: 14, borderRadius: 13, borderWidth: 1, borderColor: nx.line, backgroundColor: nx.page, padding: 14 },
  clockLabel: { fontSize: 11.5, fontWeight: '600', color: nx.muted },
  clockValue: { fontSize: 34, fontWeight: '700', letterSpacing: -1, color: nx.ink, marginTop: 6, fontVariant: ['tabular-nums'] },
  bar: { height: 6, borderRadius: 3, backgroundColor: nx.line, marginTop: 10, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3, backgroundColor: nx.green },
});
