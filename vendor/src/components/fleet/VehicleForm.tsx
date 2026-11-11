// Full vehicle form (details + documents). Used to register a car that is new to NESAM and to resubmit documents; a new
// vehicle goes to NESAM review (docStatus 'Pending' — firestore.rules).
import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../KeyboardAvoid';
import { useVendorData } from '../../context/VendorData';
import { Button, Chip, Notice, TextField } from '../ui';
import { DateField, SingleDocField, todayIso } from '../fields';
import { addVehicle, newVehicleId, updateVehicleDocuments, VendorActionError, type VehicleInput } from '../../services/vendorService';
import type { FleetVehicle } from '../../types/operations';
import { describeDataError } from '../../utils/retry';
import { isPlate } from '../../utils/fleet';
import { FLEET_CATEGORIES, FUEL_TYPES } from '../../config/constants';
import { colors, space, type } from '../../theme';

export function VehicleForm({
  existing,
  initialPlate,
  onClose,
  onSaved,
}: {
  existing: FleetVehicle | null;
  initialPlate?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { identity, vehicles } = useVendorData();
  const [id] = useState(() => existing?.id ?? newVehicleId());
  const [form, setForm] = useState<VehicleInput>({
    vehicleNumber: existing?.vehicleNumber ?? initialPlate ?? '',
    category: existing?.category ?? 'Sedan',
    make: existing?.make ?? '',
    model: existing?.model ?? '',
    year: existing?.year ?? '',
    color: existing?.color ?? '',
    seatingCapacity: existing?.seatingCapacity ?? 4,
    fuelType: existing?.fuelType ?? 'Diesel',
    status: existing?.status ?? 'Active',
    rcNumber: existing?.rcNumber ?? '',
    rcDocUrl: existing?.rcDocUrl ?? '',
    insuranceExpiry: existing?.insuranceExpiry ?? '',
    insuranceDocUrl: existing?.insuranceDocUrl ?? '',
    fitnessExpiry: existing?.fitnessExpiry ?? '',
    fitnessDocUrl: existing?.fitnessDocUrl ?? '',
    permitExpiry: existing?.permitExpiry ?? '',
    statePermitDocUrl: existing?.statePermitDocUrl ?? '',
  });
  const [uploads, setUploads] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof VehicleInput>(k: K, v: VehicleInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const onBusy = (b: boolean) => setUploads((n) => Math.max(0, n + (b ? 1 : -1)));
  const today = todayIso();

  const errors = {
    vehicleNumber: isPlate(form.vehicleNumber) ? '' : 'Enter a valid registration number (e.g. TN 01 AB 1234).',
    make: form.make.trim() ? '' : 'Required',
    model: form.model.trim() ? '' : 'Required',
    year: Number(form.year) >= 2000 && Number(form.year) <= new Date().getFullYear() ? '' : 'Enter a valid year',
    seatingCapacity: form.seatingCapacity >= 2 && form.seatingCapacity <= 60 ? '' : 'Enter seats (2–60)',
    rcNumber: form.rcNumber.trim() ? '' : 'Required',
    rcDocUrl: form.rcDocUrl ? '' : 'Upload the RC',
    insuranceExpiry: !form.insuranceExpiry ? 'Required' : form.insuranceExpiry <= today ? 'Insurance has expired' : '',
    insuranceDocUrl: form.insuranceDocUrl ? '' : 'Upload the insurance policy',
    permitExpiry: !form.permitExpiry ? 'Required' : form.permitExpiry <= today ? 'Permit has expired' : '',
    statePermitDocUrl: form.statePermitDocUrl ? '' : 'Upload the permit',
    fitnessExpiry: form.fitnessExpiry && form.fitnessExpiry <= today ? 'Fitness certificate has expired' : '',
  };
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : '');

  const save = async () => {
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return setError('Please fix the highlighted fields.');
    if (uploads > 0) return setError('Please wait for uploads to finish.');
    setBusy(true);
    setError('');
    try {
      if (existing) {
        const { status: _status, ...docs } = form;
        await updateVehicleDocuments(existing.id, {
          ...docs,
          vehicleNumber: form.vehicleNumber.trim().toUpperCase(),
          rcNumber: form.rcNumber.trim().toUpperCase(),
        });
        onSaved(`${form.vehicleNumber.toUpperCase()} sent to NESAM for re-verification.`);
      } else {
        await addVehicle(identity, id, form, vehicles);
        onSaved(`${form.vehicleNumber.toUpperCase()} added. NESAM will verify its documents.`);
      }
    } catch (e) {
      setError(e instanceof VendorActionError ? e.message : describeDataError(e));
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <Modal visible animationType="slide" onRequestClose={() => !busy && onClose()}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <KeyboardAvoid>
        <View style={styles.formHead}>
          <Text style={[type.h2, { flex: 1 }]}>{existing ? `Update ${existing.vehicleNumber}` : 'Add vehicle'}</Text>
          <Button small variant="ghost" title="Close" disabled={busy} onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          <TextField
            label="Registration number"
            required
            value={form.vehicleNumber}
            onChangeText={(t) => set('vehicleNumber', t.toUpperCase())}
            autoCapitalize="characters"
            editable={!existing && !initialPlate}
            error={err('vehicleNumber')}
            placeholder="TN 01 AB 1234"
          />
          <Text style={[type.label, { marginBottom: 6 }]}>Category</Text>
          <View style={styles.chips}>
            {FLEET_CATEGORIES.map((c) => (
              <Chip key={c} label={c} active={form.category === c} onPress={() => set('category', c)} />
            ))}
          </View>
          <TextField label="Make" required value={form.make} onChangeText={(t) => set('make', t)} error={err('make')} placeholder="Toyota" />
          <TextField label="Model" required value={form.model} onChangeText={(t) => set('model', t)} error={err('model')} placeholder="Innova Crysta" />
          <TextField label="Colour (optional)" value={form.color ?? ''} onChangeText={(t) => set('color', t)} placeholder="White" autoCapitalize="words" />
          <TextField
            label="Year"
            required
            value={form.year}
            onChangeText={(t) => set('year', t.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad"
            error={err('year')}
          />
          <TextField
            label="Seats (excluding driver)"
            required
            value={form.seatingCapacity ? String(form.seatingCapacity) : ''}
            onChangeText={(t) => set('seatingCapacity', Number(t.replace(/\D/g, '').slice(0, 2)) || 0)}
            keyboardType="number-pad"
            error={err('seatingCapacity')}
          />
          <Text style={[type.label, { marginBottom: 6 }]}>Fuel</Text>
          <View style={styles.chips}>
            {FUEL_TYPES.map((f) => (
              <Chip key={f} label={f} active={form.fuelType === f} onPress={() => set('fuelType', f)} />
            ))}
          </View>
          <Text style={[type.h3, { marginVertical: space.sm }]}>Documents</Text>
          <TextField
            label="RC number"
            required
            value={form.rcNumber}
            onChangeText={(t) => set('rcNumber', t.toUpperCase())}
            autoCapitalize="characters"
            error={err('rcNumber')}
          />
          <SingleDocField
            label="Registration certificate (RC)"
            vehicleId={id}
            kind="rc"
            value={form.rcDocUrl}
            onChange={(u) => set('rcDocUrl', u)}
            required
            error={err('rcDocUrl')}
            onBusyChange={onBusy}
          />
          <DateField
            label="Insurance valid till"
            required
            value={form.insuranceExpiry}
            onChange={(d) => set('insuranceExpiry', d)}
            minimumDate={new Date()}
            error={err('insuranceExpiry')}
          />
          <SingleDocField
            label="Insurance policy"
            vehicleId={id}
            kind="insurance"
            value={form.insuranceDocUrl}
            onChange={(u) => set('insuranceDocUrl', u)}
            required
            error={err('insuranceDocUrl')}
            onBusyChange={onBusy}
          />
          <DateField
            label="Permit valid till"
            required
            value={form.permitExpiry}
            onChange={(d) => set('permitExpiry', d)}
            minimumDate={new Date()}
            error={err('permitExpiry')}
          />
          <SingleDocField
            label="Taxi / tourist permit"
            vehicleId={id}
            kind="permit"
            value={form.statePermitDocUrl}
            onChange={(u) => set('statePermitDocUrl', u)}
            required
            error={err('statePermitDocUrl')}
            onBusyChange={onBusy}
          />
          <DateField
            label="Fitness (FC) valid till — if applicable"
            value={form.fitnessExpiry}
            onChange={(d) => set('fitnessExpiry', d)}
            minimumDate={new Date()}
            error={err('fitnessExpiry')}
          />
          <SingleDocField
            label="Fitness certificate (FC)"
            vehicleId={id}
            kind="fitness"
            value={form.fitnessDocUrl}
            onChange={(u) => set('fitnessDocUrl', u)}
            onBusyChange={onBusy}
          />
          {existing ? <Notice tone="info" message="Saving sends this vehicle back to NESAM for document verification." /> : null}
          <Notice message={error} />
          <Button
            title={busy ? 'Saving…' : uploads > 0 ? 'Uploading…' : existing ? 'Save & resubmit' : 'Add vehicle'}
            loading={busy}
            disabled={uploads > 0}
            onPress={() => void save()}
          />
        </ScrollView>
        </KeyboardAvoid>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { padding: space.lg, paddingBottom: space.xxl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.sm },
  formHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    backgroundColor: colors.card,
  },
});
