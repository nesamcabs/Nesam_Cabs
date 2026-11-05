import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCustomerData } from '@/state/CustomerData';
import { updateCustomerProfile } from '@core/services/userService';
import { formatPhone, isValidEmail, isValidIndianMobile, isValidName, localMobile } from '@core/utils/format';
import { describeError } from '@core/utils/retry';
import { Button, Dialog, Notice, PageHead, TextField } from '@/components/ui';
import { AccountLayout, SignInPrompt } from '@/components/AccountLayout';
import { Icon } from '@/components/Icon';
import { useSeo } from '@/lib/seo';
import { useToasts } from '@/state/Toasts';

const LANGUAGES = ['English', 'தமிழ் (Tamil)', 'हिन्दी (Hindi)'];

export function EditProfilePage() {
  useSeo({ title: 'Edit Profile', noindex: true });
  const navigate = useNavigate();
  const { profile } = useCustomerData();
  const { push } = useToasts();
  const [name, setName] = useState(profile?.name || '');
  const [email, setEmail] = useState(profile?.email || '');
  const [emergency, setEmergency] = useState(profile?.emergencyContact ? localMobile(profile.emergencyContact) : '');
  const [language, setLanguage] = useState(profile?.language || 'English');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const dirty =
    !!profile &&
    (name.trim() !== profile.name ||
      email.trim().toLowerCase() !== profile.email ||
      emergency !== localMobile(profile.emergencyContact) ||
      language !== (profile.language || 'English'));

  // Closing the tab with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  if (!profile) {
    return (
      <AccountLayout>
        <PageHead backTo="/account" title="My Profile">
          Personal details and contact information.
        </PageHead>
        <SignInPrompt title="Sign in to edit your profile" text="Sign in with your mobile number to update your personal details and emergency contact." />
      </AccountLayout>
    );
  }

  const errors = {
    name: !isValidName(name) ? 'Enter your full name (letters and spaces, 2–60 characters).' : '',
    email: email.trim() && !isValidEmail(email) ? 'Enter a valid email address, or leave it blank.' : '',
    emergency: emergency && !isValidIndianMobile(emergency) ? 'Enter a 10-digit number, or leave it blank.' : emergency && emergency === localMobile(profile.phone) ? 'The emergency contact must differ from your own number.' : '',
  };

  const save = async () => {
    setTouched(true);
    if (errors.name || errors.email || errors.emergency || busy) return;
    setBusy(true);
    setError('');
    try {
      await updateCustomerProfile(profile.uid, { name, email: email.toLowerCase(), emergencyContact: emergency ? `+91 ${emergency}` : '', language });
      push({ title: 'Profile updated', tone: 'success', duration: 3500 });
      navigate('/account', { replace: true });
    } catch (e) {
      setError(describeError(e, 'We couldn’t save your changes.'));
    } finally {
      setBusy(false);
    }
  };

  const leave = () => (dirty ? setConfirmLeave(true) : navigate('/account'));

  return (
    <AccountLayout>
      <PageHead
        title="My Profile"
        back={
          <button type="button" className="back-btn" aria-label="Back to account" onClick={leave}>
            <Icon name="arrow-left" size={17} />
          </button>
        }
      >
        Personal details and contact information.
      </PageHead>

      <div className="split">
        <form
          className="card form-card"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <TextField label="Mobile number (sign-in)" value={formatPhone(profile.phone)} readOnly hint="Your sign-in number can’t be changed here. Contact support to change it." />
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
            hint="Booking confirmations and receipts are sent here."
            error={touched ? errors.email : ''}
          />
          <TextField
            label={
              <>
                Emergency contact <small>(optional)</small>
              </>
            }
            prefix="+91"
            value={emergency}
            onChange={(e) => setEmergency(e.target.value.replace(/\D/g, '').slice(0, 10))}
            inputMode="numeric"
            autoComplete="off"
            placeholder="10-digit number"
            hint="Used by the safety centre during a trip."
            error={touched ? errors.emergency : ''}
          />
          <fieldset className="field">
            <legend className="field__label">Language</legend>
            <div className="quick-row" role="radiogroup" aria-label="Language">
              {LANGUAGES.map((l) => (
                <button key={l} type="button" role="radio" aria-checked={language === l} className="chip" onClick={() => setLanguage(l)}>
                  {l}
                </button>
              ))}
            </div>
          </fieldset>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="form-actions">
            <Button variant="secondary" onClick={leave}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!dirty}>
              Save changes
            </Button>
          </div>
        </form>

        <aside className="split__aside">
          <div className="aside-card">
            <h2>Why we ask</h2>
            <ul className="aside-card__list">
              <li>
                <Icon name="receipt" size={18} /> Receipts and confirmations go to your email.
              </li>
              <li>
                <Icon name="emergency" size={18} /> Your emergency contact is used by the safety centre during a trip.
              </li>
              <li>
                <Icon name="lock" size={18} /> Your mobile number is how you sign in, so it stays fixed here.
              </li>
            </ul>
          </div>
        </aside>
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
              <Button variant="danger" onClick={() => navigate('/account')}>
                Discard
              </Button>
            </>
          }
        >
          <p className="muted">Your edits have not been saved.</p>
        </Dialog>
      ) : null}
    </AccountLayout>
  );
}
