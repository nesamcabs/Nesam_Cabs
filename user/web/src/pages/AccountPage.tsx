import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useCustomerData } from '@core/context/CustomerData';
import { updateCustomerProfile } from '@core/services/userService';
import { COMPANY_LEGAL_NAME, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { formatINR, formatPhone } from '@core/utils/format';
import { describeError } from '@core/utils/retry';
import { callFunction } from '@core/services/callables';
import { Avatar, Button, Dialog, EmptyState, LinkButton, Notice, PageHead } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { PhotoError, uploadProfilePhoto } from '@/lib/avatarUpload';
import { useSeo } from '@/lib/seo';
import { useAuth } from '@/state/Auth';

function Row({ icon, label, value, to, href }: { icon: string; label: string; value?: ReactNode; to?: string; href?: string }) {
  const inner = (
    <>
      <span className="setting__icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="setting__label">{label}</span>
      {value ? <span className="setting__value truncate">{value}</span> : null}
      {to || href ? <Icon name="chevron-right" size={18} /> : null}
    </>
  );
  if (to)
    return (
      <Link className="setting" to={to}>
        {inner}
      </Link>
    );
  if (href)
    return (
      <a className="setting" href={href}>
        {inner}
      </a>
    );
  return <div className="setting">{inner}</div>;
}

export function AccountPage() {
  useSeo({ title: 'My Account', noindex: true });
  const { profile } = useCustomerData();
  const { signOut, openLoginModal } = useAuth();
  const file = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [deleteAsk, setDeleteAsk] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const requestDeletion = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteResult(null);
    try {
      const r = await callFunction<{ role: string }, { alreadyOpen: boolean; liveBookings: number; reference: string }>('requestAccountDeletion', { role: 'customer' });
      setDeleteResult({
        tone: 'success',
        text: `${r.alreadyOpen ? 'Your request is already with our team.' : 'Request received.'} Reference ${r.reference}. We will confirm by phone or email${r.liveBookings ? `. ${r.liveBookings} booking(s) are still open and must be completed or cancelled first` : ''}.`,
      });
    } catch (e) {
      setDeleteResult({ tone: 'error', text: describeError(e, 'The request was not sent. Please try again.') });
    } finally {
      setDeleting(false);
      setDeleteAsk(false);
    }
  };

  if (!profile) {
    return (
      <>
        <PageHead eyebrow="Your NESAM Cabs account" title="Account">
          Your details, saved places, payments and help.
        </PageHead>
        <div className="page">
          <div className="card card--center">
            <EmptyState
              art="welcome"
              title="Sign in to your account"
              action={
                <Button variant="primary" onClick={() => openLoginModal({ title: 'Sign in to account' })}>
                  Sign in
                </Button>
              }
            >
              Sign in to manage your profile, saved addresses and payment options.
            </EmptyState>
          </div>
          <div className="card card--list" style={{ marginTop: 16 }}>
            <Row icon="info" label="About NESAM Cabs" to="/about" />
                <Row icon="document" label="Terms, privacy & customer policies" to="/legal" />
          </div>
        </div>
      </>
    );
  }

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setError('');
    setProgress(0);
    try {
      const url = await uploadProfilePhoto(profile.uid, f, setProgress);
      await updateCustomerProfile(profile.uid, { photoUrl: url });
    } catch (e) {
      setError(e instanceof PhotoError ? e.message : describeError(e, 'We couldn’t update your photo.'));
    } finally {
      setProgress(null);
      if (file.current) file.current.value = '';
    }
  };

  return (
    <>
      <PageHead eyebrow="Your NESAM Cabs account" title="Account">
        Your details, saved places, payments and help.
      </PageHead>
      <div className="page">
        {error ? <Notice tone="error">{error}</Notice> : null}

        <div className="account">
          <aside className="account__side">
            <section className="card profile-card">
              <button type="button" className="profile-card__photo" onClick={() => file.current?.click()} disabled={progress != null} aria-label="Change profile photo">
                <Avatar name={profile.name} photoUrl={profile.photoUrl} size={104} />
                <span className="profile-card__cam">
                  <Icon name={progress != null ? 'document-upload' : 'camera'} size={16} />
                </span>
              </button>
              <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
              <h2>{profile.name}</h2>
              <p className="muted">{formatPhone(profile.phone)}</p>
              {profile.email ? <p className="muted small truncate">{profile.email}</p> : null}
              {progress != null ? <p className="small muted">Uploading photo… {progress}%</p> : null}
              <LinkButton block variant="secondary" to="/account/edit" icon="edit">
                Edit profile
              </LinkButton>
            </section>

            <Link className="credit-card" to="/account/payments">
              <Icon name="wallet" size={30} />
              <span className="credit-card__text">
                <small>Refund credits</small>
                <strong className="num">{formatINR(profile.walletBalance)}</strong>
              </span>
              <Icon name="chevron-right" size={20} />
            </Link>
          </aside>

          <div className="account__groups">
            <section className="group" aria-labelledby="g-profile">
              <h2 id="g-profile" className="eyebrow">
                Profile &amp; places
              </h2>
              <div className="card card--list">
                <Row icon="saved-place" label="Saved places" to="/account/places" />
                <Row icon="emergency" label="Emergency contact" value={profile.emergencyContact || 'Not set'} to="/account/edit" />
                <Row icon="help" label="Language" value={profile.language || 'English'} to="/account/edit" />
              </div>
            </section>
            <section className="group" aria-labelledby="g-pay">
              <h2 id="g-pay" className="eyebrow">
                Payments &amp; offers
              </h2>
              <div className="card card--list">
                <Row icon="receipt" label="Payments and refunds" to="/account/payments" />
                <Row icon="offers" label="Offers" to="/offers" />
                <Row icon="trip-history" label="My trips" to="/trips" />
              </div>
            </section>
            <section className="group" aria-labelledby="g-help">
              <h2 id="g-help" className="eyebrow">
                Help
              </h2>
              <div className="card card--list">
                <Row icon="support" label="Help and support tickets" to="/support" />
                <Row icon="phone" label="Call NESAM Cabs" value={SUPPORT_PHONE_DISPLAY} href={`tel:${SUPPORT_PHONE}`} />
                <Row icon="info" label="About NESAM Cabs" to="/about" />
                <Row icon="document" label="Terms, privacy & customer policies" to="/legal" />
              </div>
            </section>
            <section className="group" aria-label="Session">
              <h2 className="eyebrow">Session</h2>
              <div className="card account__logout">
                <div>
                  <strong>Log out of this browser</strong>
                  <p className="muted small">{COMPANY_LEGAL_NAME}</p>
                </div>
                <Button variant="danger" icon="logout" onClick={() => setConfirm(true)}>
                  Log out
                </Button>
              </div>
            </section>
            <section className="group" aria-label="Delete account">
              <h2 className="eyebrow">Privacy</h2>
              <div className="card account__logout">
                <div>
                  <strong>Delete my account</strong>
                  <p className="muted small">Ask us to erase your account and personal data.</p>
                </div>
                <Button variant="secondary" onClick={() => setDeleteAsk(true)}>
                  Request deletion
                </Button>
              </div>
              {deleteResult ? <Notice tone={deleteResult.tone}>{deleteResult.text}</Notice> : null}
            </section>
          </div>
        </div>
      </div>

      {deleteAsk ? (
        <Dialog
          title="Delete your account?"
          onClose={() => setDeleteAsk(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleteAsk(false)}>
                Keep my account
              </Button>
              <Button variant="danger" loading={deleting} onClick={() => void requestDeletion()}>
                Request deletion
              </Button>
            </>
          }
        >
          <p className="muted">
            We will verify the request, settle anything still open (bookings, payments) and then delete your account and personal data. Records we must keep by law, such as invoices, are retained. This cannot be undone once it is processed.
          </p>
        </Dialog>
      ) : null}

      {confirm ? (
        <Dialog
          title="Log out of NESAM Cabs?"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirm(false)}>
                Stay signed in
              </Button>
              <Button onClick={() => void signOut().catch(() => setError('We couldn’t log you out. Please try again.'))}>Log out</Button>
            </>
          }
        >
          <p className="muted">You’ll need to verify your mobile number again to sign back in.</p>
        </Dialog>
      ) : null}
    </>
  );
}
