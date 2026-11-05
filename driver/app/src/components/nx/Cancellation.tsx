// Help & cancellation sheets for the Driver app — the reference's openTripHelp / openCancellationRequest /
// cancellationPolicy / cancellationStatus, wired to requestDutyCancellation (functions/src/partnerOps.ts).
// The duty is cancelled only after the NESAM office approves the request.
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { NxDialog } from './Dialog';
import { NxIcon } from './Icon';
import { NxBadge, NxButton, NxField, NxFormError, NxPanel, NxRow, nxText } from './primitives';
import { nx, nxRadius } from '../../theme/nx';
import { EMERGENCY_NUMBER, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../../config/constants';
import type { TripDetails } from '../../types/driver';
import { REASONS, quote, requestDutyCancellation, type CancellationPolicy, type DriverCancellation } from '../../services/partnerRequests';

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const when = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d) : '—';
const call = (n: string) => void Linking.openURL(`tel:${n}`);

/** Owner-drivers request cancellation in the app; a vendor's driver goes through their vendor / the office. */
export const canRequestCancellation = (t: TripDetails, request: DriverCancellation | null) =>
  !t.fleetTrip && t.subStatus === 'Not Started' && !request && ['Approved', 'Confirmed', 'Assigned'].includes(t.status);

export function PolicyTable({ policy: p }: { policy: CancellationPolicy }) {
  const rows: [string, number][] = [
    [`Pickup in ${p.lastMinuteHours} hours or less`, p.lastMinuteCharge],
    [`Pickup more than ${p.lastMinuteHours} hours away · cancel within ${p.graceHours} hours of acceptance`, 0],
    [`Pickup more than ${p.lastMinuteHours} hours away · cancel after ${p.graceHours} hours of acceptance`, p.afterGraceCharge],
  ];
  return (
    <View style={styles.policy}>
      <Text style={styles.policyTitle}>Cancellation policy</Text>
      {rows.map(([label, amount]) => (
        <View key={label} style={styles.policyRow}><Text style={styles.policyLabel}>{label}</Text><Text style={styles.policyAmount}>{inr(amount)}</Text></View>
      ))}
      <Text style={[nxText.small, { marginTop: 8 }]}>Valid reasons may be waived by NESAM admin. The last-{p.lastMinuteHours}-hours rule takes priority over the acceptance grace period.</Text>
    </View>
  );
}

export function PolicyDialog({ visible, onClose, policy }: { visible: boolean; onClose: () => void; policy: CancellationPolicy }) {
  return (
    <NxDialog visible={visible} onClose={onClose} eyebrow="NESAM DUTY TERMS" title="Cancellation & waiver" footer={<NxButton title="Understood" trailingIcon="check" onPress={onClose} />}>
      <PolicyTable policy={policy} />
      <View style={styles.note}><NxIcon name="shield" size={15} color={nx.muted} /><Text style={[nxText.small, { flex: 1 }]}>Charges are based on the time your request is submitted. Admin review time does not increase the quoted penalty.</Text></View>
    </NxDialog>
  );
}

function Choice({ icon, title, sub, onPress, label }: { icon: 'document' | 'shield' | 'alert'; title: string; sub?: string; onPress: () => void; label?: string }) {
  return (
    <Pressable style={styles.choice} onPress={onPress} accessibilityRole="button" accessibilityLabel={label ?? title}>
      <NxIcon name={icon} size={18} color={icon === 'alert' ? nx.red : nx.tripRed} />
      <View style={{ flex: 1 }}>
        <Text style={styles.choiceTitle}>{title}</Text>
        {sub ? <Text style={styles.choiceSub}>{sub}</Text> : null}
      </View>
      <NxIcon name="chevron" size={16} color={nx.muted} />
    </Pressable>
  );
}

