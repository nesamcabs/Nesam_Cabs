import { useEffect, useRef, useState } from 'react';
import type { ConfirmationResult } from 'firebase/auth';
import { isValidIndianMobile, formatPhone, isValidEmail, isValidName } from '@core/utils/format';
import { registerCustomerProfile } from '@core/services/userService';
import { describeError } from '@core/utils/retry';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { Button, Dialog, Notice, TextField } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { confirmOtpCode, describePhoneAuthError, sendOtpToPhone } from '@/lib/authService';
import { useAuth } from '@/state/Auth';
import { useOnline } from '@/lib/hooks';

const RESEND_SECONDS = 30;
const OTP_LENGTH = 6;

function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className={`otp ${invalid ? 'is-invalid' : ''}`} onClick={() => ref.current?.focus()}>
      <label className="sr-only" htmlFor="modal-otp">
        6-digit verification code
      </label>
      <input
        id="modal-otp"
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
          <span
            key={i}
            className={`otp__box ${i === value.length && !disabled ? 'is-current' : ''} ${value[i] ? 'is-filled' : ''}`}
          >
            {value[i] ?? ''}
          </span>
        ))}
      </div>
    </div>
  );
}

export function LoginModal() {
  const { isLoginModalOpen, closeLoginModal, loginModalOptions, state } = useAuth();
  const { online } = useOnline();

  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Profile setup fields when newly registered
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileTouched, setProfileTouched] = useState(false);

  // Reset local state when modal opens
  useEffect(() => {
    if (isLoginModalOpen) {
      setStep('phone');
      setOtp('');
      setError('');
      setSending(false);
      setVerifying(false);
      setConfirmation(null);
      setCooldown(0);
      setName('');
      setEmail('');
      setProfileTouched(false);
    }
  }, [isLoginModalOpen]);

  // Resend cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  if (!isLoginModalOpen) return null;

  const sendOtp = async () => {
    if (sending) return;
    if (!isValidIndianMobile(mobile)) return setError('Enter a valid 10-digit mobile number.');
    if (!online) return setError('You’re offline. Connect to the internet to receive your code.');
    setError('');
    setSending(true);
    try {
      const res = await sendOtpToPhone(`+91${mobile}`);
      setConfirmation(res);
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
      // The Auth listener will transition to 'ready' or 'needs-profile'
    } catch (e) {
      setError(describePhoneAuthError(e));
      setOtp('');
      setVerifying(false);
    }
  };

  const saveProfile = async () => {
    setProfileTouched(true);
    if (!isValidName(name) || (email.trim() && !isValidEmail(email)) || savingProfile) return;
    setSavingProfile(true);
    setError('');
    try {
      await registerCustomerProfile({ name, email });
      // Auth listener handles transitioning to ready
    } catch (e) {
      setError(describeError(e, 'We couldn’t create your profile. Please try again.'));
      setSavingProfile(false);
    }
  };

  // If user just verified and needs profile setup
  if (state.status === 'needs-profile') {
    const nameErr = profileTouched && !isValidName(name) ? 'Enter your full name (2–60 characters).' : '';
    const emailErr = profileTouched && email.trim() && !isValidEmail(email) ? 'Enter a valid email address.' : '';
    return (
      <Dialog title="Almost there" onClose={closeLoginModal}>
        <div className="login-modal">
          <div className="login-modal__head">
            <p className="login-modal__sub">
              Tell us who’s travelling. Your number {formatPhone(state.user.phoneNumber ?? '')} is verified.
            </p>
          </div>
          <form
            className="login-modal__form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveProfile();
            }}
          >
            <TextField
              label="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Priya Raman"
              autoComplete="name"
              error={nameErr}
            />
            <TextField
              label={
                <>
                  Email <small>(optional)</small>
                </>
              }
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              hint="Booking confirmations and receipts are sent here."
              error={emailErr}
            />
            {error ? <Notice tone="error">{error}</Notice> : null}
            <Button type="submit" size="lg" block loading={savingProfile} disabled={!name.trim()}>
              {savingProfile ? 'Saving…' : 'Save and continue booking'}
            </Button>
          </form>
        </div>
      </Dialog>
    );
  }

  // If account is on hold
  if (state.status === 'on-hold') {
    return (
      <Dialog title="Account on hold" onClose={closeLoginModal}>
        <div className="login-modal">
          <Notice tone="warning">
            Your account is currently on hold. Please call customer support for assistance.
          </Notice>
          <div className="login-modal__actions" style={{ marginTop: '16px' }}>
            <a className="btn btn--primary btn--lg btn--block" href={`tel:${SUPPORT_PHONE}`}>
              <Icon name="phone" /> Call {SUPPORT_PHONE_DISPLAY}
            </a>
          </div>
        </div>
      </Dialog>
    );
  }

  const dialogTitle = step === 'phone' ? loginModalOptions?.title || 'Continue with mobile' : 'Enter the code';

  return (
    <Dialog title={dialogTitle} onClose={closeLoginModal}>
      <div className="login-modal">
        {step === 'phone' ? (
          <>
            <div className="login-modal__head">
              <p className="login-modal__sub">
                {loginModalOptions?.subtitle || 'Sign in to keep your bookings in one place.'}
              </p>
            </div>
            <form
              className="login-modal__form"
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
              />
              {error ? <Notice tone="error">{error}</Notice> : null}
              <Button type="submit" size="lg" block loading={sending} disabled={mobile.length < 10} trailing="arrow-right">
                {sending ? 'Sending code…' : 'Continue'}
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="login-modal__head">
              <p className="login-modal__sub">
                We sent a 6-digit code to +91 {mobile.slice(0, 5)} {mobile.slice(5)}.
              </p>
            </div>
            <form
              className="login-modal__form"
              onSubmit={(e) => {
                e.preventDefault();
                void verify(otp);
              }}
            >
              <OtpInput
                value={otp}
                onChange={(v) => {
                  setOtp(v);
                  setError('');
                }}
                onComplete={(v) => void verify(v)}
                disabled={verifying}
                invalid={!!error}
              />
              {error ? <Notice tone="error">{error}</Notice> : null}
              <Button type="submit" size="lg" block loading={verifying} disabled={otp.length !== OTP_LENGTH} icon="shield-check">
                {verifying ? 'Verifying…' : 'Verify OTP'}
              </Button>
              <div className="login-modal__links">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setStep('phone');
                    setOtp('');
                    setError('');
                  }}
                >
                  Change number
                </button>
                <button
                  type="button"
                  className="link-btn"
                  disabled={cooldown > 0 || sending}
                  onClick={() => void sendOtp()}
                >
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : sending ? 'Sending…' : 'Resend code'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </Dialog>
  );
}
