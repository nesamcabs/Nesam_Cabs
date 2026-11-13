// "Add to security deposit". The partner picks a whole-rupee amount and pays through Razorpay Checkout (a WebView on phones,
// an iframe on the web — the same checkout as the dues payment). The deposit changes only after the server verifies the captured
// payment (functions/src/partnerOps.ts: createDepositPayment / verifyDepositPayment); the app never edits the deposit itself.
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './kit/Text';
import { WebView } from 'react-native-webview';
import { Sheet, TextField } from './ui';
import { Btn, Feedback } from './kit/core';
import { CheckoutFrame, checkoutHtml } from './DuesPaymentSheet';
import { createDepositPayment, verifyDepositPayment, DEPOSIT_TOPUP_MAX, DEPOSIT_TOPUP_MIN, type RechargeOrder } from '../services/partnerOps';
import { formatINR } from '../utils/format';
import { colors, fontFamily } from '../theme';

const QUICK = [1000, 5000, 10000, 25000];

const friendly = (m: string) =>
  /PAYMENT_NOT_CONFIGURED/.test(m) ? 'Online payment is not switched on yet. Contact the NESAM office to recharge.' : m;

export function DepositSheet({ current, required = 0, onClose, onDone }: { current: number; /** The mandatory deposit the office requires (0 = none set). */ required?: number; onClose: () => void; onDone: (message: string) => void }) {
  const remaining = Math.max(0, required - current);
  const [amount, setAmount] = useState(remaining >= DEPOSIT_TOPUP_MIN ? String(Math.min(remaining, DEPOSIT_TOPUP_MAX)) : remaining > 0 ? String(DEPOSIT_TOPUP_MIN) : '');
  const [order, setOrder] = useState<RechargeOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // With a mandatory deposit the amount is the one still needed: nothing else can be chosen. (A part above the per-payment limit is paid in rounds.)
  const fixed = required > 0;
  const value = fixed ? (remaining > 0 ? Math.max(DEPOSIT_TOPUP_MIN, Math.min(remaining, DEPOSIT_TOPUP_MAX)) : 0) : Number(amount) || 0;

  const pay = async () => {
    if (value < DEPOSIT_TOPUP_MIN || value > DEPOSIT_TOPUP_MAX) { setError(`Enter an amount from ${formatINR(DEPOSIT_TOPUP_MIN)} to ${formatINR(DEPOSIT_TOPUP_MAX)}.`); return; }
    setBusy(true); setError('');
    try { setOrder(await createDepositPayment(value)); }
    catch (e) { setError(friendly((e as Error).message)); }
    finally { setBusy(false); }
  };

  const onMessage = async (raw: string) => {
    let m: { ok: boolean; reason?: string; orderId?: string; paymentId?: string; signature?: string };
    try { m = JSON.parse(raw); } catch { return; }
    setOrder(null);
    if (!m.ok || !m.orderId || !m.paymentId || !m.signature) { setError(m.reason || 'Payment was not completed.'); return; }
    setBusy(true);
    try {
      const v = await verifyDepositPayment(m.orderId, m.paymentId, m.signature);
      if (v.status === 'credited') onDone(`${formatINR(v.amount ?? value)} added to your security recharge.`);
      else if (v.status === 'held') onDone(`Your payment of ${formatINR(v.amount ?? value)} was received, but your recharge is being refunded or settled, so NESAM is holding it for review.`);
      else onDone(v.message || 'Your payment is being confirmed. The recharge updates shortly.');
    } catch (e) { setError(friendly((e as Error).message)); } finally { setBusy(false); }
  };

  return (
    <Sheet visible onClose={onClose} title="Add to security recharge" dismissible={!busy && !order}>
      {order ? (
        <View style={styles.web}>
          {Platform.OS === 'web' ? (
            <CheckoutFrame order={order} onMessage={(raw) => void onMessage(raw)} />
          ) : (
            <WebView originWhitelist={['*']} source={{ html: checkoutHtml(order, 'Security recharge') }} onMessage={(e) => void onMessage(e.nativeEvent.data)} javaScriptEnabled />
          )}
        </View>
      ) : (
        <>
          <Text style={styles.note}>{required > 0 ? 'The security recharge is mandatory. ' : `Current recharge ${formatINR(current)}. `}It is refundable and separate from your working wallet.</Text>
          {fixed ? (
            remaining > 0 ? (
              <View style={styles.fixed}>
                <Text style={styles.fixedLabel}>Amount to pay</Text>
                <Text style={styles.fixedValue}>{formatINR(value)}</Text>
                {value < remaining ? <Text style={styles.fixedNote}>{formatINR(remaining - value)} more will remain after this payment.</Text> : null}
              </View>
            ) : (
              <Text style={styles.done}>Your security recharge is complete. Nothing more to pay.</Text>
            )
          ) : (
            <>
            <TextField label="Amount (₹)" prefix="₹" value={amount} onChangeText={(t) => { setAmount(t.replace(/\D/g, '').slice(0, 6)); setError(''); }} keyboardType="number-pad" placeholder="e.g. 5000" hint={`${formatINR(DEPOSIT_TOPUP_MIN)} to ${formatINR(DEPOSIT_TOPUP_MAX)} per payment`} editable={!busy} />
            <View style={styles.chips}>
              {[...(remaining >= DEPOSIT_TOPUP_MIN && remaining <= DEPOSIT_TOPUP_MAX && !QUICK.includes(remaining) ? [remaining] : []), ...QUICK].map((q) => {
                const on = value === q;
                return (
                  <Pressable key={q} onPress={() => { setAmount(String(q)); setError(''); }} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]}>
                    <Text style={[styles.chipText, on && { color: colors.primary }]}>{formatINR(q)}</Text>
                  </Pressable>
                );
              })}
            </View>
            </>
          )}
          <Feedback tone="error" message={error} />
          {fixed && remaining <= 0 ? (
            <Btn title="Close" kind="secondary" full onPress={onClose} style={{ marginTop: 6 }} />
          ) : (
            <>
              <Btn title={value >= DEPOSIT_TOPUP_MIN ? `Pay ${formatINR(value)}` : 'Continue to payment'} icon="arrow-forward" busy={busy} disabled={value < DEPOSIT_TOPUP_MIN} full onPress={() => void pay()} style={{ marginTop: 6 }} />
              <Text style={[styles.note, { textAlign: 'center', marginTop: 12 }]}>Secure payment by Razorpay · UPI, cards and net banking.</Text>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  web: { height: 520, borderRadius: 12, overflow: 'hidden' },
  note: { fontFamily, fontSize: 12.5, lineHeight: 18, color: colors.muted, marginBottom: 14 },
  fixed: { alignItems: 'center', paddingVertical: 16, marginBottom: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.primaryBorder, backgroundColor: colors.primarySoft },
  fixedLabel: { fontFamily, fontSize: 12, color: colors.muted },
  fixedValue: { fontFamily, fontSize: 30, fontWeight: '800', color: colors.primary, marginTop: 2, letterSpacing: -0.6 },
  fixedNote: { fontFamily, fontSize: 12, color: colors.muted, marginTop: 4 },
  done: { fontFamily, fontSize: 14, color: colors.success, textAlign: 'center', paddingVertical: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { minHeight: 38, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontFamily, fontSize: 13, fontWeight: '600', color: colors.ink },
});
