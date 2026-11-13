// The two profile edit forms, used inside the side drawer (opened in place under the row that was tapped), as on the
// website's profile drawer. Each saves one thing and then calls onDone.
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useCustomerData } from '../context/CustomerData';
import { Button, Notice, TextField } from './ui';
import { Icon } from './Icon';
import { updateCustomerProfile } from '../services/userService';
import { formatPhone, isValidEmail, isValidIndianMobile, isValidName, localMobile } from '../utils/format';
import { describeError } from '../utils/retry';
import { colors, fonts } from '../theme';

interface FormProps {
  /** Called after a successful save or removal. */
  onDone: () => void;
  /** Called by Cancel. */
  onCancel: () => void;
}

/** Name and email. The sign-in number is shown but cannot be changed here. */
export function PersonalDetailsForm({ onDone, onCancel }: FormProps) {
  const { profile } = useCustomerData();
  const [name, setName] = useState(profile.name || '');
  const [email, setEmail] = useState(profile.email || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);

  const dirty = name.trim() !== profile.name || email.trim().toLowerCase() !== profile.email;
  const errors = {
    name: !isValidName(name) ? 'Enter your full name (letters and spaces, 2–60 characters).' : '',
    email: email.trim() && !isValidEmail(email) ? 'Enter a valid email address, or leave it blank.' : '',
  };

  const save = async () => {
    setTouched(true);
    if (errors.name || errors.email || busy) return;
    setBusy(true);
    setError('');
    try {
      await updateCustomerProfile(profile.uid, { name, email: email.toLowerCase() });
      onDone();
    } catch (e) {
      setError(describeError(e, 'We couldn’t save your changes.'));
      setBusy(false);
    }
  };

  return (
    <View style={styles.form}>
      <View style={styles.locked}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.lockedLabel}>Mobile number</Text>
          <Text style={styles.lockedValue}>{formatPhone(profile.phone)}</Text>
        </View>
        <Icon name="lock-keyhole" size={16} color={colors.faint} />
      </View>
      <TextField label="Full name" value={name} onChangeText={setName} autoComplete="name" error={touched ? errors.name : ''} style={styles.field} />
      <TextField
        label="Email (optional)"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        placeholder="you@example.com"
        hint="Booking confirmations and receipts are sent here."
        error={touched ? errors.email : ''}
        style={styles.field}
      />
      <Notice message={error} />
      <Button title="Save" loading={busy} disabled={!dirty} onPress={() => void save()} />
      <Button title="Cancel" variant="ghost" disabled={busy} onPress={onCancel} />
    </View>
  );
}

/** One number we can call if something goes wrong on a trip. */
export function EmergencyContactForm({ onDone, onCancel }: FormProps) {
  const { profile } = useCustomerData();
  const current = localMobile(profile.emergencyContact);
  const [number, setNumber] = useState(current);
  const [busy, setBusy] = useState<'' | 'save' | 'remove'>('');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);

  const invalid = !isValidIndianMobile(number)
    ? 'Enter a 10-digit mobile number.'
    : number === localMobile(profile.phone)
      ? 'Use someone else’s number, not your own.'
      : '';

  const run = async (kind: 'save' | 'remove') => {
    setTouched(true);
    if (busy || (kind === 'save' && invalid)) return;
    setBusy(kind);
    setError('');
    try {
      await updateCustomerProfile(profile.uid, { emergencyContact: kind === 'save' ? `+91 ${number}` : '' });
      onDone();
    } catch (e) {
      setError(describeError(e, 'We couldn’t update the number. Please try again.'));
      setBusy('');
    }
  };

  return (
    <View style={styles.form}>
      <View style={styles.lead}>
        <Icon name="triangle-alert" size={18} color={colors.danger} />
        <Text style={styles.leadText}>Someone we can call if something goes wrong on a trip.</Text>
      </View>
      <TextField
        label="Mobile number"
        prefix="+91"
        value={number}
        onChangeText={(v) => setNumber(v.replace(/\D/g, '').slice(0, 10))}
        keyboardType="phone-pad"
        maxLength={10}
        placeholder="10-digit number"
        error={touched ? invalid : ''}
        style={styles.field}
      />
      <Notice message={error} />
      <Button title="Save" loading={busy === 'save'} disabled={!!busy || number === current} onPress={() => void run('save')} />
      {current ? <Button title="Remove contact" variant="secondary" loading={busy === 'remove'} disabled={!!busy} onPress={() => void run('remove')} /> : null}
      <Button title="Cancel" variant="ghost" disabled={!!busy} onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 10, padding: 14 },
  field: { marginBottom: 0 },
  locked: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  lockedLabel: { fontFamily: fonts.medium, fontSize: 11.5, color: colors.muted },
  lockedValue: { fontFamily: fonts.semiBold, fontSize: 14.5, color: colors.ink },
  lead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  leadText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.muted },
});
