// Full vehicle form (details + documents), shown as a sheet. Used to register a car that is new to NESAM and to resubmit documents;
// a new vehicle goes to NESAM review (docStatus 'Pending' — firestore.rules).
//
// Typing the registration number checks NESAM's records: a car that is already registered shows everything on record, who
// registered it and a Send swap request button instead of the rest of the form. Choosing the make and model fills the category
// and the passenger capacity (config/vehicleCatalog.ts), so neither is typed.
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Text } from '../kit/Text';
import { useVendorData } from '../../context/VendorData';
import { Button, Notice, Segmented, Sheet, TextField } from '../ui';
import { Btn, Check, Notice as KitNotice } from '../kit/core';
import { DateField, SingleDocField, todayIso } from '../fields';
import { ExistingVehiclePanel } from './ExistingVehicle';
import { LockedField, PickerField } from './PickerField';
import { Section } from './FormSection';
import { addVehicle, newVehicleId, updateVehicleDocuments, VendorActionError, type VehicleInput } from '../../services/vendorService';
import { findVehicle, type VehicleLookup } from '../../services/partnerLinks';
import type { FleetVehicle } from '../../types/operations';
import { describeDataError } from '../../utils/retry';
import { isPlate, normalizePlate } from '../../utils/fleet';
import { fixMessage } from '../../utils/validation';
import { FUEL_TYPES } from '../../config/constants';
import { ALL_CATEGORIES, GENERIC_SEATS, MAKES, OTHER_MAKE, OTHER_MODEL, categoryFor, defaultSeats, matchMake, matchModel, modelsOf } from '../../config/vehicleCatalog';
import { useLayout } from '../../theme/responsive';
import { colors, fontFamily } from '../../theme';

type Lookup = { key: string; status: 'new' | 'found' | 'error'; data?: VehicleLookup };

/** Two fields side by side on wide screens (as in the reference), stacked on phones. */
function Pair({ children, wide }: { children: React.ReactNode; wide: boolean }) {
  const items = React.Children.toArray(children);
  return wide
    ? <View style={styles.pair}>{items.map((c, i) => <View key={i} style={{ flex: 1, minWidth: 0 }}>{c}</View>)}</View>
    : <View>{items}</View>;
}

/** One document (or a document and its expiry date) in its own card, with a heading and a Required / Optional tag. */
function DocGroup({ title, note, required, children }: { title: string; note?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <View style={styles.docCard}>
      <View style={styles.docHead}>
        <Text style={styles.docTitle} accessibilityRole="header">{title}</Text>
        {required ? (
          <View style={[styles.tag, styles.tagRequired]}>
            <Text style={[styles.tagText, { color: colors.primary }]}>Required</Text>
          </View>
        ) : null}
      </View>
      {note ? <Text style={styles.docNote}>{note}</Text> : null}
      <View style={{ marginTop: 12 }}>{children}</View>
    </View>
  );
}

