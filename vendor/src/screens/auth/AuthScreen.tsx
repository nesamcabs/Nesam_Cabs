// Welcome → mobile number → OTP (Firebase phone auth, same flow as the Driver and Customer apps), in the NESAM Driver
// sign-in design: brand panel on wide screens, choice tiles, +91 field and a single large OTP box.
import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ConfirmationResult } from 'firebase/auth';
import { AUTH, AuthCard, AuthFrame } from '../../components/shell/AuthFrame';
import { Btn, Feedback, Notice, type IconName } from '../../components/kit/core';
import { useRecaptchaVerifier } from '../../components/RecaptchaVerifier';
import { confirmOtpCode, describePhoneAuthError, sendOtpToPhone } from '../../services/authService';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { formatPhone, isValidIndianMobile } from '../../utils/format';
import { colors, fontFamily } from '../../theme';
import { setAuthIntent, type AuthIntent } from './authIntent';

const RESEND_COOLDOWN_S = 30;

function Choice({ icon, title, text, onPress, primary }: { icon: IconName; title: string; text: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${text}`}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.choice,
        primary && styles.choicePrimary,
        hovered && { borderColor: primary ? colors.primaryDark : '#D4D7DE' },
        hovered && primary && { backgroundColor: colors.primaryDark },
        pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
      ]}
    >
      <View style={[styles.choiceIcon, primary && { backgroundColor: 'rgba(255,255,255,0.16)' }]}>
        <Ionicons name={icon} size={20} color={primary ? colors.white : colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.choiceTitle, primary && { color: colors.white }]}>{title}</Text>
        <Text style={[styles.choiceText, primary && { color: 'rgba(255,255,255,0.82)' }]}>{text}</Text>
      </View>
      <Ionicons name="arrow-forward" size={18} color={primary ? colors.white : AUTH.muted} />
    </Pressable>
  );
}

function LinkButton({ title, icon, onPress, muted, disabled }: { title: string; icon?: IconName; onPress: () => void; muted?: boolean; disabled?: boolean }) {
  const color = muted ? AUTH.muted : colors.primary;
  return (
    <Pressable onPress={disabled ? undefined : onPress} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} hitSlop={8}
      style={({ pressed }) => [styles.link, (pressed || disabled) && { opacity: 0.6 }]}>
      {icon ? <Ionicons name={icon} size={15} color={color} /> : null}
      <Text style={[styles.linkText, { color }]}>{title}</Text>
    </Pressable>
  );
}

export function AuthScreen() {
  const [step, setStep] = useState<'welcome' | 'phone' | 'otp'>('welcome');
  const [intent, setIntent] = useState<AuthIntent>('login');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [focused, setFocused] = useState(false);
  const otpRef = useRef<TextInput>(null);
  const verifier = useRecaptchaVerifier();
  const { online } = useNetworkStatus();

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Android back steps backwards through the flow instead of leaving the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 'otp' && !verifying) { setStep('phone'); setOtp(''); setError(''); return true; }
      if (step === 'phone' && !sending) { setStep('welcome'); setError(''); return true; }
      return false;
    });
    return () => sub.remove();
  }, [step, verifying, sending]);

  const start = (i: AuthIntent) => {
    setIntent(i);
    setAuthIntent(i);
    setError('');
    setStep('phone');
  };

  const sendOtp = async () => {
    if (!isValidIndianMobile(mobile)) return setError('Enter a valid 10-digit Indian mobile number.');
    if (!online) return setError('You’re offline. Connect to the internet to receive your OTP.');
    if (sending) return undefined;
    setError('');
    setSending(true);
    try {
      const result = await sendOtpToPhone(`+91${mobile}`, verifier);
      setConfirmation(result);
      setOtp('');
      setStep('otp');
      setCooldown(RESEND_COOLDOWN_S);
      setTimeout(() => otpRef.current?.focus(), 250);
    } catch (e) {
      setError(describePhoneAuthError(e));
    } finally {
      setSending(false);
    }
    return undefined;
  };

  const verify = async (code: string) => {
    if (code.length !== 6) return setError('Enter the 6-digit OTP.');
    if (!confirmation) return setError('Your OTP session expired. Please request a new code.');
    if (verifying) return undefined;
    setError('');
    setVerifying(true);
    try {
      await confirmOtpCode(confirmation, code);
      // onAuthStateChanged in App.tsx takes over from here.
    } catch (e) {
      setError(describePhoneAuthError(e));
      setOtp('');
      setVerifying(false);
      otpRef.current?.focus();
    }
    return undefined;
  };

  if (step === 'welcome') {
    return (
      <AuthFrame>
        <AuthCard eyebrow="NESAM Fleet Partner" title="Welcome, partner." subtitle="Sign in to manage your duties, drivers, vehicles and earnings.">
          <View style={{ gap: 12, marginTop: 20 }}>
            <Choice icon="person-outline" title="Login" text="I’m a registered NESAM fleet partner" onPress={() => start('login')} primary />
            <Choice icon="add" title="Sign up as a fleet partner" text="Onboard your travel agency or fleet" onPress={() => start('signup')} />
          </View>
          {!online ? <Notice tone="amber" icon="cloud-offline-outline" title="You’re offline" text="Connect to the internet to sign in." style={{ marginTop: 16 }} /> : null}
          <Text style={styles.terms}>By continuing you agree to NESAM’s Terms & Conditions and Privacy Policy.</Text>
        </AuthCard>
      </AuthFrame>
    );
  }

  if (step === 'phone') {
    return (
      <AuthFrame>
        <AuthCard
          eyebrow={intent === 'signup' ? 'New fleet partner' : 'Partner sign-in'}
          title={intent === 'signup' ? 'Create your account' : 'Sign in with your mobile'}
          subtitle={intent === 'signup' ? 'This number becomes your fleet partner login. NESAM uses it for duty and settlement updates.' : 'We’ll send a 6-digit OTP to your registered number.'}
        >
          <Text style={styles.label}>{intent === 'signup' ? 'Mobile number' : 'Registered mobile number'}</Text>
          <View style={[styles.phoneField, focused && styles.fieldFocus, !!error && { borderColor: colors.primary }]}>
            <Text style={styles.prefix}>+91</Text>
            <View style={styles.prefixRule} />
            <TextInput
              value={mobile}
              onChangeText={(v) => { setMobile(v.replace(/\D/g, '').slice(0, 10)); setError(''); }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              keyboardType="phone-pad"
              autoComplete="tel-national"
              textContentType="telephoneNumber"
              maxLength={10}
              placeholder="98765 43210"
              placeholderTextColor="#A2A8B2"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void sendOtp()}
              style={styles.phoneInput}
              accessibilityLabel="Mobile number"
            />
          </View>
          <Feedback tone="error" message={error} />
          <Btn title={sending ? 'Sending OTP…' : 'Send OTP'} iconRight="arrow-forward" busy={sending} disabled={mobile.length !== 10 || !online} full onPress={() => void sendOtp()} style={styles.cta} />
          <View style={styles.linkRow}>
            <LinkButton title="Back" icon="arrow-back" muted disabled={sending} onPress={() => setStep('welcome')} />
          </View>
        </AuthCard>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <AuthCard
        eyebrow="Verify your number"
        title="Enter the OTP"
        subtitle={<>Sent to <Text style={{ fontWeight: '700', color: AUTH.ink }}>+91 {formatPhone(mobile)}</Text></>}
      >
        <TextInput
          ref={otpRef}
          value={otp}
          onChangeText={(v) => {
            const digits = v.replace(/\D/g, '').slice(0, 6);
            setOtp(digits);
            setError('');
            if (digits.length === 6) void verify(digits);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          maxLength={6}
          editable={!verifying}
          placeholder="••••••"
          placeholderTextColor="#B4BAC4"
          style={[styles.otp, focused && styles.fieldFocus, !!error && { borderColor: colors.primary }]}
          accessibilityLabel="6-digit OTP"
        />
        <Feedback tone="error" message={error} />
        <Btn title={verifying ? 'Verifying…' : 'Verify & Continue'} iconRight="arrow-forward" busy={verifying} disabled={otp.length !== 6} full onPress={() => void verify(otp)} style={styles.cta} />
        <View style={[styles.linkRow, { justifyContent: 'space-between' }]}>
          {cooldown > 0
            ? <Text style={styles.cooldown}>Resend code in {cooldown}s</Text>
            : <LinkButton title={sending ? 'Resending…' : 'Resend code'} icon="refresh" disabled={sending} onPress={() => void sendOtp()} />}
          <LinkButton title="Change number" muted onPress={() => { if (verifying) return; setStep('phone'); setOtp(''); setError(''); }} />
        </View>
      </AuthCard>
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 74, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: AUTH.line, backgroundColor: colors.white },
  choicePrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  choiceTitle: { fontFamily, fontSize: 14.5, fontWeight: '700', color: AUTH.ink },
  choiceText: { fontFamily, fontSize: 12, color: AUTH.muted, marginTop: 2 },
  terms: { fontFamily, fontSize: 11, lineHeight: 17, color: AUTH.muted, textAlign: 'center', marginTop: 20 },
  label: { fontFamily, fontSize: 12, fontWeight: '600', color: AUTH.ink, marginTop: 20 },
  phoneField: { flexDirection: 'row', alignItems: 'center', minHeight: 54, marginTop: 8, marginBottom: 4, borderWidth: 1, borderColor: AUTH.fieldLine, borderRadius: 12, backgroundColor: colors.white, paddingHorizontal: 14 },
  fieldFocus: { borderColor: '#B9C3D1', shadowColor: colors.primary, shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  prefix: { fontFamily, fontSize: 16, fontWeight: '700', color: colors.primary },
  prefixRule: { width: 1, height: 24, backgroundColor: AUTH.line, marginHorizontal: 12 },
  phoneInput: { flex: 1, minWidth: 0, fontFamily, fontSize: 17, letterSpacing: 0.6, color: AUTH.ink, paddingVertical: 12 },
  cta: { marginTop: 14, minHeight: 50, borderRadius: 12 },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32 },
  linkText: { fontFamily, fontSize: 13, fontWeight: '600' },
  otp: { minHeight: 69, marginTop: 20, marginBottom: 4, borderWidth: 1, borderColor: AUTH.fieldLine, borderRadius: 12, textAlign: 'center', fontFamily, fontSize: 30, fontWeight: '700', letterSpacing: 12, color: AUTH.ink, paddingVertical: 12, backgroundColor: colors.white },
  cooldown: { fontFamily, fontSize: 12, color: AUTH.muted },
});
