import React, { useState } from 'react';
import type { VendorRecord } from '../types';
import { SECTION_LABELS } from '../config/onboarding';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { Banner, Button } from '../ui/kit';
import { Icon, IconSprite } from '../ui/Icon';

interface AccountStatusScreenProps {
  record: VendorRecord;
  onSignOut: () => void;
  /** REJECTED only: reopen the wizard to correct and reapply. */
  onReapply?: () => void;
}

const SUPPORT_PHONE = import.meta.env.VITE_SUPPORT_PHONE || '+91 90250 99990';

export const AccountStatusScreen: React.FC<AccountStatusScreenProps> = ({ record, onSignOut, onReapply }) => {
  const online = useOnlineStatus();
  const [lang, setLang] = useState<'ta' | 'en'>('ta');
  const ta = lang === 'ta';
  const businessName = record.business?.businessName || record.fleet?.plates?.[0] || 'your fleet';

  const shell = (children: React.ReactNode) => (
    <div className="nesam-vendor-app vx" data-vendor="true" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px 14px', background: 'var(--v-page)' }}>
      <IconSprite />
      <div style={{ width: '100%', maxWidth: 460 }}>
        {!online && (
          <div style={{ marginBottom: 14 }}>
            <Banner tone="warn">You’re offline. This page updates when connection returns.</Banner>
          </div>
        )}
        <div className="nx-preview" style={{ width: '100%', maxWidth: 'none', background: '#fff', border: '1px solid var(--nx-line)', borderRadius: 20, padding: 24, boxShadow: '0 4px 20px rgba(0,0,0,0.04)' }}>
          {/* Header language toggle */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', color: 'var(--nx-muted)', textTransform: 'uppercase' }}>
              NESAM PARTNER
            </span>
            <div className="nx-language" aria-label="Language selector">
              <button type="button" onClick={() => setLang('ta')} aria-pressed={ta}>தமிழ்</button>
              <button type="button" onClick={() => setLang('en')} aria-pressed={!ta}>EN</button>
            </div>
          </div>
          {children}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, padding: '0 8px', fontSize: 13, color: 'var(--nx-muted)' }}>
          <a href={`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`} style={{ color: 'var(--nx-red)', textDecoration: 'none', fontWeight: 600 }}>
            {SUPPORT_PHONE}
          </a>
          <button type="button" onClick={onSignOut} style={{ background: 'none', border: 0, color: 'var(--nx-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, font: 'inherit' }}>
            <Icon name="logout" /> {ta ? 'வெளியேறு' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  );

  if (record.status === 'SUSPENDED') {
    return shell(
      <div style={{ textAlign: 'center' }}>
        <div className="nx-review-icon" style={{ background: 'var(--nx-pink)', color: 'var(--nx-red)' }}>
          <Icon name="alert" />
        </div>
        <p className="nx-eyebrow" style={{ color: 'var(--nx-red)' }}>ACCOUNT SUSPENDED</p>
        <h2 className="nx-review-title">{ta ? 'கணக்கு தற்காலிகமாக நிறுத்தப்பட்டுள்ளது' : 'Account Suspended'}</h2>
        <p className="nx-subtitle">
          {ta ? 'உங்கள் கணக்கு NESAM நிர்வாகத்தால் நிறுத்தப்பட்டுள்ளது. தொடர ஆதரவை அணுகவும்.' : `Operations for ${businessName} are paused by NESAM. Contact support to resume.`}
        </p>
        {record.review?.note && (
          <div className="nx-section" style={{ textAlign: 'left', marginTop: 14 }}>
            <div className="nx-tiny">REASON</div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--nx-ink)' }}>{record.review.note}</p>
          </div>
        )}
        <div style={{ marginTop: 20 }}>
          <a href={`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`} className="v-button v-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            {ta ? 'அலுவலகத்தை அழைக்கவும்' : 'Contact Support'}
          </a>
        </div>
      </div>
    );
  }

  if (record.status === 'REJECTED') {
    return shell(
      <div style={{ textAlign: 'center' }}>
        <div className="nx-review-icon" style={{ background: 'var(--nx-pink)', color: 'var(--nx-red)' }}>
          <Icon name="alert" />
        </div>
        <p className="nx-eyebrow" style={{ color: 'var(--nx-red)' }}>APPLICATION NOT APPROVED</p>
        <h2 className="nx-review-title">{ta ? 'விண்ணப்பம் ஏற்கப்படவில்லை' : 'Application Not Approved'}</h2>
        <p className="nx-subtitle">
          {ta ? 'சமர்ப்பிக்கப்பட்ட விவரங்களில் சில திருத்தங்கள் தேவைப்படுகின்றன.' : `We couldn’t approve ${businessName} with the details provided.`}
        </p>
        {record.review?.note && (
          <div className="nx-section" style={{ textAlign: 'left', marginTop: 14 }}>
            <div className="nx-tiny">REASON FROM VERIFICATION TEAM</div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--nx-ink)' }}>{record.review.note}</p>
          </div>
        )}
        {!!record.review?.flaggedSections.length && (
          <p className="nx-subtitle" style={{ fontSize: 12, marginTop: 10 }}>
            Sections to correct: <strong>{record.review.flaggedSections.map((s) => SECTION_LABELS[s]).join(', ')}</strong>
          </p>
        )}
        <div style={{ marginTop: 20 }}>
          {onReapply && (
            <Button variant="primary" block onClick={onReapply}>
              {ta ? 'விவரங்களை திருத்தி மீண்டும் விண்ணப்பிக்கவும்' : 'Correct details & reapply'}
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Under review matching reference Review screen exactly
  return shell(
    <>
      <div style={{ textAlign: 'center' }}>
        <div className="nx-review-icon" style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--nx-soft)', color: 'var(--nx-ink)', display: 'grid', placeItems: 'center', margin: '0 auto 14px', fontSize: 24 }}>
          <Icon name="clock" />
        </div>
        <p className="nx-eyebrow" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', color: 'var(--nx-muted)', margin: 0 }}>
          {ta ? 'விண்ணப்பம் பெறப்பட்டது' : 'APPLICATION RECEIVED'}
        </p>
        <h2 className="nx-review-title" style={{ fontSize: 22, fontWeight: 800, margin: '6px 0 8px', color: 'var(--nx-ink)', lineHeight: 1.25 }}>
          {ta ? 'நீங்கள் தயார்.\nநாங்கள் சரிபார்க்கிறோம்.' : 'You’re ready.\nWe’re verifying your details.'}
        </h2>
        <p className="nx-subtitle" style={{ fontSize: 13, color: 'var(--nx-muted)', margin: 0 }}>
          {ta
            ? 'உங்கள் விவரங்கள் verification-ல் உள்ளன. Admin approval முடிந்ததும் account activate ஆகும்.'
            : 'Your details are under office verification. Your account activates once approved by the Admin.'}
        </p>
      </div>

      <div className="nx-section" style={{ background: 'var(--nx-soft)', borderRadius: 14, padding: 16, marginTop: 18 }}>
        <div className="nx-tiny" style={{ fontSize: 10, fontWeight: 700, color: 'var(--nx-muted)', letterSpacing: '0.8px' }}>
          {ta ? 'விண்ணப்ப எண்' : 'APPLICATION ID'}
        </div>
        <div className="nx-person" style={{ fontSize: 16, fontWeight: 800, color: 'var(--nx-ink)', marginBottom: 14, marginTop: 2 }}>
          {record.fleet?.plates?.[0] || 'NSM-VN-PENDING'}
        </div>

        <div className="nx-review-line" style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <span style={{ color: 'var(--nx-green)', display: 'grid', placeItems: 'center' }}><Icon name="check" /></span>
          <div>
            <strong style={{ display: 'block', fontSize: 13, color: 'var(--nx-ink)' }}>
              {ta ? 'ஒப்பந்தம் ஏற்றுக்கொள்ளப்பட்டது' : 'Agreement accepted'}
            </strong>
            <span style={{ fontSize: 11, color: 'var(--nx-muted)' }}>
              Fleet Vendor Partner Agreement · v1.0
            </span>
          </div>
        </div>

        <div className="nx-review-line" style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <span style={{ color: 'var(--nx-green)', display: 'grid', placeItems: 'center' }}><Icon name="check" /></span>
          <div>
            <strong style={{ display: 'block', fontSize: 13, color: 'var(--nx-ink)' }}>
              {ta ? 'ஆவணங்கள் சமர்ப்பிக்கப்பட்டன' : 'Documents submitted'}
            </strong>
            <span style={{ fontSize: 11, color: 'var(--nx-muted)' }}>
              Business, bank, vehicle and driver details
            </span>
          </div>
        </div>

        <div className="nx-review-line" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ color: 'var(--v-amber)', display: 'grid', placeItems: 'center' }}><Icon name="clock" /></span>
          <div>
            <strong style={{ display: 'block', fontSize: 13, color: 'var(--nx-ink)' }}>
              {ta ? 'அலுவலக சரிபார்ப்பு நிலுவையில் உள்ளது' : 'Office verification in progress'}
            </strong>
            <span style={{ fontSize: 11, color: 'var(--nx-muted)' }}>
              {ta ? 'Admin approves before marketplace, drivers and wallet unlock.' : 'Admin approves before marketplace, drivers and wallet unlock.'}
            </span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18, display: 'grid', gap: 10 }}>
        <a
          href={`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`}
          className="v-button v-primary"
          style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 18px', fontSize: 14 }}
        >
          <Icon name="phone" /> {ta ? 'ஆதரவு மையத்தை அழைக்கவும்' : 'Contact NESAM support'}
        </a>
      </div>

      <div className="nx-footer-note" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, color: 'var(--nx-green)', marginTop: 14, fontWeight: 600 }}>
        <Icon name="check" />
        <span>{ta ? 'Approval முடிந்ததும் தானாகவே dashboard திறக்கும்.' : 'This page updates automatically upon approval.'}</span>
      </div>
    </>
  );
};
