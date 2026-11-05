// 24/7 Helpdesk and Profile (reference vHelpdesk / vBusiness / bank, display settings sheets).
import React, { useState } from 'react';
import { usePartner } from '../../state/Partner';
import { signOutUser } from '../../services/authService';
import { AccountPage } from '../../pages/AccountPage';
import { Icon } from '../Icon';
import { Badge, Btn, Dialog, Empty, ErrorLine, Field, KV, PageHeading, Tabs } from '../ui';
import { dayTime, maskPhone, rupees, vendorCode } from '../format';
import { requestBankChange } from '../services';
import { CancellationSheet } from './Bookings';
import { useWorkspace } from '../Workspace';

const TYPE_LABEL = { cancellation: 'Cancellation', bank_change: 'Bank change', document_renewal: 'Document renewal' } as const;

export const HelpdeskScreen: React.FC = () => {
  const p = usePartner();
  const ws = useWorkspace();
  const [filter, setFilter] = useState<'Pending' | 'Resolved'>('Pending');
  const [cancel, setCancel] = useState(false);
  const phone = p.ops.supportPhone.replace(/^\+91/, '');
  const list = p.requests.filter((r) => (filter === 'Pending' ? r.status === 'Pending' : r.status !== 'Pending'));
  return (
    <>
      <PageHeading title="24/7 Helpdesk" subtitle="Office support and duty requests." />
      <section className="v-support-panel">
        <span className="v-support-icon"><Icon name="headphones" /></span>
        <div><h2>NESAM office</h2><p>Duty, transfer and account assistance.</p></div>
        <a href={`tel:${p.ops.supportPhone}`} className="v-button v-primary q-button"><Icon name="phone" />Call {phone.replace(/(\d{5})(\d{5})/, '$1 $2')}</a>
      </section>
      <div className="v-help-actions">
        <button type="button" onClick={() => setCancel(true)}><Icon name="circle-x" /><span><strong>Request cancellation</strong><small>Office decision and charge details</small></span><Icon name="chevron-right" /></button>
        <button type="button" onClick={() => ws.go('Bookings', 'Upcoming')}><Icon name="users-round" /><span><strong>Change driver or vehicle</strong><small>Open a booking and update before trip start</small></span><Icon name="chevron-right" /></button>
        <button type="button" onClick={() => ws.open({ kind: 'linking' }, 'Fleet')}><Icon name="arrow-left-right" /><span><strong>Driver / vehicle transfers</strong><small>Linking codes and office review</small></span><Icon name="chevron-right" /></button>
      </div>
      <div className="v-section-heading"><h2>My requests</h2><p>Duties stay active until the office approves cancellation.</p></div>
      <Tabs value={filter} onChange={setFilter} items={[{ id: 'Pending', label: 'Pending' }, { id: 'Resolved', label: 'Resolved' }]} />
      <div className="v-list">
        {list.length ? list.map((r) => (
          <article key={r.id} className="v-statement">
            <div>
              <strong>{TYPE_LABEL[r.type]}{r.bookingCode ? ` · ${r.bookingCode}` : ''}</strong>
              <p>{r.type === 'cancellation' ? `${r.route} · ${r.reasonLabel}` : r.type === 'document_renewal' ? `${r.documentLabel} · ${r.entityName} · new expiry ${r.expiry}` : `Account ending ${r.accountLast4} · ${r.ifsc}`}</p>
              <small>Sent {dayTime(r.requestedAt)}{r.decidedAt ? ` · decided ${dayTime(r.decidedAt)}` : ''}</small>
              {r.adminReason ? <small>Office: {r.adminReason}</small> : null}
            </div>
            <div className="v-statement-amount">
              {r.type === 'cancellation' ? <strong>{rupees(r.status === 'Approved' ? r.finalPenalty ?? 0 : r.status === 'Declined' ? 0 : r.quotedPenalty)}</strong> : null}
              {r.type === 'cancellation' ? <small>{r.status === 'Pending' ? 'Potential charge' : 'Cancellation charge'}</small> : null}
              <Badge kind={r.status === 'Approved' ? 'green' : r.status === 'Declined' ? 'neutral' : 'amber'}>{r.status === 'Pending' ? 'Under review' : r.status}</Badge>
            </div>
          </article>
        )) : <Empty title={`No ${filter.toLowerCase()} requests`}>Office decisions appear in the same request.</Empty>}
      </div>
      {cancel ? <CancellationSheet trip={null} onClose={() => setCancel(false)} /> : null}
    </>
  );
};

