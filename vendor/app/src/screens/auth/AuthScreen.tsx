// Welcome → mobile number → OTP. Native port of
// vendor/web/src/screens/VendorLoginScreen.tsx (same flow as the Customer app).
import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ConfirmationResult } from 'firebase/auth';
import { Button, Card, LinkText, Notice, Screen, TextField } from '../../components/ui';
import { useRecaptchaVerifier } from '../../components/RecaptchaVerifier';
import { confirmOtpCode, describePhoneAuthError, sendOtpToPhone } from '../../services/authService';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { formatPhone, isValidIndianMobile } from '../../utils/format';
import { colors, space, type } from '../../theme';
import { setAuthIntent, type AuthIntent } from './authIntent';

import logo from '../../../assets/icon.png';

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

  const header = (subtitle: string) => (
    <View style={styles.brand}>
      <Image source={logo} style={styles.logo} accessibilityIgnoresInvertColors />
      <Text style={styles.title}>NESAM Fleet Partner</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );

  if (step === 'welcome') {
    return (
      <Screen>
        {header('Fleet Partner App')}
        <Card>
          <Button title="Login" onPress={() => start('login')} />
          <Text style={styles.helper}>I’m a registered NESAM fleet partner</Text>
          <Button title="Apply as a Fleet Partner" variant="dark" onPress={() => start('signup')} style={{ marginTop: space.lg }} />
          <Text style={styles.helper}>Onboard your travel agency / fleet</Text>
        </Card>
        <Text style={styles.legal}>By continuing you agree to NESAM’s Terms & Conditions and Privacy Policy.</Text>
      </Screen>
    );
  }

  if (step === 'phone') {
    return (
      <Screen>
        {header(intent === 'signup' ? 'Start your fleet partner application' : 'Sign in with your mobile number')}
        <Card>
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
            hint={intent === 'signup' ? 'This number becomes your fleet partner login.' : undefined}
          />
          <Notice message={error} />
          <Button title={sending ? 'Sending OTP…' : 'Send OTP'} loading={sending} disabled={mobile.length !== 10 || !online} onPress={() => void sendOtp()} />
          <View style={styles.backRow}>
            <LinkText onPress={() => !sending && setStep('welcome')}>← Back</LinkText>
          </View>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      {header('Verify your mobile number')}
      <Card>
        <Text style={[type.body, { marginBottom: space.md }]}>
          Enter the 6-digit OTP sent to <Text style={{ fontWeight: '800' }}>{formatPhone(mobile)}</Text>
        </Text>
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
        <Button title={verifying ? 'Verifying…' : 'Verify & Continue'} loading={verifying} disabled={otp.length !== 6} onPress={() => void verify(otp)} />
        <View style={styles.resendRow}>
          {cooldown > 0 ? (
            <Text style={type.small}>Resend code in {cooldown}s</Text>
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
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', marginTop: space.xl, marginBottom: space.xl },
  logo: { width: 88, height: 88, borderRadius: 20, marginBottom: space.md },
  title: { ...type.h1, textAlign: 'center' },
  subtitle: { ...type.small, marginTop: 4, textAlign: 'center' },
  helper: { ...type.small, textAlign: 'center', marginTop: 6 },
  legal: { ...type.tiny, textAlign: 'center', marginTop: space.md, paddingHorizontal: space.lg },
  backRow: { marginTop: space.lg, alignItems: 'center' },
  otp: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 12,
    textAlign: 'center',
    paddingVertical: 12,
    color: colors.ink,
    backgroundColor: colors.card,
    marginBottom: space.md,
  },
  resendRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.lg },
});
