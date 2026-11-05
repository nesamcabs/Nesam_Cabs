// Driver onboarding wizard (spec page 13). An owner-driver provides exactly:
//   verified mobile → selfie + driving licence → vehicle (registration number,
//   RC, insurance, FC, permit, vehicle-front photo) → Admin review.
// The vehicle's make, model, seats and fuel are not typed: they are detected
// from the registration number (lookupVehicleByRegistration → VAHAN).
// A vendor's employee driver has the licence step only — the vendor assigns the
// vehicle.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Car, CheckCircle, AlertTriangle, Loader2, LogOut, ArrowLeft, ShieldCheck, CreditCard, SearchCheck } from 'lucide-react';
import type { ApprovalStatus, DetectedVehicle, RegistrationData, VehicleCategory, VehicleLookupResult } from '../types';
import { PhotoUpload } from '../components/PhotoUpload';
import { registerDriver, resubmitDriverDocuments, describeFirestoreError } from '../services/driverFirestoreService';
import { lookupVehicle, manualSnapshot, snapshotFrom, vehiclePatchFrom } from '../services/vehicleLookup';
import { AUTO_VEHICLE_DETECTION, indiaToday, isPlate, normalizePlate, validateStep, type Errors } from '../utils/onboardingValidation';

export type RegistrationMode = 'signup' | 'resubmit' | 'update';

interface RegistrationScreenProps {
  uid: string;
  mode: RegistrationMode;
  initial: RegistrationData;
  currentStatus?: ApprovalStatus;
  rejectionReason?: string;
  vendorName?: string;
  /** A vendor's employee: licence and selfie only, the vendor assigns the vehicle. */
  fleetDriver?: boolean;
  onSubmitted: () => void;
  onCancel?: () => void;
  onSignOut?: () => void;
}

const VEHICLE_TYPES: { value: VehicleCategory; label: string; seats: number }[] = [
  { value: 'Hatchback', label: 'Hatchback', seats: 4 },
  { value: 'Sedan', label: 'Sedan', seats: 4 },
  { value: 'SUV', label: 'SUV (6+1 / 7+1)', seats: 6 },
  { value: 'Premium SUV', label: 'Innova Crysta', seats: 7 },
  { value: 'Tempo Traveller', label: 'Tempo Traveller', seats: 12 },
];

const DETECT_DELAY_MS = 800;
const FUEL_TYPES = ['Diesel', 'Petrol', 'CNG', 'Electric'];
const draftKey = (uid: string) => `nesam-driver-signup-draft-${uid}`;