export function VehicleForm({
  existing,
  initialPlate,
  beforeAdd,
  onClose,
  onSaved,
}: {
  existing: FleetVehicle | null;
  initialPlate?: string;
  /** New vehicles only: runs just before saving. Return false to stop (the caller has taken over, e.g. the plate already has a Car ID). */
  beforeAdd?: (plate: string) => Promise<boolean>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const navigation = useNavigation();
  const { wide } = useLayout();
  const { identity, vehicles } = useVendorData();
  const [id] = useState(() => existing?.id ?? newVehicleId());
  const [form, setForm] = useState<VehicleInput>({
    vehicleNumber: existing?.vehicleNumber ?? initialPlate ?? '',
    category: existing?.category ?? '',
    make: existing?.make ?? '',
    model: existing?.model ?? '',
    year: existing?.year ?? '',
    color: existing?.color ?? '',
    seatingCapacity: existing?.seatingCapacity ?? 0,
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
    photoUrl: existing?.photoUrl ?? '',
    roofCarrier: existing?.roofCarrier ?? false,
    roofCarrierPhotoUrl: existing?.roofCarrierPhotoUrl ?? '',
  });
  // What the make / model pickers show: a catalogue entry, or "Other" with the name typed by hand.
  const [makeChoice, setMakeChoice] = useState(() => matchMake(existing?.make ?? '') || (existing?.make ? OTHER_MAKE : ''));
  const [modelChoice, setModelChoice] = useState(() => {
    const mk = matchMake(existing?.make ?? '');
    return matchModel(mk, existing?.model ?? '')?.name ?? (existing?.model ? OTHER_MODEL : '');
  });
  const [uploads, setUploads] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof VehicleInput>(k: K, v: VehicleInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const onBusy = (b: boolean) => setUploads((n) => Math.max(0, n + (b ? 1 : -1)));
  const today = todayIso();

  // ── Is this registration already on NESAM? ──
  const plateKey = normalizePlate(form.vehicleNumber);
  const mine = !existing && isPlate(plateKey) ? vehicles.find((v) => normalizePlate(v.vehicleNumber) === plateKey) : undefined;
  const [lookup, setLookup] = useState<Lookup>({ key: '', status: 'new' });
  const checkable = !existing && isPlate(plateKey) && !mine;
  useEffect(() => {
    if (!checkable) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      findVehicle(plateKey)
        .then((d) => alive && setLookup({ key: plateKey, status: d.found ? 'found' : 'new', data: d }))
        // A failed check never blocks registering; saving checks the number again.
        .catch(() => alive && setLookup({ key: plateKey, status: 'error' }));
    }, 600);
    return () => { alive = false; clearTimeout(t); };
  }, [plateKey, checkable]);
  const current = lookup.key === plateKey ? lookup : null;
  const checking = checkable && !current;
  const taken = checkable && current?.status === 'found' ? current.data : undefined;

  // ── Make → model → category + capacity ──
  const catalogMake = makeChoice && makeChoice !== OTHER_MAKE ? makeChoice : '';
  const catalogModel = catalogMake && modelChoice !== OTHER_MODEL ? matchModel(catalogMake, modelChoice) : undefined;
  const typedMake = makeChoice === OTHER_MAKE;
  const typedModel = typedMake || (!!catalogMake && modelChoice === OTHER_MODEL);
  const seatOptions = (catalogModel ? catalogModel.seats : GENERIC_SEATS).map((n) => ({ value: String(n), label: String(n) }));
  const categoryOptions = ALL_CATEGORIES.map((c) => ({ value: c, label: c }));

  const pickMake = (v: string) => {
    setMakeChoice(v);
    setModelChoice('');
    setForm((f) => (v === OTHER_MAKE ? { ...f, make: '', model: '' } : { ...f, make: v, model: '', category: '', seatingCapacity: 0 }));
  };
  const pickModel = (v: string) => {
    setModelChoice(v);
    if (v === OTHER_MODEL) { setForm((f) => ({ ...f, model: '', category: '', seatingCapacity: 0 })); return; }
    const cm = matchModel(catalogMake, v);
    if (!cm) return;
    const seats = defaultSeats(cm);
    setForm((f) => ({ ...f, model: cm.name, seatingCapacity: seats, category: categoryFor(cm, seats) }));
  };
  const pickSeats = (v: string) => {
    const n = Number(v);
    setForm((f) => ({ ...f, seatingCapacity: n, category: catalogModel ? categoryFor(catalogModel, n) : f.category }));
  };

  // A roof carrier is asked about for 6-passenger vehicles (6 + driver) and always for CNG vehicles.
  // On a CNG vehicle it is mandatory: the box is ticked for them and its photo is required.
  const roofRequired = form.fuelType === 'CNG';
  const roofOffered = form.seatingCapacity === 6 || roofRequired;
  const roofOn = roofRequired || !!form.roofCarrier;

  const errors = {
    vehicleNumber: isPlate(form.vehicleNumber) ? '' : 'Enter a valid registration number (e.g. TN 01 AB 1234).',
    make: form.make.trim() ? '' : 'Choose the make',
    model: form.model.trim() ? '' : 'Choose the model',
    category: form.category && (ALL_CATEGORIES as readonly string[]).includes(form.category) ? '' : 'Choose the category',
    year: Number(form.year) >= 2000 && Number(form.year) <= new Date().getFullYear() ? '' : 'Enter a valid year',
    seatingCapacity: form.seatingCapacity >= 2 && form.seatingCapacity <= 60 ? '' : 'Choose the passenger capacity',
    photoUrl: form.photoUrl ? '' : 'Upload a photo of the vehicle',
    roofCarrierPhotoUrl: roofRequired && !form.roofCarrierPhotoUrl ? 'Upload a photo of the roof carrier' : '',
    rcDocUrl: form.rcDocUrl ? '' : 'Upload the RC',
    insuranceExpiry: !form.insuranceExpiry ? 'Required' : form.insuranceExpiry <= today ? 'Insurance has expired' : '',
    insuranceDocUrl: form.insuranceDocUrl ? '' : 'Upload the insurance policy',
    permitExpiry: !form.permitExpiry ? 'Required' : form.permitExpiry <= today ? 'Permit has expired' : '',
    statePermitDocUrl: form.statePermitDocUrl ? '' : 'Upload the permit',
    fitnessExpiry: form.fitnessExpiry && form.fitnessExpiry <= today ? 'Fitness certificate has expired' : '',
  };
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : '');

  // The RC number is the registration number printed on the RC, so it is not asked for again; a vehicle that already has one keeps it.
  const rcNumberFor = () => (existing?.rcNumber || normalizePlate(form.vehicleNumber)).trim().toUpperCase();

  const save = async () => {
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return setError(fixMessage(errors as Record<string, string>));
    if (uploads > 0) return setError('Please wait for uploads to finish.');
    setBusy(true);
    setError('');
    try {
      const clean = {
        ...form, make: form.make.trim(), model: form.model.trim(), rcNumber: rcNumberFor(),
        roofCarrier: roofOffered && roofOn,
        roofCarrierPhotoUrl: roofOffered && roofOn ? form.roofCarrierPhotoUrl ?? '' : '',
      };
      if (existing) {
        const { status: _status, ...docs } = clean;
        await updateVehicleDocuments(existing.id, {
          ...docs,
          vehicleNumber: form.vehicleNumber.trim().toUpperCase(),
          rcNumber: rcNumberFor(),
        });
        onSaved(`${form.vehicleNumber.toUpperCase()} sent to NESAM for re-verification.`);
      } else {
        if (beforeAdd && !(await beforeAdd(form.vehicleNumber))) return;
        await addVehicle(identity, id, clean, vehicles);
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
    <Sheet visible onClose={() => !busy && onClose()} dismissible={!busy} title={existing ? `Update ${existing.vehicleNumber}` : 'Register new vehicle'}>
      <View>
        <Section first title="Vehicle details" text={existing ? 'Update the details on the RC.' : 'Enter the details exactly as on the RC.'} />
        <TextField
          label="Registration number"
          required
          value={form.vehicleNumber}
          onChangeText={(t) => set('vehicleNumber', t.toUpperCase())}
          autoCapitalize="characters"
          editable={!existing && !initialPlate}
          error={err('vehicleNumber')}
          hint={checking ? 'Checking NESAM records…' : undefined}
          placeholder="TN 01 AB 1234"
        />

        {mine ? (
          <KitNotice tone="green" title="Already in your fleet" text="This registration is already one of your vehicles."
            action={<Btn kind="secondary" small title="Open vehicle" onPress={() => { onClose(); navigation.navigate('Vehicle', { id: mine.id }); }} />} />
        ) : null}

        {taken ? (
          <ExistingVehiclePanel found={taken} reg={form.vehicleNumber}
            onOpenMine={taken.mine && taken.vehicleId ? () => { onClose(); navigation.navigate('Vehicle', { id: taken.vehicleId! }); } : undefined}
            onDifferent={() => set('vehicleNumber', '')} />
        ) : null}

        {mine || taken ? null : (
          <>
            <TextField
              label="Year"
              required
              value={form.year}
              onChangeText={(t) => set('year', t.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad"
              error={err('year')}
              placeholder="e.g. 2022"
            />
            <View style={{ marginBottom: 16 }}>
              <Text style={styles.fieldLabel}>Fuel type</Text>
              <Segmented options={FUEL_TYPES.map((f) => ({ value: f, label: f }))} value={form.fuelType as (typeof FUEL_TYPES)[number]} onChange={(f) => set('fuelType', f)} />
            </View>
            <Pair wide={wide}>
              <PickerField label="Make" required value={makeChoice} placeholder="Choose make" error={err('make') && !typedMake ? err('make') : ''}
                options={MAKES.map((mk) => ({ value: mk, label: mk }))} onChange={pickMake} />
              <PickerField label="Model" required value={modelChoice} placeholder="Choose model" disabled={!makeChoice} disabledText="Choose make first"
                error={err('model') && !typedModel ? err('model') : ''}
                options={[...modelsOf(catalogMake).map((x) => ({ value: x.name, label: x.name })), ...(catalogMake ? [{ value: OTHER_MODEL, label: OTHER_MODEL }] : [])]} onChange={pickModel} />
            </Pair>
            {typedMake || typedModel ? (
              <Pair wide={wide}>
                {typedMake ? <TextField label="Make name" required value={form.make} onChangeText={(t) => set('make', t)} error={err('make')} placeholder="e.g. Force" autoCapitalize="words" /> : <View />}
                <TextField label="Model name" required value={form.model} onChangeText={(t) => set('model', t)} error={err('model')} placeholder="e.g. Traveller" autoCapitalize="words" />
              </Pair>
            ) : null}
            <Pair wide={wide}>
              {typedMake || typedModel ? (
                <PickerField label="Category" required value={form.category} placeholder="Choose category" searchable={false} options={categoryOptions}
                  onChange={(c) => set('category', c)} error={err('category')} />
              ) : (
                <LockedField label="Category" value={form.category} placeholder="Set automatically" hint="Filled from the make and model" />
              )}
              <PickerField label="Passenger capacity" required value={form.seatingCapacity ? String(form.seatingCapacity) : ''}
                placeholder={catalogModel || typedModel ? 'Choose capacity as per RC' : 'Choose model first'}
                disabled={!catalogModel && !typedModel} disabledText="Choose model first" suffix=" passengers" searchable={false}
                options={seatOptions} onChange={pickSeats} error={err('seatingCapacity')} hint="Driver excluded · as per RC" />
            </Pair>
            {roofOffered ? (
              <DocGroup title="Roof carrier" required={roofRequired} note={roofRequired ? 'Mandatory for CNG vehicles.' : '6-passenger vehicles: tell us if a roof carrier is fitted.'}>
                <Check checked={roofOn} disabled={roofRequired} onChange={(v) => set('roofCarrier', v)} label="Roof carrier available" />
                {roofOn ? (
                  <SingleDocField
                    label="Roof carrier photo"
                    vehicleId={id}
                    kind="roof-carrier"
                    value={form.roofCarrierPhotoUrl ?? ''}
                    onChange={(u) => set('roofCarrierPhotoUrl', u)}
                    required={roofRequired}
                    error={err('roofCarrierPhotoUrl')}
                    onBusyChange={onBusy}
                  />
                ) : null}
              </DocGroup>
            ) : null}
            <DocGroup title="Vehicle photo" required note="A clear photo of the vehicle helps NESAM verify it.">
              <SingleDocField
                label="Photo"
                vehicleId={id}
                kind="photo"
                value={form.photoUrl ?? ''}
                onChange={(u) => set('photoUrl', u)}
                required
                error={err('photoUrl')}
                onBusyChange={onBusy}
              />
            </DocGroup>
            <Section title="Documents" text="Upload clear copies. NESAM verifies them before the vehicle goes live." />
            <DocGroup title="Registration certificate (RC)" required>
              <SingleDocField
                label="RC document"
                vehicleId={id}
                kind="rc"
                value={form.rcDocUrl}
                onChange={(u) => set('rcDocUrl', u)}
                required
                error={err('rcDocUrl')}
                onBusyChange={onBusy}
              />
            </DocGroup>
            <DocGroup title="Insurance" required>
              <DateField
                label="Valid till"
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
            </DocGroup>
            <DocGroup title="Taxi / tourist permit" required>
              <DateField
                label="Valid till"
                required
                value={form.permitExpiry}
                onChange={(d) => set('permitExpiry', d)}
                minimumDate={new Date()}
                error={err('permitExpiry')}
              />
              <SingleDocField
                label="Permit document"
                vehicleId={id}
                kind="permit"
                value={form.statePermitDocUrl}
                onChange={(u) => set('statePermitDocUrl', u)}
                required
                error={err('statePermitDocUrl')}
                onBusyChange={onBusy}
              />
            </DocGroup>
            <DocGroup title="Fitness certificate (FC)" note="Only if applicable to this vehicle.">
              <DateField
                label="Valid till"
                value={form.fitnessExpiry}
                onChange={(d) => set('fitnessExpiry', d)}
                minimumDate={new Date()}
                error={err('fitnessExpiry')}
              />
              <SingleDocField
                label="Fitness certificate"
                vehicleId={id}
                kind="fitness"
                value={form.fitnessDocUrl}
                onChange={(u) => set('fitnessDocUrl', u)}
                onBusyChange={onBusy}
              />
            </DocGroup>
            {existing ? <Notice tone="info" message="Saving sends this vehicle back to NESAM for document verification." /> : null}
            <Notice message={error} />
            <Button
              title={busy ? 'Saving…' : uploads > 0 ? 'Uploading…' : existing ? 'Save & resubmit' : 'Add vehicle'}
              loading={busy}
              disabled={uploads > 0}
              onPress={() => void save()}
            />
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  fieldLabel: { fontFamily, fontSize: 12, fontWeight: '600', color: colors.ink, marginBottom: 7 },
  docCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: '#FBFCFD', padding: 14, paddingBottom: 2, marginBottom: 12 },
  docHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  docTitle: { flex: 1, fontFamily, fontSize: 14, fontWeight: '600', color: colors.ink },
  docNote: { fontFamily, fontSize: 11.5, color: colors.muted, marginTop: 3 },
  tag: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, backgroundColor: '#EEF1F5' },
  tagRequired: { backgroundColor: colors.primarySoft },
  tagText: { fontFamily, fontSize: 10.5, fontWeight: '600', color: colors.muted },
});
