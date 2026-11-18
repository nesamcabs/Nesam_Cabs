// The driver's own payments to NESAM, on the Wallet page (independent drivers only; a fleet driver settles through the fleet):
//   DuesCard     what is outstanding (cash fares collected, penalties) and "Pay ₹X now"
//   DepositCard  the refundable security deposit and "Add to deposit"
// Razorpay Checkout runs in a WebView (phone) or an iframe (web build). Nothing changes until the server verifies the captured
// payment; the cards then show the server's own account of what happened.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from './Text';
import { NxIcon } from './Icon';
import { NxButton, NxCardHeading, NxField, NxFormError, NxInfo, NxPanel, NxRow } from './primitives';
import { nx } from '../../theme/nx';
import { formatINR } from '../../utils/format';
import { useDriverData } from '../../context/DriverData';
import {
  DEPOSIT_TOPUP_MAX,
  DEPOSIT_TOPUP_MIN,
  createDepositPayment,
  createDuesPayment,
  duesOutcomeText,
  getDuesSummary,
  parseCheckoutMessage,
  partnerCheckoutHtml,
  partnerPaymentError,
  verifyDepositPayment,
  verifyDuesPayment,
  watchDeposit,
  type DepositState,
  type DuesSummary,
  type PartnerOrder,
} from '../../services/partnerPayments';

type Success = { orderId: string; paymentId: string; signature: string };

