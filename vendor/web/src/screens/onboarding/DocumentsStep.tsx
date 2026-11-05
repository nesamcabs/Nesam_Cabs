import React, { useMemo, useState } from 'react';
import type { BusinessRegType, IdentityProofType, StoredFile, VendorDocuments, VendorRecord } from '../../types';
import { saveDocumentsStep, type VendorKyc } from '../../services/onboardingService';
import { describeDataError } from '../../utils/retry';
import {
  digitsOnly,
  hasErrors,
  validateAadhaar,
  validatePan,
  validatePassport,
  validateRegistrationNumber,
} from '../../utils/validation';
import { BUSINESS_REG_TYPES, IDENTITY_PROOF_TYPES } from '../../config/onboarding';
import { Button, ErrorBanner, FieldShell, TextField } from '../../components/onboarding/ui';
import { FileUploadField } from '../../components/onboarding/FileUploadField';

interface Props {
  record: VendorRecord;
  kyc: VendorKyc | null;
  onKycChange: (k: VendorKyc) => void;
  onNext: () => void;
  onBack: () => void;
}

export const DocumentsStep: React.FC<Props> = ({ record, kyc, onKycChange, onNext, onBack }) => {
  const saved = record.documents;
  const [bizType, setBizType] = useState<BusinessRegType>(saved?.businessRegistration?.type ?? 'GST');
  const [bizNumber, setBizNumber] = useState(saved?.businessRegistration?.number ?? '');
  const [bizFiles, setBizFiles] = useState<StoredFile[]>(saved?.businessRegistration?.files ?? []);

  const [idType, setIdType] = useState<IdentityProofType>(saved?.identityProof?.type ?? 'AADHAAR');
  const [idNumber, setIdNumber] = useState(kyc?.identityNumber ?? '');
  const [idFiles, setIdFiles] = useState<StoredFile[]>(saved?.identityProof?.files ?? []);

  const [bizBusy, setBizBusy] = useState(false);
  const [idBusy, setIdBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const bizDef = BUSINESS_REG_TYPES.find((x) => x.value === bizType) || BUSINESS_REG_TYPES[0];
  const idDef = IDENTITY_PROOF_TYPES.find((x) => x.value === idType) || IDENTITY_PROOF_TYPES[0];

  const validateId = (val: string): string => {
    if (idType === 'AADHAAR') return validateAadhaar(val);
    if (idType === 'PAN') return validatePan(val);
    return validatePassport(val);
  };

  const errors = useMemo(
    () => ({
      bizNumber: validateRegistrationNumber(bizNumber),
      bizFiles: bizFiles.length === 0 ? 'Upload at least one document.' : '',
      idNumber: validateId(idNumber),
      idFiles: idFiles.length === 0 ? 'Upload at least one document.' : '',
    }),
    [bizNumber, bizFiles, idType, idNumber, idFiles],
  );

  const err = (key: keyof typeof errors) => (submitted ? errors[key] : '');

  const maskedIdNumber = (): string => {
    const v = idNumber.replace(/\s/g, '');
    if (v.length <= 4) return v;
    return '•'.repeat(Math.min(v.length - 4, 8)) + v.slice(-4);
  };

  const persistedBizPaths = useMemo(() => new Set((saved?.businessRegistration?.files ?? []).map((f) => f.path)), [saved]);
  const persistedIdPaths = useMemo(() => new Set((saved?.identityProof?.files ?? []).map((f) => f.path)), [saved]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSubmitted(true);
    if (hasErrors(errors) || saving || bizBusy || idBusy) return;

    const documents: VendorDocuments = {
      businessRegistration: {
        type: bizType,
        number: bizNumber.trim().toUpperCase(),
        files: bizFiles,
      },
      identityProof: {
        type: idType,
        maskedNumber: maskedIdNumber(),
        files: idFiles,
      },
    };

    setSaving(true);
    setSaveError('');
    try {
      await saveDocumentsStep(record, documents, idNumber.trim());
      onKycChange({ identityNumber: idNumber.trim(), payout: kyc?.payout ?? null });
      onNext();
    } catch (error) {
      setSaveError(describeDataError(error));
    } finally {
      setSaving(false);
    }
  };

  const uploading = bizBusy || idBusy;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {/* Business Registration */}
      <div>
        <h2 className="text-[14px] font-bold text-[#111] mb-1">Business Registration Document</h2>
        <p className="text-[12px] text-[#666] mb-3">
          Upload any official certificate showing registration of your travels or fleet business.
        </p>

        <FieldShell label="Registration Type" htmlFor="bizType" required>
          <div className="flex flex-wrap gap-2">
            {BUSINESS_REG_TYPES.map((t) => (
              <button
                type="button"
                key={t.value}
                onClick={() => setBizType(t.value)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all ${
                  bizType === t.value
                    ? 'border-[#E21B23] bg-[#FEF2F2] text-[#E21B23]'
                    : 'border-[#E5E5E5] bg-white text-[#666] hover:border-[#CCC]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </FieldShell>

        <div className="grid sm:grid-cols-2 gap-4 mt-3">
          <TextField
            id="bizNumber"
            label={`${bizDef.label} Number`}
            required
            value={bizNumber}
            onChange={(v) => setBizNumber(v.toUpperCase().replace(/\s/g, ''))}
            error={err('bizNumber')}
            placeholder={bizDef.placeholder}
            autoCapitalize="characters"
            autoCorrect="off"
          />
        </div>

        <div className="mt-3">
          <FileUploadField
            id="bizFiles"
            label={`${bizDef.label} (Document File)`}
            required
            hint="Clear scan or photo · PDF, JPG, PNG, WEBP (Max 10MB)"
            category="business_registration"
            files={bizFiles}
            onChange={(fn) => setBizFiles(fn)}
            persistedPaths={persistedBizPaths}
            onBusyChange={setBizBusy}
            error={err('bizFiles')}
            max={3}
          />
        </div>
      </div>

      {/* Owner Identity Proof */}
      <div className="pt-2 border-t border-[#F0F0F0]">
        <h2 className="text-[14px] font-bold text-[#111] mb-1">Owner Identity Proof</h2>
        <p className="text-[12px] text-[#666] mb-3">
          Government-issued identity proof of the business owner or managing partner.
        </p>

        <FieldShell label="ID Type" htmlFor="idType" required>
          <div className="flex flex-wrap gap-2">
            {IDENTITY_PROOF_TYPES.map((t) => (
              <button
                type="button"
                key={t.value}
                onClick={() => {
                  setIdType(t.value);
                  setIdNumber('');
                }}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all ${
                  idType === t.value
                    ? 'border-[#E21B23] bg-[#FEF2F2] text-[#E21B23]'
                    : 'border-[#E5E5E5] bg-white text-[#666] hover:border-[#CCC]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </FieldShell>

        <div className="grid sm:grid-cols-2 gap-4 mt-3">
          <TextField
            id="idNumber"
            label={`${idDef.label} Number`}
            required
            type={idType === 'AADHAAR' ? 'password' : 'text'}
            value={idNumber}
            onChange={(v) => {
              if (idType === 'AADHAAR') setIdNumber(digitsOnly(v).slice(0, 12));
              else if (idType === 'PAN') setIdNumber(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10));
              else setIdNumber(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8));
            }}
            error={err('idNumber')}
            placeholder={idDef.placeholder}
            autoCapitalize="characters"
            autoCorrect="off"
            hint={idType === 'AADHAAR' ? 'Stored securely in encrypted KYC record' : undefined}
          />
        </div>

        <div className="mt-3">
          <FileUploadField
            id="idFiles"
            label={`${idDef.label} (Front & Back)`}
            required
            hint="Upload both sides of ID card · PDF, JPG, PNG (Max 10MB)"
            category="identity_proof"
            files={idFiles}
            onChange={(fn) => setIdFiles(fn)}
            persistedPaths={persistedIdPaths}
            onBusyChange={setIdBusy}
            error={err('idFiles')}
            max={2}
          />
        </div>
      </div>

      {submitted && hasErrors(errors) && <ErrorBanner message="Please fix the highlighted fields." />}
      {uploading && (
        <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-xl px-4 py-3 text-[12px]">
          Upload in progress — please wait for files to finish uploading before continuing.
        </div>
      )}
      <ErrorBanner message={saveError} onRetry={saveError ? () => handleSubmit() : undefined} />

      <div className="flex justify-between items-center pt-2">
        <Button type="button" variant="secondary" onClick={onBack} disabled={saving}>
          Back
        </Button>
        <Button type="submit" loading={saving} disabled={uploading}>
          {saving ? 'Saving…' : 'Save & Continue'}
        </Button>
      </div>
    </form>
  );
};

