import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useCustomerData } from '../context/CustomerData';
import { Button, Chip, Notice, TextField } from '../components/ui';
import { ScrollView } from '../components/layout';
import { AppHeader } from '../components/brand';
import { Icon } from '../components/Icon';
import { updateCustomerProfile } from '../services/userService';
import { formatPhone, isValidEmail, isValidIndianMobile, isValidName, localMobile } from '../utils/format';
import { describeError } from '../utils/retry';
import { colors, fonts, space } from '../theme';

const LANGUAGES = ['English', 'தமிழ் (Tamil)', 'हिन्दी (Hindi)'];

type Props = NativeStackScreenProps<RootStackParamList, 'EditProfile'>;

export function EditProfileScreen({ navigation }: Props) {
  const { profile } = useCustomerData();
  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.email);
  const [emergency, setEmergency] = useState(localMobile(profile.emergencyContact));
  const [language, setLanguage] = useState(profile.language || 'English');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saved = useRef(false);

  const dirty =
    name.trim() !== profile.name ||
    email.trim().toLowerCase() !== profile.email ||
    emergency !== localMobile(profile.emergencyContact) ||
    language !== (profile.language || 'English');

  // Hardware back / header back with unsaved edits asks before discarding.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (!dirty || saved.current) return;
        e.preventDefault();
        Alert.alert('Discard changes?', 'Your edits have not been saved.', [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ]);
      }),
    [navigation, dirty],
  );

  const save = async () => {
    if (!isValidName(name)) return setError('Enter your full name (letters and spaces, 2–60 characters).');
    if (email.trim() && !isValidEmail(email)) return setError('Enter a valid email address, or leave it blank.');
    if (emergency && !isValidIndianMobile(emergency)) return setError('Enter a 10-digit emergency contact number, or leave it blank.');
    if (emergency && emergency === localMobile(profile.phone)) return setError('Emergency contact must differ from your own number.');
    setBusy(true);
    setError('');
    try {
      await updateCustomerProfile(profile.uid, {
        name,
        email: email.toLowerCase(),
        emergencyContact: emergency ? `+91 ${emergency}` : '',
        language,
      });
      saved.current = true;
      navigation.goBack();
    } catch (e) {
      setError(describeError(e, 'Couldn’t save your changes.'));
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
<KeyboardAvoid>
      <AppHeader title="My Profile" onBack={() => navigation.goBack()} />
      <ScrollView kind="narrow" contentContainerStyle={styles.page} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <TextField label="Full name" required value={name} onChangeText={setName} autoComplete="name" />
          <TextField
            label="Mobile number"
            value={formatPhone(profile.phone)}
            editable={false}
            hint="Your sign-in number. To change it, contact NESAM support."
            right={<Icon name="lock-keyhole" size={15} color="#9AA2AE" />}
          />
          <TextField
            label="Email (optional)"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            hint="Used for booking confirmations and receipts."
          />
          <TextField
            label="Emergency contact (optional)"
            prefix="+91"
            value={emergency}
            onChangeText={(v) => setEmergency(v.replace(/\D/g, '').slice(0, 10))}
            keyboardType="phone-pad"
            maxLength={10}
            hint="Receives an alert if SOS is triggered during a trip."
          />
          <Text style={styles.label}>Preferred language</Text>
          <View style={styles.langRow}>
            {LANGUAGES.map((l) => (
              <Chip key={l} label={l} active={language === l} onPress={() => setLanguage(l)} />
            ))}
          </View>
          <Notice message={error} style={{ marginTop: space.lg }} />
          <Button title="Save changes" loading={busy} disabled={!dirty} onPress={() => void save()} style={{ marginTop: space.lg }} />
        </View>
      </ScrollView>
    </KeyboardAvoid>
</SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  page: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xxl },
  card: { borderWidth: 1, borderColor: '#E3E7EC', borderRadius: 13, padding: 18, backgroundColor: colors.white },
  label: { fontFamily: fonts.regular, fontSize: 11.5, color: '#697587', marginBottom: 8 },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
