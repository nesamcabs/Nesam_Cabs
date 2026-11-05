// Waiting at each stop, hill travel and roof carrier, recorded by the driver on the trip. It is only a record: NESAM's office
// reviews it, and the server works out any charge from the rates saved on this booking (functions/src/extraUsage.ts).
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { NxButton, NxField, NxFormError, NxInfo, NxPanel, NxPills, NxSectionHeading, nxText } from './primitives';
import { callFunction } from '../../services/callables';
import type { TripDetails } from '../../types/driver';
import { nx } from '../../theme/nx';

type YesNo = 'no' | 'yes';
interface StopRow { minutes: string }

export function ExtraUsageCard({ trip, onDone }: { trip: TripDetails; onDone: (message: string) => void }) {
  const u = trip.extraUsage ?? null;
  const revision = u?.revision ?? 0;
  const [waited, setWaited] = useState<YesNo>('no');
  const [stops, setStops] = useState<StopRow[]>([{ minutes: '' }]);
  const [hill, setHill] = useState<YesNo>('no');
  const [carrier, setCarrier] = useState<YesNo>('no');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Start from the last record sent, so a correction does not have to be typed again.
  useEffect(() => {
    const x = u?.usage;
    if (!x) return;
    const recorded = x.stops ?? [];
    setWaited(recorded.some((s) => s.waitedMinutes > 0) ? 'yes' : 'no');
    setStops(recorded.length ? recorded.map((s) => ({ minutes: String(s.waitedMinutes) })) : [{ minutes: '' }]);
    setHill(x.hill ? 'yes' : 'no');
    setCarrier(x.carrier ? 'yes' : 'no');
  }, [revision]); // eslint-disable-line react-hooks/exhaustive-deps

  if (u?.status === 'approved') {
    return (
      <NxPanel>
        <NxSectionHeading title="Waiting, hill & roof carrier" caption="Approved by the NESAM office" />
        <Text style={nxText.copy}>Any approved charge is on the customer&apos;s bill and in this trip&apos;s partner settlement.</Text>
      </NxPanel>
    );
  }

  const send = async () => {
    const list = waited === 'yes' ? stops.map((s, i) => ({ stopId: `stop-${i + 1}`, waitedMinutes: Number(s.minutes) })) : [];
    if (waited === 'yes' && list.some((s) => !Number.isInteger(s.waitedMinutes) || s.waitedMinutes < 0 || s.waitedMinutes > 1440)) {
      setError('Enter the minutes you waited at each stop (whole minutes).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await callFunction('recordExtraUsage', { bookingId: trip.id, expectedRevision: revision, usage: { stops: list, hill: hill === 'yes', carrier: carrier === 'yes' } });
      onDone('Sent to the NESAM office for review.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <NxPanel>
      <NxSectionHeading
        title="Waiting, hill & roof carrier"
        caption={u?.status === 'submitted' ? 'Sent · waiting for office review' : u?.status === 'rejected' ? 'Returned by the office — correct and send again' : 'Tell the office what happened on this trip'}
      />
      {u?.status === 'rejected' && u.reviewNote ? <NxInfo tone="amber">Office note: {u.reviewNote}</NxInfo> : null}
      <NxPills<YesNo> label="Waiting" value={waited} onChange={setWaited} options={[{ value: 'no', label: 'No waiting' }, { value: 'yes', label: 'I waited at stops' }]} />
      {waited === 'yes' ? (
        <View>
          {stops.map((s, i) => (
            <NxField
              key={i}
              label={`Stop ${i + 1} · minutes waited`}
              value={s.minutes}
              onChangeText={(t) => setStops((r) => r.map((x, j) => (j === i ? { minutes: t.replace(/\D/g, '').slice(0, 4) } : x)))}
              keyboardType="number-pad"
              style={i === 0 ? { marginTop: 0 } : undefined}
            />
          ))}
          <View style={styles.row}>
            <NxButton title="Add stop" variant="secondary" compact disabled={stops.length >= 20} onPress={() => setStops((r) => [...r, { minutes: '' }])} />
            {stops.length > 1 ? <NxButton title="Remove last" variant="ghost" compact onPress={() => setStops((r) => r.slice(0, -1))} /> : null}
          </View>
        </View>
      ) : null}
      <Text style={styles.label}>Hill travel</Text>
      <NxPills<YesNo> label="Hill travel" value={hill} onChange={setHill} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} />
      <Text style={styles.label}>Roof carrier used</Text>
      <NxPills<YesNo> label="Roof carrier" value={carrier} onChange={setCarrier} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} />
      <NxFormError message={error} />
      <NxButton title={u ? 'Send correction' : 'Send to office'} loading={busy} onPress={() => void send()} />
      <Text style={[nxText.small, { marginTop: 8 }]}>Free waiting is applied at each stop. The office confirms any charge.</Text>
    </NxPanel>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginTop: 10, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '700', color: nx.muted, marginBottom: 8 },
});
