// Counter bid for a marketplace offer. Submitted on the server (submitMarketplaceBid); NESAM reviews it and awards the duty.
import React, { useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { useVendorData } from '../../context/VendorData';
import { Button, Notice, Sheet, TextField } from '../ui';
import { submitCounterBid, validateCounterRate, VendorActionError } from '../../services/vendorService';
import type { MarketTrip } from '../../types/operations';
import { formatINR } from '../../utils/format';
import { describeDataError } from '../../utils/retry';
import { colors, radius, space, type } from '../../theme';

export function BidSheet({ trip, onClose, onDone }: { trip: MarketTrip; onClose: () => void; onDone: () => void }) {
  const { identity } = useVendorData();
  const [rate, setRate] = useState(String(Math.round(trip.offeredPayout * 1.1) || ''));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const value = Number(rate);
    const invalid = validateCounterRate(value, trip.offeredPayout);
    if (invalid) return setError(invalid);
    setBusy(true);
    setError('');
    try {
      await submitCounterBid(identity, trip, value, note);
      onDone();
    } catch (e) {
      setError(e instanceof VendorActionError ? e.message : describeDataError(e));
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <Sheet visible onClose={onClose} title={`Counter bid · ${trip.bookingId}`} dismissible={!busy}>
      <Text style={[type.small, { marginBottom: space.md }]}>
        {trip.route} · offered {formatINR(trip.offeredPayout)}
      </Text>
      <TextField label="Your counter rate (₹)" value={rate} onChangeText={(t) => setRate(t.replace(/\D/g, '').slice(0, 7))} keyboardType="number-pad" />
      <Text style={[type.label, { marginBottom: 6 }]}>Note for NESAM (optional)</Text>
      <TextInput
        value={note}
        onChangeText={(t) => setNote(t.slice(0, 300))}
        placeholder="Vehicle, driver experience, anything that justifies your rate"
        placeholderTextColor={colors.faint}
        multiline
        style={styles.note}
      />
      <Notice message={error} />
      <Button title={busy ? 'Submitting…' : 'Submit counter bid'} loading={busy} onPress={() => void submit()} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  note: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, minHeight: 72, textAlignVertical: 'top', color: colors.ink, marginBottom: space.md },
});
