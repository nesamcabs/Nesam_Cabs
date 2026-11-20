// "Pay online" for a booking's balance (Razorpay: UPI, cards, net banking, wallets). Shown only when the office has online payment
// switched on and something is still owed. The amount and the result are the server's: the booking updates by itself once the
// server has verified the captured payment, so this only reports progress.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TripRecord } from '../types';
import { COMPANY_NAME } from '../config/constants';
import { Button, Notice } from './ui';
import { Icon } from './Icon';
import { CheckoutSurface } from './CheckoutSurface';
import {
  createBookingPayment,
  getPaymentOptions,
  parseCheckoutMessage,
  paymentErrorText,
  verifyBookingPayment,
  type CheckoutLabels,
  type GatewayOrder,
} from '../services/paymentService';
import { formatINR } from '../utils/format';
import { colors, fonts, space } from '../theme';

type Msg = { tone: 'info' | 'success' | 'error' | 'warning'; text: string } | null;

/** What is still owed: the server's balance once payments are recorded, else the full fare with tolls and approved extras. */
export function bookingAmountDue(trip: TripRecord): number {
  return trip.paid ? Math.max(0, Math.round(trip.paid.balanceDue)) : Math.round((trip.fareBreakdown?.total ?? trip.fare) + trip.tollCharges + (trip.extraCharges ?? 0));
}

export function PayOnline({ trip, prefill, autoStart = false, advance = false, onAutoStarted, onPaid }: { trip: TripRecord; /** The first payment opened automatically is only the advance the rider chose ("Pay 25% now"). */ advance?: boolean; prefill?: CheckoutLabels['prefill']; /** Open the payment straight away (the rider chose "Pay online now" when booking). */ autoStart?: boolean; onAutoStarted?: () => void; /** Called once the server has verified the payment as received. */ onPaid?: () => void }) {
  const [online, setOnline] = useState(false);
  const [order, setOrder] = useState<GatewayOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    let alive = true;
    void getPaymentOptions().then((o) => {
      if (alive) setOnline(o.online);
    });
    return () => {
      alive = false;
    };
  }, []);

  const due = bookingAmountDue(trip);
  // A booking still awaiting NESAM's review can be paid: if it is rejected the payment becomes a refund the office sends back through Razorpay.
  const blocked = trip.status === 'Cancelled' || trip.status === 'Rejected';
  const labels = useMemo<CheckoutLabels>(
    () => ({ name: COMPANY_NAME, description: `Booking ${trip.bookingId}`, color: colors.primary, prefill }),
    [trip.bookingId, prefill],
  );

  const start = async (advanceOnly = false) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      setOrder(advanceOnly ? await createBookingPayment(trip.id, true) : await createBookingPayment(trip.id));
    } catch (e) {
      setMsg({ tone: 'error', text: paymentErrorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const onMessage = useCallback(
    async (raw: string) => {
      const m = parseCheckoutMessage(raw);
      if (!m) return;
      if ('dismissed' in m) {
        setOrder(null);
        return;
      }
      if ('failed' in m) {
        // Razorpay keeps its window open so the rider can retry; just say what happened.
        setMsg({ tone: 'warning', text: `${m.reason} You can try again.` });
        return;
      }
      setOrder(null);
      setBusy(true);
      setMsg({ tone: 'info', text: 'Confirming your payment…' });
      try {
        const v = await verifyBookingPayment(trip.id, m);
        if (v.status === 'paid') onPaid?.();
        setMsg(
          v.status === 'paid'
            ? { tone: 'success', text: v.balanceDue && v.balanceDue > 0 ? `Payment received. Balance ${formatINR(v.balanceDue)}.` : 'Payment received. Thank you!' }
            : { tone: 'info', text: v.message || 'Your payment is being confirmed. It will show on the booking shortly.' },
        );
      } catch (e) {
        setMsg({ tone: 'error', text: paymentErrorText(e) });
      } finally {
        setBusy(false);
      }
    },
    [trip.id],
  );

  const started = React.useRef(false);
  useEffect(() => {
    if (!autoStart || started.current || !online || due < 1 || blocked) return;
    started.current = true;
    onAutoStarted?.();
    void start(advance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, online, due, blocked]);

  if (!online || due < 1 || blocked) return msg?.tone === 'success' ? <Notice tone="success" message={msg.text} style={{ marginTop: space.md }} /> : null;

  return (
    <View style={{ marginTop: space.md }}>
      <Button title={`Pay ${formatINR(due)} online`} icon="credit-card" loading={busy} onPress={() => void start()} />
      <Text style={styles.fine}>UPI, cards, net banking and wallets · Secured by Razorpay</Text>
      {msg ? <Notice tone={msg.tone} message={msg.text} style={{ marginTop: space.sm }} /> : null}
      <Modal visible={!!order} animationType="slide" onRequestClose={() => setOrder(null)} statusBarTranslucent>
        <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
          <View style={styles.bar}>
            <Text style={styles.barTitle}>Secure payment</Text>
            <Pressable onPress={() => setOrder(null)} accessibilityRole="button" accessibilityLabel="Close payment" hitSlop={10} style={styles.close}>
              <Icon name="x" size={20} color={colors.ink} strokeWidth={2.2} />
            </Pressable>
          </View>
          {msg && msg.tone === 'warning' ? <Notice tone="warning" message={msg.text} style={{ marginHorizontal: space.lg, marginBottom: space.sm }} /> : null}
          {order ? <CheckoutSurface order={order} labels={labels} onMessage={(raw) => void onMessage(raw)} /> : null}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fine: { marginTop: 6, fontFamily: fonts.regular, fontSize: 11.5, color: colors.muted, textAlign: 'center' },
  sheet: { flex: 1, backgroundColor: colors.white },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md },
  barTitle: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F1EC' },
});
