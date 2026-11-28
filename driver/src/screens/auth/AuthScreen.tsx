// Welcome → mobile number → OTP (Firebase phone auth, same flow as the Customer app), in the NESAM Driver design.
import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../../components/nx/Text';
import type { ConfirmationResult } from 'firebase/auth';
import { AuthCard, AuthFrame } from '../../components/AuthFrame';
import { NxIcon } from '../../components/nx/Icon';
import { NxButton, NxFormError, NxInfo, NxTextButton, isHovered } from '../../components/nx/primitives';
import { useRecaptchaVerifier } from '../../components/RecaptchaVerifier';
import { confirmOtpCode, describePhoneAuthError, sendOtpToPhone } from '../../services/authService';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { formatPhone, isValidIndianMobile } from '../../utils/format';
import { nx } from '../../theme/nx';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../../config/constants';
import { setAuthIntent, type AuthIntent } from './authIntent';

const RESEND_COOLDOWN_S = 30;

function Choice({ title, onPress, primary }: { title: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={(s) => [styles.choice, primary && styles.choicePrimary, isHovered(s) && primary && { backgroundColor: nx.redDark }, s.pressed && { opacity: 0.9 }]}
    >
      <Text style={[styles.choiceTitle, primary && { color: nx.white }]}>{title}</Text>
      <NxIcon name="arrow" size={18} color={primary ? nx.white : nx.ink} />
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

  if (step === 'welcome') {
    return (
      <AuthFrame footer={null}>
        <AuthCard title="Welcome, Partner">
          <View style={{ gap: 12, marginTop: 22 }}>
            <Choice title="Sign In" onPress={() => start('login')} primary />
            <Choice title="Register as a Driver" onPress={() => start('signup')} />
          </View>
          {!online ? <NxInfo tone="amber">You’re offline. Connect to the internet to sign in.</NxInfo> : null}
          <Pressable onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} accessibilityRole="button" accessibilityLabel={`Call partner support on ${SUPPORT_PHONE_DISPLAY}`} style={styles.support}>
            <NxIcon name="phone" size={15} color={nx.red} />
            <Text style={styles.supportNumber}>{SUPPORT_PHONE_DISPLAY}</Text>
          </Pressable>
          <View style={styles.agreement}>
            <View style={styles.agreementIcon}><NxIcon name="shield" size={17} color={nx.red} /></View>
            <View style={styles.agreementBody}>
              <Text style={styles.agreementTitle}>Partner agreement</Text>
              <Text style={styles.agreementText}>
                By continuing, you accept the NESAM Driver Partner <Text style={styles.agreementDoc}>Terms & Conditions</Text> and acknowledge the <Text style={styles.agreementDoc}>Privacy Policy</Text>.
              </Text>
            </View>
          </View>
        </AuthCard>
      </AuthFrame>
    );
  }

  if (step === 'phone') {
    return (
      <AuthFrame>
        <AuthCard
          eyebrow={intent === 'signup' ? 'New driver partner' : 'Driver sign-in'}
          title={intent === 'signup' ? 'Create your account' : 'Sign in with your mobile'}
          subtitle={intent === 'signup' ? 'This number becomes your driver login and is shown to customers on trips.' : 'We’ll send a 6-digit OTP to your registered number.'}
        >
          <Text style={styles.label}>{intent === 'signup' ? 'Mobile number' : 'Registered mobile number'}</Text>
          <View style={[styles.phoneField, !!error && { borderColor: nx.red }]}>
            <Text style={styles.prefix}>+91</Text>
            <View style={styles.prefixRule} />
            <TextInput
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
              placeholderTextColor="#A2A8B2"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void sendOtp()}
              style={styles.phoneInput}
              accessibilityLabel="Mobile number"
            />
          </View>
          <NxFormError message={error} />
          <NxButton title={sending ? 'Sending OTP…' : 'Send OTP'} trailingIcon="arrow" loading={sending} disabled={mobile.length !== 10 || !online} onPress={() => void sendOtp()} style={{ marginTop: 18 }} />
          <View style={styles.linkRow}>
            <NxTextButton title="Back" icon="back" color={nx.muted} disabled={sending} onPress={() => setStep('welcome')} />
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
        subtitle={
          <>
            Sent to <Text style={{ fontWeight: '700', color: nx.ink }}>+91 {formatPhone(mobile)}</Text>
          </>
        }
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
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          maxLength={6}
          editable={!verifying}
          placeholder="••••••"
          placeholderTextColor="#B4BAC4"
          style={[styles.otp, !!error && { borderColor: nx.red }]}
          accessibilityLabel="6-digit OTP"
        />
        <NxFormError message={error} />
        <NxButton title={verifying ? 'Verifying…' : 'Verify & Continue'} trailingIcon="arrow" loading={verifying} disabled={otp.length !== 6} onPress={() => void verify(otp)} style={{ marginTop: 18 }} />
        <View style={[styles.linkRow, { justifyContent: 'space-between' }]}>
          {cooldown > 0 ? <Text style={styles.cooldown}>Resend code in {cooldown}s</Text> : <NxTextButton title={sending ? 'Resending…' : 'Resend code'} icon="refresh" disabled={sending} onPress={() => void sendOtp()} />}
          <NxTextButton
            title="Change number"
            color={nx.muted}
            onPress={() => {
              if (verifying) return;
              setStep('phone');
              setOtp('');
              setError('');
            }}
          />
        </View>
      </AuthCard>
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  choice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 56, paddingHorizontal: 20, borderRadius: 12, borderWidth: 1.5, borderColor: nx.ink, backgroundColor: nx.white },
  choicePrimary: { backgroundColor: nx.tripRed, borderColor: nx.tripRed },
  choiceTitle: { fontSize: 15, fontWeight: '700', color: nx.ink },
  support: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 40, marginTop: 14 },
  supportNumber: { fontSize: 13, fontWeight: '700', color: nx.ink },
  agreement: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 14, paddingVertical: 13, paddingHorizontal: 14, borderRadius: 14, backgroundColor: '#F7F8FA', borderWidth: 1, borderColor: nx.line },
  agreementIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: nx.redSoft },
  agreementBody: { flex: 1, minWidth: 0 },
  agreementTitle: { fontSize: 10, lineHeight: 14, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase', color: nx.red },
  agreementText: { fontSize: 11.5, lineHeight: 18, color: nx.muted, marginTop: 3 },
  agreementDoc: { fontWeight: '700', color: nx.ink },
  label: { fontSize: 12, fontWeight: '600', color: nx.ink, marginTop: 20 },
  phoneField: { flexDirection: 'row', alignItems: 'center', minHeight: 54, marginTop: 8, borderWidth: 1, borderColor: nx.fieldLine, borderRadius: 12, backgroundColor: nx.white, paddingHorizontal: 14 },
  prefix: { fontSize: 16, fontWeight: '700', color: nx.red },
  prefixRule: { width: 1, height: 24, backgroundColor: nx.line, marginHorizontal: 12 },
  phoneInput: { flex: 1, minWidth: 0, fontSize: 17, letterSpacing: 0.6, color: nx.ink, paddingVertical: 12 },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  otp: { minHeight: 69, marginTop: 20, borderWidth: 1, borderColor: nx.fieldLine, borderRadius: 12, textAlign: 'center', fontSize: 30, fontWeight: '700', letterSpacing: 12, color: nx.ink, paddingVertical: 12, backgroundColor: nx.white },
  cooldown: { fontSize: 12, color: nx.muted },
});
