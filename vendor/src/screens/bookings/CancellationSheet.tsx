// Duty cancellation request for office approval. The charge shown is the server's quote at the moment of submission;
// the duty and its assignment stay active until the office decides (functions/src/partnerOps.ts requestDutyCancellation).
import React, { useState } from 'react';
import { View } from 'react-native';
import { useVendorData } from '../../context/VendorData';
import { Sheet, TextField } from '../../components/ui';
import { Btn, Choice, Empty, Feedback, KV, Notice, RouteTitle, Small } from '../../components/kit/core';
import { firstPart, rupees } from '../../components/kit/format';
import { flash } from '../../components/kit/flash';
import { CANCEL_REASONS, quoteCancellation, requestCancellation } from '../../services/partnerOps';
import type { VendorBooking } from '../../types/operations';
import { canChange } from './logic';

export function CancellationSheet({ booking, onClose }: { booking: VendorBooking | null; onClose: () => void }) {
  const d = useVendorData();
  const eligible = d.bookings.filter((b) => canChange(b) && !d.requests.some((r) => r.bookingId === b.id && r.type === 'cancellation' && r.status === 'Pending'));
  const [id, setId] = useState(booking?.id ?? '');
  const b = d.bookings.find((x) => x.id === id) ?? null;
  const [quote, setQuote] = useState(() => (b ? quoteCancellation(b.pickupAt, b.acceptedAt, d.ops.cancellation) : null));
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choose = (x: VendorBooking) => { setId(x.id); setQuote(quoteCancellation(x.pickupAt, x.acceptedAt, d.ops.cancellation)); };
  const submit = async () => {
    if (!b) return;
    if (!reason) { setError('Select a reason.'); return; }
    if (details.trim().length < 10) { setError('Describe the issue in at least 10 characters.'); return; }
    if (!quote) { setError('This duty has no pickup time. Call the NESAM office.'); return; }
    setBusy(true); setError('');
    try {
      await requestCancellation(b.id, reason, details, quote.amount);
      flash('Cancellation request sent. The duty remains assigned until the office decides.');
      onClose();
    } catch (e) {
      const x = (e as { details?: { code?: string; amount?: number; ruleLabel?: string } }).details;
      if (x?.code === 'quote-changed' && typeof x.amount === 'number') setQuote({ amount: x.amount, rule: x.ruleLabel ?? '' });
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Sheet visible onClose={onClose} title="Request cancellation" dismissible={!busy}>
      {!b ? (
        eligible.length ? (
          <>
            <Small style={{ marginBottom: 12 }}>Select the duty to cancel. Running trips are changed by calling the office.</Small>
            {eligible.map((x) => (
              <Choice key={x.id} title={`${firstPart(x.pickupAddress)} → ${firstPart(x.dropAddress)}`} sub={`${x.bookingId} · ${[x.date, x.time].filter(Boolean).join(' · ')}`} selected={false} onPress={() => choose(x)} />
            ))}
          </>
        ) : <Empty icon="close-circle-outline" title="No eligible duties" text="There are no duties that can be cancelled. Running trips are changed by calling the office." />
      ) : (
        <>
          <RouteTitle from={firstPart(b.pickupAddress)} to={firstPart(b.dropAddress)} size={17} />
          <Small>{b.bookingId}</Small>
          <Notice tone="amber" title="Office approval is required" text="The existing duty and assignment remain active until the office approves." style={{ marginTop: 14 }} />
          <KV rows={[['Proposed cancellation charge', rupees(quote?.amount ?? 0)], quote?.rule ? ['Window', quote.rule] : null]} />
          <Small style={{ marginTop: 14, marginBottom: 8, fontWeight: '600' }}>Reason</Small>
          {CANCEL_REASONS.map(([k, v]) => <Choice key={k} title={v} selected={reason === k} onPress={() => setReason(k)} />)}
          <View style={{ height: 6 }} />
          <TextField label="Details for office review" value={details} onChangeText={setDetails} multiline maxLength={500} placeholder="What happened and when?" />
          <Small>By submitting, you confirm you reviewed the proposed charge. The office may waive it for a valid reason.</Small>
          <Feedback tone="error" message={error} />
          <Btn title="Submit request" icon="send-outline" full busy={busy} onPress={() => void submit()} style={{ marginTop: 12 }} />
        </>
      )}
    </Sheet>
  );
}
