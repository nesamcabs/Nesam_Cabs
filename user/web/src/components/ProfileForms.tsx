// The two profile edit forms, used both inside the profile drawer and on their own pages (/account/edit,
// /account/emergency). Each saves one thing and then calls onDone.
import { useState } from 'react';
import { useCustomerData } from '@core/context/CustomerData';
import { updateCustomerProfile } from '@core/services/userService';
import { formatPhone, isValidEmail, isValidIndianMobile, isValidName, localMobile } from '@core/utils/format';
import { describeError } from '@core/utils/retry';
import { Button, Notice, TextField } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useToasts } from '@/state/Toasts';

interface FormProps {
  /** Called after a successful save or removal. */
  onDone: () => void;
  /** Called by Cancel. */
  onCancel: () => void;
}

/** Name and email. The sign-in number is shown but cannot be changed here. */
export function PersonalDetailsForm({ onDone, onCancel }: FormProps) {
  const { profile } = useCustomerData();
  const { push } = useToasts();
  const [name, setName] = useState(profile?.name || '');
  const [email, setEmail] = useState(profile?.email || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  if (!profile) return null;

  const dirty = name.trim() !== profile.name || email.trim().toLowerCase() !== profile.email;
  const errors = {
    name: !isValidName(name) ? 'Enter your full name (letters and spaces, 2–60 characters).' : '',
    email: email.trim() && !isValidEmail(email) ? 'Enter a valid email address, or leave it blank.' : '',
  };

  const save = async () => {
    setTouched(true);
    if (errors.name || errors.email || busy) return;
    setBusy(true);
    setError('');
    try {
      await updateCustomerProfile(profile.uid, { name, email: email.toLowerCase() });
      push({ title: 'Profile updated', tone: 'success', duration: 3000 });
      onDone();
    } catch (e) {
      setError(describeError(e, 'We couldn’t save your changes.'));
      setBusy(false);
    }
  };

  return (
    <form
      className="simple-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="profile-form__locked">
        <span className="profile-form__locked-text">
          <small>Mobile number</small>
          <strong className="num">{formatPhone(profile.phone)}</strong>
        </span>
        <Icon name="lock" size={16} />
      </div>
      <TextField label="Full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" error={touched ? errors.name : ''} />
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
      <Button type="submit" block loading={busy} disabled={!dirty}>
        Save
      </Button>
      <Button variant="ghost" block onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
    </form>
  );
}

/** One number we can call if something goes wrong on a trip. */
export function EmergencyContactForm({ onDone, onCancel }: FormProps) {
  const { profile } = useCustomerData();
  const { push } = useToasts();
  const current = profile ? localMobile(profile.emergencyContact) : '';
  const [number, setNumber] = useState(current);
  const [busy, setBusy] = useState<'' | 'save' | 'remove'>('');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  if (!profile) return null;

  const invalid = !isValidIndianMobile(number)
    ? 'Enter a 10-digit mobile number.'
    : number === localMobile(profile.phone)
      ? 'Use someone else’s number, not your own.'
      : '';

  const run = async (kind: 'save' | 'remove') => {
    setTouched(true);
    if (busy || (kind === 'save' && invalid)) return;
    setBusy(kind);
    setError('');
    try {
      await updateCustomerProfile(profile.uid, { emergencyContact: kind === 'save' ? `+91 ${number}` : '' });
      push({ title: kind === 'save' ? 'Emergency contact saved' : 'Emergency contact removed', tone: 'success', duration: 3000 });
      onDone();
    } catch (e) {
      setError(describeError(e, 'We couldn’t update the number. Please try again.'));
      setBusy('');
    }
  };

  return (
    <form
      className="simple-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void run('save');
      }}
    >
      <p className="simple-form__lead">
        <Icon name="emergency" size={18} /> Someone we can call if something goes wrong on a trip.
      </p>
      <TextField
        label="Mobile number"
        prefix="+91"
        value={number}
        onChange={(e) => setNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
        inputMode="numeric"
        autoComplete="off"
        placeholder="10-digit number"
        error={touched ? invalid : ''}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" block loading={busy === 'save'} disabled={!!busy || number === current}>
        Save
      </Button>
      {current ? (
        <Button variant="secondary" block loading={busy === 'remove'} disabled={!!busy} onClick={() => void run('remove')}>
          Remove contact
        </Button>
      ) : null}
      <Button variant="ghost" block onClick={onCancel} disabled={!!busy}>
        Cancel
      </Button>
    </form>
  );
}
