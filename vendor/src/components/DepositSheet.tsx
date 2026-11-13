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
  /PAYMENT_NOT_CONFIGURED/.test(m) ? 'Online payment is not switched on yet. Contact the NESAM office to add to your deposit.' : m;

export function DepositSheet({ current, required = 0, onClose, onDone }: { current: number; /** The mandatory deposit the office requires (0 = none set). */ required?: number; onClose: () => void; onDone: (message: string) => void }) {
  const remaining = Math.max(0, required - current);
  const [amount, setAmount] = useState(remaining >= DEPOSIT_TOPUP_MIN ? String(Math.min(remaining, DEPOSIT_TOPUP_MAX)) : remaining > 0 ? String(DEPOSIT_TOPUP_MIN) : '');
  const [order, setOrder] = useState<RechargeOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const value = Number(amount) || 0;

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
      if (v.status === 'credited') onDone(`${formatINR(v.amount ?? value)} added to your security deposit.`);
      else if (v.status === 'held') onDone(`Your payment of ${formatINR(v.amount ?? value)} was received, but your deposit is being refunded or settled, so NESAM is holding it for review.`);
      else onDone(v.message || 'Your payment is being confirmed. The deposit updates shortly.');
    } catch (e) { setError(friendly((e as Error).message)); } finally { setBusy(false); }
  };

  return (
    <Sheet visible onClose={onClose} title="Add to security deposit" dismissible={!busy && !order}>
      {order ? (
        <View style={styles.web}>
          {Platform.OS === 'web' ? (
            <CheckoutFrame order={order} onMessage={(raw) => void onMessage(raw)} />
          ) : (
            <WebView originWhitelist={['*']} source={{ html: checkoutHtml(order, 'Security deposit') }} onMessage={(e) => void onMessage(e.nativeEvent.data)} javaScriptEnabled />
          )}
        </View>
      ) : (
        <>
          {required > 0 ? (
            <View style={styles.req}>
              <View style={styles.reqCell}><Text style={styles.reqLabel}>Required</Text><Text style={styles.reqValue}>{formatINR(required)}</Text></View>
              <View style={styles.reqCell}><Text style={styles.reqLabel}>Paid</Text><Text style={styles.reqValue}>{formatINR(current)}</Text></View>
              <View style={styles.reqCell}><Text style={styles.reqLabel}>Remaining</Text><Text style={[styles.reqValue, remaining > 0 && { color: colors.primary }]}>{formatINR(remaining)}</Text></View>
            </View>
          ) : null}
          <Text style={styles.note}>{required > 0 ? 'The security deposit is mandatory. ' : `Current deposit ${formatINR(current)}. `}It is refundable and separate from your working wallet.</Text>
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
          <Feedback tone="error" message={error} />
          <Btn title={value >= DEPOSIT_TOPUP_MIN ? `Pay ${formatINR(value)}` : 'Continue to payment'} icon="arrow-forward" busy={busy} disabled={value < DEPOSIT_TOPUP_MIN} full onPress={() => void pay()} style={{ marginTop: 6 }} />
          <Text style={[styles.note, { textAlign: 'center', marginTop: 12 }]}>Secure payment by Razorpay · UPI, cards and net banking.</Text>
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  web: { height: 520, borderRadius: 12, overflow: 'hidden' },
  note: { fontFamily, fontSize: 12.5, lineHeight: 18, color: colors.muted, marginBottom: 14 },
  req: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  reqCell: { flex: 1, minWidth: 0, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.subtle },
  reqLabel: { fontFamily, fontSize: 10.5, color: colors.muted },
  reqValue: { fontFamily, fontSize: 14.5, fontWeight: '700', color: colors.ink, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { minHeight: 38, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontFamily, fontSize: 13, fontWeight: '600', color: colors.ink },
});
