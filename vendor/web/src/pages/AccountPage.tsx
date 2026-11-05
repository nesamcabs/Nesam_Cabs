import React, { useEffect, useMemo, useState } from 'react';
import type { StoredFile } from '../types';
import { usePartner } from '../state/Partner';
import { BUSINESS_REG_TYPES, IDENTITY_PROOF_TYPES, INDIAN_STATES } from '../config/onboarding';
import { updateApprovedContactInfo } from '../services/onboardingService';
import { resolveFileUrl } from '../services/storageService';
import { currentTextOf, subscribeToMyAcceptances, type Acceptance } from '../services/agreements';
import { describeDataError } from '../utils/retry';
import { digitsOnly, normalizeSpaces, validateAltPhone, validateEmail, validatePincode } from '../utils/validation';
import { Avatar, Badge, Banner, Button, Dialog, Empty, KV, SelectInput, Tabs, TextInput, Toast, useToast } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { formatDateTime12 } from '../utils/time';
import { signOutUser } from '../services/authService';

const SUPPORT_PHONE = import.meta.env.VITE_SUPPORT_PHONE || '+91 90250 99990';
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || '';

const FileLinks: React.FC<{ files: StoredFile[] }> = ({ files }) => {
  const [opening, setOpening] = useState('');
  const [error, setError] = useState('');
  const open = async (f: StoredFile) => {
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    setOpening(f.path);
    setError('');
    try {
      const url = await resolveFileUrl(f.path);
      if (win) win.location.href = url;
      else window.open(url, '_blank', 'noopener');
    } catch (e) {
      win?.close();
      setError(describeDataError(e));
    } finally {
      setOpening('');
    }
  };
  if (!files.length) return <span className="vx-muted">No files</span>;
  return (
    <span className="vx-wrap" style={{ justifyContent: 'flex-end' }}>
      {files.map((f) => (
        <Button key={f.path} size="sm" icon="document" loading={opening === f.path} onClick={() => open(f)} title={f.name}>
          {f.name.length > 18 ? `${f.name.slice(0, 16)}…` : f.name}
        </Button>
      ))}
      {error && <span className="vx-err" style={{ width: '100%' }}>{error}</span>}
    </span>
  );
};

export const AccountPage: React.FC = () => {
  const { profile, record, penalties, links, go } = usePartner();
  const [tab, setTab] = useState<'business' | 'documents' | 'agreements' | 'help'>('business');
  const { toast, show, dismiss } = useToast();
  const openLinks = links.filter((l) => l.toVendorId === profile.id && (l.status === 'Awaiting OTP' || l.status === 'Office review')).length;
  const owed = penalties.filter((p) => p.status === 'Pending').length;

  return (
    <div>
      <Toast toast={toast} onDismiss={dismiss} />

      {/* Header bar matching reference vTitle */}
      <div className="v-between" style={{ marginBottom: 18, alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--v-ink)', letterSpacing: '-0.3px' }}>My Business</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--v-muted)' }}>Your partner profile and account.</p>
        </div>
      </div>

      {/* Business profile card matching reference .v-business-head */}
      <div className="v-panel" style={{ padding: 20, marginBottom: 16 }}>
        <div className="v-between" style={{ alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <span
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: 'var(--v-line)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--v-ink)',
                fontSize: 20,
              }}
            >
              <Icon name="user" />
            </span>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--v-ink)' }}>
                {profile.companyName || record.business?.businessName || 'Fleet Partner'}
              </h2>
              <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--v-muted)' }}>
                Vendor ID: <strong>{profile.id.slice(0, 12).toUpperCase()}</strong>
              </p>
            </div>
          </div>
          <Badge tone="green">Verified Partner</Badge>
        </div>

        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--v-line)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div>
            <small style={{ fontSize: 11, color: 'var(--v-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Authorized Signatory</small>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--v-ink)', marginTop: 2 }}>{record.business?.vendorName || 'Partner'}</div>
          </div>
          <div>
            <small style={{ fontSize: 11, color: 'var(--v-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Registered Mobile</small>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--v-ink)', marginTop: 2 }}>+91 {record.phone}</div>
          </div>
          <div>
            <small style={{ fontSize: 11, color: 'var(--v-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Account Type</small>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--v-ink)', marginTop: 2 }}>Fleet Vendor</div>
          </div>
        </div>
      </div>

      {/* Quick shortcuts */}
      <div className="vx-wrap" style={{ margin: '14px 0' }}>
        <Button icon="swap" onClick={() => go('requests')}>
          Linking requests{openLinks > 0 ? ` · ${openLinks}` : ''}
        </Button>
        <Button icon="alert" onClick={() => go('alerts')}>
          Penalties{owed > 0 ? ` · ${owed}` : ''}
        </Button>
      </div>

      {/* Tabs */}
      <div className="v-tabs" role="group" aria-label="Account tabs" style={{ marginBottom: 16 }}>
        <button type="button" aria-pressed={tab === 'business'} onClick={() => setTab('business')}>
          <span>Business Profile</span>
        </button>
        <button type="button" aria-pressed={tab === 'documents'} onClick={() => setTab('documents')}>
          <span>Documents</span>
        </button>
        <button type="button" aria-pressed={tab === 'agreements'} onClick={() => setTab('agreements')}>
          <span>Agreement</span>
        </button>
        <button type="button" aria-pressed={tab === 'help'} onClick={() => setTab('help')}>
          <span>Help & Sign Out</span>
        </button>
      </div>

      {tab === 'business' && <BusinessTab onToast={show} />}
      {tab === 'documents' && <DocumentsTab />}
      {tab === 'agreements' && <AgreementsTab />}
      {tab === 'help' && (
        <div className="v-panel" style={{ padding: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 8px', color: 'var(--v-ink)' }}>NESAM Office Contact</h2>
          <p className="vx-muted" style={{ marginBottom: 16 }}>
            Reach out to our partner support team for verification, banking updates, emergency duty assistance or billing inquiries.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <a className="v-button v-primary" href={`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`}>
              <Icon name="phone" /> Call {SUPPORT_PHONE}
            </a>
            {SUPPORT_EMAIL && (
              <a className="v-button v-secondary" href={`mailto:${SUPPORT_EMAIL}`}>
                <Icon name="document" /> Email support
              </a>
            )}
          </div>
          <hr className="vx-divider" style={{ margin: '16px 0' }} />
          <Button variant="danger" icon="logout" onClick={() => void signOutUser()}>
            Sign out of account
          </Button>
        </div>
      )}
    </div>
  );
};

