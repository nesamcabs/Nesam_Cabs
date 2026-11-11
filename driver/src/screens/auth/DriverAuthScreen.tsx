import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../../components/KeyboardAvoid';
import { Text, TextInput } from '../../components/nx/Text';
import type { ConfirmationResult } from 'firebase/auth';
import { sendOtpToPhone, confirmOtpCode, describePhoneAuthError } from '../../services/authService';
import { isValidIndianMobile } from '../../utils/format';
import { Colors } from '../../theme/colors';

const RESEND_COOLDOWN = 30;

export function DriverAuthScreen() {
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [verifying, setVerifying] = useState(false);
  const otpRefs = useRef<(TextInput | null)[]>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const handleSend = async () => {
    const digits = mobile.replace(/\D/g, '').slice(-10);
    if (!isValidIndianMobile(digits)) {
      setError('Enter a valid 10-digit Indian mobile number.');
      return;
    }
    setError('');
    setSending(true);
    try {
      const e164 = `+91${digits}`;
      const conf = await sendOtpToPhone(e164);
      setConfirmation(conf);
      setStep('otp');
      setCooldown(RESEND_COOLDOWN);
    } catch (err) {
      setError(describePhoneAuthError(err));
    } finally {
      setSending(false);
    }
  };

  const handleOtpChange = (index: number, val: string) => {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKey = (index: number, key: string) => {
    if (key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const code = otp.join('');
    if (code.length < 6) {
      setError('Enter the 6-digit OTP.');
      return;
    }
    if (!confirmation) return;
    setError('');
    setVerifying(true);
    try {
      await confirmOtpCode(confirmation, code);
    } catch (err) {
      setError(describePhoneAuthError(err));
    } finally {
      setVerifying(false);
    }
  };

  const displayMobile = `+91 ${mobile.replace(/\D/g, '').slice(-10).slice(0, 5)} ${mobile.replace(/\D/g, '').slice(-10).slice(5)}`;

  if (step === 'otp') {
    return (
      <SafeAreaView style={s.safe}>
        <KeyboardAvoid>
        <ScrollView contentContainerStyle={s.kav} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={s.card}>
            <Pressable onPress={() => setStep('phone')} style={s.back}>
              <Text style={s.backText}>← Back</Text>
            </Pressable>
            <Text style={s.cardTitle}>Driver Verification</Text>
            <Text style={s.cardSub}>
              Enter OTP sent to{'\n'}
              <Text style={{ fontWeight: '700', color: Colors.white }}>{displayMobile}</Text>
            </Text>

            <View style={s.otpRow}>
              {otp.map((d, i) => (
                <TextInput
                  key={i}
                  ref={(r) => { otpRefs.current[i] = r; }}
                  style={[s.otpBox, d ? s.otpBoxFilled : null]}
                  value={d}
                  onChangeText={(v) => handleOtpChange(i, v)}
                  onKeyPress={({ nativeEvent }) => handleOtpKey(i, nativeEvent.key)}
                  keyboardType="number-pad"
                  maxLength={1}
                  selectTextOnFocus
                />
              ))}
            </View>

            {!!error && <Text style={s.error}>{error}</Text>}

            <Pressable
              style={[s.btn, s.btnPrimary, verifying && s.btnDisabled]}
              onPress={handleVerify}
              disabled={verifying}
            >
              {verifying ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={s.btnPrimaryText}>Verify & Continue</Text>
              )}
            </Pressable>

            <Pressable
              onPress={cooldown > 0 ? undefined : handleSend}
              style={{ marginTop: 14 }}
            >
              <Text style={[s.resendText, cooldown > 0 && { color: Colors.textSecondary }]}>
                {cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
        </KeyboardAvoid>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoid>
        <ScrollView contentContainerStyle={s.kav} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={s.card}>
          <View style={s.logoBox}>
            <Text style={s.logoText}>N</Text>
          </View>
          <Text style={s.cardTitle}>NESAM Driver Partner</Text>
          <Text style={s.cardSub}>Drive & Earn with NESAM Tours & Travels</Text>

          <View style={s.phoneRow}>
            <View style={s.countryCode}>
              <Text style={s.countryCodeText}>🇮🇳 +91</Text>
            </View>
            <TextInput
              style={s.phoneInput}
              value={mobile}
              onChangeText={(v) => {
                setMobile(v.replace(/\D/g, '').slice(0, 10));
                setError('');
              }}
              placeholder="Driver mobile number"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="phone-pad"
              maxLength={10}
              returnKeyType="done"
              onSubmitEditing={handleSend}
            />
          </View>

          {!!error && <Text style={s.error}>{error}</Text>}

          <Pressable
            style={[s.btn, s.btnPrimary, (sending || mobile.length < 10) && s.btnDisabled]}
            onPress={handleSend}
            disabled={sending || mobile.length < 10}
          >
            {sending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={s.btnPrimaryText}>Send OTP</Text>
            )}
          </Pressable>

          <Text style={s.termsText}>
            By signing in, you agree to the NESAM Driver Partner Terms & Guidelines.
          </Text>
        </View>
      </ScrollView>
        </KeyboardAvoid>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.darkBg },
  kav: { flexGrow: 1, justifyContent: 'center' },
  card: {
    margin: 20,
    backgroundColor: '#1C1C1E',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  logoBox: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  logoText: { fontSize: 32, fontWeight: '900', color: Colors.white },
  cardTitle: { fontSize: 22, fontWeight: '900', color: Colors.white, textAlign: 'center', marginBottom: 4 },
  cardSub: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginBottom: 24 },
  phoneRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  countryCode: {
    backgroundColor: '#2C2C2E',
    borderRadius: 12,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  countryCodeText: { fontSize: 15, fontWeight: '600', color: Colors.white },
  phoneInput: {
    flex: 1,
    backgroundColor: '#2C2C2E',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: '700',
    color: Colors.white,
    letterSpacing: 2,
  },
  otpRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 20 },
  otpBox: {
    width: 44,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#2C2C2E',
    backgroundColor: '#2C2C2E',
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '800',
    color: Colors.white,
  },
  otpBoxFilled: { borderColor: Colors.primary, backgroundColor: '#3A1C1C' },
  error: { fontSize: 12, color: Colors.error, marginBottom: 8, textAlign: 'center' },
  btn: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  btnPrimary: { backgroundColor: Colors.primary },
  btnPrimaryText: { color: Colors.white, fontSize: 15, fontWeight: '800' },
  btnDisabled: { opacity: 0.5 },
  resendText: { fontSize: 13, color: Colors.primary, fontWeight: '700', textAlign: 'center' },
  back: { marginBottom: 16 },
  backText: { fontSize: 14, color: Colors.textSecondary, fontWeight: '600' },
  termsText: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center', marginTop: 16, lineHeight: 16 },
});