// Vehicle details and Driver details: identity, document validity, service status, pairing, availability and renewals.
import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Text } from '../../components/kit/Text';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { DetailGrid, Page } from '../../components/shell/Page';
import { Segmented } from '../../components/ui';
import { VehicleForm } from '../../components/fleet/VehicleForm';
import { displayDate } from '../../components/fields';
import { Avatar, Badge, Between, Btn, CarImage, Empty, Eyebrow, H2, Inline, KV, MenuItem, Notice, Panel, Small } from '../../components/kit/core';
import { firstPart, plate, shortId } from '../../components/kit/format';
import { flash } from '../../components/kit/flash';
import { deleteVehicle, setDriverFleetStatus, setVehicleStatus, VendorActionError } from '../../services/vendorService';
import { daysUntil } from '../../utils/wallet';
import { formatPhone } from '../../utils/format';
import { describeDataError } from '../../utils/retry';
import { goSection } from '../../navigation/navigationRef';
import type { RootStackParamList } from '../../navigation/types';
import type { VehicleStatus } from '../../types/operations';
import { EXPIRY_WARNING_DAYS } from '../../config/constants';
import { AvailabilitySheet, PairSheet, RenewSheet } from './sheets';
import { docTone, driverDocState, VEHICLE_DOCS, vehicleDocState, vehicleStatusLabel } from './logic';
import { colors, fontFamily } from '../../theme';

function ExpiryRow({ label, date }: { label: string; date: string }) {
  const days = daysUntil(date);
  const tone = days === null ? 'neutral' : days < 0 ? 'red' : days <= EXPIRY_WARNING_DAYS ? 'amber' : 'green';
  const text = days === null ? 'Not recorded' : days < 0 ? 'Expired' : days <= EXPIRY_WARNING_DAYS ? `${days} days left` : 'Valid';
  return (
    <Between style={styles.docRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.docLabel}>{label}</Text>
        <Small>{date ? `Valid until ${displayDate(date)}` : 'Awaiting verification'}</Small>
      </View>
      <Badge label={text} tone={tone} />
    </Between>
  );
}

