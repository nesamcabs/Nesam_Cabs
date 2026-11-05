// Driver onboarding wizard (spec page 13). An owner-driver provides exactly:
//   verified mobile → selfie + driving licence → vehicle (registration number,
//   RC, insurance, FC, permit, vehicle-front photo) → Admin review.
// The vehicle's make, model, seats and fuel are not typed: they are detected
// from the registration number (lookupVehicleByRegistration → VAHAN).
// A vendor's employee driver has the licence step only — the vendor assigns the
// vehicle. Modes: 'signup', 'resubmit' (after rejection), 'update' (approved
// driver refreshing documents). The signup draft survives an app restart.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Image, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text } from '../components/nx/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NxIcon } from '../components/nx/Icon';
import type { ApprovalStatus, DetectedVehicle, RegistrationData, VehicleCategory, VehicleLookupResult } from '../types/driver';
import { Badge, Button, Card, Notice, Row, TextField } from '../components/ui';
import { DateField, OptionChips, PhotoField, displayDate } from '../components/forms';
import { registerDriver, resubmitDriverDocuments } from '../services/driverService';
import { lookupVehicle, manualSnapshot, snapshotFrom, vehiclePatchFrom } from '../services/vehicleLookup';
import { AUTO_VEHICLE_DETECTION, isPlate, localDateISO, maskAadhaar, normalizePlate, validateStep, type Errors } from '../validation/kyc';
import { describeError } from '../utils/retry';
import { colors, radius, space, type } from '../theme';

export type RegistrationMode = 'signup' | 'resubmit' | 'update';

const VEHICLE_TYPES: { value: VehicleCategory; label: string; seats: number }[] = [
  { value: 'Hatchback', label: 'Hatchback', seats: 4 },
  { value: 'Sedan', label: 'Sedan', seats: 4 },
  { value: 'SUV', label: 'SUV (6+1 / 7+1)', seats: 6 },
  { value: 'Premium SUV', label: 'Innova Crysta', seats: 7 },
  { value: 'Tempo Traveller', label: 'Tempo Traveller', seats: 12 },
];

const draftKey = (uid: string) => `nesam-driver-signup-draft-${uid}`;
const DETECT_DELAY_MS = 800;
const FUEL_TYPES = ['Diesel', 'Petrol', 'CNG', 'Electric'].map((f) => ({ value: f, label: f }));

type Detection =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'done'; result: VehicleLookupResult }
  | { state: 'error'; message: string };

interface Props {
  uid: string;
  mode: RegistrationMode;
  initial: RegistrationData;
  currentStatus?: ApprovalStatus;
  rejectionReason?: string;
  vendorName?: string;
  /** A vendor's employee: licence and selfie only, the vendor assigns the vehicle. */
  fleetDriver?: boolean;
  onDone?: () => void;
  onCancel?: () => void;
  onSignOut?: () => void;
}