/** Full-screen Razorpay Checkout for one server order. */
function CheckoutModal({ order, description, onSuccess, onClose }: { order: PartnerOrder | null; description: string; onSuccess: (r: Success) => void; onClose: () => void }) {
  const [warning, setWarning] = useState('');
  const html = useMemo(() => (order ? partnerCheckoutHtml(order, description) : ''), [order, description]);
  useEffect(() => setWarning(''), [order]);
  const onMessage = useCallback(
    (raw: string) => {
      const m = parseCheckoutMessage(raw);
      if (!m) return;
      if ('ok' in m) return onSuccess(m);
      if ('dismissed' in m) return onClose();
      if (m.fatal) {
        setWarning(m.reason);
        return undefined;
      }
      // Razorpay keeps its window open after a failed attempt so the driver can retry.
      setWarning(`${m.reason} You can try again.`);
      return undefined;
    },
    [onSuccess, onClose],
  );
  return (
    <Modal visible={!!order} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={styles.bar}>
          <Text style={styles.barTitle}>Secure payment</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close payment" hitSlop={10} style={styles.close}>
            <NxIcon name="close" size={20} color={nx.ink} />
          </Pressable>
        </View>
        {warning ? <NxInfo tone="amber" style={{ marginHorizontal: 16, marginBottom: 8 }}>{warning}</NxInfo> : null}
        {order ? Platform.OS === 'web' ? <CheckoutFrame html={html} onMessage={onMessage} /> : (
          <WebView originWhitelist={['*']} source={{ html, baseUrl: 'https://checkout.razorpay.com' }} onMessage={(e) => onMessage(e.nativeEvent.data)} javaScriptEnabled domStorageEnabled setSupportMultipleWindows={false} style={{ flex: 1 }} />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

/** react-native-webview has no browser build: the same page runs in an iframe, and a shim forwards its messages. */
function CheckoutFrame({ html, onMessage }: { html: string; onMessage: (raw: string) => void }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const shimmed = useMemo(() => html.replace('<head>', '<head><script>window.ReactNativeWebView={postMessage:function(m){parent.postMessage(m,"*")}}</script>'), [html]);
  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.source === frame.current?.contentWindow && typeof e.data === 'string') onMessage(e.data);
    };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, [onMessage]);
  return React.createElement('iframe', { ref: frame, srcDoc: shimmed, title: 'Secure payment', allow: 'payment', style: { border: 0, width: '100%', height: '100%' } });
}

type Msg = { tone: 'green' | 'amber' | 'red' | 'neutral'; text: string } | null;

export function DuesCard() {
  const [summary, setSummary] = useState<DuesSummary | null>(null);
  const [order, setOrder] = useState<PartnerOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const load = useCallback(async () => {
    try {
      setSummary(await getDuesSummary());
    } catch {
      setSummary(null);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const pay = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setOrder(await createDuesPayment());
    } catch (e) {
      setMsg({ tone: 'red', text: partnerPaymentError(e) });
    } finally {
      setBusy(false);
    }
  };
  const done = async (r: Success) => {
    setOrder(null);
    setBusy(true);
    setMsg({ tone: 'neutral', text: 'Confirming your payment…' });
    try {
      const v = await verifyDuesPayment(r.orderId, r.paymentId, r.signature);
      setMsg({ tone: v.status === 'applied' ? 'green' : 'amber', text: duesOutcomeText(v, formatINR) });
      await load();
    } catch (e) {
      setMsg({ tone: 'red', text: partnerPaymentError(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!summary || (summary.payable <= 0 && !msg)) return null;
  return (
    <NxPanel style={styles.card} accent={summary.payable > 0}>
      <NxCardHeading title="Dues to NESAM" caption="Cash fares you collected and penalties not covered by your earnings" />
      {summary.items.slice(0, 6).map((it, i) => (
        <NxRow key={`${it.label}-${i}`} label={it.label} value={formatINR(it.amount)} />
      ))}
      {summary.payable > 0 ? <NxRow label="Total due" value={formatINR(summary.payable)} strong last /> : null}
      {msg ? <NxInfo tone={msg.tone} style={{ marginTop: 12 }}>{msg.text}</NxInfo> : null}
      {summary.payable > 0 ? (
        <>
          <NxButton title={`Pay ${formatINR(summary.payable)} now`} icon="wallet" loading={busy} onPress={() => void pay()} style={{ marginTop: 14 }} />
          <Text style={styles.fine}>UPI, cards and net banking · Secured by Razorpay</Text>
        </>
      ) : null}
      <CheckoutModal order={order} description="Outstanding dues" onSuccess={(r) => void done(r)} onClose={() => setOrder(null)} />
    </NxPanel>
  );
}

export function DepositCard() {
  const { account } = useDriverData();
  const uid = account.driver.id;
  const [deposit, setDeposit] = useState<DepositState | null>(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [order, setOrder] = useState<PartnerOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => (uid ? watchDeposit(uid, setDeposit, () => setDeposit(null)) : undefined), [uid]);

  const open = !deposit || deposit.status === 'Not paid' || deposit.status === 'Active';
  const start = async () => {
    const n = Number(amount);
    if (!Number.isSafeInteger(n) || n < DEPOSIT_TOPUP_MIN || n > DEPOSIT_TOPUP_MAX) {
      setError(`Enter an amount from ${formatINR(DEPOSIT_TOPUP_MIN)} to ${formatINR(DEPOSIT_TOPUP_MAX)}, in whole rupees.`);
      return;
    }
    setError('');
    setMsg(null);
    setBusy(true);
    try {
      setOrder(await createDepositPayment(n));
    } catch (e) {
      setMsg({ tone: 'red', text: partnerPaymentError(e) });
    } finally {
      setBusy(false);
    }
  };
  const done = async (r: Success) => {
    setOrder(null);
    setBusy(true);
    setMsg({ tone: 'neutral', text: 'Confirming your payment…' });
    try {
      const v = await verifyDepositPayment(r.orderId, r.paymentId, r.signature);
      setMsg(
        v.status === 'credited'
          ? { tone: 'green', text: `${formatINR(v.amount ?? Number(amount))} added to your security deposit.` }
          : v.status === 'held'
            ? { tone: 'amber', text: v.message || 'Your payment was received and is held for NESAM to review.' }
            : { tone: 'neutral', text: v.message || 'Your payment is being confirmed. Your deposit updates shortly.' },
      );
      if (v.status === 'credited') setAmount('');
    } catch (e) {
      setMsg({ tone: 'red', text: partnerPaymentError(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!uid) return null;
  return (
    <NxPanel style={styles.card}>
      <NxCardHeading title="Security deposit" caption="Refundable when you leave NESAM, after dues are settled" />
      <NxRow label="Held by NESAM" value={formatINR(deposit?.amount ?? 0)} strong />
      <NxRow label="Status" value={deposit?.status ?? 'Not paid'} last />
      {open ? (
        <>
          <NxField label="Add to deposit (₹)" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9]/g, '').slice(0, 6))} keyboardType="number-pad" placeholder={`${DEPOSIT_TOPUP_MIN} – ${DEPOSIT_TOPUP_MAX}`} />
          <NxFormError message={error} />
          <NxButton title="Pay and add to deposit" icon="bank" variant="secondary" loading={busy} onPress={() => void start()} style={{ marginTop: 12 }} />
        </>
      ) : (
        <NxInfo style={{ marginTop: 12 }}>Your deposit is being refunded or has been settled, so it cannot be topped up now.</NxInfo>
      )}
      {msg ? <NxInfo tone={msg.tone} style={{ marginTop: 12 }}>{msg.text}</NxInfo> : null}
      <CheckoutModal order={order} description="Security deposit" onSuccess={(r) => void done(r)} onClose={() => setOrder(null)} />
    </NxPanel>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 14 },
  fine: { marginTop: 6, fontSize: 11.5, color: nx.muted, textAlign: 'center' },
  sheet: { flex: 1, backgroundColor: '#fff' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  barTitle: { fontSize: 16, fontWeight: '700', color: nx.ink },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: nx.page },
});
