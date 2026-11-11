// Penalties issued to the driver by NESAM (admin) or their fleet operator. A new one is first shown in PenaltyAckModal;
// this panel keeps the full history, and lets the driver dispute one they have acknowledged (the server allows a dispute
// from Pending or Acknowledged; Paid / Deducted / Waived are final).
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { NxDialog } from './Dialog';
import { NxBadge, NxButton, NxCardHeading, NxField, NxFormError, NxInfo, NxPanel, NxRow, type NxTone } from './primitives';
import { useShell } from './Shell';
import { disputePenalty } from '../../services/tripService';
import { ActionError } from '../../services/callables';
import { formatINR } from '../../utils/format';
import { formatDateTime12 } from '../../utils/time';
import type { DriverPenalty, PenaltyStatus } from '../../types/driver';
import { nx } from '../../theme/nx';

const STATE: Record<PenaltyStatus, { label: string; tone: NxTone }> = {
  Pending: { label: 'Awaiting acknowledgement', tone: 'red' },
  Acknowledged: { label: 'Acknowledged', tone: 'amber' },
  Disputed: { label: 'Disputed · under review', tone: 'amber' },
  Paid: { label: 'Paid', tone: 'neutral' },
  Deducted: { label: 'Deducted', tone: 'neutral' },
  Waived: { label: 'Waived', tone: 'green' },
};

const canDispute = (p: DriverPenalty) => p.status === 'Pending' || p.status === 'Acknowledged';

export function PenaltiesPanel({ penalties }: { penalties: DriverPenalty[] }) {
  const [open, setOpen] = useState<DriverPenalty | null>(null);
  const outstanding = penalties.filter((p) => p.status === 'Pending' || p.status === 'Acknowledged' || p.status === 'Disputed');
  const due = outstanding.reduce((s, p) => s + p.amount, 0);

  return (
    <NxPanel style={styles.card}>
      <NxCardHeading
        title="Penalties"
        caption={penalties.length ? 'Issued by NESAM or your fleet operator' : 'You have no penalties on record'}
        right={outstanding.length ? <NxBadge label={`${formatINR(due)} open`} tone="red" /> : <NxBadge label="Clear" tone="green" icon="check" />}
      />
      {penalties.map((p, i) => {
        const s = STATE[p.status];
        return (
          <View key={p.id} style={[styles.row, i === penalties.length - 1 && { borderBottomWidth: 0 }]}>
            <View style={styles.top}>
              <Text style={styles.reason} numberOfLines={2}>
                {p.category}
                {p.reason ? ` — ${p.reason}` : ''}
              </Text>
              <Text style={styles.amount}>{formatINR(p.amount)}</Text>
            </View>
            <Text style={styles.meta}>
              {[p.bookingCode, p.issuedAt ? formatDateTime12(p.issuedAt) : '', p.issuedByName ? `by ${p.issuedByName}` : ''].filter(Boolean).join(' · ')}
            </Text>
            {p.description ? <Text style={styles.desc}>{p.description}</Text> : null}
            {p.disputeNote ? <Text style={styles.desc}>Your dispute: {p.disputeNote}</Text> : null}
            <View style={styles.foot}>
              <NxBadge label={s.label} tone={s.tone} />
              {canDispute(p) ? <NxButton title="Dispute" variant="secondary" compact onPress={() => setOpen(p)} /> : null}
            </View>
          </View>
        );
      })}
      {penalties.length ? <NxInfo>A penalty you think is wrong can be disputed until it is paid or deducted. NESAM reviews every dispute.</NxInfo> : null}
      {open ? <DisputeDialog penalty={open} onClose={() => setOpen(null)} /> : null}
    </NxPanel>
  );
}

function DisputeDialog({ penalty, onClose }: { penalty: DriverPenalty; onClose: () => void }) {
  const { notify } = useShell();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const text = note.trim();
    if (text.length < 10) return setError('Explain why you dispute this penalty (at least 10 characters).');
    setBusy(true);
    setError('');
    try {
      await disputePenalty(penalty.id, text);
      notify('ok', 'Dispute sent. NESAM will review it.');
      onClose();
    } catch (err) {
      setError(err instanceof ActionError ? err.message : 'That did not go through. Please try again.');
      setBusy(false);
    }
  };

  return (
    <NxDialog
      visible
      locked={busy}
      onClose={onClose}
      eyebrow="Penalty"
      title="Dispute this penalty"
      footer={
        <>
          <NxButton title="Cancel" variant="secondary" onPress={onClose} disabled={busy} />
          <NxButton title="Send dispute" onPress={() => void submit()} loading={busy} />
        </>
      }
    >
      <NxRow label="Amount" value={formatINR(penalty.amount)} strong />
      <NxRow label="Reason" value={`${penalty.category}${penalty.reason ? ` — ${penalty.reason}` : ''}`} />
      {penalty.bookingCode ? <NxRow label="Trip / booking" value={penalty.bookingCode} last /> : null}
      <NxField label="Why do you dispute it?" value={note} onChangeText={setNote} multiline maxLength={500} placeholder="What happened, and anything NESAM should check" editable={!busy} />
      <NxFormError message={error} />
    </NxDialog>
  );
}

const styles = StyleSheet.create({
  card: { padding: 23 },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: nx.lineSoft },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  reason: { flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: '600', color: nx.ink },
  amount: { fontSize: 14.5, fontWeight: '700', color: nx.red },
  meta: { fontSize: 11.5, color: nx.muted, marginTop: 4 },
  desc: { fontSize: 12.5, color: nx.text, marginTop: 6, lineHeight: 18 },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 10 },
});
