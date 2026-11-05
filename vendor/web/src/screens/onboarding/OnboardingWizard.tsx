import React, { useEffect, useState } from "react";
import type { VendorRecord } from "../../types";
import { ONBOARDING_STEPS, SECTION_LABELS, stepOfSection } from "../../config/onboarding";
import { getVendorKyc, type VendorKyc } from "../../services/onboardingService";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import { FullScreenLoader } from "../../components/onboarding/ui";
import { Banner, Button } from "../../ui/kit";
import { Icon, IconSprite } from "../../ui/Icon";
import { BusinessAccountStep } from "./BusinessAccountStep";
import { DocumentsStep } from "./DocumentsStep";
import { FleetStep } from "./FleetStep";
import { ReviewStep } from "./ReviewStep";

export interface StepProps {
  record: VendorRecord;
  onNext: () => void;
  onBack: () => void;
}

interface OnboardingWizardProps {
  /** null until the first step is saved (brand-new vendor). */
  record: VendorRecord | null;
  phone: string;
  /** Informational banner, e.g. login attempted with an unregistered number. */
  notice?: string;
  onSignOut: () => void;
}

function initialStep(record: VendorRecord | null): number {
  if (!record) return 0;
  if (
    (record.status === "CHANGES_REQUESTED" || record.status === "REJECTED") &&
    record.review?.flaggedSections.length
  ) {
    return stepOfSection(record.review.flaggedSections[0]);
  }
  return Math.min(record.onboardingStep, ONBOARDING_STEPS.length - 1);
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  record,
  phone,
  notice,
  onSignOut,
}) => {
  const online = useOnlineStatus();
  const [step, setStep] = useState(() => initialStep(record));
  const [kyc, setKyc] = useState<VendorKyc | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(!!record);

  // Load private KYC details for resuming vendors (so bank/ID fields pre-fill).
  useEffect(() => {
    if (!record) {
      setPrefillLoading(false);
      return;
    }
    let alive = true;
    getVendorKyc()
      .catch(() => null)
      .then((k) => {
        if (!alive) return;
        setKyc(k);
        setPrefillLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [record]);

  // Scroll to top on step change (long forms on mobile).
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step]);

  if (prefillLoading)
    return <FullScreenLoader label="Preparing your application…" />;

  // Only allow jumping to steps that have been reached before.
  const maxReachable = Math.max(record?.onboardingStep ?? 0, step);
  const goTo = (i: number) => {
    if (i <= maxReachable) setStep(i);
  };
  const next = () =>
    setStep((s) => Math.min(s + 1, ONBOARDING_STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const correction =
    record &&
    (record.status === "CHANGES_REQUESTED" || record.status === "REJECTED")
      ? record
      : null;
  const current = ONBOARDING_STEPS[step] || ONBOARDING_STEPS[0];

  const renderStep = () => {
    if (!record) return <FullScreenLoader label="Saving…" />;
    switch (step) {
      case 0:
        return <BusinessAccountStep record={record} kyc={kyc} onKycChange={setKyc} onNext={next} />;
      case 1:
        return <DocumentsStep record={record} kyc={kyc} onKycChange={setKyc} onNext={next} onBack={back} />;
      case 2:
        return <FleetStep record={record} onNext={next} onBack={back} />;
      default:
        return (
          <ReviewStep
            record={record}
            onEdit={goTo}
            onBack={back}
          />
        );
    }
  };

  return (
    <div className="vx">
      <IconSprite />
      <header className="vx-wizard__bar">
        <div>
          <div className="vx-media">
            <span className="vx-brand__mark" style={{ width: 38, height: 38, borderRadius: 10 }}><img src="/brand/nesam-emblem.jpg" alt="" width={512} height={497} decoding="async" /></span>
            <div>
              <strong style={{ fontSize: 14 }}>Fleet partner application</strong>
              <small>{phone}</small>
            </div>
          </div>
          <Button size="sm" onClick={onSignOut} className="vx-btn--sm"><Icon name="logout" />Sign out</Button>
        </div>
      </header>

      <main className="vx-wizard" style={{ paddingTop: 22 }}>
        <ol className="vx-steps" aria-label="Application progress">
          {ONBOARDING_STEPS.map((s, i) => {
            const done = i < step || (record?.onboardingStep ?? 0) > i;
            const active = i === step;
            return (
              <li key={s.key} data-state={active ? "active" : done ? "done" : "todo"}>
                <button type="button" onClick={() => goTo(i)} disabled={i > maxReachable} aria-current={active ? "step" : undefined}
                  style={{ border: 0, background: "transparent", padding: 0, font: "inherit", color: "inherit", cursor: i > maxReachable ? "not-allowed" : "pointer" }}>
                  {i + 1}. {s.short}
                </button>
              </li>
            );
          })}
        </ol>

        {!online && <Banner tone="warn">You’re offline. Changes can’t be saved until your connection is back.</Banner>}
        {notice && step === 0 && <Banner>{notice}</Banner>}

        {correction && (
          <Banner tone="warn">
            <strong>{correction.status === "REJECTED" ? "Your application was not approved" : "The NESAM team requested changes"}</strong>
            {correction.review?.note && <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{correction.review.note}</div>}
            {!!correction.review?.flaggedSections.length && (
              <div style={{ marginTop: 6, fontWeight: 600 }}>
                Please update: {correction.review.flaggedSections.map((f) => SECTION_LABELS[f]).join(", ")}. Then resubmit from the final step.
              </div>
            )}
          </Banner>
        )}

        <div className="vx-card" style={{ padding: 22 }}>
          <div className="vx-card__sub" style={{ textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>Step {step + 1} of {ONBOARDING_STEPS.length}</div>
          <h1 style={{ fontSize: 21, fontWeight: 700, margin: "2px 0 16px" }}>{current.title}</h1>
          {renderStep()}
        </div>

        <p className="vx-hint" style={{ textAlign: "center", marginTop: 14 }}>
          Your progress is saved after each step — you can sign out and continue later.
        </p>
      </main>
    </div>
  );
};
