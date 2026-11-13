// One page of the driver's profile, opened from the My Profile menu: personal & vehicle details, contact & payout account,
// document verification, licence & ID or penalties.
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Text } from '../components/nx/Text';
import { useDriverData } from '../context/DriverData';
import type { ProfileSection, RootStackParamList } from '../navigation/types';
import { NxScreen } from '../components/nx/Shell';
import { NxDialog } from '../components/nx/Dialog';
import { PenaltiesPanel } from '../components/nx/Penalties';
import { NxIcon } from '../components/nx/Icon';
import { NxBadge, NxButton, NxCardHeading, NxField, NxFormError, NxInfo, NxPanel, NxRow, NxTextButton, isHovered, type NxTone } from '../components/nx/primitives';
import { updateDriverContactDetails, type ContactFields } from '../services/driverService';
import { DateField, displayDate } from '../components/forms';
import { IFSC_RE, MOBILE_RE, UPI_RE, localDateISO } from '../validation/kyc';
import { describeError } from '../utils/retry';
import type { DocumentStatus } from '../types/driver';
import { nx } from '../theme/nx';

export const PROFILE_SECTION_TITLES: Record<ProfileSection, string> = {
  details: 'Personal & vehicle',
  contact: 'Contact & payout account',
  documents: 'Document verification',
  licence: 'Licence & ID',
  penalties: 'Penalties',
};

function expiryBadge(date: string): React.ReactNode {
  if (!date) return null;
  const days = Math.floor((new Date(`${date}T23:59:59`).getTime() - Date.now()) / 86400000);
  if (Number.isNaN(days)) return null;
  if (days < 0) return <NxBadge label="Expired" tone="red" />;
  if (days <= 30) return <NxBadge label={`${days}d left`} tone="amber" />;
  return null;
}

const DOC_STATE: Record<DocumentStatus, { label: string; tone: NxTone }> = {
  Approved: { label: 'Verified', tone: 'green' },
  Pending: { label: 'Under review', tone: 'amber' },
  Rejected: { label: 'Re-upload', tone: 'red' },
};

function DocRow({ label, url, expiry, status, last }: { label: string; url: string; expiry?: string; status: DocumentStatus; last?: boolean }) {
  const state = url ? DOC_STATE[status] : { label: 'Not uploaded', tone: 'neutral' as NxTone };
  return (
    <Pressable
      style={(s) => [styles.doc, last && { borderBottomWidth: 0 }, url && isHovered(s) && { backgroundColor: '#FAFBFC' }]}
      disabled={!url}
      onPress={() => void Linking.openURL(url)}
      accessibilityRole={url ? 'button' : undefined}
      accessibilityLabel={`${label}: ${state.label}${url ? '. Open document' : ''}`}
    >
      <NxIcon name="document" size={17} color="#A0A6B0" />
      <Text style={styles.docLabel} numberOfLines={2}>
        {label}
      </Text>
      {expiry ? expiryBadge(expiry) : null}
      <NxBadge label={state.label} tone={state.tone} icon={url && status === 'Approved' ? 'check' : undefined} />
    </Pressable>
  );
}

type Props = NativeStackScreenProps<RootStackParamList, 'ProfileSection'>;

