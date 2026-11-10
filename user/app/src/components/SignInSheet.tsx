// "Sign in to NESAM Cabs": the website's login dialog as a bottom sheet over the booking page. One mobile number
// signs in or creates the account; a six-digit code confirms it. Real Firebase phone authentication; nothing here
// simulates a login or an OTP. (A brand-new number continues to the profile step once it is verified.)
import React, { useEffect, useRef, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ConfirmationResult } from 'firebase/auth';
import { LinkText, Notice, Sheet } from './ui';
import { GoButton } from './BookForm';
import { CountryCodePicker } from './CountryCodePicker';
import { useRecaptchaVerifier } from './RecaptchaVerifier';
import { confirmOtpCode, describePhoneAuthError, sendOtpToPhone } from '../services/authService';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { isValidIndianMobile } from '../utils/format';
import { setAuthIntent } from '../screens/auth/authIntent';
import { ILLUSTRATIONS } from '../assets/images';
import { colors, fonts } from '../theme';

const RESEND_COOLDOWN_S = 30;
const SITE = 'https://www.nesamcabs.com';

export function SignInSheet({ visible, onClose, title, subtitle }: { visible: boolean; onClose: () => void; title?: string; subtitle?: string }) {
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [mobile, setMobile] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const otpRef = useRef<TextInput>(null);
  const verifier = useRecaptchaVerifier();
  const { online } = useNetworkStatus();

  // A fresh sheet starts at the phone step.
  const [wasVisible, setWasVisible] = useState(false);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setStep('phone');
      setOtp('');
      setError('');
    }
  }

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const isIndia = countryCode === '+91';
  const numberOk = isIndia ? isValidIndianMobile(mobile) : mobile.length >= 6 && mobile.length <= 14;

  const sendOtp = async () => {
    if (!numberOk) return setError(isIndia ? 'Enter a valid 10-digit Indian mobile number.' : 'Enter a valid mobile number.');
    if (!online) return setError('You’re offline. Connect to the internet to receive your code.');
    if (sending) return undefined;
    setError('');
    setSending(true);
    try {
      // The website has one "Continue": the account is created on the profile step if the number is new.
      setAuthIntent('login');
      const result = await sendOtpToPhone(`${countryCode}${mobile}`, verifier);
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
    if (code.length !== 6) return setError('Enter the 6-digit code.');
    if (!confirmation) return setError('Your code expired. Please request a new one.');
    if (verifying) return undefined;
    setError('');
    setVerifying(true);
    try {
      await confirmOtpCode(confirmation, code);
      // onAuthStateChanged in App.tsx takes over from here; the booking in progress carries on.
    } catch (e) {
      setError(describePhoneAuthError(e));
      setOtp('');
      setVerifying(false);
      otpRef.current?.focus();
    }
    return undefined;
  };

  return (
    <Sheet visible={visible} onClose={() => !verifying && onClose()} title={title || (step === 'phone' ? 'Sign in to NESAM Cabs' : 'Enter the code')}>
      <View style={styles.body}>
        <View style={styles.head}>
          <Image source={step === 'phone' ? ILLUSTRATIONS.welcome : ILLUSTRATIONS.phoneVerification} style={styles.art} resizeMode="contain" accessible={false} />
          <Text style={styles.sub}>
            {step === 'phone' ? subtitle || 'Enter your mobile number to sign in or create your NESAM Cabs account.' : `We sent a 6-digit code to ${countryCode} ${mobile}.`}
          </Text>
        </View>

        {step === 'phone' ? (
          <>
            <View style={styles.phoneRow}>
              <View>
                <Text style={styles.label}>Country code</Text>
                <View style={styles.codeBox}>
                  <CountryCodePicker
                    value={countryCode}
                    onChange={(c) => {
                      setCountryCode(c);
                      setMobile('');
                      setError('');
                    }}
                  />
                </View>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.label}>Mobile number</Text>
                <TextInput
                  value={mobile}
                  onChangeText={(v) => {
                    setMobile(v.replace(/\D/g, '').slice(0, isIndia ? 10 : 14));
                    setError('');
                  }}
                  keyboardType="phone-pad"
                  autoComplete="tel-national"
                  textContentType="telephoneNumber"
                  maxLength={isIndia ? 10 : 14}
                  placeholder="Mobile number"
                  placeholderTextColor={colors.faint}
                  returnKeyType="done"
                  onSubmitEditing={() => void sendOtp()}
                  style={[styles.input, !!error && { borderColor: colors.danger }]}
                  accessibilityLabel="Mobile number"
                />
              </View>
            </View>
            <Text style={styles.hint}>We’ll text you a one-time verification code.</Text>
            <Notice message={error} />
            <GoButton title={sending ? 'Sending code…' : 'Continue'} onPress={() => void sendOtp()} loading={sending} disabled={mobile.length < 6 || !online} />
            {!online ? <Text style={styles.offline}>You’re offline. Connect to the internet to receive your code.</Text> : null}
            <Text style={styles.terms}>
              By continuing you agree to NESAM Cabs’s{'\n'}
              <Text style={styles.termsLink} onPress={() => void Linking.openURL(`${SITE}/legal#terms`)} accessibilityRole="link">
                Terms & Conditions
              </Text>{' '}
              and{' '}
              <Text style={styles.termsLink} onPress={() => void Linking.openURL(`${SITE}/legal#privacy`)} accessibilityRole="link">
                Privacy & Location Policy
              </Text>
              .
            </Text>
          </>
        ) : (
          <>
            {/* Six boxes over one invisible input: tap anywhere on them to type. */}
            <Pressable onPress={() => otpRef.current?.focus()} accessibilityRole="none" style={styles.otpWrap}>
              <View style={styles.otpBoxes} pointerEvents="none">
                {Array.from({ length: 6 }, (_, i) => (
                  <View key={i} style={[styles.otpBox, !!otp[i] && styles.otpBoxFilled, i === otp.length && !verifying && styles.otpBoxCurrent, !!error && styles.otpBoxError]}>
                    <Text style={[styles.otpDigit, !!otp[i] && { color: colors.eyebrow }]}>{otp[i] ?? ''}</Text>
                  </View>
                ))}
              </View>
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
                caretHidden
                style={styles.otpInput}
                accessibilityLabel="6-digit code"
              />
            </Pressable>
            <Notice message={error} />
            <GoButton title={verifying ? 'Verifying…' : 'Verify and continue'} onPress={() => void verify(otp)} loading={verifying} disabled={otp.length !== 6} />
            <View style={styles.links}>
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
              {cooldown > 0 ? <Text style={styles.cool}>Resend code in {cooldown}s</Text> : <LinkText onPress={() => void sendOtp()}>{sending ? 'Sending…' : 'Resend code'}</LinkText>}
            </View>
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12, paddingBottom: 12 },
  head: { alignItems: 'center', gap: 12 },
  art: { width: 100, height: 82 },
  sub: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.muted, textAlign: 'center' },
  phoneRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-end' },
  label: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink, marginBottom: 6 },
  codeBox: { minHeight: 60, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 6, justifyContent: 'center', paddingHorizontal: 4, backgroundColor: colors.white },
  input: { minHeight: 56, borderWidth: 1, borderColor: colors.field, borderRadius: 6, paddingHorizontal: 16, fontFamily: fonts.semiBold, fontSize: 18, color: colors.ink, backgroundColor: colors.white },
  hint: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted },
  offline: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, textAlign: 'center' },
  terms: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 24, color: colors.muted, textAlign: 'center', marginTop: 4 },
  termsLink: { color: colors.primary, textDecorationLine: 'underline', fontFamily: fonts.semiBold },
  otpWrap: { position: 'relative' },
  otpBoxes: { flexDirection: 'row', gap: 8 },
  otpBox: { flex: 1, height: 56, borderRadius: 14, borderWidth: 1.5, borderColor: '#FFC5C7', backgroundColor: '#FFF1F1', alignItems: 'center', justifyContent: 'center' },
  otpBoxFilled: { borderColor: colors.primary, backgroundColor: colors.white },
  otpBoxCurrent: { borderColor: colors.primary, backgroundColor: colors.white, shadowColor: colors.primary, shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  otpBoxError: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  otpDigit: { fontFamily: fonts.bold, fontSize: 22, color: colors.ink },
  otpInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.02, color: 'transparent', fontSize: 16 },
  links: { flexDirection: 'row', justifyContent: 'space-between' },
  cool: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
});