export function HelpCancellationDialog({ visible, onClose, trip, request, policy, onDone }: {
  visible: boolean; onClose: () => void; trip: TripDetails | null; request: DriverCancellation | null; policy: CancellationPolicy; onDone: (message: string) => void;
}) {
  const [mode, setMode] = useState<'help' | 'request' | 'policy'>('help');
  const close = () => { setMode('help'); onClose(); };
  if (!trip) return null;
  if (mode === 'policy') return <PolicyDialog visible={visible} onClose={() => setMode('help')} policy={policy} />;
  if (mode === 'request') return <RequestDialog visible={visible} onClose={close} trip={trip} policy={policy} onDone={(m) => { close(); onDone(m); }} />;

  const started = trip.subStatus !== 'Not Started';
  const canRequest = canRequestCancellation(trip, request);
  const intro = started
    ? 'For changes after starting your duty, call NESAM office. Our team will handle the next steps.'
    : request?.status === 'Pending' ? 'Your request is with NESAM office. The duty remains assigned until admin approves the cancellation.'
      : request?.status === 'Declined' ? 'Your cancellation request was declined. The duty remains assigned. Call NESAM office to discuss the next steps.'
        : trip.fleetTrip ? 'Your vendor manages changes to this duty. Call your vendor or the NESAM office.'
          : 'Before trip start, you can send a cancellation request in the app.';
  return (
    <NxDialog visible={visible} onClose={close} eyebrow={trip.bookingId} title={started ? 'Trip started · Office help' : 'Help & Cancellation'}
      footer={
        <>
          <NxButton title="Call NESAM Office" icon="phone" variant={started ? 'primary' : 'secondary'} onPress={() => call(SUPPORT_PHONE)} accessibilityLabel={`Call NESAM office on ${SUPPORT_PHONE_DISPLAY}`} />
          <Text style={styles.officeNumber}>{SUPPORT_PHONE_DISPLAY}</Text>
          <Text style={styles.officeNote}>{started ? 'Call the office for trip changes or an urgent issue.' : 'For an immediate or urgent issue, call the office.'}</Text>
        </>
      }>
      <Text style={styles.intro}>{intro}</Text>
      {canRequest ? (
        <>
          <Choice icon="document" title="Request cancellation" sub="Select reason → Send Request → Admin review" onPress={() => setMode('request')} />
          <View style={styles.rules}>
            {['Any potential penalty is shown before you submit.', 'The duty is cancelled only after admin approval.', 'Admin may waive the penalty for a valid reason.'].map((r) => (
              <Text key={r} style={nxText.small}>• {r}</Text>
            ))}
          </View>
        </>
      ) : null}
      {!started ? <Choice icon="shield" title="Cancellation policy" onPress={() => setMode('policy')} /> : null}
      <Choice icon="alert" title={`Emergency: police (${EMERGENCY_NUMBER})`} sub={`In danger or an accident, call ${EMERGENCY_NUMBER} first.`} onPress={() => call(EMERGENCY_NUMBER)} label={`Call police emergency number ${EMERGENCY_NUMBER}`} />
    </NxDialog>
  );
}