export function ProfileSectionScreen({ route }: Props) {
  const navigation = useNavigation();
  const { account, completedTrips, penalties } = useDriverData();
  const { driver, identity, license, vehicle, bank } = account;
  const fleet = !!driver.vendorId;
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const section = route.params.section;

  const docTone: NxTone = driver.docStatus === 'Approved' ? 'green' : driver.docStatus === 'Rejected' ? 'red' : 'amber';
  const docs: { label: string; url: string; expiry?: string }[] = [
    { label: 'Driving licence (front)', url: license.frontPhotoUrl, expiry: license.expiryDate },
    { label: 'Driving licence (back)', url: license.backPhotoUrl },
    { label: 'Aadhaar (front)', url: identity.aadhaarFrontUrl },
    { label: 'Aadhaar (back)', url: identity.aadhaarBackUrl },
    { label: 'PAN card', url: identity.panPhotoUrl },
    ...(fleet
      ? []
      : [
          { label: 'Registration certificate (RC)', url: vehicle.rcDocUrl },
          { label: 'Vehicle insurance', url: vehicle.insuranceDocUrl, expiry: vehicle.insuranceExpiry },
          { label: 'Vehicle permit', url: vehicle.statePermitDocUrl, expiry: vehicle.permitExpiry },
          { label: 'Fitness certificate (FC)', url: vehicle.fitnessDocUrl, expiry: vehicle.fitnessExpiry },
          { label: 'Vehicle photo · front', url: vehicle.frontPhotoUrl },
          { label: 'Vehicle photo · rear', url: vehicle.rearPhotoUrl },
          { label: 'Vehicle photo · side', url: vehicle.sidePhotoUrl },
          { label: 'Vehicle photo · interior', url: vehicle.interiorPhotoUrl },
        ]),
  ];

  let body: React.ReactNode = null;
  if (section === 'details') {
    body = (
      <NxPanel style={styles.card}>
        <NxRow label="Mobile" value={driver.phone || '—'} />
        <NxRow label="Vehicle" value={[vehicle.make, vehicle.model].filter(Boolean).join(' ') || (fleet ? 'Assigned by fleet' : '—')} />
        <NxRow label="Registration" value={vehicle.vehicleNumber || '—'} />
        <NxRow label="Category" value={`${vehicle.vehicleType || '—'}${vehicle.capacity ? ` · ${vehicle.capacity} seats` : ''}${vehicle.fuelType ? ` · ${vehicle.fuelType}` : ''}`} />
        <NxRow label="Pickup zone" value={driver.city || '—'} />
        <NxRow label="Rating" value={driver.rating != null ? `★ ${driver.rating.toFixed(1)}` : 'No ratings yet'} />
        <NxRow label="Completed trips" value={String(completedTrips.length)} last={!driver.joiningDate} />
        {driver.joiningDate ? <NxRow label="Partner since" value={driver.joiningDate} last /> : null}
      </NxPanel>
    );
  } else if (section === 'contact') {
    body = (
      <NxPanel style={styles.card}>
        <NxCardHeading title="Contact & payout account" caption="Used for settlements and emergencies" right={<NxTextButton title="Edit" icon="edit" onPress={() => setEditing(true)} />} />
        <NxRow label="Email" value={driver.email || '—'} />
        <NxRow label="Date of birth" value={displayDate(driver.dob) || '—'} />
        <NxRow label="Address" value={[driver.address, driver.city, driver.pincode].filter(Boolean).join(', ') || '—'} />
        <NxRow label="Emergency contact" value={driver.emergencyContact ? `${driver.emergencyContactName} (${driver.emergencyContact})` : '—'} />
        <NxRow label="Account holder" value={bank.accountHolder || '—'} />
        <NxRow label="Account no." value={bank.accountNumber ? `••••${bank.accountNumber.slice(-4)}` : '—'} />
        <NxRow label="IFSC" value={bank.ifsc || '—'} />
        <NxRow label="UPI" value={bank.upiId || '—'} last />
      </NxPanel>
    );
  } else if (section === 'documents') {
    body = (
      <NxPanel style={styles.card}>
        <NxCardHeading
          title="Document verification"
          caption={driver.docStatus === 'Approved' ? 'All documents approved by NESAM' : driver.docStatus === 'Rejected' ? 'Some documents need to be uploaded again' : 'NESAM is reviewing your documents'}
          right={<NxBadge label={driver.docStatus === 'Approved' ? 'All approved' : driver.docStatus === 'Rejected' ? 'Action needed' : 'Under review'} tone={docTone} />}
        />
        {driver.docStatus === 'Rejected' && driver.rejectionReason ? <NxInfo tone="red" style={{ marginTop: 0, marginBottom: 8 }}>Note from NESAM: {driver.rejectionReason}</NxInfo> : null}
        {docs.map((d, i) => (
          <DocRow key={d.label} label={d.label} url={d.url} expiry={d.expiry} status={driver.docStatus} last={i === docs.length - 1} />
        ))}
        <NxButton title="Update documents" trailingIcon="arrow" variant={driver.docStatus === 'Rejected' ? 'primary' : 'secondary'} onPress={() => navigation.navigate('UpdateDocuments')} style={{ marginTop: 16 }} />
        <NxInfo>Updated documents are re-verified by NESAM. You can keep taking trips meanwhile.</NxInfo>
      </NxPanel>
    );
  } else if (section === 'licence') {
    body = (
      <NxPanel style={styles.card}>
        <NxCardHeading title="Licence & ID" caption="Kept private between you and NESAM" right={<NxIcon name="shield" size={20} color={nx.ink} />} />
        <NxRow label="Licence no." value={license.number || '—'} />
        <NxRow label="Licence valid till" value={displayDate(license.expiryDate) || '—'} />
        <NxRow label="Aadhaar" value={identity.aadhaarNumber ? `XXXX XXXX ${identity.aadhaarNumber.slice(-4)}` : '—'} />
        <NxRow label="PAN" value={identity.panNumber || '—'} last />
      </NxPanel>
    );
  } else if (section === 'penalties') {
    body = <PenaltiesPanel penalties={penalties} />;
  }

  return (
    <NxScreen title={PROFILE_SECTION_TITLES[section]} maxWidth={760}>
      {saved ? (
        <NxInfo tone="green" icon="check" style={{ marginTop: 0, marginBottom: 16 }}>
          Profile updated.
        </NxInfo>
      ) : null}
      {body}
      {editing ? (
        <ContactDialog
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setSaved(true);
          }}
        />
      ) : null}
    </NxScreen>
  );
}

/** A real calendar date in YYYY-MM-DD form (rejects 2001-02-30). */
function isRealDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

function ContactDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { account } = useDriverData();
  const { driver, bank } = account;
  const [form, setForm] = useState<ContactFields>({
    email: driver.email,
    dob: driver.dob,
    address: driver.address,
    city: driver.city,
    pincode: driver.pincode,
    emergencyContactName: driver.emergencyContactName,
    emergencyContact: driver.emergencyContact,
    bank: { ...bank },
  });
  const [confirm, setConfirm] = useState(bank.accountNumber);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<ContactFields>) => setForm((f) => ({ ...f, ...patch }));
  const setBank = (patch: Partial<ContactFields['bank']>) => setForm((f) => ({ ...f, bank: { ...f.bank, ...patch } }));

  const save = async () => {
    if (form.email && !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(form.email.trim())) return setError('Invalid email.');
    // A previously saved value is kept as it is; a newly picked date must be a real, non-future date.
    if (form.dob && form.dob !== driver.dob && (!isRealDate(form.dob) || form.dob > localDateISO())) return setError('Enter a valid date of birth (not in the future).');
    if (!form.address.trim() || !form.city.trim()) return setError('Enter your address and city.');
    if (!/^[1-9]\d{5}$/.test(form.pincode)) return setError('Enter a 6-digit pincode.');
    if (!form.emergencyContactName.trim()) return setError('Enter the emergency contact name.');
    if (!MOBILE_RE.test(form.emergencyContact)) return setError('Enter a valid emergency contact number.');
    if (!form.bank.accountHolder.trim()) return setError('Enter the account holder name.');
    if (!/^\d{9,18}$/.test(form.bank.accountNumber)) return setError('Enter a valid bank account number.');
    if (confirm !== form.bank.accountNumber) return setError('Account numbers do not match.');
    if (!IFSC_RE.test(form.bank.ifsc.toUpperCase())) return setError('Invalid IFSC code.');
    if (form.bank.upiId && !UPI_RE.test(form.bank.upiId)) return setError('Invalid UPI ID.');
    setSaving(true);
    setError('');
    try {
      await updateDriverContactDetails(driver.id, {
        ...form,
        email: form.email.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        emergencyContactName: form.emergencyContactName.trim(),
        bank: { ...form.bank, ifsc: form.bank.ifsc.toUpperCase(), accountHolder: form.bank.accountHolder.trim() },
      });
      onSaved();
    } catch (e) {
      setError(describeError(e, 'Could not save your changes.'));
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  return (
    <NxDialog
      visible
      onClose={onClose}
      eyebrow="My profile"
      title="Edit contact & payout account"
      locked={saving}
      footer={<NxButton title={saving ? 'Saving…' : 'Save changes'} trailingIcon="check" loading={saving} onPress={() => void save()} />}
    >
      <NxField label="Email" value={form.email} onChangeText={(t) => set({ email: t })} keyboardType="email-address" autoCapitalize="none" style={{ marginTop: 0 }} />
      <View style={{ marginTop: 16 }}>
        <DateField label="Date of birth" value={form.dob} onChange={(d) => set({ dob: d })} maximumDate={new Date()} />
      </View>
      <NxField label="Address" value={form.address} onChangeText={(t) => set({ address: t })} multiline />
      <NxField label="City" value={form.city} onChangeText={(t) => set({ city: t })} />
      <NxField label="Pincode" value={form.pincode} onChangeText={(t) => set({ pincode: t.replace(/\D/g, '').slice(0, 6) })} keyboardType="number-pad" />
      <NxField label="Emergency contact name" value={form.emergencyContactName} onChangeText={(t) => set({ emergencyContactName: t })} />
      <NxField label="Emergency mobile" value={form.emergencyContact} onChangeText={(t) => set({ emergencyContact: t.replace(/\D/g, '').slice(0, 10) })} keyboardType="phone-pad" />
      <Text style={styles.dialogSection}>Bank account</Text>
      <NxField label="Account holder" value={form.bank.accountHolder} onChangeText={(t) => setBank({ accountHolder: t })} />
      <NxField label="Account number" value={form.bank.accountNumber} onChangeText={(t) => setBank({ accountNumber: t.replace(/\D/g, '').slice(0, 18) })} keyboardType="number-pad" secureTextEntry />
      <NxField label="Confirm account number" value={confirm} onChangeText={(t) => setConfirm(t.replace(/\D/g, '').slice(0, 18))} keyboardType="number-pad" contextMenuHidden />
      <NxField label="IFSC" value={form.bank.ifsc} onChangeText={(t) => setBank({ ifsc: t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11) })} autoCapitalize="characters" />
      <NxField label="Bank name" value={form.bank.bankName} onChangeText={(t) => setBank({ bankName: t })} />
      <NxField label="UPI ID" value={form.bank.upiId} onChangeText={(t) => setBank({ upiId: t.trim() })} autoCapitalize="none" />
      <NxFormError message={error} />
    </NxDialog>
  );
}

const styles = StyleSheet.create({
  card: { padding: 23 },
  doc: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 50, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  docLabel: { flex: 1, fontSize: 12.5, color: nx.ink },
  dialogSection: { fontSize: 14, fontWeight: '700', color: nx.ink, marginTop: 24 },
});
