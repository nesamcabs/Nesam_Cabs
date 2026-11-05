// Welcome → mobile number → OTP, in the reference's page style. Real Firebase phone
// authentication; nothing here simulates a login or an OTP.
import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ConfirmationResult } from 'firebase/auth';
import { Button, LinkText, Notice, Screen, TextField } from '../../components/ui';
import { AppHeader } from '../../components/brand';
import { Icon } from '../../components/Icon';
import { useRecaptchaVerifier } from '../../components/RecaptchaVerifier';
import { confirmOtpCode, describePhoneAuthError, sendOtpToPhone } from '../../services/authService';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { formatPhone, isValidIndianMobile } from '../../utils/format';
import { colors, fonts, space } from '../../theme';
import { setAuthIntent, type AuthIntent } from './authIntent';

const RESEND_COOLDOWN_S = 30;

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
      if (step === 'otp' && !verifying) {
        setStep('phone');
        setOtp('');
        setError('');
        return true;
      }
      if (step === 'phone' && !sending) {
        setStep('welcome');
        setError('');
        return true;
      }
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

  const frame = (title: string, subtitle: string, body: React.ReactNode) => (
    <Screen bg={colors.white} header={<AppHeader actions={false} />} kind="narrow">
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      <View style={styles.card}>{body}</View>
    </Screen>
  );

  if (step === 'welcome') {
    return frame(
      'Welcome to NESAM',
      'Cabs & car rentals for outstation, airport and local journeys.',
      <>
        <Button title="Sign in with mobile" iconRight="arrow-right" onPress={() => start('login')} />
        <Text style={styles.helper}>I already have a NESAM account</Text>
        <Button title="Create new account" variant="secondary" onPress={() => start('signup')} style={{ marginTop: space.xl }} />
        <Text style={styles.helper}>New to NESAM</Text>
        <View style={styles.trust}>
          <Icon name="shield-check" size={13} color="#8994A4" />
          <Text style={styles.trustText}>Clear fares. Dedicated support.</Text>
        </View>
      </>,
    );
  }

  if (step === 'phone') {
    return frame(
      intent === 'signup' ? 'Create your account' : 'Sign in',
      intent === 'signup' ? 'Your mobile number becomes your sign-in and trip contact.' : 'Enter your registered mobile number.',
      <>
        <TextField
          label={intent === 'signup' ? 'Mobile number' : 'Registered mobile number'}
          prefix="+91"
          value={mobile}
          onChangeText={(v) => {
            setMobile(v.replace(/\D/g, '').slice(0, 10));
            setError('');
          }}
          keyboardType="phone-pad"
          autoComplete="tel-national"
          textContentType="telephoneNumber"
          maxLength={10}
          placeholder="98765 43210"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => void sendOtp()}
        />
        <Notice message={error} />
        <Button title="Send OTP" iconRight="arrow-right" loading={sending} disabled={mobile.length !== 10 || !online} onPress={() => void sendOtp()} />
        {!online ? <Text style={styles.offline}>You’re offline. Connect to the internet to receive your OTP.</Text> : null}
        <View style={styles.backRow}>
          <LinkText onPress={() => !sending && setStep('welcome')}>← Back</LinkText>
        </View>
      </>,
    );
  }

  return frame(
    'Verify your number',
    `Enter the 6-digit OTP sent to ${formatPhone(mobile)}.`,
    <>
      <TextInput
        ref={otpRef}
        value={otp}
        onChangeText={(v) => {
          const digits = v.replace(/\D/g, '').slice(0, 6);
          setOtp(digits);
          setError('');
          if (digits.length === 6) void verify(digits);
        }}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={6}
        editable={!verifying}
        placeholder="••••••"
        placeholderTextColor={colors.faint}
        style={[styles.otp, !!error && { borderColor: colors.primary }]}
        accessibilityLabel="6-digit OTP"
      />
      <Notice message={error} />
      <Button title="Verify & continue" loading={verifying} disabled={otp.length !== 6} onPress={() => void verify(otp)} />
      <View style={styles.resendRow}>
        {cooldown > 0 ? (
          <Text style={styles.cool}>Resend code in {cooldown}s</Text>
        ) : (
          <LinkText onPress={() => void sendOtp()}>{sending ? 'Resending…' : 'Resend code'}</LinkText>
        )}
        <LinkText
          onPress={() => {
            if (verifying) return;
            setStep('phone');
            setOtp('');
            setError('');
          }}
        >
          Change number
        </LinkText>
      </View>
    </>,
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.semiBold, fontSize: 23, lineHeight: 30, letterSpacing: -0.6, color: colors.ink, textAlign: 'center', marginTop: space.xl },
  subtitle: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 19, color: '#6D7785', textAlign: 'center', marginTop: 8, marginBottom: space.xl, paddingHorizontal: space.lg },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 18, backgroundColor: colors.white },
  helper: { fontFamily: fonts.regular, fontSize: 11.5, color: '#6D7785', textAlign: 'center', marginTop: 8 },
  trust: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: space.xl },
  trustText: { fontFamily: fonts.regular, fontSize: 9.5, color: '#7F8998' },
  offline: { fontFamily: fonts.regular, fontSize: 11.5, color: '#6D7785', textAlign: 'center', marginTop: 10 },
  backRow: { marginTop: space.lg, alignItems: 'center' },
  cool: { fontFamily: fonts.regular, fontSize: 12, color: '#6D7785' },
  otp: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    fontFamily: fonts.semiBold,
    fontSize: 28,
    letterSpacing: 10,
    textAlign: 'center',
    paddingVertical: 12,
    color: colors.ink,
    backgroundColor: colors.white,
    marginBottom: space.lg,
  },
  resendRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.lg },
});
