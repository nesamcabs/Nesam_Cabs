// Sign in with a mobile number: number → one-time code. A new customer then continues to
// profile setup (see ProfileSetup). Same Firebase phone auth as the customer app.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ConfirmationResult } from 'firebase/auth';
import { isValidIndianMobile, formatPhone } from '@core/utils/format';
import { registerCustomerProfile } from '@core/services/userService';
import { isValidEmail, isValidName } from '@core/utils/format';
import { describeError } from '@core/utils/retry';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { Button, Notice, TextField } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { confirmOtpCode, describePhoneAuthError, sendOtpToPhone, signOutUser } from '@/lib/authService';
import { useOnline, usePageTitle } from '@/lib/hooks';

const RESEND_SECONDS = 30;
const OTP_LENGTH = 6;

function AuthLayout({ title, subtitle, children }: { art?: string; title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="auth">
      <header className="auth__top">
        <span className="brand">
          <img className="brand__img" src="/nesam/logo-sm.webp" alt="NESAM Cabs" width={130} height={42} />
        </span>
      </header>
      <main className="auth__main" id="main">
        <div className="auth__panel">
          <h1>{title}</h1>
          <p className="auth__sub">{subtitle}</p>
          {children}
          <p className="auth__legal">
            Need help? Call <a href={`tel:${SUPPORT_PHONE}`}>{SUPPORT_PHONE_DISPLAY}</a>. By continuing you agree to NESAM’s terms and privacy policy.
          </p>
        </div>
      </main>
    </div>
  );
}

function OtpInput({ value, onChange, onComplete, disabled, invalid }: { value: string; onChange: (v: string) => void; onComplete: (v: string) => void; disabled?: boolean; invalid?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className={`otp ${invalid ? 'is-invalid' : ''}`} onClick={() => ref.current?.focus()}>
      <label className="sr-only" htmlFor="otp">
        6-digit verification code
      </label>
      <input
        id="otp"
        ref={ref}
        className="otp__input"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={OTP_LENGTH}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH);
          onChange(v);
          if (v.length === OTP_LENGTH) onComplete(v);
        }}
      />
      <div className="otp__boxes" aria-hidden="true">
        {Array.from({ length: OTP_LENGTH }, (_, i) => (
          <span key={i} className={`otp__box ${i === value.length && !disabled ? 'is-current' : ''} ${value[i] ? 'is-filled' : ''}`}>
            {value[i] ?? ''}
          </span>
        ))}
      </div>
    </div>
  );
}

