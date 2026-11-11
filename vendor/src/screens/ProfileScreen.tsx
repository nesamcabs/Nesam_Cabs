// Business profile. Approved vendors may update contact details only (email,
// alternate phone, address) — legal names and bank details stay fixed
// (firestore.rules), matching updateApprovedContactInfo on the Web.
import React, { useState } from 'react';
import { Text } from 'react-native';
import { useVendorData } from '../context/VendorData';
import { Button, Card, Notice, Row, Screen, TextField } from '../components/ui';
import { SelectField } from '../components/SelectField';
import { updateApprovedContactInfo } from '../services/onboardingService';
import { INDIAN_STATES } from '../config/onboarding';
import { digitsOnly, hasErrors, normalizeSpaces, validateAltPhone, validateEmail, validatePincode, validateRequired } from '../utils/validation';
import { formatPhone } from '../utils/format';
import { describeDataError } from '../utils/retry';
import { space, type } from '../theme';

export function ProfileScreen() {
  const { record, profile } = useVendorData();
  const b = record.business;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    email: b?.email ?? '',
    altPhone: b?.altPhone ?? '',
    line1: b?.address.line1 ?? '',
    line2: b?.address.line2 ?? '',
    city: b?.address.city ?? '',
    state: b?.address.state ?? '',
    pincode: b?.address.pincode ?? '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const errors = {
    email: validateEmail(form.email),
    altPhone: validateAltPhone(form.altPhone, record.phone),
    line1: validateRequired(form.line1, 'Address line 1', 150),
    city: validateRequired(form.city, 'City', 60),
    state: form.state ? '' : 'Select a state.',
    pincode: validatePincode(form.pincode),
  };
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : '');

  const save = async () => {
    setSubmitted(true);
    if (!b || hasErrors(errors) || busy) return;
    setBusy(true);
    setError('');
    try {
      await updateApprovedContactInfo(b, {
        email: form.email.trim().toLowerCase(),
        altPhone: digitsOnly(form.altPhone),
        address: { line1: normalizeSpaces(form.line1), line2: normalizeSpaces(form.line2), city: normalizeSpaces(form.city), state: form.state, pincode: form.pincode.trim() },
      });
      setEditing(false);
      setSaved(true);
    } catch (e) {
      setError(describeDataError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      {saved ? <Notice tone="success" message="Contact details updated." /> : null}
      <Card>
        <Text style={[type.h3, { marginBottom: space.sm }]}>Business</Text>
        <Row label="Business name" value={profile.companyName} />
        <Row label="Owner" value={profile.contactPerson} />
        <Row label="Registered mobile" value={formatPhone(profile.phone)} />
        <Row label="GSTIN" value={profile.gstin || '—'} />
        <Row label="Fleet size (declared)" value={String(profile.totalFleetSize)} />
        <Row label="Commission rate" value={`${Math.round(profile.commissionRate * 100)}%`} />
        <Text style={[type.tiny, { marginTop: space.sm }]}>Legal names and bank details can only be changed by NESAM support.</Text>
      </Card>
      <Card>
        <Text style={[type.h3, { marginBottom: space.sm }]}>Contact</Text>
        {editing ? (
          <>
            <TextField label="Email" required value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" error={err('email')} />
            <TextField label="Alternate number" prefix="+91" value={form.altPhone} onChangeText={(v) => set('altPhone')(digitsOnly(v).slice(0, 10))} keyboardType="phone-pad" error={err('altPhone')} />
            <TextField label="Address line 1" required value={form.line1} onChangeText={set('line1')} error={err('line1')} />
            <TextField label="Address line 2" value={form.line2} onChangeText={set('line2')} />
            <TextField label="City" required value={form.city} onChangeText={set('city')} error={err('city')} />
            <SelectField label="State / UT" required value={form.state} onChange={set('state')} options={INDIAN_STATES.map((s) => ({ value: s, label: s }))} error={err('state')} />
            <TextField label="PIN code" required value={form.pincode} onChangeText={(v) => set('pincode')(digitsOnly(v).slice(0, 6))} keyboardType="number-pad" error={err('pincode')} />
            <Notice message={error} />
            <Button title={busy ? 'Saving…' : 'Save'} loading={busy} onPress={() => void save()} />
            <Button title="Cancel" variant="ghost" disabled={busy} onPress={() => setEditing(false)} style={{ marginTop: space.sm }} />
          </>
        ) : (
          <>
            <Row label="Email" value={b?.email || '—'} />
            <Row label="Alternate number" value={b?.altPhone ? `+91 ${b.altPhone}` : '—'} />
            <Row label="Address" value={b ? [b.address.line1, b.address.line2, b.address.city, `${b.address.state} ${b.address.pincode}`].filter(Boolean).join(', ') : '—'} />
            <Button
              title="Edit contact details"
              variant="secondary"
              onPress={() => {
                setSaved(false);
                setEditing(true);
              }}
              style={{ marginTop: space.md }}
            />
          </>
        )}
      </Card>
    </Screen>
  );
}
