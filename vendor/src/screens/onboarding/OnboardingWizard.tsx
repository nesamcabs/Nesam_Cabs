// Vendor onboarding wizard — 4 steps:
//   0 Business & account details  (owner name, business name, contact, city, fleet estimate, bank)
//   1 Identity & business docs    (GST/trade-licence + Aadhaar/PAN/Passport)
//   2 Fleet documentation         (per-vehicle RC, insurance, FC, permit, photo)
//   3 Review & Submit             (summary + T&C toggle)
//
// Progress is persisted to vendors/{uid} after every step so the application
// can be resumed on any device; admin-flagged sections are highlighted in orange.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../../components/KeyboardAvoid';
import { Ionicons } from '@expo/vector-icons';
import type {
  BusinessRegType,
  FleetVehicleDoc,
  IdentityProofType,
  OnboardingSection,
  PayoutDetails,
  StoredFile,
  VendorDocuments,
  VendorRecord,
} from '../../types/vendor';
import { ONBOARDING_STEPS, SECTION_LABELS, stepOfSection, BUSINESS_REG_TYPES, IDENTITY_PROOF_TYPES, INDIAN_STATES } from '../../config/onboarding';
import {
  EDITABLE_STATUSES,
  getVendorKyc,
  missingSections,
  saveBusinessAccountStep,
  saveDocumentsStep,
  saveFleetStep,
  submitForReview,
  type VendorKyc,
} from '../../services/onboardingService';
import {
  digitsOnly,
  hasErrors,
  normalizeSpaces,
  validateAccountNumber,
  validateAadhaar,
  validateAltPhone,
  validateBusinessName,
  validateEmail,
  validateFleetSize,
  validateIfsc,
  validatePan,
  validatePassport,
  validatePersonName,
  validateRegistrationNumber,
  validateUpi,
} from '../../utils/validation';
import {
  buildFleetDetails,
  displayPlate,
  emptyVehicle,
  normalizePlate,
  validateVehicle,
  type VehicleErrors,
} from '../../utils/fleet';
import { describeDataError } from '../../utils/retry';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { Badge, Button, Card, Chip, FullScreenLoader, Notice, Row, TextField } from '../../components/ui';
import { FileUploadField } from '../../components/FileUploadField';
import { DateField, displayDate } from '../../components/fields';
import { colors, radius, space, type } from '../../theme';


interface WizardProps {
  record: VendorRecord | null;
  phone: string;
  notice?: string;
  onSignOut: () => void;
}

function initialStep(record: VendorRecord | null): number {
  if (!record) return 0;
  if ((record.status === 'CHANGES_REQUESTED' || record.status === 'REJECTED') && record.review?.flaggedSections.length) {
    return stepOfSection(record.review.flaggedSections[0]!);
  }
  return Math.min(record.onboardingStep, ONBOARDING_STEPS.length - 1);
}

