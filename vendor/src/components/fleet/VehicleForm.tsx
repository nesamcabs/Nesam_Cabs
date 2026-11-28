// Full vehicle form, shown as a sheet in two steps (1 Vehicle details, 2 Photos & documents). Used to register a car that is new to NESAM and to resubmit documents;
// a new vehicle goes to NESAM review (docStatus 'Pending' — firestore.rules).
//
// Typing the registration number checks NESAM's records: a car that is already registered shows everything on record, who
// registered it and a Send swap request button instead of the rest of the form. Choosing the make and model fills the category
// and the passenger capacity (config/vehicleCatalog.ts), so neither is typed.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Text } from '../kit/Text';
import { useVendorData } from '../../context/VendorData';
import { Button, Notice, Segmented, Sheet, TextField } from '../ui';
import { Btn, Check, Notice as KitNotice } from '../kit/core';
import { DateField, todayIso, useDocUpload } from '../fields';
import { ExistingVehiclePanel } from './ExistingVehicle';
import { PickerField } from './PickerField';
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

const STEPS = ['Vehicle', 'Documents'] as const;

/** One photo or document on one row: what it is, its state, and Upload / Replace; an expiry date sits under it. */
function DocRow({ icon, title, vehicleId, kind, value, onChange, onBusyChange, required, error, children }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  vehicleId: string;
  kind: string;
  value: string;
  onChange: (url: string) => void;
  onBusyChange: (busy: boolean) => void;
  required?: boolean;
  error?: string;
  children?: React.ReactNode;
}) {
  const { progress, uploadError, pick } = useDocUpload({ label: title, vehicleId, kind, onChange, onBusyChange });
  const uploading = progress != null;
  const shown = uploadError || error;
  return (
    <View style={[styles.doc, !!value && styles.docDone, !!shown && styles.docError]}>
      <View style={styles.docHead}>
        <View style={[styles.docIcon, !!value && styles.docIconDone]}>
          <Ionicons name={value ? 'checkmark' : icon} size={18} color={value ? colors.white : colors.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.docTitle} numberOfLines={2}>{title}</Text>
          <Text style={[styles.docState, !!value && { color: colors.success }]}>
            {uploading ? `Uploading ${progress}%` : value ? 'Uploaded' : required ? 'Required' : 'Optional · if applicable'}
          </Text>
        </View>
        {value && !uploading ? (
          <Text style={styles.view} onPress={() => void Linking.openURL(value)} accessibilityRole="link" accessibilityLabel={`View ${title}`}>View</Text>
        ) : null}
        <Pressable onPress={() => void pick()} style={[styles.upload, !!value && styles.replace]} accessibilityRole="button" accessibilityLabel={`${value ? 'Replace' : 'Upload'} ${title}`}>
          {uploading ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={[styles.uploadText, !!value && { color: colors.ink }]}>{value ? 'Replace' : 'Upload'}</Text>}
        </Pressable>
      </View>
      {children ? <View style={styles.docBody}>{children}</View> : null}
      {shown ? <Text style={styles.docErrorText}>{shown}</Text> : null}
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
  const [step, setStep] = useState(0);
  const [checked, setChecked] = useState(false); // "Continue" was pressed on step 1
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

  // Step 1 holds these; everything else is on step 2.
  const detailKeys = ['vehicleNumber', 'make', 'model', 'category', 'year', 'seatingCapacity'] as const;
  const detailErrors = Object.fromEntries(detailKeys.map((k) => [k, errors[k]]));
  const detailErr = (k: (typeof detailKeys)[number]) => (checked || submitted ? errors[k] : '');
  const toDocuments = () => {
    setChecked(true);
    if (Object.values(detailErrors).some(Boolean)) return setError(fixMessage(detailErrors));
    setError('');
    setStep(1);
    return undefined;
  };

  const save = async () => {
    setSubmitted(true);
    if (Object.values(detailErrors).some(Boolean)) {
      setStep(0);
      return setError(fixMessage(detailErrors));
    }
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

  const other = typedMake || typedModel;
  const blocked = !!mine || !!taken; // this registration already exists: only the notice is shown

  return (
    <Sheet fullScreen visible onClose={() => !busy && onClose()} dismissible={!busy} title={existing ? `Update ${existing.vehicleNumber}` : 'Register new vehicle'}>
      <View>
        {/* Two steps, drawn as two lanes of the road in the NESAM emblem. */}
        {blocked ? null : (
          <View style={styles.road}>
            {STEPS.map((name, i) => (
              <Pressable key={name} style={styles.laneItem} onPress={() => (i === 0 ? setStep(0) : toDocuments())} accessibilityRole="button"
                accessibilityLabel={`Step ${i + 1}: ${name}`} accessibilityState={{ selected: step === i }}>
                <View style={[styles.lane, step > i && styles.laneDone, step === i && styles.laneActive]} />
                <Text style={[styles.laneText, step >= i && { color: colors.white }]}>{step > i ? '✓' : i + 1}  {name}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {step === 0 || blocked ? (
          <TextField
            label="Registration number"
            required
            value={form.vehicleNumber}
            onChangeText={(t) => set('vehicleNumber', t.toUpperCase())}
            autoCapitalize="characters"
            editable={!existing && !initialPlate}
            error={detailErr('vehicleNumber')}
            hint={checking ? 'Checking NESAM records…' : 'As on the RC'}
            placeholder="TN 01 AB 1234"
          />
        ) : null}

        {mine ? (
          <KitNotice tone="green" title="Already in your fleet" text="This registration is already one of your vehicles."
            action={<Btn kind="secondary" small title="Open vehicle" onPress={() => { onClose(); navigation.navigate('Vehicle', { id: mine.id }); }} />} />
        ) : null}

        {taken ? (
          <ExistingVehiclePanel found={taken} reg={form.vehicleNumber}
            onOpenMine={taken.mine && taken.vehicleId ? () => { onClose(); navigation.navigate('Vehicle', { id: taken.vehicleId! }); } : undefined}
            onDifferent={() => set('vehicleNumber', '')} />
        ) : null}

        {blocked ? null : step === 0 ? (
          <>
            <Pair wide={wide}>
              <PickerField label="Make" required value={makeChoice} placeholder="Choose make" error={detailErr('make') && !typedMake ? detailErr('make') : ''}
                options={MAKES.map((mk) => ({ value: mk, label: mk }))} onChange={pickMake} />
              <PickerField label="Model" required value={modelChoice} placeholder="Choose model" disabled={!makeChoice} disabledText="Choose make first"
                error={detailErr('model') && !typedModel ? detailErr('model') : ''}
                options={[...modelsOf(catalogMake).map((x) => ({ value: x.name, label: x.name })), ...(catalogMake ? [{ value: OTHER_MODEL, label: OTHER_MODEL }] : [])]} onChange={pickModel} />
            </Pair>
            {other ? (
              <Pair wide={wide}>
                {typedMake ? <TextField label="Make name" required value={form.make} onChangeText={(t) => set('make', t)} error={detailErr('make')} placeholder="e.g. Force" autoCapitalize="words" /> : <View />}
                <TextField label="Model name" required value={form.model} onChangeText={(t) => set('model', t)} error={detailErr('model')} placeholder="e.g. Traveller" autoCapitalize="words" />
              </Pair>
            ) : null}
            {other ? (
              <PickerField label="Category" required value={form.category} placeholder="Choose category" searchable={false} options={categoryOptions}
                onChange={(c) => set('category', c)} error={detailErr('category')} />
            ) : (
              // Filled from the make and model, so it is shown as a line rather than as a box to fill.
              <View style={styles.auto} accessibilityLabel={`Category: ${form.category || 'set automatically'}`}>
                <Ionicons name="lock-closed-outline" size={14} color={colors.muted} />
                <Text style={styles.autoLabel}>Category</Text>
                <Text style={[styles.autoValue, !form.category && { color: colors.muted, fontWeight: '500' }]} numberOfLines={1}>{form.category || 'Set from make & model'}</Text>
              </View>
            )}
            {/* Year and capacity are short: side by side on every screen. */}
            <Pair wide>
              <TextField
                label="Year"
                required
                value={form.year}
                onChangeText={(t) => set('year', t.replace(/\D/g, '').slice(0, 4))}
                keyboardType="number-pad"
                error={detailErr('year')}
                placeholder="e.g. 2022"
              />
              <PickerField label="Seats" required value={form.seatingCapacity ? String(form.seatingCapacity) : ''}
                placeholder="As per RC" disabled={!catalogModel && !typedModel} disabledText="Pick model" suffix=" seats" searchable={false}
                options={seatOptions} onChange={pickSeats} error={detailErr('seatingCapacity')} hint="Without driver" />
            </Pair>
            <View style={{ marginBottom: 16 }}>
              <Text style={styles.fieldLabel}>Fuel type</Text>
              <Segmented options={FUEL_TYPES.map((f) => ({ value: f, label: f }))} value={form.fuelType as (typeof FUEL_TYPES)[number]} onChange={(f) => set('fuelType', f)} />
            </View>
            <Notice message={error} />
            <Button title="Continue to documents" onPress={() => void toDocuments()} />
          </>
        ) : (
          <>
            <Text style={styles.lead}>Upload clear copies. NESAM verifies them before the vehicle goes live.</Text>
            <DocRow icon="camera-outline" title="Vehicle photo" vehicleId={id} kind="photo" required value={form.photoUrl ?? ''}
              onChange={(u) => set('photoUrl', u)} onBusyChange={onBusy} error={err('photoUrl')} />
            <DocRow icon="document-text-outline" title="Registration certificate (RC)" vehicleId={id} kind="rc" required value={form.rcDocUrl}
              onChange={(u) => set('rcDocUrl', u)} onBusyChange={onBusy} error={err('rcDocUrl')} />
            <DocRow icon="shield-checkmark-outline" title="Insurance" vehicleId={id} kind="insurance" required value={form.insuranceDocUrl}
              onChange={(u) => set('insuranceDocUrl', u)} onBusyChange={onBusy} error={err('insuranceDocUrl')}>
              <DateField label="Valid till" required value={form.insuranceExpiry} onChange={(d) => set('insuranceExpiry', d)} minimumDate={new Date()} error={err('insuranceExpiry')} />
            </DocRow>
            <DocRow icon="ribbon-outline" title="Taxi / tourist permit" vehicleId={id} kind="permit" required value={form.statePermitDocUrl}
              onChange={(u) => set('statePermitDocUrl', u)} onBusyChange={onBusy} error={err('statePermitDocUrl')}>
              <DateField label="Valid till" required value={form.permitExpiry} onChange={(d) => set('permitExpiry', d)} minimumDate={new Date()} error={err('permitExpiry')} />
            </DocRow>
            <DocRow icon="construct-outline" title="Fitness certificate (FC)" vehicleId={id} kind="fitness" value={form.fitnessDocUrl}
              onChange={(u) => set('fitnessDocUrl', u)} onBusyChange={onBusy}>
              <DateField label="Valid till" value={form.fitnessExpiry} onChange={(d) => set('fitnessExpiry', d)} minimumDate={new Date()} error={err('fitnessExpiry')} />
            </DocRow>
            {roofOffered ? (
              <View style={styles.roof}>
                <Check checked={roofOn} disabled={roofRequired} onChange={(v) => set('roofCarrier', v)} label={roofRequired ? 'Roof carrier (mandatory for CNG)' : 'Roof carrier available'} />
                {roofOn ? (
                  <DocRow icon="cube-outline" title="Roof carrier photo" vehicleId={id} kind="roof-carrier" required={roofRequired} value={form.roofCarrierPhotoUrl ?? ''}
                    onChange={(u) => set('roofCarrierPhotoUrl', u)} onBusyChange={onBusy} error={err('roofCarrierPhotoUrl')} />
                ) : null}
              </View>
            ) : null}
            {existing ? <Notice tone="info" message="Saving sends this vehicle back to NESAM for document verification." /> : null}
            <Notice message={error} />
            <View style={styles.actions}>
              <Button title="Back" variant="secondary" disabled={busy} onPress={() => { setError(''); setStep(0); }} style={{ flex: 1 }} />
              <Button
                title={busy ? 'Saving…' : uploads > 0 ? 'Uploading…' : existing ? 'Save & resubmit' : 'Add vehicle'}
                loading={busy}
                disabled={uploads > 0}
                onPress={() => void save()}
                style={{ flex: 2 }}
              />
            </View>
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  fieldLabel: { fontFamily, fontSize: 12, fontWeight: '600', color: colors.ink, marginBottom: 7 },
  road: { flexDirection: 'row', gap: 10, backgroundColor: '#121212', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 18 },
  laneItem: { flex: 1, gap: 7, paddingVertical: 2 },
  lane: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)' },
  laneDone: { backgroundColor: colors.white },
  laneActive: { backgroundColor: colors.primary },
  laneText: { fontFamily, fontSize: 12, fontWeight: '700', color: '#8B919C' },
  auto: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#F6F7F9', marginBottom: 12 },
  autoLabel: { fontFamily, fontSize: 12, fontWeight: '600', color: colors.muted },
  autoValue: { flex: 1, textAlign: 'right', fontFamily, fontSize: 13, fontWeight: '700', color: colors.ink },
  lead: { fontFamily, fontSize: 12.5, lineHeight: 19, color: '#4B5563', marginBottom: 12 },
  doc: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.white, padding: 12, marginBottom: 10 },
  docDone: { borderColor: '#BFE3CF' },
  docError: { borderColor: colors.primary },
  docHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  docIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  docIconDone: { backgroundColor: colors.success },
  docTitle: { fontFamily, fontSize: 13, lineHeight: 18, fontWeight: '700', color: colors.ink },
  docState: { fontFamily, fontSize: 11, fontWeight: '600', color: '#6F7785', marginTop: 1 },
  view: { fontFamily, fontSize: 12, fontWeight: '700', color: colors.primary, paddingVertical: 8 },
  upload: { minWidth: 76, height: 36, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.primary },
  replace: { borderColor: colors.border },
  uploadText: { fontFamily, fontSize: 12.5, fontWeight: '700', color: colors.primary },
  docBody: { marginTop: 10, marginBottom: -12 },
  docErrorText: { fontFamily, fontSize: 12, color: colors.primaryDark, marginTop: 8 },
  roof: { marginBottom: 6, gap: 8 },
  actions: { flexDirection: 'row', gap: 10 },
});