function RequestDialog({ visible, onClose, trip, policy, onDone }: { visible: boolean; onClose: () => void; trip: TripDetails; policy: CancellationPolicy; onDone: (m: string) => void }) {
  const [q, setQ] = useState(() => quote(trip.pickupAt, trip.acceptedAt ?? null, policy));
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPolicy, setShowPolicy] = useState(false);
  const submit = async () => {
    setError('');
    if (!reason || details.trim().length < 10) { setError('Select a reason and describe the issue in at least 10 characters.'); return; }
    if (!q) { setError('Unable to quote this request. Contact NESAM support.'); return; }
    setBusy(true);
    try {
      await requestDutyCancellation(trip.id, reason, details, q.amount);
      onDone('Request sent. Await office review; the duty remains assigned.');
    } catch (err) {
      const d = (err as { details?: { code?: string; amount?: number; ruleLabel?: string } }).details;
      if (d?.code === 'quote-changed' && typeof d.amount === 'number') setQ({ amount: d.amount, rule: d.ruleLabel ?? '' });
      setError((err as Error).message || 'The request was not sent. Please retry.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <NxDialog visible={visible} onClose={onClose} locked={busy} eyebrow={trip.bookingId} title="Request cancellation"
      footer={
        <>
          <NxButton title="Send Request" trailingIcon="arrow" loading={busy} onPress={() => void submit()} />
          <NxButton title="Call NESAM Office" icon="phone" variant="secondary" onPress={() => call(SUPPORT_PHONE)} style={{ marginTop: 10 }} />
          <Text style={styles.officeNote}>Immediate or urgent issue? Call {SUPPORT_PHONE_DISPLAY}.</Text>
        </>
      }>
      <View style={styles.fee}>
        <View style={styles.feeRow}><Text style={styles.feeLabel}>Potential penalty</Text><Text style={styles.feeAmount}>{inr(q?.amount ?? 0)}</Text></View>
        <Text style={nxText.small}>{q?.amount ? 'Valid reasons can be waived after admin review.' : 'No penalty in this window. Admin approval is still required.'}</Text>
      </View>
      {q ? <View style={styles.window}><NxIcon name="clock" size={14} color={nx.amber} /><Text style={styles.windowText}>{q.rule}</Text></View> : null}
      <Text style={styles.fieldLabel}>Reason</Text>
      <View style={styles.reasons} accessibilityRole="radiogroup">
        {REASONS.map(([k, v]) => (
          <Pressable key={k} onPress={() => setReason(k)} style={[styles.reason, reason === k && styles.reasonOn]} accessibilityRole="radio" accessibilityState={{ checked: reason === k }}>
            <Text style={[styles.reasonText, reason === k && { color: nx.tripRed }]}>{v}</Text>
          </Pressable>
        ))}
      </View>
      <NxField label="What happened?" value={details} onChangeText={setDetails} multiline maxLength={500} placeholder="Explain the issue so NESAM can review your request." />
      <Text style={[nxText.small, { marginTop: 12 }]}><Text style={{ fontWeight: '700', color: nx.ink }}>Admin approval is required to cancel this duty. </Text>Your duty stays assigned until approval. Selecting a reason does not automatically waive a charge; admin may waive it after review.</Text>
      <NxFormError message={error} />
      <Pressable onPress={() => setShowPolicy((v) => !v)} accessibilityRole="button" style={{ marginTop: 12 }}><Text style={styles.link}>{showPolicy ? 'Hide' : 'View'} cancellation policy</Text></Pressable>
      {showPolicy ? <PolicyTable policy={policy} /> : null}
    </NxDialog>
  );
}

/** Shown on the trip page while a request is under review, or after it was declined. */
export function CancellationStatus({ request: c }: { request: DriverCancellation }) {
  const declined = c.status === 'Declined';
  return (
    <NxPanel style={{ marginTop: 16 }}>
      <NxBadge label={declined ? 'Cancellation request declined' : 'Cancellation under review'} tone="amber" icon="clock" />
      <Text style={[nxText.heading, { marginTop: 12 }]}>{declined ? 'Contact NESAM for help' : 'Office review pending'}</Text>
      <Text style={[nxText.small, { marginTop: 6 }]}>{declined ? 'This duty remains assigned. No cancellation penalty has been deducted.' : 'The duty remains assigned. Call NESAM if the pickup is approaching.'}</Text>
      <NxRow label="Reason" value={c.reasonLabel} />
      <NxRow label="Requested" value={`${when(c.requestedAt)} IST`} />
      <NxRow label={declined ? 'Cancellation charge' : 'Potential penalty'} value={inr(declined ? 0 : c.quotedPenalty)} />
      <Text style={[nxText.small, { marginTop: 8 }]}>{declined ? c.adminReason : 'No wallet deduction during review. Valid reasons may be waived.'}</Text>
      <NxButton title="Call NESAM support" icon="phone" variant="secondary" onPress={() => call(SUPPORT_PHONE)} style={{ marginTop: 14 }} />
    </NxPanel>
  );
}

/** Cancelled tab card for a duty the office cancelled after a request. */
export function CancelledRequestCard({ request: c }: { request: DriverCancellation }) {
  return (
    <NxPanel style={{ marginBottom: 12 }}>
      <View style={styles.cardTop}><Text style={nxText.small}>{when(c.pickupAt)}</Text><NxBadge label="Cancelled" tone="neutral" /></View>
      <Text style={[nxText.heading, { marginTop: 8 }]}>{c.route}</Text>
      <Text style={nxText.small}>{c.bookingCode}</Text>
      <NxRow label={c.finalPenalty ? 'Cancellation penalty' : 'No cancellation penalty'} value={inr(c.finalPenalty ?? 0)} strong />
      <Text style={[nxText.small, { marginTop: 6 }]}>{c.finalPenalty ? 'Admin-approved debit recorded in your wallet' : 'No penalty · approved by NESAM'}{c.adminReason ? ` · ${c.adminReason}` : ''}</Text>
    </NxPanel>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 13, lineHeight: 20, color: nx.muted, marginBottom: 12 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: nx.line, borderRadius: nxRadius.button, padding: 14, marginTop: 10, minHeight: 52 },
  choiceTitle: { fontSize: 14, fontWeight: '600', color: nx.ink },
  choiceSub: { fontSize: 12, color: nx.muted, marginTop: 2 },
  rules: { marginTop: 10, gap: 4, paddingHorizontal: 4 },
  officeNumber: { textAlign: 'center', fontSize: 15, fontWeight: '700', color: nx.ink, marginTop: 10 },
  officeNote: { textAlign: 'center', fontSize: 12, color: nx.muted, marginTop: 4 },
  policy: { borderWidth: 1, borderColor: nx.line, borderRadius: nxRadius.button, padding: 14, marginTop: 6 },
  policyTitle: { fontSize: 13, fontWeight: '700', color: nx.ink, marginBottom: 8 },
  policyRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 7, borderTopWidth: 1, borderTopColor: nx.line },
  policyLabel: { flex: 1, fontSize: 12, color: nx.label, lineHeight: 18 },
  policyAmount: { fontSize: 13, fontWeight: '700', color: nx.ink },
  note: { flexDirection: 'row', gap: 8, marginTop: 14, alignItems: 'flex-start' },
  fee: { backgroundColor: nx.redSoft, borderRadius: nxRadius.button, padding: 14 },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  feeLabel: { fontSize: 13, color: nx.label, fontWeight: '600' },
  feeAmount: { fontSize: 22, fontWeight: '700', color: nx.tripRed },
  window: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, backgroundColor: nx.amberSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, alignSelf: 'flex-start' },
  windowText: { fontSize: 12, color: nx.amber, fontWeight: '600' },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: nx.label, marginTop: 16 },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  reason: { borderWidth: 1, borderColor: nx.fieldLine, borderRadius: nxRadius.pill, paddingHorizontal: 14, paddingVertical: 9, minHeight: 40, justifyContent: 'center' },
  reasonOn: { borderColor: nx.tripRed, backgroundColor: nx.redSoft },
  reasonText: { fontSize: 13, color: nx.ink, fontWeight: '500' },
  link: { fontSize: 13, fontWeight: '600', color: nx.tripRed },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