export function OnboardingWizard({ record, phone, notice, onSignOut }: WizardProps) {
  const { online } = useNetworkStatus();
  const [step, setStep] = useState(() => initialStep(record));
  const [kyc, setKyc] = useState<VendorKyc | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(!!record);
  const hasRecord = !!record;

  // Load private KYC details for resuming vendors (so bank fields pre-fill).
  useEffect(() => {
    if (!hasRecord) return;
    let alive = true;
    getVendorKyc()
      .catch(() => null)
      .then((k) => {
        if (!alive) return;
        setKyc(k);
        setPrefillLoading(false);
      });
    return () => { alive = false; };
  }, [hasRecord]);

  const maxReachable = Math.max(record?.onboardingStep ?? 0, step);
  const next = useCallback(() => setStep((s) => Math.min(s + 1, ONBOARDING_STEPS.length - 1)), []);
  const back = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);

  // Android back steps backwards through the wizard.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step > 0) { back(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [step, back]);

  if (hasRecord && prefillLoading) return <FullScreenLoader label="Preparing your application…" />;
  // If record is still null (the application was just created), wait.
  if (!record) return <FullScreenLoader label="Setting up your application…" />;

  const correction = record && (record.status === 'CHANGES_REQUESTED' || record.status === 'REJECTED') ? record : null;
  const current = ONBOARDING_STEPS[step]!;
  const flagged = correction?.review?.flaggedSections ?? [];

  let body: React.ReactNode;
  if (step === 0) body = <BusinessAccountStep record={record} kyc={kyc} onKycChange={setKyc} phone={phone} onNext={next} />;
  else if (step === 1) body = <DocumentsStep record={record} kyc={kyc} onKycChange={setKyc} onNext={next} onBack={back} />;
  else if (step === 2) body = <FleetStep record={record} onNext={next} onBack={back} />;
  else body = <ReviewStep record={record} onEdit={(i) => i <= maxReachable && setStep(i)} onBack={back} />;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={type.h3}>Fleet Partner Onboarding</Text>
          <Text style={type.tiny}>{phone}</Text>
        </View>
        <Button small variant="ghost" title="Sign out" onPress={onSignOut} />
      </View>
      <KeyboardAvoid>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Step indicator */}
        <View style={styles.stepper}>
          {ONBOARDING_STEPS.map((s, i) => {
            const done = i < step || (record?.onboardingStep ?? 0) > i;
            const active = i === step;
            const isFlagged = flagged.some((f) => stepOfSection(f) === i);
            return (
              <Pressable
                key={s.key}
                onPress={() => i <= maxReachable && setStep(i)}
                disabled={i > maxReachable}
                style={styles.stepItem}
                accessibilityRole="button"
                accessibilityLabel={`Step ${i + 1}: ${s.title}`}
              >
                <View style={[styles.stepDot, active && styles.stepActive, !active && isFlagged && styles.stepFlagged, !active && !isFlagged && done && styles.stepDone]}>
                  {done && !active && !isFlagged
                    ? <Ionicons name="checkmark" size={14} color={colors.success} />
                    : <Text style={[styles.stepNum, active && { color: colors.white }]}>{i + 1}</Text>}
                </View>
                <Text style={[styles.stepLabel, active && { color: colors.ink }]} numberOfLines={1}>{s.short}</Text>
              </Pressable>
            );
          })}
        </View>

        {!online ? <Notice tone="warning" message="You're offline. Uploads and saves will fail until you reconnect." /> : null}
        {notice && step === 0 ? <Notice tone="info" message={notice} /> : null}
        {correction ? (
          <Notice
            tone="warning"
            message={`${correction.status === 'REJECTED' ? 'Your application was not approved.' : 'The NESAM team requested changes.'}${
              correction.review?.note ? `\n${correction.review.note}` : ''
            }${flagged.length ? `\nPlease update: ${flagged.map((s) => SECTION_LABELS[s]).join(', ')}. Then resubmit from the final step.` : ''}`}
          />
        ) : null}

        <Card>
          <Text style={type.tiny}>
            STEP {step + 1} OF {ONBOARDING_STEPS.length}
          </Text>
          <Text style={[type.h2, { marginBottom: space.md }]}>{current.title}</Text>
          {body}
        </Card>
        <Text style={[type.tiny, { textAlign: 'center' }]}>Your progress is saved after each step — you can sign out and continue later.</Text>
      </ScrollView>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}

// ── Step 0: business & account details ──────────────────────────────────────

