// Sign-up for a new fleet partner: the verified mobile number plus the vehicle's registration number.
// Submitting creates the application already submitted for NESAM's review; the vendors/{uid}
// listener in App.tsx then shows the "under review" screen.
import React, { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../../components/KeyboardAvoid';
import { Ionicons } from '@expo/vector-icons';
import { registerVendorWithVehicle } from '../../services/onboardingService';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../../config/constants';
import { displayPlate, isPlate, normalizePlate } from '../../utils/fleet';
import { describeDataError } from '../../utils/retry';
import { Button, Card, Notice, TextField } from '../../components/ui';
import { colors, radius, space, type } from '../../theme';

export function RegistrationGate({ phone, onSignOut }: { phone: string; onSignOut: () => void }) {
  const [plate, setPlate] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const invalid = !isPlate(plate);
  const fieldError = touched && invalid ? 'Enter the registration number as printed on the plate, e.g. TN 01 AB 1234.' : '';

  const register = async () => {
    setTouched(true);
    if (invalid || busy) return;
    setBusy(true);
    setError('');
    try {
      await registerVendorWithVehicle(phone, plate);
      // vendors/{uid} listener in App.tsx fires and routes to the account status screen.
    } catch (e) {
      setError(describeDataError(e));
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <KeyboardAvoid>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Ionicons name="car" size={40} color={colors.white} />
            </View>
            <Text style={[type.h1, styles.heroTitle]}>Become a NESAM fleet partner</Text>
            <Text style={[type.body, styles.heroSub]}>Sign up with your vehicle number. That is all we need to start your application.</Text>
          </View>

          <Card style={styles.stepsCard}>
            <TextField
              label="Vehicle registration number"
              required
              value={plate}
              onChangeText={(t) => setPlate(t.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="TN 01 AB 1234"
              error={fieldError}
              hint="As printed on the number plate."
              returnKeyType="done"
              onSubmitEditing={() => void register()}
              style={{ marginBottom: 0 }}
            />
          </Card>

          <View style={styles.noteBox}>
            <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
            <Text style={[type.small, { flex: 1, color: colors.ink }]}>
              NESAM reviews your application and verifies the vehicle before bookings, drivers, vehicles and wallet become active. We will contact you on {phone} if anything else is needed.
            </Text>
          </View>

          <View style={styles.phoneRow}>
            <Ionicons name="phone-portrait-outline" size={14} color={colors.muted} />
            <Text style={[type.tiny, { color: colors.muted }]}>
              Registering as <Text style={{ fontWeight: '700', color: colors.ink }}>{phone}</Text>
              {!invalid ? <Text> · Vehicle <Text style={{ fontWeight: '700', color: colors.ink }}>{displayPlate(normalizePlate(plate))}</Text></Text> : null}
            </Text>
          </View>

          {error ? <Notice message={error} style={{ marginBottom: space.md }} onRetry={() => void register()} /> : null}

          <Button title={busy ? 'Submitting…' : 'Register vehicle'} loading={busy} onPress={() => void register()} style={styles.cta} />

          <View style={styles.footer}>
            <Button title={`Need help? Call ${SUPPORT_PHONE_DISPLAY}`} variant="secondary" onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} />
            <Button title="Sign out" variant="ghost" onPress={onSignOut} style={{ marginTop: space.sm }} />
          </View>
        </ScrollView>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: space.xxl },
  hero: { alignItems: 'center', marginVertical: space.lg },
  heroIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    marginBottom: space.md,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  heroTitle: { textAlign: 'center', marginBottom: space.xs },
  heroSub: { textAlign: 'center', color: colors.muted, paddingHorizontal: space.md },
  stepsCard: { padding: space.md, marginBottom: space.md },
  noteBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.sm,
    backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primaryBorder,
    borderRadius: radius.md, padding: space.md, marginBottom: space.md,
  },
  phoneRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    justifyContent: 'center', marginBottom: space.md,
  },
  cta: { marginBottom: space.sm },
  footer: { marginTop: space.md },
});
