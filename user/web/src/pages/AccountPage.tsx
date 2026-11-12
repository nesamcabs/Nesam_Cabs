import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useCustomerData } from '@core/context/CustomerData';
import { updateCustomerProfile } from '@core/services/userService';
import { COMPANY_LEGAL_NAME } from '@core/config/constants';
import { formatINR, formatPhone } from '@core/utils/format';
import { describeError } from '@core/utils/retry';
import { callFunction } from '@core/services/callables';
import { Avatar, Button, Dialog, EmptyState, Notice, PageHead } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { PhotoError, uploadProfilePhoto } from '@/lib/avatarUpload';
import { useSeo } from '@/lib/seo';
import { useAuth } from '@/state/Auth';

/** Each kind of row keeps its own icon colour, so a list reads at a glance. */
const TONES: Record<string, string> = {
  'saved-place': 'brand', emergency: 'red', help: 'blue', receipt: 'green', offers: 'gold', 'trip-history': 'brand',
  support: 'blue', phone: 'green', info: 'gold', document: 'brand',
};

function Row({ icon, label, value, to, href, onPress }: { icon: string; label: string; value?: ReactNode; to?: string; href?: string; onPress?: () => void }) {
  const tone = TONES[icon] ?? 'brand';
  const cls = `setting setting--${tone}`;
  const inner = (
    <>
      <span className="setting__icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="setting__label">{label}</span>
      {value ? <span className="setting__value truncate">{value}</span> : null}
      {to || href || onPress ? <Icon name="chevron-right" size={18} /> : null}
    </>
  );
  if (onPress)
    return (
      <button type="button" className={`${cls} setting--button`} onClick={onPress}>
        {inner}
      </button>
    );
  if (to)
    return (
      <Link className={cls} to={to}>
        {inner}
      </Link>
    );
  if (href)
    return (
      <a className={cls} href={href}>
        {inner}
      </a>
    );
  return <div className={cls}>{inner}</div>;
}

export type ProfileEditView = 'details' | 'emergency';

/** `drawer`: shown inside the profile side drawer (no page heading or page padding); `onEdit` opens an edit form in place. */
export function AccountPage({ variant = 'page', onEdit }: { variant?: 'page' | 'drawer'; onEdit?: (view: ProfileEditView) => void }) {
  useSeo(variant === 'page' ? { title: 'My Account', noindex: true } : null);
  const inDrawer = variant === 'drawer';
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
    const signedOut = (
      <>
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
      </>
    );
    return inDrawer ? <div className="account account--drawer">{signedOut}</div> : (
      <>
        <PageHead title="Account" />
        <div className="page">{signedOut}</div>
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

  const body = (
    <>
        {error ? <Notice tone="error">{error}</Notice> : null}

        <div className={`account ${inDrawer ? 'account--drawer' : ''}`}>
          <aside className="account__side">
            <section className="profile-card" aria-label="Your profile">
              <button type="button" className="profile-card__photo" onClick={() => file.current?.click()} disabled={progress != null} aria-label="Change profile photo">
                <Avatar name={profile.name} photoUrl={profile.photoUrl} size={52} />
                <span className="profile-card__cam">
                  <Icon name={progress != null ? 'document-upload' : 'camera'} size={12} />
                </span>
              </button>
              <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
              <div className="profile-card__info">
                <h2 className="truncate">{profile.name}</h2>
                <p className="truncate">{formatPhone(profile.phone)}</p>
                {progress != null ? <p className="truncate">Uploading photo… {progress}%</p> : profile.email ? <p className="truncate">{profile.email}</p> : null}
              </div>
              {onEdit ? (
                <button type="button" className="profile-card__edit" onClick={() => onEdit('details')} aria-label="Edit profile" title="Edit profile">
                  <Icon name="edit" size={17} />
                </button>
              ) : (
                <Link className="profile-card__edit" to="/account/edit" aria-label="Edit profile" title="Edit profile">
                  <Icon name="edit" size={17} />
                </Link>
              )}
            </section>

            {/* Refund credits live on the Payments page; the drawer stays a short menu. */}
            {inDrawer ? null : (
            <Link className="credit-row" to="/account/payments">
              <Icon name="wallet" size={18} />
              <span>Refund credits</span>
              <strong className="num">{formatINR(profile.walletBalance)}</strong>
              <Icon name="chevron-right" size={16} />
            </Link>
            )}
          </aside>

          <div className="account__groups">
            <section className="group" aria-labelledby="g-account">
              <h2 id="g-account" className="group__title">Account</h2>
              <div className="card card--list">
                <Row icon="emergency" label="Emergency contact" value={profile.emergencyContact || 'Not set'} {...(onEdit ? { onPress: () => onEdit('emergency') } : { to: '/account/emergency' })} />
              </div>
            </section>
            <section className="group" aria-labelledby="g-trips">
              <h2 id="g-trips" className="group__title">Trips &amp; payments</h2>
              <div className="card card--list">
                <Row icon="trip-history" label="My trips" to="/trips" />
                <Row icon="receipt" label="Payments and refunds" to="/account/payments" />
                <Row icon="offers" label="Offers" to="/offers" />
              </div>
            </section>
            <section className="group" aria-labelledby="g-help">
              <h2 id="g-help" className="group__title">Help</h2>
              <div className="card card--list">
                <Row icon="support" label="Help and support" to="/support" />
                <Row icon="info" label="About NESAM Cabs" to="/about" />
                <Row icon="document" label="Terms & policies" to="/legal" />
              </div>
            </section>
            <section className="group" aria-label="Session">
              <div className="card card--list">
                <button type="button" className="setting setting--action" onClick={() => setConfirm(true)}>
                  <span className="setting__icon"><Icon name="logout" size={18} /></span>
                  <span className="setting__label">Log out</span>
                </button>
                <button type="button" className="setting setting--danger" onClick={() => setDeleteAsk(true)}>
                  <span className="setting__icon"><Icon name="trash" size={18} /></span>
                  <span className="setting__label">Delete my account</span>
                </button>
              </div>
              {deleteResult ? <Notice tone={deleteResult.tone}>{deleteResult.text}</Notice> : null}
              <p className="account__legal">{COMPANY_LEGAL_NAME}</p>
            </section>
          </div>
        </div>
    </>
  );

  return (
    <>
      {inDrawer ? body : (
        <>
          <PageHead title="Account" />
          <div className="page">{body}</div>
        </>
      )}

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