export function AuthFlow() {
  usePageTitle('Sign in');
  const { online } = useOnline();
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const sendOtp = async () => {
    if (sending) return;
    if (!isValidIndianMobile(mobile)) return setError('Enter a valid 10-digit mobile number.');
    if (!online) return setError('You’re offline. Connect to the internet to receive your code.');
    setError('');
    setSending(true);
    try {
      setConfirmation(await sendOtpToPhone(`+91${mobile}`));
      setOtp('');
      setStep('otp');
      setCooldown(RESEND_SECONDS);
    } catch (e) {
      setError(describePhoneAuthError(e));
    } finally {
      setSending(false);
    }
  };

  const verify = async (code: string) => {
    if (verifying) return;
    if (code.length !== OTP_LENGTH) return setError('Enter the 6-digit code.');
    if (!confirmation) return setError('Your code expired. Request a new one.');
    setError('');
    setVerifying(true);
    try {
      await confirmOtpCode(confirmation, code);
      // The auth listener takes over from here.
    } catch (e) {
      setError(describePhoneAuthError(e));
      setOtp('');
      setVerifying(false);
    }
  };

  if (step === 'otp') {
    return (
      <AuthLayout art="phone-verification" title="Enter the code" subtitle={`We sent a 6-digit code to +91 ${mobile.slice(0, 5)} ${mobile.slice(5)}.`}>
        <form
          className="auth__form"
          onSubmit={(e) => {
            e.preventDefault();
            void verify(otp);
          }}
        >
          <OtpInput value={otp} onChange={(v) => { setOtp(v); setError(''); }} onComplete={(v) => void verify(v)} disabled={verifying} invalid={!!error} />
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" size="lg" block loading={verifying} disabled={otp.length !== OTP_LENGTH}>
            {verifying ? 'Verifying…' : 'Verify and continue'}
          </Button>
          <div className="auth__links">
            <button type="button" className="link-btn" onClick={() => { setStep('phone'); setOtp(''); setError(''); }}>
              Change number
            </button>
            <button type="button" className="link-btn" disabled={cooldown > 0 || sending} onClick={() => void sendOtp()}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : sending ? 'Sending…' : 'Resend code'}
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout art="welcome" title="Book your ride" subtitle="Enter your mobile number to sign in or create your NESAM account.">
      <form
        className="auth__form"
        onSubmit={(e) => {
          e.preventDefault();
          void sendOtp();
        }}
      >
        <TextField
          label="Mobile number"
          prefix="+91"
          value={mobile}
          onChange={(e) => {
            setMobile(e.target.value.replace(/\D/g, '').slice(0, 10));
            setError('');
          }}
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="98765 43210"
          autoFocus={typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches}
          hint="We’ll text you a one-time code."
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" size="lg" block loading={sending} disabled={mobile.length < 10}>
          {sending ? 'Sending code…' : 'Continue'}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ProfileSetup({ phone }: { phone: string }) {
  usePageTitle('Complete your profile');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const errors = {
    name: !isValidName(name) ? 'Enter your full name (letters and spaces, 2–60 characters).' : '',
    email: email.trim() && !isValidEmail(email) ? 'Enter a valid email address, or leave it blank.' : '',
  };

  const save = async () => {
    setTouched(true);
    if (errors.name || errors.email || saving) return;
    setSaving(true);
    setError('');
    try {
      await registerCustomerProfile({ name, email });
      // The profile listener moves on to the app.
    } catch (e) {
      setError(describeError(e, 'We couldn’t create your profile. Please try again.'));
      setSaving(false);
    }
  };

  return (
    <AuthLayout art="profile-setup" title="Almost there" subtitle={`Tell us who’s travelling. Your number ${formatPhone(phone)} is verified.`}>
      <form
        className="auth__form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField label="Full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="e.g. Priya Raman" error={touched ? errors.name : ''} />
        <TextField
          label={
            <>
              Email <small>(optional)</small>
            </>
          }
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
          hint="Booking confirmations and receipts are sent here."
          error={touched ? errors.email : ''}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Button type="submit" size="lg" block loading={saving}>
          {saving ? 'Saving…' : 'Save and start booking'}
        </Button>
        <div className="auth__links auth__links--center">
          <button type="button" className="link-btn" onClick={() => void signOutUser()}>
            Not your number? Sign out
          </button>
        </div>
      </form>
    </AuthLayout>
  );
}

export function AccountHold({ status, onSignOut }: { status: string; onSignOut: () => void }) {
  usePageTitle('Account on hold');
  return (
    <AuthLayout art="account-review" title="Your account is on hold" subtitle={`${status ? `Your account is currently ${status.toLowerCase()}.` : 'Your account is not active yet.'} Please call us and we’ll help.`}>
      <div className="auth__form">
        <a className="btn btn--primary btn--lg btn--block" href={`tel:${SUPPORT_PHONE}`}>
          <Icon name="phone" /> Call {SUPPORT_PHONE_DISPLAY}
        </a>
        <Button variant="secondary" size="lg" block onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </AuthLayout>
  );
}

export function LoadError({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut: () => void }) {
  usePageTitle('Something went wrong');
  return (
    <AuthLayout art="error" title="We couldn’t load your account" subtitle="This is usually a connection problem.">
      <div className="auth__form">
        <Notice tone="error">{message}</Notice>
        <Button size="lg" block onClick={onRetry}>
          Try again
        </Button>
        <Button variant="secondary" size="lg" block onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </AuthLayout>
  );
}
