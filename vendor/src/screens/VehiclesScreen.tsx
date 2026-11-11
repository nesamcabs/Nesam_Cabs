// Vehicles of this fleet. Adding opens manual details and documents for review. Linking a car NESAM already knows is a
// separate request that the driver who drove it last confirms with a code
// (see components/links). Pairing a driver and changing a vehicle's service status stay direct, rules-checked writes.
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useVendorData } from '../context/VendorData';
import { Badge, Button, Card, Chip, EmptyState, Notice, Row, Screen, Segmented, Sheet, TextField } from '../components/ui';
import { CodePanel } from '../components/links/LinkParts';
import { VehicleForm } from '../components/fleet/VehicleForm';
import { assignVehicle, deleteVehicle, setVehicleStatus, VendorActionError } from '../services/vendorService';
import { findVehicle, requestVehicleLink, type LinkRequestResult, type VehicleLookup } from '../services/partnerLinks';
import type { FleetVehicle, VehicleStatus } from '../types/operations';
import type { TabParamList } from '../navigation/types';
import { DateField, SingleDocField, displayDate } from '../components/fields';
import { setVehicleAvailability, submitVehicleRenewal } from '../services/partnerOps';
import { daysUntil } from '../utils/wallet';
import { isPlate, normalizePlate as plateKey } from '../utils/fleet';
import { describeDataError } from '../utils/retry';
import { EXPIRY_WARNING_DAYS } from '../config/constants';
import { colors, space, type } from '../theme';


function ExpiryBadge({ label, date }: { label: string; date: string }) {
  const days = daysUntil(date);
  if (days == null || days > EXPIRY_WARNING_DAYS) return null;
  return <Badge label={days < 0 ? `${label} expired` : `${label} in ${days}d`} tone={days < 0 ? 'danger' : 'warning'} />;
}

