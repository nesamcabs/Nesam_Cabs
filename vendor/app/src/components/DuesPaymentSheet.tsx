// "Pay outstanding dues". The server derives what is payable from the confirmed ledger debits (cash collected on confirmed
// trips, finalised penalties) — the app never sends an amount. Razorpay Checkout runs in a WebView; the dues are marked paid
// only after the server verifies the captured payment (functions/src/partnerOps.ts: createDuesPayment / verifyDuesPayment).
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Sheet } from './ui';
import { Feedback, PButton } from './partner';
import { createDuesPayment, getDuesSummary, verifyDuesPayment, type DuesOrder, type DuesOutcome, type DuesSummary } from '../services/partnerOps';
import { formatINR } from '../utils/format';
import { colors, space } from '../theme';

const checkoutHtml = (o: DuesOrder) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;color:#7a8593">Opening secure payment…
<script src="https://checkout.razorpay.com/v1/checkout.js"></script><script>
var post=function(m){window.ReactNativeWebView.postMessage(JSON.stringify(m))};
var rz=new Razorpay({key:${JSON.stringify(o.keyId)},amount:${o.amount},currency:${JSON.stringify(o.currency)},order_id:${JSON.stringify(o.orderId)},
name:'NESAM Partner',description:'Outstanding dues',prefill:{name:${JSON.stringify(o.name)},contact:${JSON.stringify(o.phone)}},theme:{color:'#c62828'},
handler:function(r){post({ok:true,orderId:r.razorpay_order_id,paymentId:r.razorpay_payment_id,signature:r.razorpay_signature})},
modal:{ondismiss:function(){post({ok:false,reason:'Payment was cancelled. No money was taken.'})}}});
rz.on('payment.failed',function(){post({ok:false,reason:'The payment failed. You have not been charged; please try again.'})});
rz.open();</script></body></html>`;

/** Never says "paid" unless an amount was actually applied to the dues. */
function outcomeMessage(v: DuesOutcome): string {
  const captured = v.captured ?? 0;
  const applied = v.applied ?? 0;
  const held = v.held ?? 0;
  if (v.status === 'applied' && applied > 0) return `${formatINR(applied)} paid. Your dues have been updated.`;
  if (v.status === 'partly_applied' && applied > 0) return `${formatINR(applied)} of your ${formatINR(captured)} payment was applied to your dues. ${formatINR(held)} is held by NESAM for review and is not available to withdraw.`;
  if (v.status === 'held' || (v.status === 'applied' && applied <= 0)) return `Your payment of ${formatINR(captured || held)} was received, but your dues changed while you were paying, so none of it was applied. NESAM is holding it for review. No dues were marked paid.`;
  return v.message || 'Your payment is being confirmed. Your dues update shortly.';
}

const friendly = (m: string) =>
  /PAYMENT_NOT_CONFIGURED/.test(m) ? 'Online payment is not switched on yet. Contact the NESAM office to pay your dues.' : m;

export function DuesPaymentSheet({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [summary, setSummary] = useState<DuesSummary | null>(null);
  const [order, setOrder] = useState<DuesOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setSummary(await getDuesSummary()); }
    catch (e) { setError(friendly((e as Error).message)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const pay = async () => {
    setBusy(true); setError('');
    try { setOrder(await createDuesPayment()); }
    catch (e) { setError(friendly((e as Error).message)); void load(); }
    finally { setBusy(false); }
  };

  const onMessage = async (raw: string) => {
    let m: { ok: boolean; reason?: string; orderId?: string; paymentId?: string; signature?: string };
    try { m = JSON.parse(raw); } catch { return; }
    setOrder(null);
    if (!m.ok || !m.orderId || !m.paymentId || !m.signature) { setError(m.reason || 'Payment was not completed.'); return; }
    setBusy(true);
    try {
      const v = await verifyDuesPayment(m.orderId, m.paymentId, m.signature);
      onDone(outcomeMessage(v));
    } catch (e) { setError(friendly((e as Error).message)); void load(); } finally { setBusy(false); }
  };

  const payable = summary?.payable ?? 0;
  return (
    <Sheet visible onClose={onClose} title="Pay outstanding dues" dismissible={!busy && !order}>
      {order ? (
        <View style={styles.web}>
          <WebView originWhitelist={['*']} source={{ html: checkoutHtml(order) }} onMessage={(e) => void onMessage(e.nativeEvent.data)} javaScriptEnabled />
        </View>
      ) : loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: space.lg }} />
      ) : (
        <>
          {payable > 0 ? (
            <>
              <Text style={styles.label}>Confirmed dues to pay</Text>
              <Text style={styles.amount}>{formatINR(payable)}</Text>
              {(summary?.items ?? []).map((i, k) => (
                <View key={`${i.label}-${k}`} style={styles.row}>
                  <Text style={styles.rowLabel} numberOfLines={2}>{i.label}</Text>
                  <Text style={styles.rowValue}>{formatINR(i.amount)}</Text>
                </View>
              ))}
              <Text style={styles.note}>The amount is calculated by NESAM from confirmed cash collections and penalties. Paying it clears these dues; they are not deducted again from your settlement.</Text>
            </>
          ) : (
            <Text style={styles.note}>You have no confirmed dues to pay right now.</Text>
          )}
          <Feedback tone="error" message={error} />
          {payable > 0 ? <PButton title={`Pay ${formatINR(payable)}`} icon="arrow-forward" busy={busy} full onPress={() => void pay()} /> : <PButton title="Close" style="secondary" full onPress={onClose} />}
          <Text style={[styles.note, { textAlign: 'center', marginTop: space.md }]}>Secure payment by Razorpay · UPI, cards and net banking.</Text>
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  web: { height: 520, borderRadius: 12, overflow: 'hidden' },
  label: { fontSize: 12, color: colors.muted, fontWeight: '700' },
  amount: { fontSize: 28, fontWeight: '800', color: colors.ink, marginBottom: space.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowLabel: { flex: 1, fontSize: 13, color: colors.ink },
  rowValue: { fontSize: 13, fontWeight: '700', color: colors.ink },
  note: { fontSize: 12.5, lineHeight: 18, color: colors.muted, marginVertical: space.sm },
});
