import React, { useEffect, useRef, useState } from 'react';
import type { ConfirmationResult } from 'firebase/auth';
import {
  confirmOtpCode,
  createRecaptchaVerifier,
  describePhoneAuthError,
  resetRecaptchaVerifier,
  sendOtpToPhone,
  setAuthIntent,
  type AuthIntent,
} from '../services/authService';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { Banner, Button, PhoneInput } from '../ui/kit';
import { Icon, IconSprite } from '../ui/Icon';

type Step = 'choose' | 'phone' | 'otp';

const RESEND_COOLDOWN_S = 30;
const EMPTY_OTP = ['', '', '', '', '', ''];

/**
 * Entry flow: choose Login / Sign up → phone → OTP. On success Firebase Auth fires onAuthStateChanged and App routes from
 * the vendors/{uid} document, so this screen never decides the destination itself.
 */
export const VendorLoginScreen: React.FC = () => {
  const online = useOnlineStatus();
  const [step, setStep] = useState<Step>('choose');
  const [mode, setMode] = useState<AuthIntent>('login');
  const [mobileNumber, setMobileNumber] = useState('');
  const [otp, setOtp] = useState(EMPTY_OTP);
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [sendError, setSendError] = useState('');
  const [otpError, setOtpError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const verifyingRef = useRef(false);

  useEffect(() => {
    // Firebase Phone Auth authorizes 'localhost' by default, but rejects IP addresses like 127.0.0.1.
    if (typeof window !== 'undefined' && window.location.hostname === '127.0.0.1') window.location.hostname = 'localhost';
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => () => resetRecaptchaVerifier(), []);

  const choose = (m: AuthIntent) => {
    setMode(m);
    setAuthIntent(m);
    setSendError('');
    setStep('phone');
  };

  const handleSendOtp = async () => {
    if (!/^[6-9]\d{9}$/.test(mobileNumber)) {
      setSendError('Enter a valid 10-digit Indian mobile number.');
      return;
    }
    if (isSending || cooldown > 0) return;
    setSendError('');
    setOtpError('');
    setIsSending(true);
    try {
      const verifier = createRecaptchaVerifier('vendor-recaptcha-container');
      const result = await sendOtpToPhone(`+91${mobileNumber}`, verifier);
      setConfirmation(result);
      setOtp(EMPTY_OTP);
      setStep('otp');
      setCooldown(RESEND_COOLDOWN_S);
      setTimeout(() => document.getElementById('vendor-otp-0')?.focus(), 50);
    } catch (error) {
      const message = describePhoneAuthError(error);
      if (step === 'otp') setOtpError(message);
      else setSendError(message);
    } finally {
      setIsSending(false);
    }
  };

  const verify = async (code: string) => {
    if (verifyingRef.current) return;
    if (code.length < 6) {
      setOtpError('Please enter the 6-digit OTP.');
      return;
    }
    if (!confirmation) {
      setOtpError('Your verification session expired. Please resend the OTP.');
      return;
    }
    verifyingRef.current = true;
    setOtpError('');
    setIsVerifying(true);
    try {
      await confirmOtpCode(confirmation, code);
      // App takes over via the auth listener; keep the spinner until unmount.
    } catch (error) {
      setOtpError(describePhoneAuthError(error));
      setIsVerifying(false);
      verifyingRef.current = false;
    }
  };

  const handleOtpChange = (index: number, val: string) => {
    const digits = val.replace(/\D/g, '');
    const next = [...otp];
    if (digits.length >= 6) {
      // Paste / SMS autofill of the full code into any box
      const pasted = digits.slice(0, 6);
      for (let i = 0; i < 6; i++) next[i] = pasted[i] || '';
      setOtp(next);
      document.getElementById(`vendor-otp-${Math.min(pasted.length, 5)}`)?.focus();
    } else {
      next[index] = digits.slice(-1);
      setOtp(next);
      if (next[index] && index < 5) document.getElementById(`vendor-otp-${index + 1}`)?.focus();
    }
    const code = next.join('');
    if (code.length === 6) void verify(code);
  };

  const isSignup = mode === 'signup';
  const ipHost = typeof window !== 'undefined' && /^(127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)$/.test(window.location.hostname);

  return (
    <div className="vx">
      <IconSprite />
      <div className="vx-auth">
        <div id="vendor-recaptcha-container" />
        <div className="vx-auth__col">
          <div className="vx-auth__brand">
            <span className="vx-brand__mark"><img src="/brand/nesam-emblem.jpg" alt="" width={512} height={497} decoding="async" /></span>
            <h1>NESAM Fleet Partner</h1>
            <p>{step === 'choose' ? 'Manage your vehicles, drivers and duties in one place.' : isSignup ? 'Create your partner account with your vehicle number.' : 'Sign in to your partner account.'}</p>
          </div>

          {!online && <Banner tone="warn">You’re offline. You can’t sign in until your connection is back.</Banner>}

          <div className="vx-card">
            {step === 'choose' && (
              <>
                <button type="button" className="vx-choice" onClick={() => choose('login')}>
                  <span className="vx-choice__ico"><Icon name="arrow" /></span>
                  <span><strong>Login</strong><small>I already have a partner account</small></span>
                </button>
                <button type="button" className="vx-choice" onClick={() => choose('signup')} style={{ marginBottom: 0 }}>
                  <span className="vx-choice__ico vx-choice__ico--dark"><Icon name="userplus" /></span>
                  <span><strong>Sign up</strong><small>Register my fleet with a vehicle number</small></span>
                </button>
              </>
            )}

            {step === 'phone' && (
              <>
                <button type="button" className="vx-btn vx-btn--ghost vx-btn--sm" onClick={() => setStep('choose')} style={{ marginBottom: 8, marginLeft: -8 }}>← Back</button>
                {ipHost && (
                  <Banner tone="warn">
                    Firebase Phone Auth blocks IP addresses ({window.location.hostname}). Use <a href={`http://localhost:${window.location.port || '3003'}`}>http://localhost:{window.location.port || '3003'}</a> for OTP to work.
                  </Banner>
                )}
                <PhoneInput id="vendor-phone" label={isSignup ? 'Mobile number' : 'Registered mobile number'} value={mobileNumber} onChange={(v) => { setMobileNumber(v); setSendError(''); }} autoFocus onEnter={handleSendOtp}
                  hint={isSignup ? 'This number becomes your login and primary business contact.' : undefined} error={sendError} />
                <Button variant="primary" block loading={isSending} disabled={!online} onClick={handleSendOtp}>{isSending ? 'Sending OTP…' : 'Send OTP'}</Button>
                <p className="vx-hint" style={{ textAlign: 'center', marginTop: 14 }}>By continuing, you agree to NESAM’s Fleet Partner Terms of Service and Privacy Policy.</p>
              </>
            )}

            {step === 'otp' && (
              <>
                <button type="button" className="vx-btn vx-btn--ghost vx-btn--sm" disabled={isVerifying} onClick={() => { setStep('phone'); setOtp(EMPTY_OTP); setOtpError(''); }} style={{ marginBottom: 8, marginLeft: -8 }}>← Change number</button>
                <p style={{ marginBottom: 14 }}>Enter the 6-digit OTP sent to <strong>+91 {mobileNumber}</strong></p>
                <div className="vx-otpbox" role="group" aria-label="One-time password">
                  {otp.map((digit, idx) => (
                    <input key={idx} id={`vendor-otp-${idx}`} type="text" inputMode="numeric" autoComplete={idx === 0 ? 'one-time-code' : 'off'} aria-label={`OTP digit ${idx + 1}`} maxLength={6}
                      value={digit} disabled={isVerifying} aria-invalid={!!otpError}
                      onChange={(e) => handleOtpChange(idx, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Backspace' && !otp[idx] && idx > 0) document.getElementById(`vendor-otp-${idx - 1}`)?.focus();
                        if (e.key === 'Enter') void verify(otp.join(''));
                      }} />
                  ))}
                </div>
                {otpError && <p className="vx-err" role="alert" style={{ marginTop: 10 }}>{otpError}</p>}
                <div style={{ height: 14 }} />
                <Button variant="primary" block loading={isVerifying} disabled={!online} onClick={() => void verify(otp.join(''))}>{isVerifying ? 'Verifying…' : 'Verify & continue'}</Button>
                <div style={{ textAlign: 'right', marginTop: 8 }}>
                  <button type="button" className="vx-btn vx-btn--ghost vx-btn--sm" onClick={handleSendOtp} disabled={isSending || cooldown > 0 || isVerifying}>
                    {cooldown > 0 ? `Resend OTP in ${cooldown}s` : isSending ? 'Sending…' : 'Resend OTP'}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="vx-auth__foot">
            <span><Icon name="shield" /> {step !== 'choose' && isSignup ? 'New accounts are verified by NESAM before going live.' : 'Secured with a one-time password.'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