function loadDraft(uid: string): { data: RegistrationData; step: number } | null {
  try {
    const raw = localStorage.getItem(draftKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDraft(uid: string, data: RegistrationData, step: number) {
  try {
    localStorage.setItem(draftKey(uid), JSON.stringify({ data, step }));
  } catch {
    /* storage unavailable — draft just won't survive a reload */
  }
}

function clearDraft(uid: string) {
  try {
    localStorage.removeItem(draftKey(uid));
  } catch {
    /* ignore */
  }
}

type Detection =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'done'; result: VehicleLookupResult }
  | { state: 'error'; message: string };

// ── Small form primitives ──────────────────────────────────────────────────

const inputCls = (err?: string) =>
  `w-full px-3 py-2.5 border rounded-lg text-sm font-semibold focus:outline-none focus:border-[#E21E26] bg-white ${
    err ? 'border-red-400' : 'border-gray-300'
  }`;

const Field: React.FC<{ label: string; error?: string; required?: boolean; className?: string; children: React.ReactNode }> = ({
  label, error, required, className, children,
}) => (
  <div className={className}>
    <label className="text-xs font-bold text-gray-700 block mb-1">
      {label} {required && <span className="text-[#E21E26]">*</span>}
    </label>
    {children}
    {error && <p className="text-[11px] text-red-600 font-semibold mt-1">{error}</p>}
  </div>
);

const ReviewRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between gap-3 py-1.5 border-b border-gray-100 last:border-0 text-xs">
    <span className="text-gray-500">{label}</span>
    <span className="font-semibold text-gray-900 text-right break-all">{value || '—'}</span>
  </div>
);

const Alert: React.FC<{ tone: 'error' | 'warning' | 'info'; children: React.ReactNode }> = ({ tone, children }) => {
  const cls = tone === 'error' ? 'bg-red-50 border-red-200 text-red-700' : tone === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-blue-50 border-blue-200 text-blue-800';
  return (
    <div className={`border p-3 rounded-xl text-xs font-semibold flex gap-2 ${cls}`} role={tone === 'error' ? 'alert' : undefined}>
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
};

/** The vehicle as the register describes it, so the driver can confirm it is theirs. */
const DetectedCard: React.FC<{ vehicle: DetectedVehicle; issues: string[] }> = ({ vehicle, issues }) => {
  const name = [vehicle.make, vehicle.model, vehicle.variant].filter(Boolean).join(' ');
  const facts = [vehicle.fuelType, vehicle.seatClass ? `${vehicle.seatClass} seats` : '', vehicle.manufactureYear, vehicle.colour].filter(Boolean).join(' • ');
  return (
    <div className="border border-emerald-300 bg-emerald-50 rounded-xl p-4 space-y-1" data-testid="detected-vehicle">
      <div className="flex items-center gap-2">
        <CheckCircle className="w-5 h-5 text-emerald-600" />
        <p className="text-sm font-extrabold text-gray-900 flex-1">Vehicle found</p>
        <span className="text-[10px] font-bold bg-white border border-emerald-300 text-emerald-700 px-2 py-0.5 rounded">
          {vehicle.category === 'Premium SUV' ? 'Innova Crysta' : vehicle.category}
        </span>
      </div>
      <p className="text-sm font-bold text-gray-900">{name || vehicle.registrationNumber}</p>
      <p className="text-xs text-gray-600">{facts}</p>
      <p className="text-[11px] text-gray-500">
        Registered to {vehicle.ownerNameMasked || 'the owner on record'}. If this is not your vehicle, correct the number above.
      </p>
      {issues.map((m) => (
        <p key={m} className="text-[11px] text-amber-800 font-semibold flex gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {m} Enter the dates from your current document below.
        </p>
      ))}
    </div>
  );
};

// ── Wizard ─────────────────────────────────────────────────────────────────

export const RegistrationScreen: React.FC<RegistrationScreenProps> = ({
  uid,
  mode,
  initial,
  currentStatus,
  rejectionReason,
  vendorName,
  fleetDriver = false,
  onSubmitted,
  onCancel,
  onSignOut,
}) => {
  const STEPS = fleetDriver
    ? [{ id: 1, label: 'Selfie & licence', icon: CreditCard }, { id: 2, label: 'Review', icon: ShieldCheck }]
    : [{ id: 1, label: 'Selfie & licence', icon: CreditCard }, { id: 2, label: 'Vehicle', icon: Car }, { id: 3, label: 'Review', icon: ShieldCheck }];
  const lastStep = STEPS.length;
  const vehicleStep = fleetDriver ? 0 : 2;

  const draft = useMemo(() => (mode === 'signup' ? loadDraft(uid) : null), [uid, mode]);
  const [data, setData] = useState<RegistrationData>(() =>
    draft ? { ...initial, ...draft.data, profile: { ...initial.profile, ...draft.data.profile, phone: initial.profile.phone } } : initial,
  );
  const [step, setStep] = useState<number>(Math.min(draft?.step ?? 1, lastStep));
  const [errors, setErrors] = useState<Errors>({});
  const [showPhotoErrors, setShowPhotoErrors] = useState(false);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [detection, setDetection] = useState<Detection>({ state: 'idle' });
  const [detected, setDetected] = useState<DetectedVehicle | null>(null);
  const detectSeq = useRef(0);

  useEffect(() => {
    if (mode === 'signup') saveDraft(uid, data, step);
  }, [uid, mode, data, step]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  const setProfile = (patch: Partial<RegistrationData['profile']>) => setData((d) => ({ ...d, profile: { ...d.profile, ...patch } }));
  const setLicense = (patch: Partial<RegistrationData['license']>) => setData((d) => ({ ...d, license: { ...d.license, ...patch } }));
  const setVehicle = (patch: Partial<RegistrationData['vehicle']>) => setData((d) => ({ ...d, vehicle: { ...d.vehicle, ...patch } }));

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
        const today = indiaToday();
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
      setDetection({ state: 'error', message: err instanceof Error && err.message ? err.message : 'We could not check the vehicle right now. Please try again.' });
    }
  }, []);

  // Detect on its own once a full plate is typed.
  useEffect(() => {
    if (!AUTO_VEHICLE_DETECTION || fleetDriver || step !== vehicleStep) return undefined;
    // Only from idle: after an error the partner retries with the button, so a failing provider is not hammered.
    if (!isPlate(v.vehicleNumber) || v.vahan?.lookupId === plate || detection.state !== 'idle') return undefined;
    const t = setTimeout(() => void detect(v.vehicleNumber), DETECT_DELAY_MS);
    return () => clearTimeout(t);
  }, [fleetDriver, step, vehicleStep, v.vehicleNumber, v.vahan?.lookupId, plate, detection.state, detect]);

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

  const validate = (s: number) => validateStep(s, data, { fleetDriver });

  const goNext = () => {
    const errs = validate(step);
    setErrors(errs);
    setShowPhotoErrors(true);
    if (Object.keys(errs).length > 0) return;
    setShowPhotoErrors(false);
    setStep((s) => Math.min(s + 1, lastStep));
  };

  const jumpTo = (target: number) => {
    // Only allow jumping back, or forward over steps that already validate.
    if (target <= step) {
      setErrors({});
      setStep(target);
      return;
    }
    for (let s = step; s < target; s++) {
      const errs = validate(s);
      if (Object.keys(errs).length > 0) {
        setStep(s);
        setErrors(errs);
        setShowPhotoErrors(true);
        return;
      }
    }
    setStep(target);
  };

  const handleSubmit = async () => {
    for (let s = 1; s < lastStep; s++) {
      const errs = validate(s);
      if (Object.keys(errs).length > 0) {
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
    setSubmitError('');
    setSubmitting(true);
    try {
      if (mode === 'signup') {
        await registerDriver(data);
        clearDraft(uid);
      } else {
        await resubmitDriverDocuments(uid, data, currentStatus ?? 'Pending', { fleetDriver });
      }
      onSubmitted();
    } catch (err) {
      setSubmitError(describeFirestoreError(err, 'We could not save your application. Please sign out, sign in again and retry.'));
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === 'signup' ? 'Driver Partner Registration' : mode === 'resubmit' ? 'Update & Resubmit Application' : 'Update Documents';
  const l = data.license;
  const today = indiaToday();
  const result = detection.state === 'done' ? detection.result : null;
  const manual = !AUTO_VEHICLE_DETECTION || (result != null && (result.status === 'unavailable' || result.status === 'not_configured'));

  return (
    <div className={mode === 'update' ? '' : 'min-h-screen bg-[#F7F7F7] p-4 sm:p-6'}>
      <div className="space-y-5 max-w-3xl mx-auto pb-10">
        {/* Header */}
        <div className="bg-white p-5 sm:p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {mode !== 'update' && (
              <img src="/icons/logo.png" alt="NESAM" className="w-11 h-11 rounded-xl object-contain bg-gray-50 border border-gray-200 p-1" />
            )}
            <div>
              <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-gray-900">{title}</h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Verified mobile: <span className="font-bold text-gray-800">{data.profile.phone}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            {onCancel && (
              <button onClick={onCancel} className="px-3 py-2 text-xs font-bold text-gray-600 border border-gray-300 rounded-lg flex items-center gap-1">
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
            )}
            {onSignOut && (
              <button onClick={onSignOut} className="px-3 py-2 text-xs font-bold text-gray-600 border border-gray-300 rounded-lg flex items-center gap-1 hover:text-[#E21E26]">
                <LogOut className="w-3.5 h-3.5" /> Sign out
              </button>
            )}
          </div>
        </div>

        {vendorName && mode === 'signup' && (
          <Alert tone="info">You were invited by {vendorName}. Your account will be linked to this fleet and your vehicle will be assigned by them.</Alert>
        )}
        {mode === 'resubmit' && rejectionReason && (
          <Alert tone="error">
            <p className="font-bold">Reason for rejection</p>
            <p>{rejectionReason}</p>
          </Alert>
        )}
        {mode === 'update' && <Alert tone="warning">Updated documents are re-verified by the NESAM team. You can keep taking trips meanwhile.</Alert>}

        {/* Stepper */}
        <div className={`grid gap-1.5 bg-white p-2 rounded-xl border border-gray-200 shadow-sm ${lastStep === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {STEPS.map((st) => {
            const Icon = st.icon;
            const active = step === st.id;
            const done = step > st.id;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => jumpTo(st.id)}
                className={`flex flex-col items-center py-2 px-1 rounded-lg transition-all ${
                  active ? 'bg-[#E21E26] text-white font-bold shadow' : done ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {done ? <CheckCircle className="w-4 h-4 mb-1" /> : <Icon className="w-4 h-4 mb-1" />}
                <span className="text-[11px]">{st.label}</span>
              </button>
            );
          })}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6 shadow-sm space-y-5">
          {/* STEP 1 — SELFIE & LICENCE */}
          {step === 1 && (
            <>
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-[#E21E26]" /> Selfie &amp; driving licence
              </h2>
              <div className="grid sm:grid-cols-[200px_1fr] gap-5">
                <PhotoUpload
                  label="Selfie"
                  hint="Clear, front-facing, no sunglasses"
                  value={data.profile.photoUrl}
                  folder="kyc"
                  name="selfie"
                  capture="user"
                  required
                  showError={showPhotoErrors}
                  onChange={(url) => setProfile({ photoUrl: url })}
                />
                <div className="grid md:grid-cols-2 gap-4 content-start">
                  <Field label="Driving Licence Number" required error={errors.licenseNumber}>
                    <input className={`${inputCls(errors.licenseNumber)} uppercase font-mono`} value={l.number} onChange={(e) => setLicense({ number: e.target.value.toUpperCase() })} placeholder="TN01 20190012345" />
                  </Field>
                  <Field label="Licence Valid Till" required error={errors.licenseExpiry}>
                    <input type="date" className={inputCls(errors.licenseExpiry)} value={l.expiryDate} onChange={(e) => setLicense({ expiryDate: e.target.value })} />
                  </Field>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <PhotoUpload label="Licence Front" value={l.frontPhotoUrl} folder="kyc" name="dl-front" capture="environment" required showError={showPhotoErrors} onChange={(url) => setLicense({ frontPhotoUrl: url })} />
                <PhotoUpload label="Licence Back" value={l.backPhotoUrl} folder="kyc" name="dl-back" capture="environment" required showError={showPhotoErrors} onChange={(url) => setLicense({ backPhotoUrl: url })} />
              </div>
            </>
          )}

          {/* STEP 2 — VEHICLE */}
          {step === vehicleStep && (
            <>
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <Car className="w-5 h-5 text-[#E21E26]" /> Your vehicle
              </h2>
              <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
                <Field label="Registration Number" required error={errors.vehicleNumber}>
                  <input
                    className={`${inputCls(errors.vehicleNumber)} uppercase font-mono`}
                    value={v.vehicleNumber}
                    onChange={(e) => onPlateChange(e.target.value)}
                    placeholder="TN 01 AB 1234"
                    autoCapitalize="characters"
                  />
                </Field>
                {AUTO_VEHICLE_DETECTION && (
                  <button
                    type="button"
                    onClick={() => void detect(v.vehicleNumber)}
                    disabled={!isPlate(v.vehicleNumber) || detection.state === 'loading'}
                    className="px-4 py-2.5 border border-gray-300 text-xs font-bold rounded-lg flex items-center justify-center gap-2 disabled:opacity-40 hover:border-[#E21E26]"
                  >
                    {detection.state === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <SearchCheck className="w-4 h-4" />}
                    {v.vahan?.lookupId === plate ? 'Check again' : 'Detect vehicle'}
                  </button>
                )}
              </div>
              {AUTO_VEHICLE_DETECTION && <p className="text-[11px] text-gray-500 -mt-3">Make, model, seats and fuel type are filled in automatically from the vehicle register.</p>}

              {detection.state === 'loading' && (
                <p className="text-xs text-gray-600 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-[#E21E26]" /> Looking up {v.vehicleNumber} in the vehicle register…</p>
              )}
              {detection.state === 'error' && <Alert tone="error">{detection.message}</Alert>}
              {result?.status === 'not_found' && (
                <Alert tone="error">This registration number was not found in the vehicle register. Check the number on the plate and try again.</Alert>
              )}
              {result?.status === 'found' && result.duplicate && (
                <Alert tone="error">This vehicle is already registered with another NESAM partner. Please contact NESAM support.</Alert>
              )}
              {detected && result?.status === 'found' && <DetectedCard vehicle={detected} issues={result.issues.map((i) => i.message)} />}
              {manual && (
                <>
                  <Alert tone="warning">
                    {AUTO_VEHICLE_DETECTION
                      ? 'Automatic vehicle detection is unavailable right now. Choose your vehicle type — NESAM will verify the vehicle from your documents.'
                      : 'Enter your vehicle details below — NESAM will verify the vehicle from your documents.'}
                  </Alert>
                  <Field label="Vehicle Type" required error={errors.vehicleType}>
                    <select
                      className={inputCls(errors.vehicleType)}
                      value={v.vahan?.manualType ? v.vehicleType : ''}
                      onChange={(e) => {
                        const t = VEHICLE_TYPES.find((x) => x.value === e.target.value);
                        if (t) setVehicle({ vehicleType: t.value, capacity: t.seats, vahan: v.vahan ? { ...v.vahan, manualType: true } : manualSnapshot(plate) });
                      }}
                    >
                      <option value="">Select</option>
                      {VEHICLE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </Field>
                  {!AUTO_VEHICLE_DETECTION && (
                    <div className="grid sm:grid-cols-3 gap-3">
                      <Field label="Make (optional)">
                        <input className={inputCls()} value={v.make} onChange={(e) => setVehicle({ make: e.target.value })} placeholder="Toyota" />
                      </Field>
                      <Field label="Model (optional)">
                        <input className={inputCls()} value={v.model} onChange={(e) => setVehicle({ model: e.target.value })} placeholder="Etios" />
                      </Field>
                      <Field label="Fuel type">
                        <select className={inputCls()} value={v.fuelType} onChange={(e) => setVehicle({ fuelType: e.target.value })}>
                          {FUEL_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
                        </select>
                      </Field>
                    </div>
                  )}
                </>
              )}

              <h3 className="text-sm font-bold text-gray-900 pt-3 border-t border-gray-100">Vehicle documents</h3>
              <div className="grid md:grid-cols-2 gap-5">
                <div className="space-y-3 border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-extrabold text-gray-900">RC (registration certificate)</p>
                  <PhotoUpload compact label="RC Photo" value={v.rcDocUrl} folder="vehicle" name="rc" capture="environment" required showError={showPhotoErrors} onChange={(url) => setVehicle({ rcDocUrl: url })} />
                </div>
                <div className="space-y-3 border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-extrabold text-gray-900">Insurance</p>
                  <Field label="Valid Till" required error={errors.insuranceExpiry}>
                    <input type="date" className={inputCls(errors.insuranceExpiry)} value={v.insuranceExpiry} onChange={(e) => setVehicle({ insuranceExpiry: e.target.value })} />
                  </Field>
                  <PhotoUpload compact label="Insurance Policy" value={v.insuranceDocUrl} folder="vehicle" name="insurance" capture="environment" required showError={showPhotoErrors} onChange={(url) => setVehicle({ insuranceDocUrl: url })} />
                </div>
                <div className="space-y-3 border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-extrabold text-gray-900">FC (fitness certificate)</p>
                  <Field label="Valid Till" required error={errors.fitnessExpiry}>
                    <input type="date" className={inputCls(errors.fitnessExpiry)} value={v.fitnessExpiry} onChange={(e) => setVehicle({ fitnessExpiry: e.target.value })} />
                  </Field>
                  <PhotoUpload compact label="FC Document" value={v.fitnessDocUrl} folder="vehicle" name="fitness" capture="environment" required showError={showPhotoErrors} onChange={(url) => setVehicle({ fitnessDocUrl: url })} />
                </div>
                <div className="space-y-3 border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-extrabold text-gray-900">Permit</p>
                  <Field label="Valid Till" required error={errors.permitExpiry}>
                    <input type="date" className={inputCls(errors.permitExpiry)} value={v.permitExpiry} onChange={(e) => setVehicle({ permitExpiry: e.target.value })} />
                  </Field>
                  <PhotoUpload compact label="Permit Document" value={v.statePermitDocUrl} folder="vehicle" name="permit" capture="environment" required showError={showPhotoErrors} onChange={(url) => setVehicle({ statePermitDocUrl: url })} />
                </div>
              </div>
              <div className="max-w-xs">
                <PhotoUpload compact label="Vehicle Front (with plate)" value={v.frontPhotoUrl} folder="vehicle" name="front" capture="environment" required showError={showPhotoErrors} onChange={(url) => setVehicle({ frontPhotoUrl: url })} />
              </div>
            </>
          )}

          {/* REVIEW */}
          {step === lastStep && (
            <>
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#E21E26]" /> Review &amp; Submit
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center gap-3 mb-3">
                    {data.profile.photoUrl && <img src={data.profile.photoUrl} alt="" className="w-12 h-12 rounded-xl object-cover" />}
                    <div>
                      <p className="text-sm font-extrabold text-gray-900">{data.profile.name || 'New driver partner'}</p>
                      <p className="text-xs text-gray-500">{data.profile.phone}</p>
                    </div>
                    <button type="button" onClick={() => setStep(1)} className="ml-auto text-[11px] font-bold text-[#E21E26]">Edit</button>
                  </div>
                  <ReviewRow label="Licence no." value={l.number} />
                  <ReviewRow label="Licence valid till" value={l.expiryDate} />
                </div>
                {!fleetDriver && (
                  <div className="border border-gray-200 rounded-xl p-4">
                    <div className="flex justify-between mb-2">
                      <p className="text-xs font-extrabold text-gray-900">Vehicle</p>
                      <button type="button" onClick={() => setStep(vehicleStep)} className="text-[11px] font-bold text-[#E21E26]">Edit</button>
                    </div>
                    <ReviewRow label="Registration" value={v.vehicleNumber} />
                    <ReviewRow label="Vehicle" value={[v.make, v.model].filter(Boolean).join(' ') || v.vehicleType} />
                    <ReviewRow label="Category" value={`${v.vehicleType}${v.capacity ? ` • ${v.capacity}+1 seats` : ''}${v.fuelType ? ` • ${v.fuelType}` : ''}`} />
                    <ReviewRow label="Insurance till" value={v.insuranceExpiry} />
                    <ReviewRow label="FC till" value={v.fitnessExpiry} />
                    <ReviewRow label="Permit till" value={v.permitExpiry} />
                    <ReviewRow label="Register check" value={v.vahan?.status === 'found' ? 'Verified from vehicle register' : 'Manual verification by NESAM'} />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {[data.profile.photoUrl, l.frontPhotoUrl, l.backPhotoUrl, ...(fleetDriver ? [] : [v.frontPhotoUrl, v.rcDocUrl, v.insuranceDocUrl, v.fitnessDocUrl, v.statePermitDocUrl])]
                  .filter(Boolean)
                  .map((url) => (
                    <img key={url} src={url} alt="" className="h-16 w-full object-cover rounded-lg border border-gray-200" />
                  ))}
              </div>

              {[l.expiryDate, ...(fleetDriver ? [] : [v.insuranceExpiry, v.fitnessExpiry, v.permitExpiry])].some((d) => d && d <= today) && (
                <Alert tone="error">A document above has expired. Go back and update it before submitting.</Alert>
              )}

              <label className="flex items-start gap-2 text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-xl p-3 cursor-pointer">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-[#E21E26]" />
                <span>
                  I declare that the information and documents provided are genuine and belong to me / my vehicle, and I
                  authorise NESAM Tours &amp; Travels to verify them.
                </span>
              </label>

              {submitError && <Alert tone="error">{submitError}</Alert>}
            </>
          )}

          {/* Navigation */}
          <div className="flex justify-between pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={() => { setErrors({}); setStep((s) => Math.max(1, s - 1)); }}
              disabled={step === 1 || submitting}
              className="px-4 py-2.5 border border-gray-300 text-gray-700 text-xs font-bold rounded-xl disabled:opacity-40"
            >
              Back
            </button>
            {step < lastStep ? (
              <button type="button" onClick={goNext} className="px-6 py-2.5 bg-[#E21E26] hover:bg-[#C9141B] text-white text-xs font-bold rounded-xl shadow">
                Save &amp; Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !consent}
                className="px-6 py-2.5 bg-[#E21E26] hover:bg-[#C9141B] text-white text-xs font-bold rounded-xl shadow disabled:opacity-60 flex items-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? 'Submitting...' : mode === 'signup' ? 'Submit for Verification' : 'Resubmit for Verification'}
              </button>
            )}
          </div>
          {Object.keys(errors).length > 0 && (
            <p className="text-[11px] text-red-600 font-semibold text-right -mt-2">Please fix the highlighted fields.</p>
          )}
        </div>
      </div>
    </div>
  );
};
