import React, { useEffect, useState } from 'react';
import type { FleetDriver } from '../types';
import { usePartner } from '../state/Partner';
import { findDriver, requestDriverLink, revokeInvite, type DriverLookup, type LinkRequestResult } from '../services/partnerLinks';
import { Avatar, Badge, Banner, Button, Dialog, Empty, KV, PhoneInput, SelectInput, Tabs, Toast, useToast } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { isMobile, tenDigits } from '../ui/format';
import { formatDateTime12 } from '../utils/time';
import { CodePanel } from './LinkParts';

const accountTone = { Approved: 'green', Pending: 'amber', 'Needs Correction': 'amber', Rejected: 'red' } as const;
const accountText = { Approved: 'Approved by NESAM', Pending: 'Awaiting NESAM review', 'Needs Correction': 'Needs correction', Rejected: 'Rejected' } as const;

export const DriversPage: React.FC = () => {
  const { drivers, invites, vehicles, intent, clearIntent, actions } = usePartner();
  const [tab, setTab] = useState<'fleet' | 'invites'>('fleet');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState('');
  const { toast, show, dismiss } = useToast();

  useEffect(() => {
    if (intent === 'add') { setAdding(true); clearIntent(); }
  }, [intent, clearIntent]);

  const toggle = async (d: FleetDriver) => {
    if (busyId) return;
    setBusyId(d.id);
    try {
      await actions.setSuspended(d.id, !d.suspended);
      show(d.suspended ? `${d.name || 'The driver'} can take duties again.` : `${d.name || 'The driver'} is suspended and cannot be dispatched.`);
    } catch (e) { show(e instanceof Error ? e.message : 'The change was not saved.', 'err'); } finally { setBusyId(''); }
  };

  return (
    <div>
      <Toast toast={toast} onDismiss={dismiss} />
      <div className="vx-split vx-split--center" style={{ marginBottom: 16 }}>
        <Tabs label="Drivers" value={tab} onChange={setTab} tabs={[{ id: 'fleet', label: 'My drivers', count: drivers.length }, { id: 'invites', label: 'Invitations', count: invites.length }]} />
        <Button variant="primary" icon="userplus" onClick={() => setAdding(true)} style={{ marginTop: -16 }}>Add driver</Button>
      </div>

      {tab === 'fleet' && (
        drivers.length === 0 ? (
          <div className="vx-card"><Empty icon="users" title="No drivers in your fleet yet" action={<Button variant="primary" icon="userplus" onClick={() => setAdding(true)}>Add your first driver</Button>}>
            Enter a driver’s mobile number. If they already drive on NESAM you can link them; otherwise we send an invitation.
          </Empty></div>
        ) : (
          <div className="vx-grid">
            {drivers.map((d) => (
              <article className="vx-card" key={d.id}>
                <div className="vx-split">
                  <div className="vx-media">
                    <Avatar name={d.name} photoUrl={d.photoUrl} large />
                    <div>
                      <strong>{d.name || 'Name not provided'}</strong>
                      <small>{d.phone || '—'}</small>
                      <small>{d.rating !== null ? `★ ${d.rating.toFixed(1)}` : 'No ratings yet'}</small>
                    </div>
                  </div>
                  {d.accountStatus === 'Approved' && !d.suspended && <Badge tone={d.online ? 'green' : 'gray'}>{d.online ? 'Online' : 'Offline'}</Badge>}
                  {d.suspended && <Badge tone="red">Suspended</Badge>}
                </div>
                <div style={{ marginTop: 10 }}>
                  <KV label="NESAM review"><Badge tone={accountTone[d.accountStatus]}>{accountText[d.accountStatus]}</Badge></KV>
                  <KV label="Paired vehicle">{d.assignedVehicleNumber ? <span className="vx-plate">{d.assignedVehicleNumber}</span> : 'None'}</KV>
                  {d.licenseExpiry && <KV label="Licence valid till">{d.licenseExpiry}</KV>}
                </div>
                <div className="vx-actions">
                  <Button size="sm" variant={d.suspended ? 'primary' : 'danger'} loading={busyId === d.id} onClick={() => toggle(d)}>{d.suspended ? 'Resume duties' : 'Suspend'}</Button>
                  {d.phone && <a className="vx-btn vx-btn--sm" href={`tel:${d.phone}`}><Icon name="phone" />Call</a>}
                </div>
              </article>
            ))}
          </div>
        )
      )}

      {tab === 'invites' && (
        invites.length === 0 ? (
          <div className="vx-card"><Empty icon="send" title="No pending invitations">Drivers you invite appear here until they sign up in the NESAM Driver app with the same number.</Empty></div>
        ) : (
          <div className="vx-card">
            {invites.map((i) => (
              <div className="vx-listrow" key={i.phone}>
                <span className="vx-avatar vx-avatar--grey"><Icon name="phone" /></span>
                <div className="vx-listrow__body">
                  <strong>{i.phone}</strong>
                  <small>{i.vehicleAssignment ? `Vehicle ${i.vehicleAssignment} · ` : ''}Invited {i.createdAt ? formatDateTime12(i.createdAt) : ''}</small>
                </div>
                <Button size="sm" variant="danger" onClick={async () => { try { await revokeInvite(i.phone); show('Invitation withdrawn.'); } catch { show('Could not withdraw the invitation.', 'err'); } }}>Withdraw</Button>
              </div>
            ))}
          </div>
        )
      )}

      <AddDriverDialog open={adding} onClose={() => setAdding(false)} vehicleOptions={vehicles.map((v) => v.vehicleNumber)} onToast={show}
        onInvite={async (phone, plate) => { await actions.inviteDriver(phone, plate); setTab('invites'); }} />
    </div>
  );
};

