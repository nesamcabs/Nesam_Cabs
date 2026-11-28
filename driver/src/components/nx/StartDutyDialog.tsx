// "Start Local Duty" from the Drive page: the town, the order types and the hours. The server (createLocalShift) checks the
// driver and the vehicle and creates a planned duty; the duty page then asks for the photo check and the start slide. Only a
// running duty is shown on riders' maps — the Online switch alone is not.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { NxDialog } from './Dialog';
import { NxButton, NxField, NxFormError, NxInfo, NxPills, nxText } from './primitives';
import { useDriverData } from '../../context/DriverData';
import { ActionError } from '../../services/callables';
import { startMyLocalDuty } from '../../services/localDutyService';
import type { LocalMode } from '../../types/driver';
import { LOCAL_MODE_LABEL } from '../../utils/localDuty';
import { describeError } from '../../utils/retry';
import { nx } from '../../theme/nx';

type Orders = LocalMode | 'both';
const ORDERS: { value: Orders; label: string }[] = [
  { value: 'both', label: 'Both' },
  { value: 'pickup_drop', label: LOCAL_MODE_LABEL.pickup_drop },
  { value: 'rental', label: LOCAL_MODE_LABEL.rental },
];
const HOURS = ['4', '8', '12'] as const;

export function StartDutyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { account } = useDriverData();
  const [city, setCity] = useState(account.driver.city ?? '');
  const [orders, setOrders] = useState<Orders>('both');
  const [hours, setHours] = useState<(typeof HOURS)[number]>('8');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (busy) return;
    if (city.trim().length < 2) {
      setError('Enter your town or city.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await startMyLocalDuty({ cityName: city.trim(), services: orders === 'both' ? ['pickup_drop', 'rental'] : [orders], hours: Number(hours) });
      onClose();
      onCreated();
    } catch (e) {
      setError(e instanceof ActionError ? e.message : describeError(e, 'The local duty could not be created.'));
      setBusy(false);
    }
  };

  return (
    <NxDialog
      visible
      onClose={onClose}
      locked={busy}
      eyebrow="Local Taxi"
      title="Start Local Duty"
      footer={<NxButton title={busy ? 'Setting up…' : 'Continue to photo check'} trailingIcon="arrow" loading={busy} onPress={() => void submit()} />}
    >
      <NxField label="Town or city" value={city} onChangeText={setCity} placeholder="e.g. Theni" maxLength={80} style={{ marginTop: 0 }} />
      <Text style={styles.label}>Orders you take</Text>
      <NxPills<Orders> options={ORDERS} value={orders} onChange={setOrders} label="Orders you take" />
      <Text style={styles.label}>Hours on duty</Text>
      <NxPills<(typeof HOURS)[number]> options={HOURS.map((h) => ({ value: h, label: `${h} hours` }))} value={hours} onChange={setHours} label="Hours on duty" />
      <View style={{ marginTop: 16 }}>
        <NxInfo tone="amber" icon="info" style={{ marginTop: 0 }}>
          While the duty is running and the Drive page is open, riders nearby see your vehicle at an approximate position. Your name and number are not shown on their map.
        </NxInfo>
      </View>
      <Text style={[nxText.small, { marginTop: 10 }]}>Next: the selfie and vehicle photo check, then Slide to Start Duty.</Text>
      <NxFormError message={error} />
    </NxDialog>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '600', color: nx.ink, marginTop: 16, marginBottom: 8 },
});