export function VehicleScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'Vehicle'>>();
  const d = useVendorData();
  const [sheet, setSheet] = useState<'' | 'docs' | 'renew' | 'availability' | 'pair'>('');
  const v = d.vehicles.find((x) => x.id === params.id);
  if (!v) {
    return <Page title="Vehicle details"><Empty icon="car-sport-outline" title="Vehicle not found" text="It may have been removed from your fleet or moved to another partner." action={<Btn kind="secondary" icon="arrow-back" title="Fleet" onPress={() => goSection('Fleet')} />} /></Page>;
  }
  const doc = vehicleDocState(v);
  const upcoming = d.bookings.find((b) => b.vehicleId === v.id && ['Assigned', 'Ongoing'].includes(b.status));
  const changeStatus = (status: VehicleStatus) => {
    setVehicleStatus(v.id, status).then(() => flash(`${plate(v.vehicleNumber)} marked ${status === 'Active' ? 'In service' : status}.`), (e: unknown) => flash(describeDataError(e), 'error'));
  };
  const remove = () => Alert.alert('Remove vehicle?', `${plate(v.vehicleNumber)} will be removed from your fleet.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: () => { deleteVehicle(v).then(() => { flash(`${plate(v.vehicleNumber)} removed.`); goSection('Fleet'); }, (e: unknown) => flash(e instanceof VendorActionError ? e.message : describeDataError(e), 'error')); } },
  ]);

  const main = (
    <>
      <Panel>
        <Between><Eyebrow>{shortId(v.id, 'NSM-CAR')}</Eyebrow><Badge label={doc} tone={docTone(doc)} /></Between>
        <View style={styles.carHead}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.plate}>{plate(v.vehicleNumber)}</Text>
            <Small>{[[v.make, v.model].filter(Boolean).join(' '), v.year, v.color].filter(Boolean).join(' · ') || 'Model not recorded'}</Small>
          </View>
          <CarImage category={v.category} model={v.model} width={150} height={92} />
        </View>
        {v.docStatus === 'Rejected' ? <Notice tone="red" title="Documents rejected" text={v.rejectionReason || 'Upload corrected documents for office review.'} style={{ marginTop: 14 }} action={<Btn kind="secondary" small icon="cloud-upload-outline" title="Update documents" onPress={() => setSheet('docs')} />} /> : null}
        <KV rows={[['Category', v.category || '—'], ['Seats', v.seatingCapacity ? String(v.seatingCapacity) : '—'], ['Fuel', v.fuelType || '—'], ['RC number', v.rcNumber || '—'], ['Paired driver', v.assignedDriverName || 'None'], upcoming ? ['Next duty', `${upcoming.bookingId} · ${firstPart(upcoming.pickupAddress)}`] : null]} />
      </Panel>
      <Panel>
        <H2>Documents & validity</H2>
        <Small style={{ marginTop: 4 }}>A hold applies only to this Car ID. Renewals are approved by the office.</Small>
        <View style={{ marginTop: 10 }}>{VEHICLE_DOCS.map((x) => <ExpiryRow key={x.key} label={x.label} date={v[x.key]} />)}</View>
        <Inline style={{ marginTop: 14, gap: 10 }}>
          <Btn kind="secondary" small icon="refresh" title="Renew a document" disabled={v.docStatus !== 'Approved'} onPress={() => setSheet('renew')} />
          <Btn kind="secondary" small icon="cloud-upload-outline" title="Update all documents" onPress={() => setSheet('docs')} />
        </Inline>
      </Panel>
    </>
  );

  const side = (
    <>
      <Panel>
        <Eyebrow>SERVICE STATUS</Eyebrow>
        <Text style={styles.status}>{vehicleStatusLabel(v)}</Text>
        <Small style={{ marginBottom: 12 }}>Only vehicles In service with approved documents can be assigned.</Small>
        <Segmented<VehicleStatus> options={[{ value: 'Active', label: 'In service' }, { value: 'Maintenance', label: 'Repair' }, { value: 'Inactive', label: 'Inactive' }]} value={v.status} onChange={changeStatus} />
      </Panel>
      <Panel style={{ paddingVertical: 8 }}>
        <MenuItem icon="time-outline" title="Update availability" sub="When and where it is free" onPress={() => setSheet('availability')} />
        <MenuItem icon="person-add-outline" title="Pair driver" sub={v.assignedDriverName || 'No paired driver'} onPress={() => setSheet('pair')} />
        <MenuItem icon="trash-outline" title="Remove vehicle" danger last onPress={remove} />
      </Panel>
    </>
  );

  return (
    <Page title="Vehicle details" subtitle={plate(v.vehicleNumber)}>
      <DetailGrid main={main} side={side} />
      {sheet === 'docs' ? <VehicleForm existing={v} onClose={() => setSheet('')} onSaved={(m) => { setSheet(''); flash(m); }} /> : null}
      {sheet === 'renew' ? <RenewSheet vehicle={v} onClose={() => setSheet('')} /> : null}
      {sheet === 'availability' ? <AvailabilitySheet vehicle={v} onClose={() => setSheet('')} /> : null}
      {sheet === 'pair' ? <PairSheet vehicle={v} onClose={() => setSheet('')} /> : null}
    </Page>
  );
}

export function DriverScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'Driver'>>();
  const d = useVendorData();
  const [pair, setPair] = useState(false);
  const x = d.drivers.find((y) => y.id === params.id);
  if (!x) {
    return <Page title="Driver details"><Empty icon="person-outline" title="Driver not found" text="The driver may have moved to another partner." action={<Btn kind="secondary" icon="arrow-back" title="Fleet" onPress={() => goSection('Fleet', { tab: 'Drivers' })} />} /></Page>;
  }
  const doc = driverDocState(x);
  const suspended = x.fleetStatus === 'Suspended';
  const duties = d.bookings.filter((b) => b.driverId === x.id && ['Assigned', 'Ongoing'].includes(b.status));
  const completed = d.bookings.filter((b) => b.driverId === x.id && b.status === 'Completed').length;
  const toggle = () => {
    const next = suspended ? 'Active' : 'Suspended';
    Alert.alert(suspended ? `Reactivate ${x.name}?` : `Suspend ${x.name}?`, suspended ? 'They can be assigned to your duties again.' : 'They will not be assigned to your duties until reactivated.', [
      { text: 'Cancel', style: 'cancel' },
      { text: suspended ? 'Reactivate' : 'Suspend', style: suspended ? 'default' : 'destructive', onPress: () => { setDriverFleetStatus(x.id, next).then(() => flash(`${x.name} ${suspended ? 'reactivated' : 'suspended'}.`), (e: unknown) => flash(describeDataError(e), 'error')); } },
    ]);
  };

  const main = (
    <>
      <Panel>
        <Between><Eyebrow>{shortId(x.id, 'NSM-DR')}</Eyebrow><Badge label={doc} tone={docTone(doc)} /></Between>
        <View style={styles.person}>
          <Avatar name={x.name} size={56} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.plate}>{x.name}</Text>
            <Small>{formatPhone(x.phone)}{x.rating ? ` · ★ ${x.rating.toFixed(1)}` : ''}</Small>
          </View>
        </View>
        <Inline style={{ marginTop: 14 }}>
          <Badge label={suspended ? 'Suspended' : 'Active'} tone={suspended ? 'red' : 'neutral'} />
          <Badge label={x.approvalStatus === 'Approved' ? 'Approved by NESAM' : x.approvalStatus || 'Waiting for approval'} tone={x.approvalStatus === 'Approved' ? 'green' : 'amber'} />
          {x.presenceStatus ? <Badge label={x.presenceStatus} tone={x.presenceStatus === 'Online' ? 'green' : 'neutral'} /> : null}
        </Inline>
        <KV rows={[['Driving licence', x.licenseNumber || '—'], ['Paired vehicle', x.assignedVehicleNumber ? plate(x.assignedVehicleNumber) : 'None'], ['Documents', x.docStatus || '—'], ['Completed duties', String(completed)]]} />
      </Panel>
      <Panel>
        <H2>Licence validity</H2>
        <ExpiryRow label="Driving licence" date={x.licenseExpiry} />
        {doc === 'Expired' || doc === 'Rejected' ? <Notice tone="amber" title="Assignment on hold for this driver" text="The driver renews documents from the NESAM Driver app; the office approves them before duties can be assigned." style={{ marginTop: 12 }} /> : null}
      </Panel>
      {duties.length ? (
        <Panel>
          <H2>Current duties</H2>
          {duties.map((b) => <KV key={b.id} rows={[[b.bookingId, `${firstPart(b.pickupAddress)} → ${firstPart(b.dropAddress)}`]]} />)}
        </Panel>
      ) : null}
    </>
  );
  const side = (
    <Panel style={{ paddingVertical: 8 }}>
      <MenuItem icon="car-outline" title="Pair vehicle" sub={x.assignedVehicleNumber ? plate(x.assignedVehicleNumber) : 'No paired vehicle'} onPress={() => setPair(true)} />
      <MenuItem icon={suspended ? 'play-circle-outline' : 'pause-circle-outline'} title={suspended ? 'Resume duties' : 'Suspend driver'} sub={suspended ? 'Allow assignments again' : 'Stop new assignments'} danger={!suspended} last onPress={toggle} />
    </Panel>
  );
  return (
    <Page title="Driver details" subtitle={x.name}>
      <DetailGrid main={main} side={side} />
      {pair ? <PairSheet driver={x} onClose={() => setPair(false)} /> : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  carHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16 },
  plate: { fontFamily, fontSize: 21, fontWeight: '600', color: colors.ink, marginBottom: 4, letterSpacing: -0.2 },
  status: { fontFamily, fontSize: 20, fontWeight: '600', color: colors.ink, marginTop: 10, marginBottom: 4 },
  docRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F2F5' },
  docLabel: { fontFamily, fontSize: 13, fontWeight: '500', color: colors.ink, marginBottom: 2 },
});
