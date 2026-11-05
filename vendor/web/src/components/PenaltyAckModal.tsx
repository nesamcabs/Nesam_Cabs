import React, { useState } from 'react';
import type { PartnerPenalty } from '../notificationTypes';
import { acknowledgePenalty, disputePenalty } from '../services/partnerNotifications';
import { ActionError } from '../services/callables';
import { formatDateTime12 } from '../utils/time';
import { Banner, Button, Dialog, Field, KV } from '../ui/kit';
import { inr } from '../ui/format';

export const ACK_TEXT = 'I have read and understood the penalty information.';

/**
 * Shown for a penalty the partner has not yet acknowledged. A new penalty cannot be closed until the box is ticked and it
 * is acknowledged (or disputed). The tick records that it was read — it is not an admission, and it can still be disputed.
 * Opened from Notifications for an already-acknowledged penalty, it only offers the dispute and can be closed.
 */
export const PenaltyAckModal: React.FC<{ penalty: PartnerPenalty; onDone: (message: string) => void; onClose?: () => void }> = ({ penalty, onDone, onClose }) => {
  const mustAck = penalty.status === 'Pending' && !penalty.acknowledged;
  const [checked, setChecked] = useState(false);
  const [disputing, setDisputing] = useState(!mustAck);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true); setError('');
    try { await fn(); onDone(success); } catch (err) { setError(err instanceof ActionError ? err.message : 'That did not go through. Please try again.'); setBusy(false); }
  };

  return (
    <Dialog open onClose={() => onClose?.()} locked={mustAck || busy} eyebrow={mustAck ? 'A penalty was issued to your fleet' : 'Penalty'} title={`Penalty of ${inr(penalty.amount)}`}
      footer={!disputing ? (
        <>
          <Button onClick={() => setDisputing(true)} disabled={busy}>I want to dispute this</Button>
          <Button variant="primary" loading={busy} disabled={!checked} onClick={() => run(() => acknowledgePenalty(penalty.id), 'Penalty acknowledged.')}>Acknowledge</Button>
        </>
      ) : (
        <>
          {mustAck ? <Button onClick={() => { setDisputing(false); setError(''); }} disabled={busy}>Back</Button> : <Button onClick={() => onClose?.()} disabled={busy}>Close</Button>}
          <Button variant="dark" loading={busy} disabled={note.trim().length < 10} onClick={() => run(() => disputePenalty(penalty.id, note.trim()), 'Your dispute was sent to NESAM.')}>Send dispute</Button>
        </>
      )}>
      <KV label="Reason">{penalty.category} — {penalty.reason}</KV>
      {penalty.description && <KV label="Details">{penalty.description}</KV>}
      {penalty.bookingCode && <KV label="Trip / booking"><span className="vx-mono">{penalty.bookingCode}</span></KV>}
      <KV label="Issued">{penalty.issuedAt ? formatDateTime12(penalty.issuedAt) : '—'}{penalty.incidentDate ? ` · incident on ${penalty.incidentDate}` : ''}</KV>
      <div style={{ height: 12 }} />
      {!disputing ? (
        <>
          <label className="vx-check"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /><span>{ACK_TEXT}</span></label>
          <p className="vx-hint">Ticking this only confirms that you have read the penalty. You can still dispute it.</p>
        </>
      ) : (
        <Field label="Why do you dispute this penalty?" htmlFor="pen-note">
          <textarea id="pen-note" className="vx-textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Explain what happened (at least 10 characters)" />
        </Field>
      )}
      {error && <Banner tone="err">{error}</Banner>}
    </Dialog>
  );
};
