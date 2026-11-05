import { displayPlate } from '../../utils/fleet';
import React, { useState } from 'react';
import { AlertTriangle, Pencil } from 'lucide-react';
import type { OnboardingSection, VendorRecord } from '../../types';
import { SECTION_LABELS, stepOfSection } from '../../config/onboarding';
import { missingSections, submitForReview } from '../../services/onboardingService';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { describeDataError } from '../../utils/retry';
import { Button, ErrorBanner } from '../../components/onboarding/ui';

interface ReviewStepProps {
  record: VendorRecord;
  onEdit: (stepIndex: number) => void;
  onBack: () => void;
}

const Row: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div className="flex justify-between gap-4 py-1.5 text-[12px]">
    <span className="text-[#888] shrink-0">{label}</span>
    <span className="font-semibold text-[#111] text-right break-words min-w-0">{value || '—'}</span>
  </div>
);

export const ReviewStep: React.FC<ReviewStepProps> = ({ record, onEdit, onBack }) => {
  const online = useOnlineStatus();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const missing = missingSections(record);
  const { business: b, fleet: f, payoutSummary: p, documents: d } = record;
  const isResubmission = record.status !== 'INCOMPLETE';

  const Section: React.FC<{ id: OnboardingSection; children: React.ReactNode }> = ({ id, children }) => {
    const isMissing = missing.includes(id);
    const flagged = record.review?.flaggedSections.includes(id) && isResubmission;
    return (
      <div className={`rounded-xl border p-4 ${isMissing ? 'border-[#FBD5D5] bg-[#FFF8F8]' : flagged ? 'border-amber-200 bg-amber-50/40' : 'border-[#E5E5E5]'}`}>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[13px] font-bold text-[#111] flex items-center gap-1.5">
            {isMissing && <AlertTriangle className="w-4 h-4 text-[#E21B23]" />}
            {SECTION_LABELS[id]}
          </h3>
          <button
            type="button"
            onClick={() => onEdit(stepOfSection(id))}
            className="text-[12px] font-semibold text-[#E21B23] flex items-center gap-1 hover:underline"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        </div>
        {isMissing ? <p className="text-[12px] text-[#B4141B]">This section is incomplete.</p> : children}
      </div>
    );
  };

  const handleSubmit = async () => {
    if (missing.length || !agreed) return;
    setSubmitting(true);
    setError('');
    try {
      await submitForReview(record);
      // The vendors/{uid} listener re-routes to the pending review screen.
    } catch (err) {
      setError(describeDataError(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Section id="business">
        <Row label="Owner name" value={b?.vendorName} />
        <Row label="Business name" value={b?.businessName} />
        <Row label="Business email" value={b?.email} />
        {b?.altPhone && <Row label="Alternate mobile" value={`+91 ${b.altPhone}`} />}
        {b?.operatingCity && <Row label="Operating city / base" value={b.operatingCity} />}
        {b?.estimatedFleetSize && <Row label="Estimated fleet size" value={`${b.estimatedFleetSize} vehicle(s)`} />}
      </Section>

      <Section id="payout">
        <Row label="Account holder" value={p?.accountHolderName} />
        <Row label="Account number" value={p ? `••••${p.bankLast4}` : ''} />
        <Row label="IFSC" value={p?.ifsc} />
        <Row label="UPI ID" value={p?.upiId || '—'} />
      </Section>

      {d && (
        <Section id="documents">
          <Row label="Business registration" value={`${d.businessRegistration.type} — ${d.businessRegistration.number}`} />
          <Row label="Owner ID proof" value={`${d.identityProof.type} — ${d.identityProof.maskedNumber}`} />
          <Row label="Uploaded files" value={`${(d.businessRegistration.files?.length || 0) + (d.identityProof.files?.length || 0)} document(s)`} />
        </Section>
      )}

      <Section id="fleet">
        <Row label="Vehicles registered" value={f?.vehicles?.length ? String(f.vehicles.length) : ''} />
        {(f?.vehicles ?? []).map((v) => (
          <Row
            key={v.registrationNumber}
            label={displayPlate(v.registrationNumber)}
            value={[v.make, v.model].filter(Boolean).join(' ') || v.category || 'NESAM will verify the vehicle'}
          />
        ))}
      </Section>

      <label className="flex items-start gap-2.5 text-[12px] text-[#444] cursor-pointer select-none pt-1">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-[#E21B23]"
        />
        I confirm that the information and documents provided are genuine, and I agree to NESAM's Fleet Partner Terms
        of Service, commission policy and verification requirements.
      </label>

      {missing.length > 0 && <ErrorBanner message="Complete the highlighted sections before submitting." />}
      <ErrorBanner message={error} onRetry={error ? handleSubmit : undefined} />

      <div className="flex justify-between pt-2">
        <Button variant="secondary" onClick={onBack} disabled={submitting}>
          Back
        </Button>
        <Button onClick={handleSubmit} loading={submitting} disabled={!agreed || missing.length > 0 || !online}>
          {submitting ? 'Submitting…' : isResubmission ? 'Resubmit for Review' : 'Submit for Review'}
        </Button>
      </div>
    </div>
  );
};