const BusinessTab: React.FC<{ onToast: (t: string, k?: 'ok' | 'err') => void }> = ({ onToast }) => {
  const { record } = usePartner();
  const b = record.business;
  const p = record.payoutSummary;
  const [form, setForm] = useState({
    email: b?.email ?? '',
    altPhone: b?.altPhone ?? '',
    line1: b?.address.line1 ?? '',
    line2: b?.address.line2 ?? '',
    city: b?.address.city ?? '',
    state: b?.address.state ?? '',
    pincode: b?.address.pincode ?? '',
  });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const errors = useMemo(
    () => ({
      email: form.email ? validateEmail(form.email) : '',
      altPhone: form.altPhone ? validateAltPhone(form.altPhone, record.phone) : '',
      pincode: form.pincode ? validatePincode(form.pincode) : '',
      city: form.line1 && !form.city.trim() ? 'Enter the city.' : '',
    }),
    [form, record.phone]
  );
  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError('');
  };
  const bad = Object.values(errors).some(Boolean);

  const save = async () => {
    setTouched(true);
    if (!b || bad) return;
    setSaving(true);
    setError('');
    try {
      await updateApprovedContactInfo(b, {
        email: form.email.trim().toLowerCase(),
        altPhone: digitsOnly(form.altPhone),
        address: {
          line1: normalizeSpaces(form.line1),
          line2: normalizeSpaces(form.line2),
          city: normalizeSpaces(form.city),
          state: form.state,
          pincode: form.pincode.trim(),
        },
      });
      onToast('Contact details saved.');
    } catch (e) {
      setError(describeDataError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Settlement Bank Account Details */}
      <div className="v-panel" style={{ padding: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px', color: 'var(--v-ink)' }}>Settlement Bank Account</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <KV label="Account Holder">{p?.accountHolderName || b?.vendorName || '—'}</KV>
          <KV label="Account Number">{p?.bankLast4 ? `•••• •••• ${p.bankLast4}` : 'Saved securely'}</KV>
          <KV label="IFSC Code">{p?.ifsc || '—'}</KV>
          <KV label="UPI ID">{p?.upiId || '—'}</KV>
        </div>
        <p className="vx-hint" style={{ marginTop: 12 }}>
          To update your registered settlement bank account or IFSC, contact the NESAM office for security verification.
        </p>
      </div>

      {/* Editable contact information */}
      <div className="v-panel" style={{ padding: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px', color: 'var(--v-ink)' }}>Operating Address & Contact</h3>
        {b ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="vx-grid vx-grid--2" style={{ gap: 10 }}>
              <TextInput id="acc-email" label="Business Email" type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} error={touched ? errors.email : ''} />
              <TextInput id="acc-alt" label="Alternate Mobile" inputMode="numeric" value={form.altPhone} onChange={(e) => set('altPhone')(e.target.value)} error={touched ? errors.altPhone : ''} />
            </div>
            <TextInput id="acc-line1" label="Address Line 1" value={form.line1} onChange={(e) => set('line1')(e.target.value)} />
            <TextInput id="acc-line2" label="Address Line 2" value={form.line2} onChange={(e) => set('line2')(e.target.value)} />
            <div className="vx-grid vx-grid--3" style={{ gap: 10 }}>
              <TextInput id="acc-city" label="City" value={form.city} onChange={(e) => set('city')(e.target.value)} error={touched ? errors.city : ''} />
              <SelectInput id="acc-state" label="State" value={form.state} onChange={set('state')} options={INDIAN_STATES.map((s) => ({ value: s, label: s }))} />
              <TextInput id="acc-pin" label="Pincode" inputMode="numeric" value={form.pincode} onChange={(e) => set('pincode')(e.target.value)} error={touched ? errors.pincode : ''} />
            </div>
            {error && <p className="vx-err" role="alert">{error}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <Button variant="primary" loading={saving} onClick={save}>
                Save Changes
              </Button>
            </div>
          </div>
        ) : (
          <p className="vx-muted">No business address on file.</p>
        )}
      </div>
    </div>
  );
};

const DocumentsTab: React.FC = () => {
  const { record } = usePartner();
  const d = record.documents;
  if (!d) return <div className="v-panel" style={{ padding: 20 }}><Empty icon="document" title="No documents found" /></div>;

  const regLabel = BUSINESS_REG_TYPES.find((t) => t.value === d.businessRegistration.type)?.label || d.businessRegistration.type;
  const idLabel = IDENTITY_PROOF_TYPES.find((t) => t.value === d.identityProof.type)?.label || d.identityProof.type;

  return (
    <div className="v-panel" style={{ padding: 20 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 14px', color: 'var(--v-ink)' }}>Verified Entity Documents</h3>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: 12, border: '1px solid var(--v-line)', borderRadius: 10, alignItems: 'center' }}>
          <div>
            <strong style={{ display: 'block', fontSize: 14, color: 'var(--v-ink)' }}>{regLabel}</strong>
            <small style={{ fontSize: 12, color: 'var(--v-muted)' }}>{d.businessRegistration.number}</small>
          </div>
          <FileLinks files={d.businessRegistration.files || []} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: 12, border: '1px solid var(--v-line)', borderRadius: 10, alignItems: 'center' }}>
          <div>
            <strong style={{ display: 'block', fontSize: 14, color: 'var(--v-ink)' }}>{idLabel}</strong>
            <small style={{ fontSize: 12, color: 'var(--v-muted)' }}>{d.identityProof.maskedNumber}</small>
          </div>
          <FileLinks files={d.identityProof.files || []} />
        </div>
      </div>
    </div>
  );
};

const AgreementsTab: React.FC = () => {
  const { profile } = usePartner();
  const [list, setList] = useState<Acceptance[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Acceptance | null>(null);
  const [agreementBody, setAgreementBody] = useState('');

  useEffect(() => {
    return subscribeToMyAcceptances(
      profile.id,
      (a: Acceptance[]) => { setList(a); setLoading(false); },
      () => setLoading(false)
    );
  }, [profile.id]);

  useEffect(() => {
    if (active) {
      currentTextOf(active).then((res) => setAgreementBody(res.body)).catch(() => setAgreementBody(''));
    } else {
      setAgreementBody('');
    }
  }, [active]);

  return (
    <div className="v-panel" style={{ padding: 20 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 12px', color: 'var(--v-ink)' }}>Fleet Vendor Partner Agreement</h3>
      {loading ? (
        <p className="vx-muted">Loading agreement history…</p>
      ) : list.length === 0 ? (
        <p className="vx-muted">Signed electronically upon onboarding verification.</p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {list.map((a) => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 14, border: '1px solid var(--v-line)', borderRadius: 10, alignItems: 'center' }}>
              <div>
                <strong style={{ display: 'block', fontSize: 14, color: 'var(--v-ink)' }}>{a.title || 'Fleet Vendor Partner Agreement'} · v{a.version}</strong>
                <small style={{ fontSize: 12, color: 'var(--v-muted)' }}>Accepted: {a.acceptedAt ? formatDateTime12(a.acceptedAt) : 'Onboarding'}</small>
              </div>
              <Button size="sm" onClick={() => setActive(a)}>View Copy</Button>
            </div>
          ))}
        </div>
      )}

      {active && (
        <Dialog open={!!active} onClose={() => setActive(null)} eyebrow={`Version ${active.version}`} title={active.title || 'Fleet Vendor Partner Agreement'}
          footer={<Button onClick={() => setActive(null)}>Close</Button>}>
          <div style={{ maxHeight: 380, overflowY: 'auto', fontSize: 13, lineHeight: 1.6, color: 'var(--v-ink)', padding: '4px 0' }}>
            <p style={{ whiteSpace: 'pre-wrap' }}>{agreementBody || 'Fleet Vendor Partner Agreement accepted electronically.'}</p>
          </div>
        </Dialog>
      )}
    </div>
  );
};