export const AccountScreen: React.FC = () => {
  const p = usePartner();
  const ws = useWorkspace();
  const [sheet, setSheet] = useState<'' | 'bank' | 'settings'>('');
  const bank = p.record.payoutSummary;
  return (
    <>
      <PageHeading title="Profile" subtitle="My Business and account settings." />
      <div className="v-detail-grid">
        <section className="v-panel">
          <div className="v-business-head">
            <span className="v-business-icon"><Icon name="Business" /></span>
            <div><h2>{p.profile.companyName}</h2><p>{vendorCode(p.profile.id)}</p></div>
            <Badge kind="green">Verified</Badge>
          </div>
          <KV rows={[
            ['Vendor ID', vendorCode(p.profile.id)], ['Business name', p.profile.companyName], ['Authorized representative', p.profile.contactPerson || '—'],
            ['Mobile number', maskPhone(p.profile.phone)], ['Account type', 'Fleet vendor'],
            ['Fleet', `${p.vehicles.length} vehicle${p.vehicles.length === 1 ? '' : 's'} · ${p.drivers.length} driver${p.drivers.length === 1 ? '' : 's'}`],
          ]} />
        </section>
        <section className="v-panel">
          <div className="v-account-menu">
            <button type="button" onClick={() => setSheet('bank')}><Icon name="landmark" /><span>Bank details<small>{bank?.bankLast4 ? `Account ending ${bank.bankLast4}` : 'Not added'}</small></span><Icon name="chevron-right" /></button>
            <button type="button" onClick={() => ws.open({ kind: 'business' })}><Icon name="file-check" /><span>Business details, agreement &amp; accepted copy</span><Icon name="chevron-right" /></button>
            <button type="button" onClick={() => ws.open({ kind: 'documents' }, 'Fleet')}><Icon name="shield-check" /><span>Documents &amp; verification</span><Icon name="chevron-right" /></button>
            <button type="button" onClick={() => ws.open({ kind: 'linking' }, 'Fleet')}><Icon name="arrow-left-right" /><span>Driver / vehicle linking requests</span><Icon name="chevron-right" /></button>
            <button type="button" onClick={() => ws.open({ kind: 'penalties' }, 'Wallet')}><Icon name="triangle-alert" /><span>Penalty notices</span><Icon name="chevron-right" /></button>
            <button type="button" onClick={() => setSheet('settings')}><Icon name="settings-2" /><span>Display settings</span><Icon name="chevron-right" /></button>
            <button type="button" onClick={() => void signOutUser()}><Icon name="log-out" /><span>Sign out</span><Icon name="chevron-right" /></button>
          </div>
        </section>
      </div>
      {sheet === 'bank' ? <BankSheet onClose={() => setSheet('')} /> : null}
      {sheet === 'settings' ? <SettingsSheet onClose={() => setSheet('')} /> : null}
    </>
  );
};

/** Business profile, address, settlement account, documents and accepted agreements (the earlier My Business page). */
export const BusinessScreen: React.FC = () => {
  const ws = useWorkspace();
  return (
    <>
      <PageHeading title="Business details" subtitle="Profile, agreement and verified documents." action={<Btn style="secondary" icon="arrow-left" onClick={() => ws.go('Account')}>Profile</Btn>} />
      <div className="vx"><AccountPage /></div>
    </>
  );
};

const BankSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const p = usePartner();
  const ws = useWorkspace();
  const bank = p.record.payoutSummary;
  const pending = p.requests.find((r) => r.type === 'bank_change' && r.status === 'Pending');
  const [holder, setHolder] = useState(bank?.accountHolderName ?? p.profile.companyName);
  const [last4, setLast4] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(last4)) { setError('Enter the last four digits of the new account.'); return; }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase())) { setError('Enter a valid IFSC (for example HDFC0001234).'); return; }
    setBusy(true); setError('');
    try { await requestBankChange(holder, last4, ifsc); onClose(); ws.say('Bank change requested. It takes effect after office approval.'); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Bank details" onClose={onClose} busy={busy}>
      <KV rows={[['Account holder', bank?.accountHolderName || '—'], ['Account ending', bank?.bankLast4 ? `•••• ${bank.bankLast4}` : '—'], ['IFSC', bank?.ifsc || '—'], ...(bank?.upiId ? [['UPI', bank.upiId] as [string, string]] : [])]} />
      {pending ? <p className="v-small v-muted">A change to the account ending {pending.accountLast4} is with the office since {dayTime(pending.requestedAt)}.</p> : (
        <form onSubmit={submit}>
          <Field label="Account holder"><input type="text" required minLength={2} value={holder} onChange={(e) => setHolder(e.target.value)} /></Field>
          <Field label="New account last four digits"><input type="text" required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="IFSC"><input type="text" required maxLength={11} value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} /></Field>
          <p className="v-small v-muted">Bank changes take effect after office approval. Keep a cancelled cheque or statement ready for the office.</p>
          <ErrorLine message={error} />
          <Btn submit full icon="arrow-right" busy={busy}>Request bank change</Btn>
        </form>
      )}
    </Dialog>
  );
};

const SettingsSheet: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [large, setLarge] = useState(() => { try { return localStorage.getItem('nesam-partner-text') === 'large'; } catch { return false; } });
  const pick = (v: boolean) => {
    setLarge(v);
    try { localStorage.setItem('nesam-partner-text', v ? 'large' : 'standard'); } catch { /* storage blocked: applies to this visit only */ }
    window.dispatchEvent(new CustomEvent('nesam-partner-text', { detail: v }));
  };
  return (
    <Dialog title="Display settings" onClose={onClose}>
      <p className="v-modal-intro">Choose a comfortable text size.</p>
      <div className="q-presets">
        <button type="button" aria-pressed={!large} onClick={() => pick(false)}>Standard</button>
        <button type="button" aria-pressed={large} onClick={() => pick(true)}>Larger text</button>
      </div>
    </Dialog>
  );
};
