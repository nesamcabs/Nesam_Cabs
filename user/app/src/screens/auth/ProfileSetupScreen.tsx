import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, LinkText, Notice, Screen, TextField } from '../../components/ui';
import { AppHeader } from '../../components/brand';
import { registerCustomerProfile } from '../../services/userService';
import { signOutUser } from '../../services/authService';
import { formatPhone, isValidEmail, isValidName } from '../../utils/format';
import { describeError } from '../../utils/retry';
import { colors, fonts, space } from '../../theme';
import { getAuthIntent } from './authIntent';

export function ProfileSetupScreen({ phone }: { phone: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const errors = {
    name: !isValidName(name) ? 'Enter your full name (letters and spaces, 2–60 characters).' : '',
    // Optional: only a value that was typed has to be a real address.
    email: email.trim() && !isValidEmail(email) ? 'Enter a valid email address, or leave it blank.' : '',
  };
  const valid = !errors.name && !errors.email;

  const save = async () => {
    setTouched(true);
    if (!valid || saving) return;
    setSaving(true);
    setError('');
    try {
      await registerCustomerProfile({ name, email });
      // The profile listener in App.tsx moves on to the main app.
    } catch (e) {
      setError(describeError(e, 'We couldn’t create your profile. Please try again.'));
      setSaving(false);
    }
  };

  const fieldError = (k: keyof typeof errors) => (touched ? errors[k] : '');

  return (
    <Screen bg={colors.white} header={<AppHeader actions={false} />} kind="narrow">
      <Text style={styles.title} accessibilityRole="header">
        Complete your profile
      </Text>
      <Text style={styles.sub}>
        {getAuthIntent() === 'login' ? 'Set up your profile to continue' : 'Create your passenger profile'} · {formatPhone(phone)}
      </Text>
      <View style={styles.card}>
        <TextField label="Full name" required value={name} onChangeText={setName} autoComplete="name" error={fieldError('name')} placeholder="e.g. Priya Raman" />
        <TextField
          label="Email (optional)"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          error={fieldError('email')}
          placeholder="you@example.com"
          hint="Booking confirmations and receipts are sent here when you add one."
        />
        <Notice message={error} />
        <Button title="Save & start booking" iconRight="arrow-right" loading={saving} onPress={() => void save()} />
        <View style={styles.signOut}>
          <LinkText onPress={() => void signOutUser()}>Not your number? Sign out</LinkText>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.semiBold, fontSize: 23, lineHeight: 30, letterSpacing: -0.6, color: colors.ink, textAlign: 'center', marginTop: space.xl },
  sub: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 19, color: '#6D7785', marginBottom: space.xl, marginTop: 8, textAlign: 'center' },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 18, backgroundColor: colors.white },
  signOut: { alignItems: 'center', marginTop: space.lg },
});
