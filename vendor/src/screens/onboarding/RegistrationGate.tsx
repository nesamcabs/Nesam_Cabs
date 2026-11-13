// Sign-up for a new fleet partner: the verified mobile number plus the vehicle's registration number.
// Submitting creates the application already submitted for NESAM's review; the vendors/{uid}
// listener in App.tsx then shows the "under review" screen.
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../../components/kit/Text';
import { Ionicons } from '@expo/vector-icons';
import { AUTH, AuthCard, AuthFrame } from '../../components/shell/AuthFrame';
import { Btn, Feedback, Notice } from '../../components/kit/core';
import { registerVendorWithVehicle, RoleConflictError } from '../../services/onboardingService';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../../config/constants';
import { displayPlate, isPlate, normalizePlate } from '../../utils/fleet';
import { describeDataError } from '../../utils/retry';
import { colors, fontFamily } from '../../theme';

const STEPS: [string, string][] = [
  ['Register your first vehicle', 'Just the number on the plate.'],
  ['Complete your application', 'Add your business details and upload the required vehicle documents.'],
  ['Submit for NESAM approval', 'After approval, add your drivers and start accepting duties.'],
];

export function RegistrationGate({ phone, onSignOut }: { phone: string; onSignOut: () => void }) {
  const [plate, setPlate] = useState('');
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState('');

  const invalid = !isPlate(plate);
  const fieldError = touched && invalid ? 'Enter the registration number as printed on the plate, e.g. TN 01 AB 1234.' : '';

  const register = async () => {
    setTouched(true);
    if (invalid || busy) return;
    setBusy(true);
    setError('');
    setConflict('');
    try {
      await registerVendorWithVehicle(phone, plate);
      // vendors/{uid} listener in App.tsx fires and routes to the account status screen.
    } catch (e) {
      if (e instanceof RoleConflictError) setConflict(e.message);
      else setError(e instanceof Error && (e as { code?: string }).code === 'failed-precondition' ? e.message : describeDataError(e));
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      <AuthCard eyebrow="New fleet partner" title="Become a NESAM partner" subtitle="Sign up with your vehicle number. That is all we need to start your application.">
        <View style={styles.steps}>
          {STEPS.map(([title, text], i) => (
            <View key={title} style={styles.step}>
              <View style={[styles.stepDot, i === 0 && styles.stepDotOn]}><Text style={[styles.stepNum, i === 0 && { color: colors.white }]}>{i + 1}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>{title}</Text>
                <Text style={styles.stepText}>{text}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.label}>Vehicle registration number</Text>
        <View style={[styles.field, focused && styles.fieldFocus, !!fieldError && { borderColor: colors.primary }]}>
          <Ionicons name="car-sport-outline" size={20} color={colors.primary} />
          <View style={styles.rule} />
          <TextInput
            value={plate}
            onChangeText={(t) => { setPlate(t.toUpperCase().slice(0, 14)); setError(''); }}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); if (plate) setTouched(true); }}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="TN 01 AB 1234"
            placeholderTextColor="#A9AEB8"
            returnKeyType="done"
            onSubmitEditing={() => void register()}
            style={styles.input}
            accessibilityLabel="Vehicle registration number"
          />
          {!invalid ? <Ionicons name="checkmark-circle" size={20} color={colors.success} /> : null}
        </View>
        {fieldError ? <Text style={styles.fieldError}>{fieldError}</Text> : <Text style={styles.hint}>As printed on the number plate.</Text>}

        <View style={styles.who}>
          <Ionicons name="phone-portrait-outline" size={15} color={AUTH.muted} />
          <Text style={styles.whoText}>
            Registering as <Text style={styles.strong}>{phone}</Text>
            {!invalid ? <Text> · Vehicle <Text style={styles.strong}>{displayPlate(normalizePlate(plate))}</Text></Text> : null}
          </Text>
        </View>

        <Feedback tone="error" message={error} />
        {conflict ? (
          <Notice tone="red" icon="person-circle-outline" title="This number already has a NESAM account" text={conflict} style={{ marginBottom: 12 }}
            action={<Btn kind="secondary" small icon="log-out-outline" title="Sign out and use another number" onPress={onSignOut} />} />
        ) : null}
        <Btn title={busy ? 'Creating account…' : 'Continue to application'} iconRight="arrow-forward" busy={busy} full onPress={() => void register()} style={styles.cta} />

        <View style={styles.links}>
          <Pressable onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} accessibilityRole="button" hitSlop={8} style={styles.link}>
            <Ionicons name="call-outline" size={15} color={colors.primary} />
            <Text style={[styles.linkText, { color: colors.primary }]}>Help · {SUPPORT_PHONE_DISPLAY}</Text>
          </Pressable>
          <Pressable onPress={onSignOut} accessibilityRole="button" hitSlop={8} style={styles.link}>
            <Ionicons name="log-out-outline" size={15} color={AUTH.muted} />
            <Text style={[styles.linkText, { color: AUTH.muted }]}>Sign out</Text>
          </Pressable>
        </View>
      </AuthCard>
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  steps: { marginTop: 18, gap: 14, padding: 16, borderRadius: 14, backgroundColor: '#F6F7F9', borderWidth: 1, borderColor: AUTH.line },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: '#E7EAF0', backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  stepDotOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepNum: { fontFamily, fontSize: 12, fontWeight: '700', color: AUTH.muted },
  stepTitle: { fontFamily, fontSize: 13.5, fontWeight: '600', color: AUTH.ink },
  stepText: { fontFamily, fontSize: 12, lineHeight: 18, color: AUTH.muted, marginTop: 2 },
  label: { fontFamily, fontSize: 12, fontWeight: '600', color: AUTH.ink, marginTop: 22 },
  field: { flexDirection: 'row', alignItems: 'center', minHeight: 54, marginTop: 8, borderWidth: 1, borderColor: AUTH.fieldLine, borderRadius: 12, backgroundColor: colors.white, paddingHorizontal: 14 },
  fieldFocus: { borderColor: '#C3C8D0', shadowColor: colors.primary, shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  rule: { width: 1, height: 24, backgroundColor: AUTH.line, marginHorizontal: 12 },
  input: { flex: 1, minWidth: 0, fontFamily, fontSize: 17, letterSpacing: 1, color: AUTH.ink, paddingVertical: 12 },
  hint: { fontFamily, fontSize: 11.5, color: AUTH.muted, marginTop: 6 },
  fieldError: { fontFamily, fontSize: 12, color: colors.primaryDark, marginTop: 6, lineHeight: 18 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 16, marginBottom: 12 },
  whoText: { fontFamily, fontSize: 12, color: AUTH.muted, flex: 1 },
  strong: { fontWeight: '700', color: AUTH.ink },
  cta: { marginTop: 4, minHeight: 50, borderRadius: 12 },
  links: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, flexWrap: 'wrap', gap: 10 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32 },
  linkText: { fontFamily, fontSize: 13, fontWeight: '600' },
});
