// Fleet wallet, payouts and ledger (native port of vendor/web WalletPayoutScreen.tsx).
// Every number here is the server's (wallets/vendor_{uid}, wallet_ledger); the
// app never computes a balance or commission.
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useVendorData } from '../context/VendorData';
import { Badge, Button, Card, EmptyState, Notice, Row, Screen, Segmented, Sheet, TextField } from '../components/ui';
import { MIN_PAYOUT, requestVendorPayout, validateVendorPayout, VendorActionError } from '../services/vendorService';
import { formatINR } from '../utils/format';
import { formatDateTime12 } from '../utils/time';
import { describeDataError } from '../utils/retry';
import { colors, space, type } from '../theme';
import { useNavigation } from '@react-navigation/native';
import { Alert } from 'react-native';
import { DuesPaymentSheet } from '../components/DuesPaymentSheet';
import { Feedback, PageHeading, PBadge, PButton } from '../components/partner';
import { requestDepositRefund } from '../services/partnerOps';

const ENTRY_LABEL: Record<string, string> = {
  trip_earning: 'Trip earning',
  toll_reimbursement: 'Toll reimbursement',
  cash_collected: 'Cash fare collected by your fleet',
  payout: 'Payout',
  penalty_deduction: 'Confirmed penalty',
  wallet_recharge: 'Wallet recharge',
  extra_charge: 'Approved extra charges',
  due_payment: 'Dues payment',
  due_payment_held: 'Dues payment · held for review',
};
const ENTRY_STATUS: Record<string, string> = {
  pending: 'Awaiting customer payment',
  available: 'Available',
  reserved: 'Held for payout',
  completed: 'Completed',
  cancelled: 'Released',
  held: 'Held by NESAM for review · not withdrawable',
};

export function WalletScreen() {
  const { wallet, ledger, payouts, profile, monthEarnings, errors, deposit } = useVendorData();
  const navigation = useNavigation();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [payDues, setPayDues] = useState(false);
  const [notice, setNotice] = useState('');
  const withdrawable = Math.max(0, Math.floor(wallet.available));
  const askRefund = () => Alert.alert('Security deposit refund', 'The deposit is refunded at Full & Final settlement, after account closure, completed duties and clearance of outstanding accounts. Request it now?', [
    { text: 'Not now', style: 'cancel' },
    { text: 'Request refund', onPress: () => { requestDepositRefund().then(() => setNotice('Refund request sent. The office settles it at full & final settlement.'), (e: Error) => setNotice(e.message)); } },
  ]);

  return (
    <Screen edges={[]}>
      <PageHeading title="Wallet" subtitle="Your working balance and security deposit." />
      <Feedback message={notice} />
      {payDues ? <DuesPaymentSheet onClose={() => setPayDues(false)} onDone={(m) => { setPayDues(false); setNotice(m); }} /> : null}
      <Card>
        <Text style={type.tiny}>SECURITY DEPOSIT</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <Text style={styles.balance}>{formatINR(deposit?.amount ?? 0)}</Text>
          <PBadge label={deposit?.status ?? 'Not recorded'} tone={deposit?.status === 'Active' ? 'green' : deposit?.status === 'Refund requested' ? 'amber' : 'neutral'} />
        </View>
        <Text style={type.small}>Held separately from your working wallet. Refund at Full &amp; Final settlement — after account closure, completed duties and clearance of outstanding accounts.</Text>
        {deposit?.status === 'Active' && deposit.amount > 0 ? <PButton style="text" icon="chevron-forward" title="Request refund at closure" onPress={askRefund} /> : null}
      </Card>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: space.md }}>
        {wallet.available < 0 ? <PButton title="Pay outstanding dues" icon="card-outline" onPress={() => setPayDues(true)} containerStyle={{ flex: 1 }} /> : null}
        <PButton title="Penalty notices" style="secondary" icon="warning-outline" onPress={() => navigation.navigate('Penalties')} containerStyle={{ flex: 1 }} />
      </View>
      {open ? (
        <PayoutSheet
          withdrawable={withdrawable}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            setDone(true);
          }}
        />
      ) : null}
      <Notice message={errors.wallet} />
      <Card>
        <Text style={type.tiny}>WORKING WALLET · AVAILABLE TO WITHDRAW</Text>
        <Text style={[styles.balance, wallet.available < 0 && { color: colors.danger }]}>{formatINR(wallet.available)}</Text>
        {wallet.available < 0 ? (
          <Text style={[type.small, { color: colors.danger }]}>Cash fares your fleet collected exceed your earnings; upcoming earnings settle this first.</Text>
        ) : null}
        <Text style={type.small}>
          {formatINR(wallet.pending)} awaiting customer payment · {formatINR(wallet.reserved)} held for requests · {formatINR(wallet.paidOut)} paid out
        </Text>
        <Button title="Request payout" disabled={withdrawable < MIN_PAYOUT} onPress={() => setOpen(true)} style={{ marginTop: space.md }} />
        {withdrawable < MIN_PAYOUT ? (
          <Text style={[type.small, { marginTop: space.sm }]}>Payouts can be requested once your available balance reaches {formatINR(MIN_PAYOUT)}.</Text>
        ) : null}
      </Card>
      {done ? <Notice tone="success" message="Payout request submitted. The amount is held from your balance until NESAM finance pays it and shares the UTR." /> : null}

      <Card>
        <Text style={[type.h3, { marginBottom: space.sm }]}>Earnings summary</Text>
        <Row label="Trip earnings credited" value={formatINR(wallet.tripEarnings)} />
        <Row label="Toll reimbursements" value={formatINR(wallet.tollReimbursements)} />
        <Row label="Cash collected by your fleet" value={`− ${formatINR(wallet.cashCollected)}`} />
        <Row label="Earned this month" value={formatINR(monthEarnings)} bold />
        <Text style={[type.tiny, { marginTop: space.sm }]}>Figures are recorded by NESAM on each completed trip; the payout per trip is the rate you accepted.</Text>
      </Card>

      <Card>
        <Text style={type.h3}>Settlement account</Text>
        <Text style={[type.body, { marginTop: 4 }]}>{profile.bankAccountName || 'Not on file'}</Text>
        <Text style={type.small}>
          {profile.bankAccountNumber} {profile.ifscCode ? `· ${profile.ifscCode}` : ''}
        </Text>
        {profile.upiId ? <Text style={type.small}>UPI {profile.upiId}</Text> : null}
        <Text style={[type.tiny, { marginTop: 4 }]}>NESAM pays only to this account. Request a bank change from Profile → Bank details; it takes effect after office approval.</Text>
      </Card>

      <Text style={[type.h3, styles.section]}>Payout requests</Text>
      {payouts.length === 0 ? (
        <EmptyState title="No payout requests yet" />
      ) : (
        payouts.map((p) => (
          <View key={p.id} style={styles.txn}>
            <View style={{ flex: 1 }}>
              <Text style={type.body}>Payout · {p.method}</Text>
              {p.utr ? <Text style={type.tiny}>UTR {p.utr}</Text> : null}
              {p.createdMs ? <Text style={type.tiny}>Requested {formatDateTime12(new Date(p.createdMs))}</Text> : null}
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={styles.amount}>{formatINR(p.amount)}</Text>
              <Badge label={p.status} tone={p.status === 'Paid' ? 'success' : p.status === 'Pending' ? 'warning' : 'neutral'} />
            </View>
          </View>
        ))
      )}

      <Text style={[type.h3, styles.section]}>Ledger</Text>
      {ledger.length === 0 ? (
        <EmptyState title="No entries yet" message="Trip earnings, cash collected and payouts recorded by NESAM appear here." />
      ) : (
        ledger.slice(0, 50).map((e) => (
          <View key={e.id} style={styles.txn}>
            <View style={{ flex: 1 }}>
              <Text style={type.body}>
                {ENTRY_LABEL[e.type] ?? e.type}
                {e.bookingCode ? ` · ${e.bookingCode}` : ''}
              </Text>
              <Text style={type.tiny}>
                {e.createdAt ? formatDateTime12(e.createdAt) : ''}
                {ENTRY_STATUS[e.status] ? ` · ${ENTRY_STATUS[e.status]}` : ''}
              </Text>
            </View>
            <Text style={[styles.amount, { color: e.direction === 'credit' ? colors.success : colors.danger }]}>
              {e.direction === 'credit' ? '+' : '−'} {formatINR(e.amount)}
            </Text>
          </View>
        ))
      )}
    </Screen>
  );
}

