import React, { useEffect, useState } from 'react';
import { askOfficeForHelp, cancelLink, resendLinkCode, verifyLinkCode, type LinkStatus, type PartnerLink } from '../services/partnerLinks';
import { Badge, Banner, Button, KV, TextInput, type Tone } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { formatDateTime12 } from '../utils/time';

export const statusTone: Record<LinkStatus, Tone> = {
  'Awaiting OTP': 'blue',
  'Office review': 'amber',
  Completed: 'green',
  Rejected: 'red',
  Cancelled: 'gray',
};

export const statusText: Record<LinkStatus, string> = {
  'Awaiting OTP': 'Waiting for the code',
  'Office review': 'With the NESAM office',
  Completed: 'Done',
  Rejected: 'Declined',
  Cancelled: 'Cancelled',
};

export const fromLabel = (l: PartnerLink): string =>
  l.fromVendorName || (l.fromType === 'owner_driver' ? 'Owner-driver' : l.fromType === 'unattached' ? 'Not attached' : '—');

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * Enter the code the driver read out, ask for a new one, or hand the request to the office.
 * Used inside the Add dialogs and on the Requests screen, so a vendor can always pick up where they left off.
 */
export const CodePanel: React.FC<{
  link: PartnerLink;
  /** Only the local emulator ever supplies this; production never shows a code. */
  testCode?: string;
  onToast: (text: string, kind?: 'ok' | 'err') => void;
}> = ({ link, testCode, onToast }) => {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'' | 'verify' | 'resend' | 'help' | 'cancel'>('');
  const [error, setError] = useState('');
  const [local, setLocal] = useState(testCode);
  const [cool, setCool] = useState(0);

  useEffect(() => {
    if (cool <= 0) return undefined;
    const t = setTimeout(() => setCool((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cool]);

  const driverKind = link.kind === 'driver';
  const who = driverKind ? `${link.subjectLabel.split(' ')[0] || 'the driver'}` : link.receiverName || 'the last-trip driver';

  const verify = async () => {
    if (code.length !== 6 || busy) return;
    setBusy('verify'); setError('');
    try {
      const r = await verifyLinkCode(link.id, code);
      onToast(r.message, r.completed ? 'ok' : 'ok');
      setCode('');
    } catch (e) { setError(errMsg(e, 'That code did not work.')); } finally { setBusy(''); }
  };
  const resend = async () => {
    setBusy('resend'); setError('');
    try {
      const r = await resendLinkCode(link.id);
      setLocal(r.testCode);
      setCool(60);
      onToast(r.delivered ? 'A new code was sent.' : 'The code could not be delivered. Ask the office to help.', r.delivered ? 'ok' : 'err');
    } catch (e) { setError(errMsg(e, 'Could not send a new code.')); } finally { setBusy(''); }
  };
  const help = async () => {
    setBusy('help'); setError('');
    try { await askOfficeForHelp(link.id, 'Could not get the code'); onToast('The NESAM office will help you finish this.'); } catch (e) { setError(errMsg(e, 'Could not reach the office.')); } finally { setBusy(''); }
  };

  if (link.status === 'Completed') return <Banner tone="ok">Done. {link.subjectLabel} is now part of your fleet.</Banner>;
  if (link.status === 'Rejected') return <Banner tone="err">Declined by the NESAM office{link.rejectedReason ? `: ${link.rejectedReason}` : '.'}</Banner>;
  if (link.status === 'Cancelled') return <Banner>This request was cancelled.</Banner>;

  if (link.status === 'Office review') {
    return (
      <>
        <Banner tone="warn">
          {link.blockedReason || 'The NESAM office is checking this request.'} You will get a notification as soon as it is decided.
        </Banner>
        {!link.consent && !link.otpVerified && link.hasReceiver && (
          <>
            <p className="vx-muted" style={{ marginBottom: 10 }}>If {who} has the code, you can still enter it here.</p>
            <CodeEntry idKey={link.id} code={code} setCode={setCode} onSubmit={verify} busy={busy === 'verify'} error={error} testCode={local} />
          </>
        )}
      </>
    );
  }

  return (
    <>
      <Banner>
        {link.codeDelivered
          ? <>A 6-digit code was sent to <strong>{who}</strong>{link.receiverPhoneMask ? ` (${link.receiverPhoneMask})` : ''}. Ask {driverKind ? 'them' : 'the driver'} to read it out, and enter it below. It works for 5 minutes.</>
          : <>The code could not be delivered to <strong>{who}</strong>{link.receiverPhoneMask ? ` (${link.receiverPhoneMask})` : ''}. Try sending it again, or ask the NESAM office to help.</>}
      </Banner>
      <CodeEntry idKey={link.id} code={code} setCode={setCode} onSubmit={verify} busy={busy === 'verify'} error={error} testCode={local} />
      <div className="vx-actions" style={{ marginTop: 6 }}>
        <Button size="sm" variant="ghost" icon="refresh" loading={busy === 'resend'} disabled={cool > 0 || !!busy} onClick={resend}>{cool > 0 ? `Send again in ${cool}s` : 'Send a new code'}</Button>
        <Button size="sm" variant="ghost" icon="headset" loading={busy === 'help'} disabled={!!busy} onClick={help}>Code not coming — ask the office</Button>
      </div>
    </>
  );
};

const CodeEntry: React.FC<{ idKey: string; code: string; setCode: (v: string) => void; onSubmit: () => void; busy: boolean; error: string; testCode?: string }> = ({ idKey, code, setCode, onSubmit, busy, error, testCode }) => (
  <div>
    <TextInput id={`code-${idKey}`} label="6-digit code" className="vx-otp" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && onSubmit()} error={error} placeholder="••••••" />
    {testCode && <p className="vx-hint">Local test only — code {testCode}</p>}
    <Button variant="primary" block loading={busy} disabled={code.length !== 6} onClick={onSubmit}>Verify & add to my fleet</Button>
  </div>
);

/** One request as a card: what moves, from where to where, and where it stands. */
export const LinkCard: React.FC<{ link: PartnerLink; mine: boolean; onToast: (t: string, k?: 'ok' | 'err') => void }> = ({ link, mine, onToast }) => {
  const [open, setOpen] = useState(link.status === 'Awaiting OTP');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const outgoing = !mine; // someone else is taking a record from this vendor
  const cancel = async () => {
    setBusy(true);
    try { await cancelLink(link.id); onToast('Request cancelled.'); } catch (e) { onToast(errMsg(e, 'Could not cancel.'), 'err'); } finally { setBusy(false); setConfirmCancel(false); }
  };
  return (
    <article className="vx-card">
      <div className="vx-split">
        <div className="vx-media">
          <span className="vx-avatar" aria-hidden="true"><Icon name={link.kind === 'driver' ? 'user' : 'car'} /></span>
          <div>
            <strong className={link.kind === 'vehicle' ? 'vx-plate' : ''}>{link.subjectLabel}</strong>
            <small>{link.kind === 'driver' ? (link.subjectKind === 'owner_driver' ? 'Owner-driver joins a fleet' : 'Driver changes fleet') : 'Vehicle attachment'}</small>
          </div>
        </div>
        <Badge tone={statusTone[link.status]}>{statusText[link.status]}</Badge>
      </div>
      <div style={{ marginTop: 10 }}>
        <KV label="From">{fromLabel(link)}</KV>
        <KV label="To">{link.toVendorName}</KV>
        <KV label="Asked">{link.createdAt ? formatDateTime12(link.createdAt) : '—'}</KV>
        {link.method && <KV label="Finished by">{link.method}</KV>}
      </div>
      {outgoing && link.status !== 'Completed' && <Banner tone="warn">{link.toVendorName} asked to take this from your fleet. The office will check with you if anything is open.</Banner>}
      {outgoing && link.status === 'Completed' && <Banner>This {link.kind} has moved to {link.toVendorName}.</Banner>}
      {mine && (link.status === 'Awaiting OTP' || link.status === 'Office review') && (
        <>
          <div className="vx-actions" style={{ marginTop: 6 }}>
            <Button size="sm" variant={open ? 'secondary' : 'primary'} onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : link.status === 'Awaiting OTP' ? 'Enter code' : 'See details'}</Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmCancel(true)}>Cancel request</Button>
          </div>
          {open && <div style={{ marginTop: 14 }}><CodePanel link={link} onToast={onToast} /></div>}
          {confirmCancel && (
            <div className="vx-banner vx-banner--err" style={{ marginTop: 12 }}>
              <Icon name="alert" />
              <div>Cancel this request? Any code already sent stops working.
                <div className="vx-actions" style={{ marginTop: 8 }}>
                  <Button size="sm" variant="danger" loading={busy} onClick={cancel}>Yes, cancel</Button>
                  <Button size="sm" onClick={() => setConfirmCancel(false)} disabled={busy}>Keep it</Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {mine && (link.status === 'Completed' || link.status === 'Rejected') && <div style={{ marginTop: 10 }}><CodePanel link={link} onToast={onToast} /></div>}
    </article>
  );
};