export function RegistrationScreen({ uid, mode, initial, currentStatus, rejectionReason, vendorName, fleetDriver = false, onDone, onCancel, onSignOut }: Props) {
  const steps = fleetDriver ? ['Selfie & licence', 'Review'] : ['Selfie & licence', 'Vehicle', 'Review'];
  const lastStep = steps.length;
  const [data, setData] = useState<RegistrationData>(initial);
  const [step, setStep] = useState(1);
  const [draftLoaded, setDraftLoaded] = useState(mode !== 'signup');
  const [errors, setErrors] = useState<Errors>({});
  const [showPhotoErrors, setShowPhotoErrors] = useState(false);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [uploads, setUploads] = useState(0);
  const [detection, setDetection] = useState<Detection>({ state: 'idle' });
  const [detected, setDetected] = useState<DetectedVehicle | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const submittingRef = useRef(false);
  const detectSeq = useRef(0);

  // Restore a signup draft (the verified phone always comes from auth).
  useEffect(() => {
    if (mode !== 'signup') return undefined;
    let alive = true;
    AsyncStorage.getItem(draftKey(uid))
      .then((raw) => {
        if (!alive || !raw) return;
        const draft = JSON.parse(raw) as { data: RegistrationData; step: number };
        if (draft?.data?.profile) {
          setData({ ...initial, ...draft.data, profile: { ...initial.profile, ...draft.data.profile, phone: initial.profile.phone } });
          setStep(Math.min(Math.max(1, draft.step || 1), lastStep));
        }
      })
      .catch(() => undefined)
      .finally(() => alive && setDraftLoaded(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, uid]);

  useEffect(() => {
    if (mode !== 'signup' || !draftLoaded) return;
    AsyncStorage.setItem(draftKey(uid), JSON.stringify({ data, step })).catch(() => undefined);
  }, [mode, draftLoaded, uid, data, step]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [step]);

  // Android back walks back through the steps instead of leaving the form.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (submitting) return true;
      if (step > 1) {
        setErrors({});
        setStep((s) => s - 1);
        return true;
      }
      if (onCancel) {
        onCancel();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [step, submitting, onCancel]);

  const setProfile = (patch: Partial<RegistrationData['profile']>) => setData((d) => ({ ...d, profile: { ...d.profile, ...patch } }));
  const setLicense = (patch: Partial<RegistrationData['license']>) => setData((d) => ({ ...d, license: { ...d.license, ...patch } }));
  const setVehicle = (patch: Partial<RegistrationData['vehicle']>) => setData((d) => ({ ...d, vehicle: { ...d.vehicle, ...patch } }));
  const setIdentity = (patch: Partial<RegistrationData['identity']>) => setData((d) => ({ ...d, identity: { ...d.identity, ...patch } }));
  const onBusy = (busy: boolean) => setUploads((n) => Math.max(0, n + (busy ? 1 : -1)));

  const v = data.vehicle;
  const plate = normalizePlate(v.vehicleNumber);

  /** Asks the server to identify the vehicle and fills the form from the register. */
  const detect = useCallback(async (raw: string) => {
    const wanted = normalizePlate(raw);
    if (!AUTO_VEHICLE_DETECTION || !isPlate(wanted)) return;
    const seq = ++detectSeq.current;
    setDetection({ state: 'loading' });
    try {
      const result = await lookupVehicle(wanted);
      if (seq !== detectSeq.current) return;
      setDetection({ state: 'done', result });
      if (result.status === 'found') {
        const today = localDateISO();
        const usable = (iso: string) => (iso && iso > today ? iso : '');
        setDetected(result.vehicle);
        setData((d) => ({
          ...d,
          vehicle: {
            ...d.vehicle,
            ...vehiclePatchFrom(result.vehicle),
            vehicleNumber: raw.trim().toUpperCase(),
            rcNumber: wanted,
            // Prefill from the register; the driver can still correct them from the document in hand.
            insuranceExpiry: usable(result.vehicle.validity.insuranceUpto) || d.vehicle.insuranceExpiry,
            fitnessExpiry: usable(result.vehicle.validity.fitnessUpto) || d.vehicle.fitnessExpiry,
            permitExpiry: usable(result.vehicle.validity.permitUpto) || d.vehicle.permitExpiry,
            vahan: snapshotFrom(result, false),
          },
        }));
      } else {
        setDetected(null);
        setData((d) => ({ ...d, vehicle: { ...d.vehicle, rcNumber: wanted, vahan: snapshotFrom(result, d.vehicle.vahan?.manualType ?? false) } }));
      }
    } catch (err) {
      if (seq !== detectSeq.current) return;
      setDetection({ state: 'error', message: describeError(err, 'We could not check the vehicle right now. Please try again.') });
    }
  }, []);

  // Detect on its own once a full plate is typed.
  useEffect(() => {
    if (!AUTO_VEHICLE_DETECTION || fleetDriver || step !== 2) return undefined;
    // Only from idle: after an error the partner retries with the button, so a failing provider is not hammered.
    if (!isPlate(v.vehicleNumber) || v.vahan?.lookupId === plate || detection.state !== 'idle') return undefined;
    const t = setTimeout(() => void detect(v.vehicleNumber), DETECT_DELAY_MS);
    return () => clearTimeout(t);
  }, [fleetDriver, step, v.vehicleNumber, v.vahan?.lookupId, plate, detection.state, detect]);

  const onPlateChange = (text: string) => {
    const upper = text.toUpperCase();
    if (!AUTO_VEHICLE_DETECTION) {
      // Manual entry: keep the chosen vehicle type while the number is typed.
      setVehicle({ vehicleNumber: upper, rcNumber: normalizePlate(upper) });
      return;
    }
    if (normalizePlate(upper) !== plate) {
      detectSeq.current++;
      setDetection({ state: 'idle' });
      setDetected(null);
      setVehicle({ vehicleNumber: upper, rcNumber: '', vahan: undefined });
    } else setVehicle({ vehicleNumber: upper });
  };

  // The identity saved before this session: unchanged legacy numbers are not re-validated, changed or new ones are.
  const savedIdentity = mode === 'signup' ? undefined : initial.identity;
  const validate = (s: number) => validateStep(s, data, { fleetDriver, originalIdentity: savedIdentity });

  const goNext = () => {
    if (uploads > 0) return setSubmitError('Please wait for uploads to finish.');
    const errs = validate(step);
    setErrors(errs);
    setShowPhotoErrors(true);
    setSubmitError('');
    if (Object.keys(errs).length > 0) return undefined;
    setShowPhotoErrors(false);
    setStep((s) => Math.min(s + 1, lastStep));
    return undefined;
  };

  const jumpTo = (target: number) => {
    if (target <= step) {
      setErrors({});
      setStep(target);
      return;
    }
    for (let s = step; s < target; s++) {
      const errs = validate(s);
      if (Object.keys(errs).length) {
        setStep(s);
        setErrors(errs);
        setShowPhotoErrors(true);
        return;
      }
    }
    setStep(target);
  };

  const submit = async () => {
    if (submittingRef.current) return;
    for (let s = 1; s < lastStep; s++) {
      const errs = validate(s);
      if (Object.keys(errs).length) {
        setStep(s);
        setErrors(errs);
        setShowPhotoErrors(true);
        return;
      }
    }
    if (!consent) {
      setSubmitError('Please confirm the declaration to continue.');
      return;
    }
    submittingRef.current = true;
    setSubmitError('');
    setSubmitting(true);
    try {
      if (mode === 'signup') {
        await registerDriver(data);
        await AsyncStorage.removeItem(draftKey(uid)).catch(() => undefined);
      } else {
        await resubmitDriverDocuments(uid, data, currentStatus ?? 'Pending', { fleetDriver, originalIdentity: savedIdentity });
      }
      onDone?.();
    } catch (err) {
      setSubmitError(describeError(err, 'We could not save your application. Please sign out, sign in again and retry.'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const confirmLeave = () => {
    if (!onCancel) return;
    Alert.alert('Leave without saving?', 'Changes on this form will be lost.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: onCancel },
    ]);
  };

  const title = mode === 'signup' ? 'Driver Partner Registration' : mode === 'resubmit' ? 'Update & Resubmit' : 'Update Documents';
  const l = data.license;
  const today = localDateISO();
  const reviewStep = lastStep;
  const vehicleStep = fleetDriver ? 0 : 2;
  const result = detection.state === 'done' ? detection.result : null;
  const manual = !AUTO_VEHICLE_DETECTION || (result != null && (result.status === 'unavailable' || result.status === 'not_configured'));

  if (!draftLoaded) return null;

  return (
    <SafeAreaView style={styles.root} edges={mode === 'update' ? [] : ['top']}>
      <KeyboardAvoid>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {mode !== 'update' ? (
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={type.h2}>{title}</Text>
              <Text style={type.small}>Verified mobile: {data.profile.phone}</Text>
            </View>
            {onCancel ? <Button small variant="secondary" title="Back" onPress={confirmLeave} /> : null}
            {onSignOut ? <Button small variant="ghost" title="Sign out" onPress={onSignOut} /> : null}
          </View>
        ) : null}

        {vendorName && mode === 'signup' ? <Notice tone="info" message={`You were invited by ${vendorName}. Your account will be linked to this fleet and your vehicle will be assigned by them.`} /> : null}
        {mode === 'resubmit' && rejectionReason ? <Notice message={`Reason for rejection: ${rejectionReason}`} /> : null}
        {mode === 'update' ? <Notice tone="warning" message="Updated documents are re-verified by the NESAM team. You can keep taking trips meanwhile." /> : null}

        <View style={styles.stepper}>
          {steps.map((label, i) => {
            const n = i + 1;
            const active = step === n;
            const done = step > n;
            return (
              <Pressable key={label} onPress={() => jumpTo(n)} style={styles.stepItem} accessibilityRole="button" accessibilityLabel={`Step ${n}: ${label}`}>
                <View style={[styles.stepDot, active && styles.stepDotActive, done && styles.stepDotDone]}>
                  {done ? <NxIcon name="check" size={14} color={colors.white} strokeWidth={2.2} /> : <Text style={[styles.stepNum, active && { color: colors.white }]}>{n}</Text>}
                </View>
                <Text style={[styles.stepLabel, active && { color: colors.ink }]} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Card>
          {step === 1 ? (
            <>
              <Text style={styles.sectionTitle}>Selfie</Text>
              <PhotoField
                label="Selfie"
                hint="Clear, front-facing, no sunglasses. Taken with the camera."
                value={data.profile.photoUrl}
                folder="kyc"
                name="selfie"
                required
                cameraOnly
                showError={showPhotoErrors}
                onBusyChange={onBusy}
                onChange={(url) => setProfile({ photoUrl: url })}
              />
              <Text style={[styles.sectionTitle, { marginTop: space.md }]}>Driving licence</Text>
              <TextField
                label="Driving licence number"
                required
                value={l.number}
                onChangeText={(t) => setLicense({ number: t.toUpperCase() })}
                autoCapitalize="characters"
                placeholder="TN01 20190012345"
                error={errors.licenseNumber}
              />
              <DateField label="Licence valid till" required value={l.expiryDate} onChange={(d) => setLicense({ expiryDate: d })} minimumDate={new Date()} error={errors.licenseExpiry} />
              <PhotoField label="Licence front" value={l.frontPhotoUrl} folder="kyc" name="dl-front" required showError={showPhotoErrors} onBusyChange={onBusy} onChange={(url) => setLicense({ frontPhotoUrl: url })} />
              <PhotoField label="Licence back" value={l.backPhotoUrl} folder="kyc" name="dl-back" required showError={showPhotoErrors} onBusyChange={onBusy} onChange={(url) => setLicense({ backPhotoUrl: url })} />

              <Text style={[styles.sectionTitle, { marginTop: space.md }]}>Aadhaar & PAN (optional)</Text>
              <Text style={[type.tiny, { marginBottom: space.sm }]}>Kept private: only you and the NESAM verification team can see these. A blank field keeps what is already saved.</Text>
              <TextField
                label="Aadhaar number"
                value={data.identity.aadhaarNumber}
                onChangeText={(t) => setIdentity({ aadhaarNumber: t.replace(/\D/g, '').slice(0, 12) })}
                keyboardType="number-pad"
                placeholder="12-digit Aadhaar number"
                error={errors.aadhaarNumber}
              />
              <PhotoField label="Aadhaar front" value={data.identity.aadhaarFrontUrl} folder="kyc" name="aadhaar-front" onBusyChange={onBusy} onChange={(url) => setIdentity({ aadhaarFrontUrl: url })} />
              <PhotoField label="Aadhaar back" value={data.identity.aadhaarBackUrl} folder="kyc" name="aadhaar-back" onBusyChange={onBusy} onChange={(url) => setIdentity({ aadhaarBackUrl: url })} />
              <TextField
                label="PAN number"
                value={data.identity.panNumber}
                onChangeText={(t) => setIdentity({ panNumber: t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) })}
                autoCapitalize="characters"
                placeholder="ABCDE1234F"
                error={errors.panNumber}
              />
              <PhotoField label="PAN card" value={data.identity.panPhotoUrl} folder="kyc" name="pan" onBusyChange={onBusy} onChange={(url) => setIdentity({ panPhotoUrl: url })} />
            </>
          ) : null}

          {step === vehicleStep ? (
            <>
              <Text style={styles.sectionTitle}>Your vehicle</Text>
              <TextField
                label="Registration number"
                required
                value={v.vehicleNumber}
                onChangeText={onPlateChange}
                autoCapitalize="characters"
                placeholder="TN 01 AB 1234"
                error={errors.vehicleNumber}
              />
              {AUTO_VEHICLE_DETECTION ? (
                <>
                  <Text style={[type.tiny, { marginBottom: space.sm }]}>Make, model, seats and fuel type are filled in automatically from the vehicle register.</Text>
                  <Button
                    title={detection.state === 'loading' ? 'Checking…' : v.vahan?.lookupId === plate ? 'Check again' : 'Detect vehicle'}
                    variant="secondary"
                    loading={detection.state === 'loading'}
                    disabled={!isPlate(v.vehicleNumber) || detection.state === 'loading'}
                    onPress={() => void detect(v.vehicleNumber)}
                    style={{ marginBottom: space.md }}
                  />
                </>
              ) : null}

              {detection.state === 'loading' ? (
                <View style={styles.detecting}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={type.small}>Looking up {v.vehicleNumber} in the vehicle register…</Text>
                </View>
              ) : null}
              {detection.state === 'error' ? <Notice message={detection.message} /> : null}
              {result?.status === 'not_found' ? <Notice message="This registration number was not found in the vehicle register. Check the number on the plate and try again." /> : null}
              {result?.status === 'found' && result.duplicate ? (
                <Notice message="This vehicle is already registered with another NESAM partner. Please contact NESAM support." />
              ) : null}
              {detected && result?.status === 'found' ? <DetectedCard vehicle={detected} issues={result.issues.map((i) => i.message)} /> : null}
              {manual ? (
                <>
                  <Notice
                    tone="warning"
                    message={
                      AUTO_VEHICLE_DETECTION
                        ? 'Automatic vehicle detection is unavailable right now. Choose your vehicle type — NESAM will verify the vehicle from your documents.'
                        : 'Enter your vehicle details below — NESAM will verify the vehicle from your documents.'
                    }
                  />
                  <OptionChips
                    label="Vehicle type"
                    required
                    options={VEHICLE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                    value={v.vahan?.manualType ? v.vehicleType : ''}
                    onChange={(val) => {
                      const t = VEHICLE_TYPES.find((x) => x.value === val)!;
                      setVehicle({ vehicleType: t.value, capacity: t.seats, vahan: v.vahan ? { ...v.vahan, manualType: true } : manualSnapshot(plate) });
                    }}
                    error={errors.vehicleType}
                  />
                  {!AUTO_VEHICLE_DETECTION ? (
                    <>
                      <TextField label="Make (optional)" value={v.make} onChangeText={(t) => setVehicle({ make: t })} placeholder="Toyota" />
                      <TextField label="Model (optional)" value={v.model} onChangeText={(t) => setVehicle({ model: t })} placeholder="Etios" />
                      <OptionChips label="Fuel type" options={FUEL_TYPES} value={v.fuelType} onChange={(val) => setVehicle({ fuelType: val })} />
                    </>
                  ) : null}
                </>
              ) : null}

              <TextField label="Colour (optional)" value={v.color} onChangeText={(t) => setVehicle({ color: t })} placeholder="White" autoCapitalize="words" />

              <Text style={[styles.sectionTitle, { marginTop: space.md }]}>Vehicle documents</Text>
              <PhotoField label="RC (registration certificate)" value={v.rcDocUrl} folder="vehicle" name="rc" required showError={showPhotoErrors} onBusyChange={onBusy} onChange={(url) => setVehicle({ rcDocUrl: url })} />
              <PhotoField label="Insurance" value={v.insuranceDocUrl} folder="vehicle" name="insurance" required showError={showPhotoErrors} onBusyChange={onBusy} onChange={(url) => setVehicle({ insuranceDocUrl: url })} />
              <DateField label="Insurance valid till" required value={v.insuranceExpiry} onChange={(d) => setVehicle({ insuranceExpiry: d })} minimumDate={new Date()} error={errors.insuranceExpiry} />
              <PhotoField label="FC (fitness certificate)" value={v.fitnessDocUrl} folder="vehicle" name="fitness" required showError={showPhotoErrors} onBusyChange={onBusy} onChange={(url) => setVehicle({ fitnessDocUrl: url })} />
              <DateField label="FC valid till" required value={v.fitnessExpiry} onChange={(d) => setVehicle({ fitnessExpiry: d })} minimumDate={new Date()} error={errors.fitnessExpiry} />
              <PhotoField label="Permit" value={v.statePermitDocUrl} folder="vehicle" name="permit" required showError={showPhotoErrors} onBusyChange={onBusy} onChange={(url) => setVehicle({ statePermitDocUrl: url })} />
              <DateField label="Permit valid till" required value={v.permitExpiry} onChange={(d) => setVehicle({ permitExpiry: d })} minimumDate={new Date()} error={errors.permitExpiry} />
              <PhotoField label="Vehicle front (with plate)" value={v.frontPhotoUrl} folder="vehicle" name="front" required showError={showPhotoErrors} onBusyChange={onBusy} onChange={(url) => setVehicle({ frontPhotoUrl: url })} />
              <PhotoField label="Vehicle rear (optional)" value={v.rearPhotoUrl} folder="vehicle" name="rear" onBusyChange={onBusy} onChange={(url) => setVehicle({ rearPhotoUrl: url })} />
              <PhotoField label="Vehicle side (optional)" value={v.sidePhotoUrl} folder="vehicle" name="side" onBusyChange={onBusy} onChange={(url) => setVehicle({ sidePhotoUrl: url })} />
              <PhotoField label="Vehicle interior (optional)" value={v.interiorPhotoUrl} folder="vehicle" name="interior" onBusyChange={onBusy} onChange={(url) => setVehicle({ interiorPhotoUrl: url })} />
            </>
          ) : null}

          {step === reviewStep ? (
            <>
              <Text style={styles.sectionTitle}>Review & submit</Text>
              <View style={styles.reviewHead}>
                {data.profile.photoUrl ? <Image source={{ uri: data.profile.photoUrl }} style={styles.reviewPhoto} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={type.h3}>{data.profile.name || 'New driver partner'}</Text>
                  <Text style={type.small}>{data.profile.phone}</Text>
                </View>
              </View>
              <ReviewSection title="Licence" onEdit={() => setStep(1)}>
                <Row label="Licence no." value={l.number} />
                <Row label="Valid till" value={displayDate(l.expiryDate)} />
                {data.identity.aadhaarNumber ? <Row label="Aadhaar" value={maskAadhaar(data.identity.aadhaarNumber)} /> : null}
                {data.identity.panNumber ? <Row label="PAN" value={data.identity.panNumber} /> : null}
              </ReviewSection>
              {!fleetDriver ? (
                <ReviewSection title="Vehicle" onEdit={() => setStep(vehicleStep)}>
                  <Row label="Registration" value={v.vehicleNumber} />
                  {v.color ? <Row label="Colour" value={v.color} /> : null}
                  <Row label="Vehicle" value={[v.make, v.model].filter(Boolean).join(' ') || v.vehicleType} />
                  <Row label="Category" value={`${v.vehicleType}${v.capacity ? ` • ${v.capacity}+1 seats` : ''}${v.fuelType ? ` • ${v.fuelType}` : ''}`} />
                  <Row label="Insurance till" value={displayDate(v.insuranceExpiry)} />
                  <Row label="FC till" value={displayDate(v.fitnessExpiry)} />
                  <Row label="Permit till" value={displayDate(v.permitExpiry)} />
                  <Row label="Register check" value={v.vahan?.status === 'found' ? 'Verified from vehicle register' : 'Manual verification by NESAM'} />
                </ReviewSection>
              ) : null}
              {[l.expiryDate, ...(fleetDriver ? [] : [v.insuranceExpiry, v.fitnessExpiry, v.permitExpiry])].some((d) => d && d <= today) ? (
                <Notice message="A document above has expired. Go back and update it before submitting." />
              ) : null}
              <Pressable style={styles.consent} onPress={() => setConsent((c) => !c)} accessibilityRole="checkbox" accessibilityState={{ checked: consent }}>
                <Switch value={consent} onValueChange={setConsent} trackColor={{ true: colors.primary, false: colors.border }} />
                <Text style={[type.small, { flex: 1 }]}>
                  I declare that the information and documents provided are genuine and belong to me / my vehicle, and I authorise NESAM Tours & Travels to verify them.
                </Text>
              </Pressable>
            </>
          ) : null}

          <Notice message={submitError} />
          {Object.keys(errors).length > 0 ? <Text style={styles.fixHint}>Please fix the highlighted fields.</Text> : null}

          <View style={styles.nav}>
            <Button
              title="Back"
              variant="secondary"
              disabled={step === 1 || submitting}
              onPress={() => {
                setErrors({});
                setStep((s) => Math.max(1, s - 1));
              }}
              style={{ flex: 1 }}
            />
            {step < lastStep ? (
              <Button title={uploads > 0 ? 'Uploading…' : 'Save & continue'} disabled={uploads > 0} onPress={goNext} style={{ flex: 2 }} />
            ) : (
              <Button
                title={submitting ? 'Submitting…' : mode === 'signup' ? 'Submit for verification' : 'Resubmit for verification'}
                loading={submitting}
                disabled={!consent}
                onPress={() => void submit()}
                style={{ flex: 2 }}
              />
            )}
          </View>
        </Card>
      </ScrollView>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}

/** The vehicle as the register describes it, so the driver can confirm it is theirs. */
function DetectedCard({ vehicle, issues }: { vehicle: DetectedVehicle; issues: string[] }) {
  const name = [vehicle.make, vehicle.model, vehicle.variant].filter(Boolean).join(' ');
  return (
    <View style={styles.detected}>
      <View style={styles.detectedHead}>
        <NxIcon name="check" size={20} color={colors.success} />
        <Text style={[type.h3, { flex: 1 }]}>Vehicle found</Text>
        <Badge label={vehicle.category === 'Premium SUV' ? 'Innova Crysta' : vehicle.category} tone="brand" />
      </View>
      <Text style={type.body}>{name || vehicle.registrationNumber}</Text>
      <Text style={type.small}>
        {[vehicle.fuelType, vehicle.seatClass ? `${vehicle.seatClass} seats` : '', vehicle.manufactureYear, vehicle.colour].filter(Boolean).join(' • ')}
      </Text>
      <Text style={[type.tiny, { marginTop: 4 }]}>Registered to {vehicle.ownerNameMasked || 'the owner on record'}. If this is not your vehicle, correct the number above.</Text>
      {issues.map((m) => (
        <View key={m} style={styles.issue}>
          <NxIcon name="alert" size={14} color={colors.warning} />
          <Text style={[type.tiny, { flex: 1 }]}>{m} Enter the dates from your current document below.</Text>
        </View>
      ))}
    </View>
  );
}

function ReviewSection({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.reviewSection}>
      <View style={styles.reviewTitleRow}>
        <Text style={type.h3}>{title}</Text>
        <Text style={styles.edit} onPress={onEdit} accessibilityRole="button">
          Edit
        </Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: space.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  stepper: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.md, padding: space.sm, marginBottom: space.md, borderWidth: 1, borderColor: colors.border },
  stepItem: { flex: 1, alignItems: 'center', gap: 4 },
  stepDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  stepDotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepDotDone: { backgroundColor: colors.success, borderColor: colors.success },
  stepNum: { fontSize: 12, fontWeight: '800', color: colors.muted },
  stepLabel: { fontSize: 10, fontWeight: '700', color: colors.muted },
  sectionTitle: { ...type.h3, marginBottom: space.md },
  detecting: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  detected: { borderWidth: 1, borderColor: colors.success, backgroundColor: colors.successSoft, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  detectedHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: 4 },
  issue: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: space.sm },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  reviewPhoto: { width: 52, height: 52, borderRadius: 12 },
  reviewSection: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  reviewTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  edit: { color: colors.primary, fontWeight: '800' },
  consent: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.bg, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  fixHint: { color: colors.primaryDark, fontSize: 12, fontWeight: '700', textAlign: 'right', marginBottom: space.sm },
  nav: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
});