type Step = 'phone' | 'found' | 'code' | 'invited';

export const AddDriverDialog: React.FC<{
  open: boolean; onClose: () => void; vehicleOptions: string[]; onToast: (t: string, k?: 'ok' | 'err') => void;
  onInvite: (phone: string, vehicleNumber: string) => Promise<void>;
}> = ({ open, onClose, vehicleOptions, onToast, onInvite }) => {
  const { links, go } = usePartner();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [plate, setPlate] = useState('');
  const [found, setFound] = useState<DriverLookup | null>(null);
  const [result, setResult] = useState<LinkRequestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setStep('phone'); setPhone(''); setPlate(''); setFound(null); setResult(null); setError(''); setBusy(false); }
  }, [open]);

  const link = result ? links.find((l) => l.id === result.linkId) : undefined;

  const check = async () => {
    const n = tenDigits(phone);
    if (!isMobile(n)) return setError('Enter the driver’s 10-digit mobile number.');
    setBusy(true); setError('');
    try { setFound(await findDriver(n)); setStep('found'); } catch (e) { setError(e instanceof Error ? e.message : 'Could not check that number.'); } finally { setBusy(false); }
  };
  const invite = async () => {
    setBusy(true); setError('');
    try { await onInvite(tenDigits(phone), plate); setStep('invited'); } catch (e) { setError(e instanceof Error ? e.message : 'The invitation was not saved.'); } finally { setBusy(false); }
  };
  const request = async (office: boolean) => {
    setBusy(true); setError('');
    try { const r = await requestDriverLink(tenDigits(phone), office); setResult(r); setStep('code'); } catch (e) { setError(e instanceof Error ? e.message : 'The request could not be sent.'); } finally { setBusy(false); }
  };

  const f = found;
  const blocked = f && (f.mine || !f.approved || !!f.pendingLinkId);
  const title = step === 'phone' ? 'Add a driver' : step === 'invited' ? 'Invitation sent' : step === 'code' ? 'Confirm with the driver' : f?.found ? f.name ?? 'Driver' : 'New to NESAM';

  return (
    <Dialog open={open} onClose={onClose} eyebrow="Grow your fleet" title={title} locked={busy}
      footer={
        step === 'phone' ? <><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} onClick={check}>Check number</Button></>
        : step === 'found' ? <>
            <Button onClick={() => { setStep('phone'); setError(''); }} disabled={busy}>Back</Button>
            {f && !f.found && <Button variant="primary" icon="send" loading={busy} onClick={invite}>Send invitation</Button>}
            {f?.found && !blocked && <Button variant="primary" icon="send" loading={busy} onClick={() => request(false)}>Send code to driver</Button>}
            {f?.found && f.pendingLinkId && <Button variant="primary" onClick={() => { onClose(); go('requests'); }}>Open requests</Button>}
          </>
        : <Button variant="primary" onClick={() => { onClose(); if (step === 'invited') go('drivers'); }}>{step === 'code' && link && link.status === 'Completed' ? 'Done' : 'Close'}</Button>
      }>
      {step === 'phone' && (
        <>
          <p className="vx-muted" style={{ marginBottom: 14 }}>Enter the driver’s own mobile number. We will tell you whether they already drive on NESAM.</p>
          <PhoneInput id="add-driver-phone" label="Driver mobile number" value={phone} onChange={(v) => { setPhone(v); setError(''); }} autoFocus onEnter={check} error={error} />
        </>
      )}

      {step === 'found' && f && (
        <>
          {!f.found ? (
            <>
              <Banner>This number is not on NESAM yet. Send an invitation: the driver signs up in the <strong>NESAM Driver app</strong> with <strong>+91 {tenDigits(phone)}</strong>, and NESAM reviews their documents.</Banner>
              <SelectInput id="invite-plate" label="Pair with a vehicle (optional)" value={plate} onChange={setPlate} placeholder="No vehicle yet" options={vehicleOptions.map((v) => ({ value: v, label: v }))} />
            </>
          ) : (
            <>
              <div className="vx-found">
                <div className="vx-media">
                  <Avatar name={f.name ?? ''} large />
                  <div>
                    <strong>{f.name}</strong>
                    <small>{f.phoneMask}</small>
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <KV label="Type">{f.kind === 'owner_driver' ? 'Owner-driver (works for themselves)' : 'Driver of another fleet'}</KV>
                  {f.kind === 'vendor_driver' && <KV label="Current fleet">{f.mine ? 'Your fleet' : f.fleet || 'Another vendor'}</KV>}
                  <KV label="NESAM account">{f.approved ? <Badge tone="green">Approved</Badge> : <Badge tone="amber">Not approved yet</Badge>}</KV>
                </div>
              </div>
              {f.mine && <Banner>{f.name} is already in your fleet.</Banner>}
              {!f.mine && !f.approved && <Banner tone="warn">NESAM has not approved this driver yet, so they cannot be linked.</Banner>}
              {f.pendingLinkId && <Banner tone="warn">You already have an open request for this driver.</Banner>}
              {!blocked && f.onHold && <Banner tone="warn">This driver is on hold. The office will have to review the move.</Banner>}
              {!blocked && (f.openDuties ?? 0) > 0 && <Banner tone="warn">{f.name} has {f.openDuties} booked {f.openDuties === 1 ? 'duty' : 'duties'}. Those must be reassigned before the move can finish.</Banner>}
              {!blocked && (
                <Banner>
                  {f.kind === 'owner_driver'
                    ? <>As an owner-driver, {f.name} will stop taking duties directly and work for your fleet. We send a code to <strong>their own phone</strong>; they read it to you, and the NESAM office then confirms the change.</>
                    : <>We send a code to <strong>{f.name}’s own phone</strong>. Once they read it to you and you enter it, they move to your fleet. Their old trips and payouts stay with their previous fleet.</>}
                </Banner>
              )}
            </>
          )}
          {error && <p className="vx-err" role="alert">{error}</p>}
        </>
      )}

      {step === 'code' && result && (
        link ? <CodePanel link={link} testCode={result.testCode} onToast={onToast} /> : <Banner>Request sent. Loading its status…</Banner>
      )}

      {step === 'invited' && (
        <>
          <Banner tone="ok">Invitation saved for <strong>+91 {tenDigits(phone)}</strong>.</Banner>
          <p className="vx-muted">The driver joins your fleet by signing up in the NESAM Driver app with this number. You will see them under <strong>My drivers</strong> once they do.</p>
        </>
      )}
    </Dialog>
  );
};