export function VehiclesScreen() {
  const route = useRoute<RouteProp<TabParamList, 'Fleet'>>();
  const { vehicles, drivers } = useVendorData();
  const [linking, setLinking] = useState(false);
  const [editing, setEditing] = useState<FleetVehicle | null>(null);
  const [register, setRegister] = useState<string | null>(null);
  const [pairFor, setPairFor] = useState<FleetVehicle | null>(null);
  const [availabilityFor, setAvailabilityFor] = useState<FleetVehicle | null>(null);
  const [renewFor, setRenewFor] = useState<FleetVehicle | null>(null);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  // "Add …" from another screen arrives as a fresh timestamp param; open the manual form once per value.
  const addRequest = route.params?.add;
  const [seenAdd, setSeenAdd] = useState(addRequest);
  if (addRequest !== seenAdd) {
    setSeenAdd(addRequest);
    if (addRequest) setRegister('');
  }

  const changeStatus = (v: FleetVehicle, status: VehicleStatus) => {
    setMessage(null);
    setVehicleStatus(v.id, status).catch((e: unknown) => setMessage({ tone: 'error', text: describeDataError(e) }));
  };

  const remove = (v: FleetVehicle) =>
    Alert.alert('Remove vehicle?', `${v.vehicleNumber} will be removed from your fleet.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          deleteVehicle(v)
            .then(() =>
              setMessage({
                tone: 'success',
                text: `${v.vehicleNumber} removed.`,
              }),
            )
            .catch((e: unknown) =>
              setMessage({
                tone: 'error',
                text: e instanceof VendorActionError ? e.message : describeDataError(e),
              }),
            );
        },
      },
    ]);

  const approvedCount = vehicles.filter((v) => v.docStatus === 'Approved').length;

  return (
    <View style={styles.root}>
      {editing ? (
        <VehicleForm
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setMessage({ tone: 'success', text });
          }}
        />
      ) : null}
      {register !== null ? (
        <VehicleForm
          existing={null}
          initialPlate={register}
          onClose={() => setRegister(null)}
          onSaved={(text) => {
            setRegister(null);
            setMessage({ tone: 'success', text });
          }}
        />
      ) : null}
      {pairFor ? (
        <PairSheet
          key={pairFor.id}
          vehicle={pairFor}
          onClose={() => setPairFor(null)}
          onDone={(text) => {
            setPairFor(null);
            setMessage({ tone: 'success', text });
          }}
        />
      ) : null}
      {linking ? (
        <LinkVehicleSheet
          onClose={() => setLinking(false)}
          onMessage={(text, tone = 'success') => setMessage({ tone, text })}
          onRegister={(plate) => {
            setLinking(false);
            setRegister(plate);
          }}
        />
      ) : null}
      {availabilityFor ? <AvailabilitySheet vehicle={availabilityFor} onClose={() => setAvailabilityFor(null)} onDone={(text) => { setAvailabilityFor(null); setMessage({ tone: 'success', text }); }} /> : null}
      {renewFor ? <RenewSheet vehicle={renewFor} onClose={() => setRenewFor(null)} onDone={(text) => { setRenewFor(null); setMessage({ tone: 'success', text }); }} /> : null}
      <Screen edges={[]}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={type.h1}>Vehicles</Text>
            <Text style={type.small}>
              {vehicles.length} in your fleet · {approvedCount} approved
            </Text>
          </View>
          <Button small title="+ Add vehicle" onPress={() => setRegister('')} />
        </View>
        <Button small variant="ghost" title="Link an existing NESAM vehicle" onPress={() => setLinking(true)} />
        {message ? <Notice tone={message.tone} message={message.text} /> : null}
        {vehicles.length === 0 ? (
          <EmptyState
            title="No vehicles in your fleet yet"
            message="Enter your vehicle details and upload its documents for NESAM review."
            action={<Button title="Add your first vehicle" onPress={() => setRegister('')} />}
          />
        ) : (
          vehicles.map((v) => (
            <Card key={v.id}>
              <View style={styles.between}>
                <Text style={type.h2}>{v.vehicleNumber}</Text>
                <Badge
                  label={v.docStatus === 'Approved' ? 'Approved' : v.docStatus === 'Rejected' ? 'Rejected' : 'Awaiting NESAM review'}
                  tone={v.docStatus === 'Approved' ? 'success' : v.docStatus === 'Rejected' ? 'danger' : 'warning'}
                />
              </View>
              <Text style={type.small}>
                {[v.make, v.model].filter(Boolean).join(' ') || 'Make / model not recorded'} · {v.category} · {v.seatingCapacity} seats
              </Text>
              {v.docStatus === 'Rejected' && v.rejectionReason ? <Notice message={`Reason: ${v.rejectionReason}`} style={{ marginTop: space.sm }} /> : null}
              <View style={styles.badges}>
                <ExpiryBadge label="Insurance" date={v.insuranceExpiry} />
                <ExpiryBadge label="Permit" date={v.permitExpiry} />
                <ExpiryBadge label="FC" date={v.fitnessExpiry} />
              </View>
              <Row label="Paired driver" value={v.assignedDriverName || 'None'} />
              <Row label="Insurance till" value={displayDate(v.insuranceExpiry) || '—'} />
              <Row label="Permit till" value={displayDate(v.permitExpiry) || '—'} />
              <Segmented
                options={[
                  { value: 'Active', label: 'In service' },
                  { value: 'Maintenance', label: 'Maintenance' },
                  { value: 'Inactive', label: 'Inactive' },
                ]}
                value={v.status}
                onChange={(s) => changeStatus(v, s)}
              />
              <View style={styles.actions}>
                <Button small variant="secondary" title="Pair driver" onPress={() => setPairFor(v)} style={{ flex: 1 }} disabled={drivers.length === 0} />
                <Button small variant="secondary" title="Documents" onPress={() => setEditing(v)} style={{ flex: 1 }} />
                <Button small variant="ghost" title="Remove" onPress={() => remove(v)} />
              </View>
              <View style={styles.actions}>
                <Button small variant="secondary" title="Availability" onPress={() => setAvailabilityFor(v)} style={{ flex: 1 }} />
                <Button small variant="secondary" title="Renew a document" onPress={() => setRenewFor(v)} style={{ flex: 1 }} disabled={v.docStatus !== 'Approved'} />
              </View>
            </Card>
          ))
        )}
      </Screen>
    </View>
  );
}

/** When (and where) the vehicle is free for new duties — the same record the vendor website and the office read. */
function AvailabilitySheet({ vehicle, onClose, onDone }: { vehicle: FleetVehicle; onClose: () => void; onDone: (text: string) => void }) {
  const [at, setAt] = useState(() => new Date());
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pick = (mode: 'date' | 'time') =>
    DateTimePickerAndroid.open({
      value: at, mode, is24Hour: false, minimumDate: mode === 'date' ? new Date() : undefined,
      onChange: (event, d) => {
        if (event.type !== 'set' || !d) return;
        const next = new Date(at);
        if (mode === 'date') next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
        else next.setHours(d.getHours(), d.getMinutes(), 0, 0);
        setAt(next);
      },
    });
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await setVehicleAvailability(vehicle.id, at, location);
      onDone(`${vehicle.vehicleNumber} is available from ${at.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Availability was not saved.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible onClose={onClose} title={`Availability · ${vehicle.vehicleNumber}`} dismissible={!busy}>
      <Text style={[type.small, { marginBottom: space.md }]}>Tell the office when this vehicle is free for new duties, and where it will be.</Text>
      <View style={styles.actions}>
        <Pressable onPress={() => pick('date')} style={styles.pickBox} accessibilityRole="button" accessibilityLabel="Available from date">
          <Ionicons name="calendar-outline" size={18} color={colors.muted} />
          <Text style={type.body}>{at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
        </Pressable>
        <Pressable onPress={() => pick('time')} style={styles.pickBox} accessibilityRole="button" accessibilityLabel="Available from time">
          <Ionicons name="time-outline" size={18} color={colors.muted} />
          <Text style={type.body}>{at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</Text>
        </Pressable>
      </View>
      <TextField label="Vehicle location (optional)" value={location} onChangeText={setLocation} placeholder="e.g. Theni bus stand" maxLength={120} />
      {error ? <Notice message={error} /> : null}
      <Button title="Update availability" loading={busy} onPress={() => void save()} />
    </Sheet>
  );
}

const RENEWABLE: { key: 'rc' | 'insurance' | 'fitness' | 'permit' | 'puc'; label: string }[] = [
  { key: 'insurance', label: 'Insurance' }, { key: 'permit', label: 'Permit' }, { key: 'fitness', label: 'Fitness (FC)' }, { key: 'rc', label: 'RC' }, { key: 'puc', label: 'PUC' },
];

/**
 * A renewed document for office approval. Unlike "Documents" (which sends the whole vehicle back to review), the vehicle stays in
 * service on its current documents until the office approves the new expiry.
 */
function RenewSheet({ vehicle, onClose, onDone }: { vehicle: FleetVehicle; onClose: () => void; onDone: (text: string) => void }) {
  const { requests } = useVendorData();
  const [docKey, setDocKey] = useState<(typeof RENEWABLE)[number]['key']>('insurance');
  const [fileUrl, setFileUrl] = useState('');
  const [expiry, setExpiry] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = requests.filter((r) => r.type === 'document_renewal' && r.status === 'Pending' && r.entityName === vehicle.vehicleNumber);
  const tomorrow = new Date(Date.now() + 86400000);
  const save = async () => {
    if (!fileUrl) return setError('Upload the renewed document first.');
    if (!expiry) return setError('Choose the new expiry date.');
    setBusy(true);
    setError('');
    try {
      await submitVehicleRenewal(vehicle.id, docKey, expiry, fileUrl);
      onDone(`${RENEWABLE.find((d) => d.key === docKey)?.label} renewal sent for ${vehicle.vehicleNumber}. The office reviews it.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The renewal was not sent.');
    } finally {
      setBusy(false);
    }
    return undefined;
  };
  return (
    <Sheet visible onClose={onClose} title={`Renew a document · ${vehicle.vehicleNumber}`} dismissible={!busy && !uploading}>
      {pending.map((r) => <Notice key={r.id} tone="info" message={`${r.documentLabel} renewal under review · new expiry ${displayDate(r.expiry)}`} />)}
      <Text style={[type.label, { marginBottom: 6 }]}>Document</Text>
      <View style={styles.chips}>
        {RENEWABLE.map((d) => <Chip key={d.key} label={d.label} active={docKey === d.key} onPress={() => { setDocKey(d.key); setFileUrl(''); }} />)}
      </View>
      <SingleDocField label="Renewed document" vehicleId={vehicle.id} kind={`renewal-${docKey}`} value={fileUrl} onChange={setFileUrl} required onBusyChange={setUploading} />
      <DateField label="New expiry date" value={expiry} onChange={setExpiry} minimumDate={tomorrow} required />
      {error ? <Notice message={error} /> : null}
      <Button title={uploading ? 'Uploading…' : 'Send for approval'} loading={busy} disabled={uploading} onPress={() => void save()} />
    </Sheet>
  );
}

function PairSheet({ vehicle, onClose, onDone }: { vehicle: FleetVehicle; onClose: () => void; onDone: (text: string) => void }) {
  const { drivers, vehicles } = useVendorData();
  const [driverId, setDriverId] = useState(vehicle.assignedDriverId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const usable = drivers.filter((d) => d.approvalStatus === 'Approved' && d.fleetStatus !== 'Suspended');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const target = drivers.find((d) => d.id === driverId);
      if (target) await assignVehicle(target, vehicle, vehicles);
      else {
        const current = drivers.find((d) => d.id === vehicle.assignedDriverId);
        if (current) await assignVehicle(current, null, vehicles);
      }
      onDone(target ? `${target.name} paired with ${vehicle.vehicleNumber}.` : `${vehicle.vehicleNumber} unpaired.`);
    } catch (e) {
      setError(e instanceof VendorActionError ? e.message : describeDataError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={`Pair driver · ${vehicle.vehicleNumber}`} dismissible={!busy}>
      {usable.length === 0 ? <Notice tone="info" message="No approved drivers yet. Add a driver from the Drivers tab." /> : null}
      <View style={styles.chips}>
        <Chip label="None" active={!driverId} onPress={() => setDriverId('')} />
        {usable.map((d) => (
          <Chip key={d.id} label={d.name} active={driverId === d.id} onPress={() => setDriverId(d.id)} />
        ))}
      </View>
      <Notice message={error} />
      <Button title={busy ? 'Saving…' : 'Save'} loading={busy} disabled={driverId === vehicle.assignedDriverId} onPress={() => void save()} />
    </Sheet>
  );
}

type Step = 'plate' | 'found' | 'code';

function LinkVehicleSheet({
  onClose,
  onMessage,
  onRegister,
}: {
  onClose: () => void;
  onMessage: (text: string, tone?: 'success' | 'error') => void;
  onRegister: (plate: string) => void;
}) {
  const { vehicles, links } = useVendorData();
  const navigation = useNavigation();
  const [step, setStep] = useState<Step>('plate');
  const [plate, setPlate] = useState('');
  const [found, setFound] = useState<VehicleLookup | null>(null);
  const [result, setResult] = useState<LinkRequestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const key = plateKey(plate);
  const link = result ? links.find((l) => l.id === result.linkId) : undefined;

  const check = async () => {
    if (!isPlate(plate)) return setError('Enter the registration number as printed on the plate, e.g. TN 01 AB 1234.');
    if (vehicles.some((v) => plateKey(v.vehicleNumber) === key)) return setError('This vehicle is already in your fleet.');
    setBusy(true);
    setError('');
    try {
      const r = await findVehicle(plate);
      if (!r.found) {
        onRegister(key);
        return;
      }
      setFound(r);
      setStep('found');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check that number.');
    } finally {
      setBusy(false);
    }
  };
  const request = async (office: boolean) => {
    setBusy(true);
    setError('');
    try {
      setResult(await requestVehicleLink(plate, office));
      setStep('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  const f = found;
  const blocked = !!f && (f.mine || !!f.pendingLinkId);

  return (
    <Sheet
      visible
      onClose={onClose}
      title={step === 'plate' ? 'Link an existing NESAM vehicle' : step === 'code' ? 'Confirm the change' : (f?.plate ?? 'Vehicle')}
      dismissible={!busy}
    >
      {step === 'plate' ? (
        <>
          <Text style={[type.small, { marginBottom: space.md }]}>
            Check an existing NESAM vehicle to request a fleet transfer. If it is not registered yet, you can enter its details manually.
          </Text>
          <TextField
            label="Vehicle registration number"
            value={plate}
            onChangeText={(t) => {
              setPlate(t.toUpperCase().slice(0, 14));
              setError('');
            }}
            autoCapitalize="characters"
            placeholder="TN 01 AB 1234"
            error={error}
          />
          <Button title="Check NESAM record" loading={busy} onPress={() => void check()} />
        </>
      ) : null}

      {step === 'found' && f ? (
        <>
          <Card style={{ marginBottom: space.md }}>
            <View style={styles.head}>
              <Ionicons name="car-outline" size={26} color={colors.ink} />
              <View style={{ flex: 1 }}>
                <Text style={type.h3}>{f.plate}</Text>
                <Text style={type.small}>{[f.model, f.category].filter(Boolean).join(' · ') || 'Already on NESAM'}</Text>
              </View>
            </View>
            <Row label="Currently with" value={f.mine ? 'Your fleet' : f.owner || 'Another owner'} />
            <Row label="Documents" value={f.verified ? 'Verified' : 'Not verified'} />
          </Card>
          {f.mine ? <Notice tone="info" message="This vehicle is already in your fleet." /> : null}
          {f.pendingLinkId ? <Notice tone="warning" message="You already have an open request for this vehicle." /> : null}
          {!blocked && f.onHold ? <Notice tone="warning" message="This vehicle is on hold. Only the NESAM office can move it." /> : null}
          {!blocked && !f.verified ? <Notice tone="warning" message="This vehicle is not verified yet, so the NESAM office has to approve the move." /> : null}
          {!blocked && (f.openDuties ?? 0) > 0 ? (
            <Notice
              tone="warning"
              message={`It has ${f.openDuties} booked ${f.openDuties === 1 ? 'duty' : 'duties'}. Those must be reassigned before it can move.`}
            />
          ) : null}
          {!blocked ? (
            f.otpReceiver ? (
              <Notice
                tone="info"
                message={`To confirm the change we send a code to ${f.otpReceiver.name} (${f.otpReceiver.phoneMask}), who drove this car last. They read it to you and you enter it. The car’s verified documents stay valid.`}
              />
            ) : (
              <Notice
                tone="warning"
                message="No driver has completed a trip in this car recently, so there is nobody to send a code to. The NESAM office will verify the change with you."
              />
            )
          ) : null}
          <Notice message={error} />
          {!blocked && f.otpReceiver ? <Button title={`Send code to ${f.otpReceiver.name}`} loading={busy} onPress={() => void request(false)} /> : null}
          {!blocked && !f.otpReceiver ? <Button title="Ask the office to verify" loading={busy} onPress={() => void request(true)} /> : null}
          {f.pendingLinkId ? (
            <Button
              title="Open requests"
              onPress={() => {
                onClose();
                navigation.navigate('Requests');
              }}
            />
          ) : null}
          <Button
            variant="ghost"
            title="Back"
            disabled={busy}
            onPress={() => {
              setStep('plate');
              setError('');
            }}
            style={{ marginTop: space.sm }}
          />
        </>
      ) : null}

      {step === 'code' && result ? (
        link ? (
          <>
            <CodePanel link={link} testCode={result.testCode} say={onMessage} />
            <Button title={link.status === 'Completed' ? 'Done' : 'Close'} variant="secondary" onPress={onClose} style={{ marginTop: space.md }} />
          </>
        ) : (
          <Notice tone="info" message="Request sent. Loading its status…" />
        )
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.md,
  },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    marginVertical: space.sm,
  },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.sm },
  pickBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 46, paddingHorizontal: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.card, marginBottom: space.md },
});
