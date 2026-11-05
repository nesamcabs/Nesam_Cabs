// Cancel with reason + live fee quote (port of user/web CancelRideDialog.tsx).
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TripRecord } from '../types';
import { cancelRide, cancellationQuote } from '../services/rideService';
import { CANCEL_REASONS } from '../config/constants';
import { describeError } from '../utils/retry';
import { Button, Notice, Sheet } from './ui';
import { colors, fonts, radius, space, type } from '../theme';

export function CancelRideSheet({ trip, onClose, onCancelled }: { trip: TripRecord | null; onClose: () => void; onCancelled?: () => void }) {
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, tick] = useState(0);

  // The fee depends on elapsed time — keep the quote current while open.
  // Callers key this component by trip id, so form state starts fresh per trip.
  const open = !!trip;
  useEffect(() => {
    if (!open) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, [open]);

  if (!trip) return null;
  const quote = cancellationQuote(trip);
  const finalReason = reason === 'Other' ? other.trim() : reason;

  const confirm = async () => {
    if (!finalReason) {
      setError('Please tell us why you’re cancelling.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await cancelRide(trip, finalReason);
      onCancelled?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : describeError(e, 'We couldn’t cancel this ride. Please try again or call support.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={`Cancel ride ${trip.bookingId}?`} dismissible={!busy}>
      {!quote.allowed ? (
        <Text style={type.body}>{quote.explanation}</Text>
      ) : (
        <View>
          <Notice tone={quote.fee ? 'warning' : 'success'} message={`${quote.fee ? `Cancellation fee: ₹${quote.fee}. ` : 'Free cancellation. '}${quote.explanation}`} />
          <Text style={[type.label, { marginBottom: space.sm }]}>Why are you cancelling?</Text>
          {CANCEL_REASONS.map((r) => (
            <Pressable
              key={r}
              onPress={() => setReason(r)}
              style={[styles.reason, reason === r && styles.reasonOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: reason === r }}
            >
              <View style={[styles.radio, reason === r && styles.radioOn]} />
              <Text style={[type.body, reason === r && { fontFamily: fonts.bold, fontWeight: '700' }]}>{r}</Text>
            </Pressable>
          ))}
          {reason === 'Other' ? (
            <TextInput
              value={other}
              onChangeText={(v) => setOther(v.slice(0, 200))}
              placeholder="Tell us more"
              placeholderTextColor={colors.faint}
              multiline
              style={styles.other}
            />
          ) : null}
          <Notice message={error} />
          <View style={styles.actions}>
            <Button title="Keep ride" variant="secondary" onPress={onClose} disabled={busy} style={{ flex: 1 }} />
            <Button title={busy ? 'Cancelling…' : 'Cancel ride'} variant="danger" loading={busy} disabled={!finalReason} onPress={() => void confirm()} style={{ flex: 1 }} />
          </View>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: space.sm,
  },
  reasonOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.faint },
  radioOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  other: {
    fontFamily: fonts.regular,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 64,
    textAlignVertical: 'top',
    color: colors.ink,
    marginBottom: space.md,
  },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
});
