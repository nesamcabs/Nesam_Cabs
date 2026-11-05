import React, { useMemo, useState } from 'react';
import type { PayoutDetails, VendorRecord } from '../../types';
import { saveBusinessAccountStep, type VendorKyc } from '../../services/onboardingService';
import { describeDataError } from '../../utils/retry';
import {
  digitsOnly,
  hasErrors,
  normalizeSpaces,
  validateAccountNumber,
  validateAltPhone,
  validateBusinessName,
  validateEmail,
  validateFleetSize,
  validateIfsc,
  validatePersonName,
  validateUpi,
} from '../../utils/validation';
import { Button, ErrorBanner, TextField } from '../../components/onboarding/ui';

interface Props {
  record: VendorRecord;
  kyc: VendorKyc | null;
  onKycChange: (k: VendorKyc) => void;
  onNext: () => void;
}

export const BusinessAccountStep: React.FC<Props> = ({ record, kyc, onKycChange, onNext }) => {
  const b = record.business;
  const saved = kyc?.payout;
  const loginPhone = record.phone || '';

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

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const errors = useMemo(
    () => ({
      vendorName: validatePersonName(form.vendorName, 'Owner name'),
      businessName: validateBusinessName(form.businessName),
      email: validateEmail(form.email),
      altPhone: validateAltPhone(form.altPhone, loginPhone),
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
    }),
    [form, loginPhone],
  );

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const blur = (key: string) => () => setTouched((t) => ({ ...t, [key]: true }));
  const err = (key: keyof typeof errors) => (submitted || touched[key] ? errors[key] : '');

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
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
    } catch (error) {
      setSaveError(describeDataError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      <div>
        <h2 className="text-[14px] font-bold text-[#111] mb-1">Business details</h2>
        <p className="text-[12px] text-[#666] mb-4">
          Basic contact details of the fleet owner and registered travel agency.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <TextField
            id="vendorName"
            label="Owner / Contact Person Name"
            required
            value={form.vendorName}
            onChange={set('vendorName')}
            onBlur={blur('vendorName')}
            error={err('vendorName')}
            placeholder="Ravi Kumar"
            autoComplete="name"
            autoFocus
          />
          <TextField
            id="businessName"
            label="Business / Travels Name"
            required
            value={form.businessName}
            onChange={set('businessName')}
            onBlur={blur('businessName')}
            error={err('businessName')}
            placeholder="Sri Balaji Travels"
            autoComplete="organization"
          />
          <TextField
            id="email"
            label="Business Email"
            required
            type="email"
            value={form.email}
            onChange={set('email')}
            onBlur={blur('email')}
            error={err('email')}
            placeholder="office@sribalajitravels.com"
            autoComplete="email"
          />
          <TextField
            id="altPhone"
            label="Alternate Mobile Number"
            inputMode="numeric"
            value={form.altPhone}
            onChange={(v) => set('altPhone')(digitsOnly(v).slice(0, 10))}
            onBlur={blur('altPhone')}
            error={err('altPhone')}
            placeholder="Optional 10-digit mobile"
            hint="Must differ from your login mobile"
          />
          <TextField
            id="operatingCity"
            label="Operating City / Base Area"
            required
            value={form.operatingCity}
            onChange={set('operatingCity')}
            onBlur={blur('operatingCity')}
            error={err('operatingCity')}
            placeholder="Chennai / Coimbatore"
            hint="Primary city or region your fleet serves"
          />
          <TextField
            id="estimatedFleetSize"
            label="Approximate Fleet Size (Vehicle Count)"
            required
            inputMode="numeric"
            value={form.estimatedFleetSize}
            onChange={(v) => set('estimatedFleetSize')(digitsOnly(v).slice(0, 4))}
            onBlur={blur('estimatedFleetSize')}
            error={err('estimatedFleetSize')}
            placeholder="e.g. 5"
            hint="Total vehicles you plan to attach with NESAM"
          />
        </div>
      </div>

      <div className="pt-2 border-t border-[#F0F0F0]">
        <h2 className="text-[14px] font-bold text-[#111] mb-1">Bank account for settlements</h2>
        <p className="text-[12px] text-[#666] mb-4">
          All trip payouts and marketplace earnings will be credited to this verified account.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <TextField
              id="accountHolderName"
              label="Bank Account Holder Name"
              required
              value={form.accountHolderName}
              onChange={set('accountHolderName')}
              onBlur={blur('accountHolderName')}
              error={err('accountHolderName')}
              hint="Exactly as printed on your bank passbook / cheque"
            />
          </div>
          <TextField
            id="accountNumber"
            label="Account Number"
            required
            inputMode="numeric"
            autoComplete="off"
            value={form.accountNumber}
            onChange={(v) => set('accountNumber')(digitsOnly(v).slice(0, 18))}
            onBlur={blur('accountNumber')}
            error={err('accountNumber')}
          />
          <TextField
            id="confirmAccountNumber"
            label="Confirm Account Number"
            required
            inputMode="numeric"
            autoComplete="off"
            value={form.confirmAccountNumber}
            onChange={(v) => set('confirmAccountNumber')(digitsOnly(v).slice(0, 18))}
            onBlur={blur('confirmAccountNumber')}
            onPaste={(e) => e.preventDefault()}
            error={err('confirmAccountNumber')}
          />
          <TextField
            id="ifsc"
            label="IFSC Code"
            required
            value={form.ifsc}
            onChange={(v) => set('ifsc')(v.toUpperCase().replace(/\s/g, '').slice(0, 11))}
            onBlur={blur('ifsc')}
            error={err('ifsc')}
            placeholder="SBIN0001234"
          />
          <TextField
            id="upiId"
            label="UPI ID"
            value={form.upiId}
            onChange={(v) => set('upiId')(v.replace(/\s/g, ''))}
            onBlur={blur('upiId')}
            error={err('upiId')}
            placeholder="business@okhdfcbank"
            hint="Optional · used for instant UPI settlements"
          />
        </div>
        <p className="mt-3 text-[11px] text-[#888]">
          Account details are stored securely and encrypted. Visible only to you and the NESAM finance team.
        </p>
      </div>

      {submitted && hasErrors(errors) && <ErrorBanner message="Please fix the highlighted fields." />}
      <ErrorBanner message={saveError} onRetry={saveError ? () => handleSubmit() : undefined} />

      <div className="flex justify-end pt-2">
        <Button type="submit" loading={saving}>
          {saving ? 'Saving…' : 'Save & Continue'}
        </Button>
      </div>
    </form>
  );
};
