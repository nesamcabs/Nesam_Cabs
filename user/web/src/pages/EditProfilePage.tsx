import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCustomerData } from '@core/context/CustomerData';
import { updateCustomerProfile } from '@core/services/userService';
import { formatPhone, isValidEmail, isValidName } from '@core/utils/format';
import { describeError } from '@core/utils/retry';
import { Button, Dialog, EmptyState, Notice, PageHead, TextField } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useAuth } from '@/state/Auth';
import { useSeo } from '@/lib/seo';
import { useToasts } from '@/state/Toasts';

export function EditProfilePage() {
  useSeo({ title: 'Edit Profile', noindex: true });
  const navigate = useNavigate();
  const { profile } = useCustomerData();
  const { openLoginModal } = useAuth();
  const { push } = useToasts();
  const [name, setName] = useState(profile?.name || '');
  const [email, setEmail] = useState(profile?.email || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  if (!profile) {
    return (
      <div className="page">
        <div className="card card--center">
          <EmptyState
            art="welcome"
            title="Sign in to edit your profile"
            action={
              <Button variant="primary" onClick={() => openLoginModal({ title: 'Sign in to edit profile' })}>
                Sign in
              </Button>
            }
          >
            Sign in with your mobile number to update your personal details.
          </EmptyState>
        </div>
      </div>
    );
  }

  const dirty =
    name.trim() !== profile.name ||
    email.trim().toLowerCase() !== profile.email;

  // Closing the tab with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

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
      push({ title: 'Profile updated', tone: 'success', duration: 3500 });
      leaveNow();
    } catch (e) {
      setError(describeError(e, 'We couldn’t save your changes.'));
    } finally {
      setBusy(false);
    }
  };

  const leaveNow = () => ((window.history.state as { idx?: number } | null)?.idx ? navigate(-1) : navigate('/', { replace: true }));
  const leave = () => (dirty ? setConfirmLeave(true) : leaveNow());

  return (
    <>
      <PageHead
        eyebrow="Account"
        title="Edit profile"
      >
        Keep your details current so drivers and receipts reach you.
      </PageHead>

      <div className="page">
        <form
          className="profile-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <section className="card profile-form__card" aria-labelledby="pf-details">
            <h2 id="pf-details" className="profile-form__title">Your details</h2>
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
          </section>

          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="profile-form__actions">
            <Button type="submit" block loading={busy} disabled={!dirty}>
              Save changes
            </Button>
            <Button variant="ghost" block onClick={leave}>
              Cancel
            </Button>
          </div>
          <p className="profile-form__note">
            <Icon name="lock" size={14} /> Your mobile number is your sign-in and can only be changed by support.
          </p>
        </form>
      </div>

      {confirmLeave ? (
        <Dialog
          title="Discard changes?"
          onClose={() => setConfirmLeave(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmLeave(false)}>
                Keep editing
              </Button>
              <Button variant="danger" onClick={leaveNow}>
                Discard
              </Button>
            </>
          }
        >
          <p className="muted">Your edits have not been saved.</p>
        </Dialog>
      ) : null}
    </>
  );
}