function BusinessAccountStep({
  record, kyc, onKycChange, phone, onNext,
}: {
  record: VendorRecord;
  kyc: VendorKyc | null;
  onKycChange: (k: VendorKyc) => void;
  phone: string;
  onNext: () => void;
}) {
  const b = record.business as (typeof record.business & { operatingCity?: string; estimatedFleetSize?: number }) | null;
  const saved = kyc?.payout;
  const [form, setForm] = useState({
    vendorName: b?.vendorName ?? '',
    businessName: b?.businessName ?? '',
    email: b?.email ?? '',
    altPhone: b?.altPhone ?? '',
    operatingCity: b?.operatingCity ?? '',
    estimatedFleetSize: b?.estimatedFleetSize ? String(b.estimatedFleetSize) : '',
    accountHolderName: saved?.accountHolderName ?? b?.vendorName ?? '',
    accountNumber: saved?.accountNumber ?? '',
    confirmAccountNumber: saved?.accountNumber ?? '',
    ifsc: saved?.ifsc ?? '',
    upiId: saved?.upiId ?? '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const errors = useMemo(() => ({
    vendorName: validatePersonName(form.vendorName, 'Owner name'),
    businessName: validateBusinessName(form.businessName),
    email: validateEmail(form.email),
    altPhone: validateAltPhone(form.altPhone, phone),
    operatingCity: form.operatingCity.trim().length < 2 ? 'Operating city is required.' : '',
    estimatedFleetSize: validateFleetSize(form.estimatedFleetSize),
    accountHolderName: validatePersonName(form.accountHolderName, 'Account holder name'),
    accountNumber: validateAccountNumber(form.accountNumber),
    confirmAccountNumber: !form.confirmAccountNumber
      ? 'Please re-enter the account number.'
      : form.confirmAccountNumber !== form.accountNumber
        ? 'Account numbers do not match.'
        : '',
    ifsc: validateIfsc(form.ifsc),
    upiId: validateUpi(form.upiId),
  }), [form, phone]);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const err = (key: keyof typeof errors) => (submitted ? errors[key] : '');

  const submit = async () => {
    setSubmitted(true);
    if (hasErrors(errors) || saving) return;
    const payout: PayoutDetails = {
      accountHolderName: normalizeSpaces(form.accountHolderName),
      accountNumber: digitsOnly(form.accountNumber),
      ifsc: form.ifsc.trim().toUpperCase(),
      upiId: form.upiId.trim().toLowerCase(),
    };
    setSaving(true);
    setSaveError('');
    try {
      await saveBusinessAccountStep(
        record,
        {
          vendorName: normalizeSpaces(form.vendorName),
          businessName: normalizeSpaces(form.businessName),
          email: form.email.trim().toLowerCase(),
          altPhone: digitsOnly(form.altPhone),
          operatingCity: normalizeSpaces(form.operatingCity),
          estimatedFleetSize: Number(form.estimatedFleetSize),
        },
        payout,
      );
      onKycChange({ identityNumber: kyc?.identityNumber ?? '', payout });
      onNext();
    } catch (e) {
      setSaveError(describeDataError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      <Text style={[type.h3, { marginBottom: space.sm }]}>Business details</Text>
      <TextField label="Owner / contact person name" required value={form.vendorName} onChangeText={set('vendorName')} error={err('vendorName')} placeholder="Ravi Kumar" autoComplete="name" />
      <TextField label="Business / agency name" required value={form.businessName} onChangeText={set('businessName')} error={err('businessName')} placeholder="Sri Balaji Travels" />
      <TextField label="Business email" required value={form.email} onChangeText={set('email')} error={err('email')} placeholder="office@sribalajitravels.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <TextField
        label="Alternate mobile number"
        value={form.altPhone}
        onChangeText={(v) => set('altPhone')(digitsOnly(v).slice(0, 10))}
        error={err('altPhone')}
        keyboardType="number-pad"
        placeholder="Optional — 10-digit mobile"
        hint="Must differ from your login number"
      />
      <TextField label="Operating city / base" required value={form.operatingCity} onChangeText={set('operatingCity')} error={err('operatingCity')} placeholder="Chennai" hint="Primary city from which your fleet operates" />
      <TextField
        label="Approximate fleet size"
        required
        value={form.estimatedFleetSize}
        onChangeText={(v) => set('estimatedFleetSize')(digitsOnly(v).slice(0, 4))}
        error={err('estimatedFleetSize')}
        keyboardType="number-pad"
        placeholder="e.g. 5"
        hint="Total vehicles you plan to register — you'll document each one in the Fleet step"
      />

      <Text style={[type.h3, { marginVertical: space.sm }]}>Bank account for settlements</Text>
      <TextField label="Account holder name" required value={form.accountHolderName} onChangeText={set('accountHolderName')} error={err('accountHolderName')} hint="Exactly as printed on your passbook / cheque" />
      <TextField label="Account number" required value={form.accountNumber} onChangeText={(v) => set('accountNumber')(digitsOnly(v).slice(0, 18))} error={err('accountNumber')} keyboardType="number-pad" secureTextEntry autoComplete="off" />
      <TextField
        label="Confirm account number"
        required
        value={form.confirmAccountNumber}
        onChangeText={(v) => set('confirmAccountNumber')(digitsOnly(v).slice(0, 18))}
        error={err('confirmAccountNumber')}
        keyboardType="number-pad"
        contextMenuHidden
        autoComplete="off"
      />
      <TextField label="IFSC code" required value={form.ifsc} onChangeText={(v) => set('ifsc')(v.toUpperCase().replace(/\s/g, '').slice(0, 11))} error={err('ifsc')} placeholder="SBIN0001234" autoCapitalize="characters" />
      <TextField label="UPI ID" value={form.upiId} onChangeText={(v) => set('upiId')(v.replace(/\s/g, ''))} error={err('upiId')} placeholder="business@okhdfcbank" hint="Optional · used for instant settlements" autoCapitalize="none" />
      <Text style={[type.tiny, { marginBottom: space.md }]}>
        Account details are stored in a restricted record visible only to you and the NESAM finance team. After approval, changes require re-verification by support.
      </Text>
      {submitted && hasErrors(errors) ? <Notice message="Please fix the highlighted fields." /> : null}
      <Notice message={saveError} onRetry={saveError ? () => void submit() : undefined} />
      <Button title={saving ? 'Saving…' : 'Save & continue'} loading={saving} onPress={() => void submit()} />
    </View>
  );
}

// ── Step 1: identity & business documents ────────────────────────────────────

function DocumentsStep({
  record, kyc, onKycChange, onNext, onBack,
}: {
  record: VendorRecord;
  kyc: VendorKyc | null;
  onKycChange: (k: VendorKyc) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const saved = record.documents;
  const [bizType, setBizType] = useState<BusinessRegType>(saved?.businessRegistration.type ?? 'GST');
  const [bizNumber, setBizNumber] = useState(saved?.businessRegistration.number ?? '');
  const [bizFiles, setBizFiles] = useState<StoredFile[]>(saved?.businessRegistration.files ?? []);
  const [idType, setIdType] = useState<IdentityProofType>(saved?.identityProof.type ?? 'AADHAAR');
  const [idNumber, setIdNumber] = useState(kyc?.identityNumber ?? '');
  const [idFiles, setIdFiles] = useState<StoredFile[]>(saved?.identityProof.files ?? []);
  const [bizBusy, setBizBusy] = useState(false);
  const [idBusy, setIdBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const bizDef = BUSINESS_REG_TYPES.find((x) => x.value === bizType)!;
  const idDef = IDENTITY_PROOF_TYPES.find((x) => x.value === idType)!;

  const validateIdNumber = (val: string): string => {
    if (idType === 'AADHAAR') return validateAadhaar(val);
    if (idType === 'PAN') return validatePan(val);
    return validatePassport(val);
  };

  const errors = useMemo(() => ({
    bizNumber: validateRegistrationNumber(bizNumber),
    bizFiles: bizFiles.length === 0 ? 'Upload at least one document.' : '',
    idNumber: validateIdNumber(idNumber),
    idFiles: idFiles.length === 0 ? 'Upload at least one document.' : '',
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [bizNumber, bizFiles, idType, idNumber, idFiles]);
  const err = (key: keyof typeof errors) => (submitted ? errors[key] : '');

  const maskedIdNumber = (): string => {
    const v = idNumber.replace(/\s/g, '');
    if (v.length <= 4) return v;
    return '•'.repeat(Math.min(v.length - 4, 8)) + v.slice(-4);
  };

  const submit = async () => {
    setSubmitted(true);
    if (hasErrors(errors) || saving || bizBusy || idBusy) return;
    const documents: VendorDocuments = {
      businessRegistration: { type: bizType, number: bizNumber.trim().toUpperCase(), files: bizFiles },
      identityProof: { type: idType, maskedNumber: maskedIdNumber(), files: idFiles },
    };
    setSaving(true);
    setSaveError('');
    try {
      await saveDocumentsStep(record, documents, idNumber.trim());
      onKycChange({ identityNumber: idNumber.trim(), payout: kyc?.payout ?? null });
      onNext();
    } catch (e) {
      setSaveError(describeDataError(e));
    } finally {
      setSaving(false);
    }
  };

  const uploading = bizBusy || idBusy;

  return (
    <View>
      {/* Business registration */}
      <Text style={[type.h3, { marginBottom: space.sm }]}>Business registration</Text>
      <Text style={[type.small, { color: colors.muted, marginBottom: space.sm }]}>
        Upload a GST certificate, business registration or trade license.
      </Text>
      <Text style={[type.label, { marginBottom: 6 }]}>
        Document type<Text style={{ color: colors.primary }}> *</Text>
      </Text>
      <View style={styles.chips}>
        {BUSINESS_REG_TYPES.map((t) => (
          <Chip key={t.value} label={t.label} active={bizType === t.value} onPress={() => setBizType(t.value)} />
        ))}
      </View>
      <TextField
        label={`${bizDef.label} number`}
        required
        value={bizNumber}
        onChangeText={(v) => setBizNumber(v.toUpperCase().replace(/\s/g, ''))}
        error={err('bizNumber')}
        placeholder={bizDef.placeholder}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <FileUploadField
        label={`${bizDef.label} (document)`}
        required
        category="business_registration"
        files={bizFiles}
        onChange={setBizFiles}
        persistedPaths={new Set(bizFiles.map((f) => f.path))}
        onBusyChange={setBizBusy}
        error={err('bizFiles')}
        max={3}
      />

      {/* Identity proof */}
      <Text style={[type.h3, { marginVertical: space.sm }]}>Owner identity proof</Text>
      <Text style={[type.small, { color: colors.muted, marginBottom: space.sm }]}>
        A government-issued ID for the owner / contact person.
      </Text>
      <Text style={[type.label, { marginBottom: 6 }]}>
        ID type<Text style={{ color: colors.primary }}> *</Text>
      </Text>
      <View style={styles.chips}>
        {IDENTITY_PROOF_TYPES.map((t) => (
          <Chip key={t.value} label={t.label} active={idType === t.value} onPress={() => { setIdType(t.value); setIdNumber(''); }} />
        ))}
      </View>
      <TextField
        label={`${idDef.label} number`}
        required
        value={idNumber}
        onChangeText={(v) => {
          if (idType === 'AADHAAR') setIdNumber(digitsOnly(v).slice(0, 12));
          else if (idType === 'PAN') setIdNumber(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10));
          else setIdNumber(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8));
        }}
        error={err('idNumber')}
        placeholder={idDef.placeholder}
        autoCapitalize="characters"
        autoCorrect={false}
        secureTextEntry={idType === 'AADHAAR'}
        hint={idType === 'AADHAAR' ? 'Stored securely — only the last 4 digits are shown' : undefined}
      />
      <FileUploadField
        label={`${idDef.label} (front & back)`}
        required
        category="identity_proof"
        files={idFiles}
        onChange={setIdFiles}
        persistedPaths={new Set(idFiles.map((f) => f.path))}
        onBusyChange={setIdBusy}
        error={err('idFiles')}
        max={2}
      />

      {submitted && hasErrors(errors) ? <Notice message="Please fix the highlighted fields." /> : null}
      {uploading ? <Notice tone="info" message="Upload in progress — please wait before saving." /> : null}
      <Notice message={saveError} onRetry={saveError ? () => void submit() : undefined} />
      <View style={styles.nav}>
        <Button title="Back" variant="secondary" onPress={onBack} disabled={saving} style={{ flex: 1 }} />
        <Button title={saving ? 'Saving…' : 'Save & continue'} loading={saving} disabled={uploading} onPress={() => void submit()} style={{ flex: 2 }} />
      </View>
    </View>
  );
}

// ── Step 2: fleet ────────────────────────────────────────────────────────────

/** Each vehicle is added with its registration number only; RC, insurance, FC, permit and a front photo are optional extras. */
function FleetStep({ record, onNext, onBack }: { record: VendorRecord; onNext: () => void; onBack: () => void }) {
  const saved = useMemo(() => record.fleet?.vehicles ?? [], [record.fleet]);
  const [vehicles, setVehicles] = useState<FleetVehicleDoc[]>(saved);
  const [draft, setDraft] = useState<FleetVehicleDoc>(emptyVehicle());
  const [adding, setAdding] = useState(saved.length === 0);
  const [moreDocs, setMoreDocs] = useState(false);
  const [errors, setErrors] = useState<VehicleErrors>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [stepError, setStepError] = useState('');

  const persisted = useMemo(
    () => new Set(saved.flatMap((v) => [...v.rcFiles, ...v.insuranceFiles, ...v.fitnessFiles, ...v.permitFiles, ...v.frontPhotoFiles].map((f) => f.path))),
    [saved],
  );
  const busySetter = useCallback((k: string) => (v: boolean) => setBusy((b) => (b[k] === v ? b : { ...b, [k]: v })), []);
  const onRc = useMemo(() => busySetter('rc'), [busySetter]);
  const onIns = useMemo(() => busySetter('ins'), [busySetter]);
  const onFc = useMemo(() => busySetter('fc'), [busySetter]);
  const onPermit = useMemo(() => busySetter('permit'), [busySetter]);
  const onFront = useMemo(() => busySetter('front'), [busySetter]);
  const uploading = Object.values(busy).some(Boolean);

  const plate = normalizePlate(draft.registrationNumber);

  const setFiles = (key: 'rcFiles' | 'insuranceFiles' | 'fitnessFiles' | 'permitFiles' | 'frontPhotoFiles') => (files: StoredFile[]) =>
    setDraft((d) => ({ ...d, [key]: files }));

  const resetEditor = () => {
    setDraft(emptyVehicle());
    setErrors({});
    setMoreDocs(false);
  };

  const addVehicle = () => {
    const e = validateVehicle(draft, { others: vehicles.map((v) => normalizePlate(v.registrationNumber)) });
    setErrors(e);
    if (Object.keys(e).length || uploading) return;
    setVehicles((list) => [...list, { ...draft, registrationNumber: plate, source: 'manual' }]);
    resetEditor();
    setAdding(false);
  };

  const submit = async () => {
    setStepError('');
    if (!vehicles.length) { setStepError('Add at least one vehicle.'); return; }
    if (adding && draft.registrationNumber.trim()) { setStepError('Finish adding the vehicle you started, or clear it, before continuing.'); return; }
    if (uploading || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await saveFleetStep(record, buildFleetDetails(vehicles));
      onNext();
    } catch (e) {
      setSaveError(describeDataError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      {vehicles.map((v) => (
        <View key={v.registrationNumber} style={styles.vehicle}>
          <View style={{ flex: 1 }}>
            <Text style={type.h3}>{displayPlate(v.registrationNumber)}</Text>
            {[v.make, v.model].filter(Boolean).length ? <Text style={type.small}>{[v.make, v.model].filter(Boolean).join(' ')}</Text> : null}
            {v.category ? <Text style={type.tiny}>{v.category === 'Premium SUV' ? 'Innova Crysta' : v.category}</Text> : null}
          </View>
          <Badge label="NESAM will verify" tone="warning" />
          <Text
            style={styles.remove}
            onPress={() => setVehicles((list) => list.filter((x) => x.registrationNumber !== v.registrationNumber))}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${displayPlate(v.registrationNumber)}`}
          >
            Remove
          </Text>
        </View>
      ))}

      {adding ? (
        <View style={styles.editor}>
          <Text style={[type.h3, { marginBottom: space.sm }]}>{vehicles.length ? 'Add another vehicle' : 'Add a vehicle'}</Text>
          <TextField
            label="Registration number"
            required
            value={draft.registrationNumber}
            onChangeText={(t) => setDraft((d) => ({ ...d, registrationNumber: t.toUpperCase() }))}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="TN 01 AB 1234"
            error={errors.registrationNumber}
            hint="As printed on the number plate. NESAM verifies the vehicle during review."
          />

          <Button
            title={moreDocs ? 'Hide vehicle documents' : 'Add vehicle documents (optional)'}
            variant="ghost"
            onPress={() => setMoreDocs((v) => !v)}
            style={{ marginBottom: space.sm }}
          />
          {moreDocs ? (
            <>
              <FileUploadField label="RC (registration certificate)" category="vehicle_rc" files={draft.rcFiles} onChange={setFiles('rcFiles')} persistedPaths={persisted} onBusyChange={onRc} max={2} />
              <FileUploadField label="Insurance" category="vehicle_insurance" files={draft.insuranceFiles} onChange={setFiles('insuranceFiles')} persistedPaths={persisted} onBusyChange={onIns} max={2} />
              <DateField label="Insurance valid till" value={draft.insuranceUpto} onChange={(d) => setDraft((x) => ({ ...x, insuranceUpto: d }))} minimumDate={new Date()} />
              <FileUploadField label="FC (fitness certificate)" category="vehicle_fc" files={draft.fitnessFiles} onChange={setFiles('fitnessFiles')} persistedPaths={persisted} onBusyChange={onFc} max={2} />
              <DateField label="FC valid till" value={draft.fitnessUpto} onChange={(d) => setDraft((x) => ({ ...x, fitnessUpto: d }))} minimumDate={new Date()} />
              <FileUploadField label="Permit" category="vehicle_permit" files={draft.permitFiles} onChange={setFiles('permitFiles')} persistedPaths={persisted} onBusyChange={onPermit} max={2} />
              <DateField label="Permit valid till" value={draft.permitUpto} onChange={(d) => setDraft((x) => ({ ...x, permitUpto: d }))} minimumDate={new Date()} />
              <FileUploadField label="Vehicle front (with plate)" hint="Clear photo showing the number plate · JPG/PNG/WEBP" category="vehicle_photos" files={draft.frontPhotoFiles} onChange={setFiles('frontPhotoFiles')} persistedPaths={persisted} onBusyChange={onFront} max={1} />
            </>
          ) : null}
          <View style={styles.nav}>
            {vehicles.length ? (
              <Button title="Cancel" variant="secondary" onPress={() => { setAdding(false); resetEditor(); }} style={{ flex: 1 }} />
            ) : null}
            <Button title={uploading ? 'Uploading…' : 'Add vehicle'} disabled={uploading} onPress={addVehicle} style={{ flex: 2 }} />
          </View>
        </View>
      ) : (
        <Button title="+ Add another vehicle" variant="secondary" onPress={() => setAdding(true)} style={{ marginBottom: space.md }} />
      )}

      {stepError ? <Notice message={stepError} /> : null}
      <Notice message={saveError} onRetry={saveError ? () => void submit() : undefined} />
      <View style={styles.nav}>
        <Button title="Back" variant="secondary" onPress={onBack} disabled={saving} style={{ flex: 1 }} />
        <Button title={saving ? 'Saving…' : 'Save & continue'} loading={saving} disabled={uploading} onPress={() => void submit()} style={{ flex: 2 }} />
      </View>
    </View>
  );
}

// ── Step 3: review & submit ──────────────────────────────────────────────────

function ReviewStep({ record, onEdit, onBack }: { record: VendorRecord; onEdit: (i: number) => void; onBack: () => void }) {
  const { online } = useNetworkStatus();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const missing = missingSections(record);
  const { business: b, fleet: f, payoutSummary: p, documents: d } = record;
  const isResubmission = record.status !== 'INCOMPLETE';
  const flaggedNow = isResubmission ? (record.review?.flaggedSections ?? []) : [];

  const submit = async () => {
    if (missing.length || !agreed || submitting) return;
    if (!EDITABLE_STATUSES.includes(record.status)) {
      setError('This application has already been submitted.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await submitForReview(record);
      // The vendors/{uid} listener re-routes to AccountStatusScreen (PENDING_APPROVAL).
    } catch (e) {
      setError(describeDataError(e));
      setSubmitting(false);
    }
  };

  return (
    <View>
      <ReviewSection id="business" missing={missing} flagged={flaggedNow} onEdit={onEdit}>
        <Row label="Owner name" value={b?.vendorName ?? ''} />
        <Row label="Business name" value={b?.businessName ?? ''} />
        <Row label="Email" value={b?.email ?? ''} />
        {(b as any)?.altPhone ? <Row label="Alt phone" value={`+91 ${(b as any).altPhone}`} /> : null}
        {(b as any)?.operatingCity ? <Row label="Operating city" value={(b as any).operatingCity} /> : null}
        {(b as any)?.estimatedFleetSize ? <Row label="Est. fleet size" value={String((b as any).estimatedFleetSize)} /> : null}
      </ReviewSection>
      <ReviewSection id="payout" missing={missing} flagged={flaggedNow} onEdit={onEdit}>
        <Row label="Account holder" value={p?.accountHolderName ?? ''} />
        <Row label="Account" value={p ? `••••${p.bankLast4}` : ''} />
        <Row label="IFSC" value={p?.ifsc ?? ''} />
        <Row label="UPI" value={p?.upiId || '—'} />
      </ReviewSection>
      {d ? (
        <ReviewSection id="documents" missing={missing} flagged={flaggedNow} onEdit={onEdit}>
          <Row label="Business registration" value={`${d.businessRegistration.type} — ${d.businessRegistration.number}`} />
          <Row label="Identity proof" value={`${d.identityProof.type} — ${d.identityProof.maskedNumber}`} />
          <Row label="Documents uploaded" value={`${d.businessRegistration.files.length + d.identityProof.files.length} file(s)`} />
        </ReviewSection>
      ) : null}
      <ReviewSection id="fleet" missing={missing} flagged={flaggedNow} onEdit={onEdit}>
        <Row label="Vehicles" value={f?.vehicles?.length ? `${f.vehicles.length}` : ''} />
        {(f?.vehicles ?? []).map((v) => (
          <Row
            key={v.registrationNumber}
            label={v.registrationNumber}
            value={[v.make, v.model].filter(Boolean).join(' ') || v.category || 'NESAM will verify the vehicle'}
          />
        ))}
      </ReviewSection>

      <Pressable style={styles.agree} onPress={() => setAgreed((a) => !a)} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}>
        <Switch value={agreed} onValueChange={setAgreed} trackColor={{ true: colors.primary, false: colors.border }} />
        <Text style={[type.small, { flex: 1 }]}>
          I confirm the details are accurate and agree to the NESAM Fleet Partner terms, commission policy and document verification.
        </Text>
      </Pressable>
      {missing.length ? <Notice message={`Complete: ${[...new Set(missing.map((m) => SECTION_LABELS[m]))].join(', ')}.`} /> : null}
      {!online ? <Notice tone="warning" message="You're offline — reconnect to submit." /> : null}
      <Notice message={error} />
      <View style={styles.nav}>
        <Button title="Back" variant="secondary" onPress={onBack} disabled={submitting} style={{ flex: 1 }} />
        <Button
          title={submitting ? 'Submitting…' : isResubmission ? 'Resubmit for review' : 'Submit for review'}
          loading={submitting}
          disabled={!!missing.length || !agreed || !online}
          onPress={() => void submit()}
          style={{ flex: 2 }}
        />
      </View>
    </View>
  );
}

function ReviewSection({
  id, missing, flagged, onEdit, children,
}: {
  id: OnboardingSection;
  missing: OnboardingSection[];
  flagged: OnboardingSection[];
  onEdit: (i: number) => void;
  children: React.ReactNode;
}) {
  const isMissing = missing.includes(id);
  const isFlagged = flagged.includes(id);
  return (
    <View style={[styles.section, isMissing && { borderColor: colors.primaryBorder, backgroundColor: colors.primarySoft }, !isMissing && isFlagged && { borderColor: colors.warningBorder }]}>
      <View style={styles.sectionHead}>
        <Text style={type.h3}>{SECTION_LABELS[id]}</Text>
        <Text style={styles.edit} onPress={() => onEdit(stepOfSection(id))} accessibilityRole="button">Edit</Text>
      </View>
      {isMissing ? <Text style={styles.err}>This section is incomplete.</Text> : children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: colors.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  content: { padding: space.lg, paddingBottom: space.xxl },
  stepper: { flexDirection: 'row', marginBottom: space.md },
  stepItem: { flex: 1, alignItems: 'center', gap: 4 },
  stepDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  stepActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepDone: { borderColor: colors.success, backgroundColor: colors.successSoft },
  stepFlagged: { borderColor: colors.warning, backgroundColor: colors.warningSoft },
  stepNum: { fontSize: 12, fontWeight: '800', color: colors.muted },
  stepLabel: { fontSize: 10, fontWeight: '700', color: colors.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.sm },
  err: { color: colors.primaryDark, fontSize: 12, marginBottom: space.sm },
  section: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  edit: { color: colors.primary, fontWeight: '800' },
  agree: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.bg, borderRadius: radius.md, padding: space.md, marginBottom: space.md },
  nav: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  vehicle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, marginBottom: space.sm, backgroundColor: colors.card },
  remove: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  editor: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, marginBottom: space.md, backgroundColor: colors.bg },
});