function PayoutSheet({ withdrawable, onClose, onDone }: { withdrawable: number; onClose: () => void; onDone: () => void }) {
  const { profile } = useVendorData();
  const [amount, setAmount] = useState(String(withdrawable));
  const [method, setMethod] = useState<'UPI' | 'Bank Transfer'>(profile.bankAccountNumber || !profile.upiId ? 'Bank Transfer' : 'UPI');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const value = Number(amount);
    const invalid = validateVendorPayout(value, withdrawable);
    if (invalid) return setError(invalid);
    // The server pays only to the account in the vendor's KYC.
    if (method === 'UPI' && !profile.upiId) return setError('No UPI ID on file. Contact NESAM support to add one.');
    if (method === 'Bank Transfer' && !profile.bankAccountNumber) return setError('No bank account on file. Contact NESAM support.');
    setBusy(true);
    setError('');
    try {
      await requestVendorPayout(value, withdrawable, method);
      onDone();
    } catch (e) {
      setError(e instanceof VendorActionError ? e.message : describeDataError(e));
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <Sheet visible onClose={onClose} title="Request payout" dismissible={!busy}>
      <Text style={[type.small, { marginBottom: space.md }]}>
        Available {formatINR(withdrawable)} · minimum {formatINR(MIN_PAYOUT)}
      </Text>
      <TextField label="Amount (₹)" value={amount} onChangeText={(t) => setAmount(t.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad" />
      <Segmented
        options={[
          { value: 'Bank Transfer', label: 'Bank (NEFT/IMPS)' },
          { value: 'UPI', label: 'UPI' },
        ]}
        value={method}
        onChange={setMethod}
      />
      <Card style={{ marginTop: space.md }}>
        <Text style={type.tiny}>PAID TO</Text>
        {method === 'UPI' ? (
          <Text style={type.body}>{profile.upiId || 'No UPI ID on file'}</Text>
        ) : (
          <>
            <Text style={type.body}>{profile.bankAccountName || 'No account on file'}</Text>
            <Text style={type.small}>
              {profile.bankAccountNumber} {profile.ifscCode}
            </Text>
          </>
        )}
      </Card>
      <Notice message={error} />
      <Button title={busy ? 'Submitting…' : 'Confirm request'} loading={busy} onPress={() => void submit()} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  balance: { fontSize: 32, fontWeight: '900', color: colors.ink, marginVertical: 4 },
  section: { marginTop: space.md, marginBottom: space.sm },
  txn: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  amount: { fontSize: 15, fontWeight: '900' },
});
