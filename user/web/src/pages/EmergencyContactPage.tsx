// Emergency contact on its own: one number, saved or removed. Opened from the profile drawer.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCustomerData } from '@core/context/CustomerData';
import { updateCustomerProfile } from '@core/services/userService';
import { isValidIndianMobile, localMobile } from '@core/utils/format';
import { describeError } from '@core/utils/retry';
import { Button, EmptyState, Notice, PageHead, TextField } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useAuth } from '@/state/Auth';
import { useSeo } from '@/lib/seo';
import { useToasts } from '@/state/Toasts';

export function EmergencyContactPage() {
  useSeo({ title: 'Emergency contact', noindex: true });
  const navigate = useNavigate();
  const { profile } = useCustomerData();
  const { openLoginModal } = useAuth();
  const { push } = useToasts();
  const current = profile ? localMobile(profile.emergencyContact) : '';
  const [number, setNumber] = useState(current);
  const [busy, setBusy] = useState<'' | 'save' | 'remove'>('');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);

  if (!profile) {
    return (
      <div className="page">
        <div className="card card--center">
          <EmptyState
            art="welcome"
            title="Sign in to add an emergency contact"
            action={
              <Button variant="primary" onClick={() => openLoginModal({ title: 'Sign in' })}>
                Sign in
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const invalid = !isValidIndianMobile(number)
    ? 'Enter a 10-digit mobile number.'
    : number === localMobile(profile.phone)
      ? 'Use someone else’s number, not your own.'
      : '';
  const done = (message: string) => {
    push({ title: message, tone: 'success', duration: 3000 });
    if ((window.history.state as { idx?: number } | null)?.idx) navigate(-1);
    else navigate('/', { replace: true });
  };

  const save = async () => {
    setTouched(true);
    if (invalid || busy) return;
    setBusy('save');
    setError('');
    try {
      await updateCustomerProfile(profile.uid, { emergencyContact: `+91 ${number}` });
      done('Emergency contact saved');
    } catch (e) {
      setError(describeError(e, 'We couldn’t save the number. Please try again.'));
      setBusy('');
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy('remove');
    setError('');
    try {
      await updateCustomerProfile(profile.uid, { emergencyContact: '' });
      done('Emergency contact removed');
    } catch (e) {
      setError(describeError(e, 'We couldn’t remove the number. Please try again.'));
      setBusy('');
    }
  };

  return (
    <>
      <PageHead title="Emergency contact" />
      <div className="page">
        <form
          className="card simple-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="simple-form__head">
            <span className="simple-form__icon">
              <Icon name="emergency" size={22} />
            </span>
            <div>
              <h2>Emergency contact</h2>
              <p>Someone we can call if something goes wrong on a trip.</p>
            </div>
          </div>
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
            <Button variant="ghost" block loading={busy === 'remove'} disabled={!!busy} onClick={() => void remove()}>
              Remove contact
            </Button>
          ) : null}
        </form>
      </div>
    </>
  );
}
