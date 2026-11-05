import React, { useCallback, useMemo, useState } from 'react';
import { CheckCircle2, Trash2 } from 'lucide-react';
import type { FleetVehicleDoc, StoredFile } from '../../types';
import { saveFleetStep } from '../../services/onboardingService';
import { buildFleetDetails, displayPlate, emptyVehicle, normalizePlate, validateVehicle, type VehicleErrors } from '../../utils/fleet';
import { describeDataError } from '../../utils/retry';
import { Button, ErrorBanner, FieldShell, TextField } from '../../components/onboarding/ui';
import { FileUploadField } from '../../components/onboarding/FileUploadField';
import type { StepProps } from './OnboardingWizard';

type FileKey = 'rcFiles' | 'insuranceFiles' | 'fitnessFiles' | 'permitFiles' | 'frontPhotoFiles';

const dateInput = 'w-full h-10 px-3 rounded-lg border text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#E21B23]/20 border-[#E5E5E5]';

/** Fleet: each vehicle is added with its registration number only. RC, insurance, FC, permit and a front photo are optional extras. */
export const FleetStep: React.FC<StepProps> = ({ record, onNext, onBack }) => {
  const saved = useMemo(() => record.fleet?.vehicles ?? [], [record.fleet]);
  const [vehicles, setVehicles] = useState<FleetVehicleDoc[]>(saved);
  const [draft, setDraft] = useState<FleetVehicleDoc>(emptyVehicle());
  const [adding, setAdding] = useState(saved.length === 0);
  const [errors, setErrors] = useState<VehicleErrors>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [stepError, setStepError] = useState('');

  const persistedPaths = useMemo(
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

  const setFiles = (key: FileKey) => (updater: (prev: StoredFile[]) => StoredFile[]) => setDraft((d) => ({ ...d, [key]: updater(d[key]) }));

  const resetEditor = () => {
    setDraft(emptyVehicle());
    setErrors({});
  };

  const addVehicle = () => {
    const e = validateVehicle(draft, { others: vehicles.map((v) => normalizePlate(v.registrationNumber)) });
    setErrors(e);
    if (Object.keys(e).length || uploading) return;
    setVehicles((list) => [...list, { ...draft, registrationNumber: plate, source: 'manual' }]);
    resetEditor();
    setAdding(false);
  };

  const handleSave = async () => {
    setStepError('');
    if (!vehicles.length) {
      setStepError('Add at least one vehicle.');
      return;
    }
    if (adding && draft.registrationNumber.trim()) {
      setStepError('Finish adding the vehicle you started, or clear it, before continuing.');
      return;
    }
    if (uploading || saving) return;
    setSaving(true);
    setSaveError('');
    try {
      await saveFleetStep(record, buildFleetDetails(vehicles));
      onNext();
    } catch (error) {
      setSaveError(describeDataError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {vehicles.map((v) => (
        <div key={v.registrationNumber} className="flex items-start gap-3 rounded-xl border border-[#E5E5E5] bg-white p-4">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-bold text-[#111] font-mono">{displayPlate(v.registrationNumber)}</div>
            {[v.make, v.model].filter(Boolean).length > 0 && <div className="text-[12px] text-[#555]">{[v.make, v.model].filter(Boolean).join(' ')}</div>}
            {v.category && <div className="text-[11px] text-[#888]">{v.category === 'Premium SUV' ? 'Innova Crysta' : v.category}</div>}
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-700">NESAM will verify</span>
          <button
            type="button"
            onClick={() => setVehicles((list) => list.filter((x) => x.registrationNumber !== v.registrationNumber))}
            className="text-[#999] hover:text-[#E21B23]"
            aria-label={`Remove ${displayPlate(v.registrationNumber)}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}

      {adding ? (
        <div className="rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] p-4 space-y-4">
          <h2 className="text-[13px] font-bold text-[#111]">{vehicles.length ? 'Add another vehicle' : 'Add a vehicle'}</h2>

          <TextField
            id="registrationNumber"
            label="Registration Number"
            required
            value={draft.registrationNumber}
            onChange={(text) => setDraft((d) => ({ ...d, registrationNumber: text.toUpperCase() }))}
            error={errors.registrationNumber}
            placeholder="TN 01 AB 1234"
            hint="As printed on the number plate. NESAM verifies the vehicle during review."
          />

          <details className="rounded-lg border border-[#E5E5E5] bg-white">
            <summary className="cursor-pointer select-none px-3.5 py-2.5 text-[12px] font-bold text-[#444]">Add vehicle documents (optional)</summary>
            <div className="space-y-4 p-4 border-t border-[#EEE]">
              <FileUploadField id="rcFiles" label="RC (registration certificate)" category="vehicle_rc" files={draft.rcFiles} onChange={setFiles('rcFiles')} persistedPaths={persistedPaths} onBusyChange={onRc} max={2} />
              <div className="grid sm:grid-cols-[1fr_200px] gap-4 items-start">
                <FileUploadField id="insuranceFiles" label="Insurance" category="vehicle_insurance" files={draft.insuranceFiles} onChange={setFiles('insuranceFiles')} persistedPaths={persistedPaths} onBusyChange={onIns} max={2} />
                <FieldShell label="Insurance valid till" htmlFor="insuranceUpto">
                  <input id="insuranceUpto" type="date" className={dateInput} value={draft.insuranceUpto} onChange={(e) => setDraft((d) => ({ ...d, insuranceUpto: e.target.value }))} />
                </FieldShell>
              </div>
              <div className="grid sm:grid-cols-[1fr_200px] gap-4 items-start">
                <FileUploadField id="fitnessFiles" label="FC (fitness certificate)" category="vehicle_fc" files={draft.fitnessFiles} onChange={setFiles('fitnessFiles')} persistedPaths={persistedPaths} onBusyChange={onFc} max={2} />
                <FieldShell label="FC valid till" htmlFor="fitnessUpto">
                  <input id="fitnessUpto" type="date" className={dateInput} value={draft.fitnessUpto} onChange={(e) => setDraft((d) => ({ ...d, fitnessUpto: e.target.value }))} />
                </FieldShell>
              </div>
              <div className="grid sm:grid-cols-[1fr_200px] gap-4 items-start">
                <FileUploadField id="permitFiles" label="Permit" category="vehicle_permit" files={draft.permitFiles} onChange={setFiles('permitFiles')} persistedPaths={persistedPaths} onBusyChange={onPermit} max={2} />
                <FieldShell label="Permit valid till" htmlFor="permitUpto">
                  <input id="permitUpto" type="date" className={dateInput} value={draft.permitUpto} onChange={(e) => setDraft((d) => ({ ...d, permitUpto: e.target.value }))} />
                </FieldShell>
              </div>
              <FileUploadField id="frontPhotoFiles" label="Vehicle Front (with plate)" hint="Clear photo showing the number plate · JPG/PNG/WEBP" category="vehicle_photos" files={draft.frontPhotoFiles} onChange={setFiles('frontPhotoFiles')} persistedPaths={persistedPaths} onBusyChange={onFront} max={1} />
            </div>
          </details>

          <div className="flex justify-end gap-2">
            {vehicles.length > 0 && (
              <Button variant="secondary" onClick={() => { resetEditor(); setAdding(false); }}>
                Cancel
              </Button>
            )}
            <Button onClick={addVehicle} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Add Vehicle'}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          + Add another vehicle
        </Button>
      )}

      {stepError && <ErrorBanner message={stepError} />}
      <ErrorBanner message={saveError} onRetry={saveError ? handleSave : undefined} />

      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={onBack} disabled={saving}>
          Back
        </Button>
        <Button onClick={handleSave} loading={saving} disabled={uploading}>
          {uploading ? 'Uploading…' : saving ? 'Saving…' : 'Save & Continue'}
        </Button>
      </div>
    </div>
  );
};
