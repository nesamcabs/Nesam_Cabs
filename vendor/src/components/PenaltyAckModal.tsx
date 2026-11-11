import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PartnerPenalty } from '../types/notifications';
import { acknowledgePenalty, disputePenalty } from '../services/partnerNotifications';
import { ActionError } from '../services/callables';
import { formatDateTime12 } from '../utils/time';
import { Button, Notice } from './ui';
import { Checkbox } from './Checkbox';
import { colors, radius, space } from '../theme';

export const ACK_TEXT = 'I have read and understood the penalty information.';
const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/**
 * Shown for a penalty the driver has not yet acknowledged. It cannot be closed
 * until they tick the box and acknowledge (or raise a dispute). The tick records
 * that the penalty was read — it is not an admission, and it can still be disputed.
 */
export function PenaltyAckModal({ penalty, onDone }: { penalty: PartnerPenalty; onDone: (message: string) => void }) {
  const [checked, setChecked] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onDone(success);
    } catch (err) {
      setError(err instanceof ActionError ? err.message : 'That did not go through. Please try again.');
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => undefined}>
      <SafeAreaView style={styles.backdrop}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.card}>
            <View style={styles.head}>
              <Text style={styles.headTitle}>⚠ A penalty has been issued</Text>
              <Text style={styles.headSub}>Please read it carefully.</Text>
            </View>
            <View style={styles.body}>
              <View style={styles.amountBox}>
                <Text style={styles.amountLabel}>PENALTY AMOUNT</Text>
                <Text style={styles.amount}>{rupees(penalty.amount)}</Text>
              </View>
              <Field label="Reason" value={`${penalty.category} — ${penalty.reason}`} bold />
              {penalty.description ? <Field label="Additional details" value={penalty.description} /> : null}
              {penalty.bookingCode ? <Field label="Trip / booking" value={penalty.bookingCode} /> : null}
              <Field label="Date and time" value={`${penalty.issuedAt ? formatDateTime12(penalty.issuedAt) : '—'}${penalty.incidentDate ? ` · incident on ${penalty.incidentDate}` : ''}`} />

              {!disputing ? (
                <>
                  <Checkbox checked={checked} onChange={setChecked} label={ACK_TEXT} tone={colors.danger} />
                  <Text style={styles.fine}>Ticking this only confirms that you have read the penalty. You can still dispute it.</Text>
                </>
              ) : (
                <View>
                  <Text style={styles.fieldLabel}>WHY DO YOU DISPUTE THIS PENALTY?</Text>
                  <TextInput
                    value={note}
                    onChangeText={setNote}
                    multiline
                    maxLength={500}
                    placeholder="Explain what happened (at least 10 characters)"
                    placeholderTextColor={colors.faint}
                    style={styles.input}
                    accessibilityLabel="Dispute reason"
                  />
                </View>
              )}
              <Notice message={error} />
              {!disputing ? (
                <View style={styles.actions}>
                  <Button title={busy ? 'Saving…' : 'Acknowledge'} loading={busy} disabled={!checked} onPress={() => void run(() => acknowledgePenalty(penalty.id), 'Penalty acknowledged.')} />
                  <Button title="I want to dispute this" variant="secondary" disabled={busy} onPress={() => setDisputing(true)} />
                </View>
              ) : (
                <View style={styles.actions}>
                  <Button
                    title={busy ? 'Sending…' : 'Send dispute'}
                    variant="dark"
                    loading={busy}
                    disabled={note.trim().length < 10}
                    onPress={() => void run(() => disputePenalty(penalty.id, note.trim()), 'Your dispute was sent to NESAM.')}
                  />
                  <Button
                    title="Back"
                    variant="secondary"
                    disabled={busy}
                    onPress={() => {
                      setDisputing(false);
                      setError('');
                    }}
                  />
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Field({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={{ marginBottom: space.sm }}>
      <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
      <Text style={[styles.fieldValue, bold && { fontWeight: '800' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: space.lg },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.danger, overflow: 'hidden' },
  head: { backgroundColor: colors.danger, padding: space.lg },
  headTitle: { color: colors.white, fontSize: 18, fontWeight: '900' },
  headSub: { color: '#FEE2E2', fontSize: 13, marginTop: 2 },
  body: { padding: space.lg },
  amountBox: { alignItems: 'center', backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: radius.md, paddingVertical: space.md, marginBottom: space.md },
  amountLabel: { fontSize: 11, fontWeight: '800', color: '#B91C1C' },
  amount: { fontSize: 30, fontWeight: '900', color: '#B91C1C' },
  fieldLabel: { fontSize: 11, fontWeight: '800', color: colors.muted },
  fieldValue: { fontSize: 14, color: colors.ink },
  fine: { fontSize: 12, color: colors.muted, marginBottom: space.sm },
  input: { borderWidth: 1, borderColor: colors.faint, borderRadius: radius.md, padding: space.md, minHeight: 90, textAlignVertical: 'top', color: colors.ink, marginTop: space.xs },
  actions: { gap: space.sm, marginTop: space.sm },
});
