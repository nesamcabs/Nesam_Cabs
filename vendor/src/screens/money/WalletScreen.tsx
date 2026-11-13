// Wallet — working balance and a separate refundable deposit (reference qWalletView). Every number is the server's
// (wallets/vendor_{uid}, wallet_ledger); the app never computes a balance. Ledger tabs: All · Trips · Payments · Penalties · Payouts.
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/kit/Text';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { useInbox } from '../../context/Inbox';
import { Page } from '../../components/shell/Page';
import { Segmented, Sheet, TextField } from '../../components/ui';
import { DuesPaymentSheet } from '../../components/DuesPaymentSheet';
import { DepositSheet } from '../../components/DepositSheet';
import { ActionButton, Badge, Btn, Empty, Eyebrow, Feedback, Grid, H2, KV, Notice, Panel, Small, Tabs, TextLink, type IconName, type Tone } from '../../components/kit/core';
import { dayTime, rupees } from '../../components/kit/format';
import { flash } from '../../components/kit/flash';
import { MIN_PAYOUT, requestVendorPayout, validateVendorPayout, VendorActionError } from '../../services/vendorService';
import { requestDepositRefund } from '../../services/partnerOps';
import { describeDataError } from '../../utils/retry';
import type { LedgerRecord } from '../../types/operations';
import type { RootStackParamList, WalletTab } from '../../navigation/types';
import { penaltyTone } from './PenaltyScreen';
import { colors, fontFamily } from '../../theme';
import { useLayout } from '../../theme/responsive';

const ENTRY: Record<string, { label: string; tab: WalletTab; icon: IconName }> = {
  trip_earning: { label: 'Trip earning', tab: 'Trips', icon: 'swap-horizontal' },
  toll_reimbursement: { label: 'Toll reimbursement', tab: 'Trips', icon: 'swap-horizontal' },
  cash_collected: { label: 'Cash fare collected by your fleet', tab: 'Trips', icon: 'cash-outline' },
  extra_charge: { label: 'Approved extra charges', tab: 'Trips', icon: 'swap-horizontal' },
  penalty_deduction: { label: 'Confirmed penalty', tab: 'Penalties', icon: 'warning-outline' },
  payout: { label: 'Bank payout', tab: 'Payouts', icon: 'business-outline' },
  wallet_recharge: { label: 'Wallet payment', tab: 'Payments', icon: 'add-circle-outline' },
  due_payment: { label: 'Dues payment', tab: 'Payments', icon: 'add-circle-outline' },
  due_payment_held: { label: 'Dues payment · held for review', tab: 'Payments', icon: 'add-circle-outline' },
};
const STATUS: Record<string, string> = {
  pending: 'Awaiting customer payment', available: 'Available', reserved: 'Held for payout', completed: 'Completed', cancelled: 'Released', held: 'Held by NESAM for review',
};

export function WalletScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'Wallet'>>();
  const d = useVendorData();
  const { penalties } = useInbox();
  const { wide } = useLayout();
  const [tab, setTab] = useState<WalletTab>(route.params?.tab ?? 'All');
  const [seen, setSeen] = useState(route.params?.tab);
  if (route.params?.tab !== seen) { setSeen(route.params?.tab); if (route.params?.tab) setTab(route.params.tab); }
  const [sheet, setSheet] = useState<'' | 'payout' | 'dues' | 'deposit'>('');
  const w = d.wallet;
  const withdrawable = Math.max(0, Math.floor(w.available));
  const negative = w.available < 0;
  const dep = d.deposit;
  // Once a refund is requested or the deposit is settled, only the office changes it.
  const depositClosed = !!dep && ['Refund requested', 'Refunded', 'Adjusted'].includes(dep.status);
  // The office's mandatory deposit: what is required, what is held, what is still to pay.
  const policy = d.depositPolicy;
  const requiredDeposit = policy.required ? policy.amount : 0;
  const heldDeposit = dep && ['Active', 'Refund requested'].includes(dep.status) ? dep.amount : 0;
  const remainingDeposit = depositClosed ? 0 : Math.max(0, requiredDeposit - heldDeposit);
  const depositPct = requiredDeposit ? Math.min(100, Math.round((heldDeposit / requiredDeposit) * 100)) : 0;
  const entries = d.ledger.filter((e) => tab === 'All' || (ENTRY[e.type]?.tab ?? 'Trips') === tab);
  const processing = d.dues.filter((x) => ['Due', 'Processing', 'On Hold'].includes(x.status)).length;

  const askRefund = () => Alert.alert('Request deposit refund?', 'The deposit is refunded at Full & Final settlement, after account closure, completed duties and clearance of outstanding accounts.', [
    { text: 'Not now', style: 'cancel' },
    { text: 'Request refund', onPress: () => { requestDepositRefund().then(() => flash('Refund request sent. The office settles it at full & final settlement.'), (e: Error) => flash(e.message, 'error')); } },
  ]);

  return (
    <Page title="Wallet">
      {remainingDeposit > 0 ? (
        <Notice tone="amber" icon="shield-checkmark-outline" title="Security deposit is mandatory" style={{ marginBottom: 12 }}
          text={`NESAM requires a refundable deposit of ${rupees(requiredDeposit)}. ${heldDeposit ? `${rupees(heldDeposit)} is paid; ` : ''}pay the remaining ${rupees(remainingDeposit)} to complete it.${policy.message ? ` ${policy.message}` : ''}`}
          action={<Btn small icon="add" title="Pay deposit" onPress={() => setSheet('deposit')} />} />
      ) : null}
      {d.errors.wallet ? <Notice tone="red" title="Wallet could not load" text={d.errors.wallet} style={{ marginBottom: 14 }} /> : null}
      <View style={styles.actionRow}>
        {negative
          ? <ActionButton primary icon="card-outline" label="Pay dues" onPress={() => setSheet('dues')} />
          : <ActionButton primary icon="arrow-up" label="Withdraw" disabled={withdrawable < MIN_PAYOUT} onPress={() => setSheet('payout')} />}
        <ActionButton icon="add" label="Add deposit" disabled={depositClosed} onPress={() => setSheet('deposit')} />
      </View>
      <Grid columns={wide ? 2 : 1} gap={12}>
        <View style={[styles.balance, { flexGrow: 1 }]}>
          <Text style={styles.eyebrowLight}>WORKING WALLET</Text>
          <Text style={[styles.balanceValue, negative && { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>{rupees(w.available)}</Text>
          <Text style={styles.balanceSub}>{negative ? 'Outstanding · upcoming earnings settle this first, or pay your dues now.' : 'Available to withdraw'}</Text>
          {w.reserved ? <Text style={styles.held}>{rupees(w.reserved)} held for a pending bank payout</Text> : null}
          <View style={styles.balanceRow}>
            <Mini label="Awaiting" value={rupees(w.pending)} />
            <Mini label="Paid out" value={rupees(w.paidOut)} />
            <Mini label="This month" value={rupees(d.monthEarnings)} />
          </View>
          {withdrawable < MIN_PAYOUT && !negative ? <Small style={{ marginTop: 10 }}>Withdraw opens at {rupees(MIN_PAYOUT)} available.</Small> : null}
        </View>
        <Panel style={{ padding: 16, flexGrow: 1 }}>
          <View style={styles.depRow}>
            <View style={styles.depositIcon}><Ionicons name="shield-checkmark-outline" size={18} color="#4F7A68" /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Eyebrow>SECURITY DEPOSIT{requiredDeposit ? ' · MANDATORY' : ''}</Eyebrow>
              <Text style={styles.depositValue} numberOfLines={1}>{rupees(heldDeposit)}{requiredDeposit ? <Text style={styles.depositOf}> / {rupees(requiredDeposit)}</Text> : null}</Text>
            </View>
            <Badge
              label={depositClosed ? (dep?.status ?? '') : requiredDeposit ? (remainingDeposit > 0 ? `${rupees(remainingDeposit)} due` : 'Complete') : (dep?.status ?? 'Not recorded')}
              tone={depositClosed ? 'amber' : requiredDeposit ? (remainingDeposit > 0 ? 'red' : 'green') : dep?.status === 'Active' ? 'green' : 'neutral'} />
          </View>
          {requiredDeposit && !depositClosed ? (
            <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: depositPct }} accessibilityLabel="Security deposit paid">
              <View style={[styles.trackFill, { width: `${depositPct}%`, backgroundColor: remainingDeposit > 0 ? colors.primary : colors.success }]} />
            </View>
          ) : null}
          <Small style={{ marginTop: 10 }}>{requiredDeposit && policy.message ? policy.message : 'Refundable and separate from the working wallet. Trip and penalty adjustments never use it.'}</Small>
          {dep?.status === 'Active' && dep.amount > 0 ? <View style={{ marginTop: 8 }}><TextLink title="Request deposit refund" onPress={askRefund} /></View> : null}
          {dep?.status === 'Refund requested' ? <Small style={{ marginTop: 8 }}>Existing duties and outstanding accounts must be resolved before the refund.</Small> : null}
        </Panel>
      </Grid>

      {processing ? <Notice tone="neutral" icon="time-outline" title="Adjustment pending" text={`${processing} completed ${processing === 1 ? 'duty needs' : 'duties need'} final bill closure or collection verification.`} style={{ marginTop: 18 }} /> : null}

      <Tabs value={tab} onChange={setTab} items={(['All', 'Trips', 'Payments', 'Penalties', 'Payouts'] as WalletTab[]).map((id) => ({ id, label: id, count: id === 'Penalties' ? penalties.length || undefined : undefined }))} />

      {tab === 'Penalties' ? (
        penalties.length ? (
          <View style={{ marginBottom: 18 }}>
            <Grid>
              {penalties.map((p) => (
                <Panel key={p.id} onPress={() => navigation.navigate('Penalty', { id: p.id })} label={`Penalty ${rupees(p.amount)}`} style={{ flexGrow: 1 }}>
                  <View style={styles.between}><Small>{p.bookingCode || 'General notice'}</Small><Badge label={p.status === 'Pending' && !p.acknowledged ? 'Acknowledgement required' : p.status} tone={penaltyTone(p.status, p.acknowledged)} /></View>
                  <Text style={styles.penaltyAmount}>{rupees(p.amount)}</Text>
                  <Text style={styles.penaltyReason} numberOfLines={2}>{p.category} · {p.reason}</Text>
                  <View style={[styles.between, { marginTop: 12 }]}><Small>{dayTime(p.issuedAt)}</Small><TextLink title="View notice" onPress={() => navigation.navigate('Penalty', { id: p.id })} /></View>
                </Panel>
              ))}
            </Grid>
          </View>
        ) : <View style={{ marginBottom: 18 }}><Empty icon="shield-checkmark-outline" title="No penalty notices" text="Notices and office decisions appear here." /></View>
      ) : null}

      {tab === 'Payouts' || tab === 'All' ? (
        d.payouts.length ? (
          <Panel style={{ marginBottom: 14, padding: 16 }}>
            <H2>Bank payouts</H2>
            {d.payouts.map((p) => (
              <View key={p.id} style={styles.payRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.payTitle}>{rupees(p.amount)} · {p.method}</Text>
                  <Small>{p.utr ? `UTR ${p.utr} · ` : ''}{p.createdMs ? dayTime(new Date(p.createdMs)) : p.requestedAt}</Small>
                </View>
                <Badge label={p.status} tone={p.status === 'Paid' ? 'green' : p.status === 'Pending' ? 'amber' : p.status === 'Rejected' ? 'red' : 'neutral'} />
              </View>
            ))}
          </Panel>
        ) : tab === 'Payouts' ? <View style={{ marginBottom: 18 }}><Empty icon="business-outline" title="No payout requests yet" text={`Request a payout once your available balance reaches ${rupees(MIN_PAYOUT)}.`} /></View> : null
      ) : null}

      {tab !== 'Penalties' || entries.length ? (
        entries.length ? (
          <Panel style={{ paddingVertical: 4, paddingHorizontal: 6 }}>
            {entries.slice(0, 80).map((e, i) => <LedgerRow key={e.id} e={e} last={i === Math.min(entries.length, 80) - 1} />)}
          </Panel>
        ) : tab !== 'Payouts' ? <Empty icon="receipt-outline" title="No entries here" text="Trip earnings, cash collected, penalties and payouts recorded by NESAM appear here." /> : null
      ) : null}

      <Panel style={{ marginTop: 14, padding: 16 }}>
        <H2>Settlement account</H2>
        <KV rows={[['Account holder', d.profile.bankAccountName || d.record.payoutSummary?.accountHolderName || 'Not on file'], ['Account', d.profile.bankAccountNumber || (d.record.payoutSummary?.bankLast4 ? `•••• ${d.record.payoutSummary.bankLast4}` : '—')], ['IFSC', d.profile.ifscCode || d.record.payoutSummary?.ifsc || '—'], d.profile.upiId ? ['UPI', d.profile.upiId] : null]} />
        <Small style={{ marginTop: 10 }}>NESAM pays only to this account. Request a change from Profile → Bank details; it applies after office approval.</Small>
      </Panel>

      {sheet === 'payout' ? <PayoutSheet withdrawable={withdrawable} onClose={() => setSheet('')} /> : null}
      {sheet === 'deposit' ? <DepositSheet current={heldDeposit} required={requiredDeposit} onClose={() => setSheet('')} onDone={(m) => { setSheet(''); flash(m); }} /> : null}
      {sheet === 'dues' ? <DuesPaymentSheet onClose={() => setSheet('')} onDone={(m) => { setSheet(''); flash(m); }} /> : null}
    </Page>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={styles.miniLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.miniValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function LedgerRow({ e, last }: { e: LedgerRecord; last: boolean }) {
  const meta = ENTRY[e.type] ?? { label: e.type.replace(/_/g, ' '), tab: 'Trips' as WalletTab, icon: 'swap-horizontal' as IconName };
  const credit = e.direction === 'credit';
  const tone: Tone = meta.tab === 'Penalties' ? 'red' : meta.tab === 'Payments' ? 'green' : meta.tab === 'Payouts' ? 'blue' : 'neutral';
  const iconBg = { red: '#FFF0EE', green: '#EDF7F1', blue: '#EEF3FB', neutral: '#F6F7F9', amber: '#FFF6E5' }[tone];
  const iconFg = { red: '#B4533F', green: '#3D7D5E', blue: '#4D6E9C', neutral: '#6F7785', amber: '#9A6A2D' }[tone];
  return (
    <Pressable style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.ledger, last && { borderBottomWidth: 0 }, hovered && { backgroundColor: '#FAFAFB' }]} accessibilityLabel={`${meta.label} ${credit ? 'credit' : 'debit'} ${rupees(e.amount)}`}>
      <View style={[styles.ledgerIcon, { backgroundColor: iconBg }]}><Ionicons name={meta.icon} size={17} color={iconFg} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.ledgerTitle} numberOfLines={1}>{meta.label}</Text>
        <Small lines={1}>{[e.bookingCode, dayTime(e.createdAt), STATUS[e.status]].filter(Boolean).join(' · ')}</Small>
      </View>
      <Text style={[styles.ledgerAmount, { color: credit ? colors.success : colors.danger }]}>{credit ? '+' : '−'}{rupees(e.amount)}</Text>
    </Pressable>
  );
}

function PayoutSheet({ withdrawable, onClose }: { withdrawable: number; onClose: () => void }) {
  const { profile } = useVendorData();
  const [amount, setAmount] = useState(String(withdrawable));
  const [method, setMethod] = useState<'UPI' | 'Bank Transfer'>(profile.bankAccountNumber || !profile.upiId ? 'Bank Transfer' : 'UPI');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    const value = Number(amount);
    const invalid = validateVendorPayout(value, withdrawable);
    if (invalid) { setError(invalid); return; }
    if (method === 'UPI' && !profile.upiId) { setError('No UPI ID on file. Contact NESAM support to add one.'); return; }
    if (method === 'Bank Transfer' && !profile.bankAccountNumber) { setError('No bank account on file. Contact NESAM support.'); return; }
    setBusy(true); setError('');
    try {
      await requestVendorPayout(value, withdrawable, method);
      flash('Payout requested. The amount is held until NESAM finance pays it and shares the UTR.');
      onClose();
    } catch (e) { setError(e instanceof VendorActionError ? e.message : describeDataError(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet visible onClose={onClose} title="Request payout" dismissible={!busy}>
      <Small style={{ marginBottom: 14 }}>Available {rupees(withdrawable)} · minimum {rupees(MIN_PAYOUT)}</Small>
      <TextField label="Amount (₹)" value={amount} onChangeText={(t) => setAmount(t.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad" />
      <Segmented<'UPI' | 'Bank Transfer'> options={[{ value: 'Bank Transfer', label: 'Bank (NEFT/IMPS)' }, { value: 'UPI', label: 'UPI' }]} value={method} onChange={setMethod} />
      <Panel style={{ marginTop: 14, padding: 16, backgroundColor: colors.subtle }}>
        <Eyebrow>PAID TO</Eyebrow>
        {method === 'UPI'
          ? <Text style={styles.payTitle}>{profile.upiId || 'No UPI ID on file'}</Text>
          : <><Text style={[styles.payTitle, { marginTop: 6 }]}>{profile.bankAccountName || 'No account on file'}</Text><Small>{[profile.bankAccountNumber, profile.ifscCode].filter(Boolean).join(' · ')}</Small></>}
      </Panel>
      <Feedback tone="error" message={error} />
      <Btn title="Confirm request" icon="checkmark" busy={busy} full onPress={() => void submit()} style={{ marginTop: 14 }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  depRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  balance: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 16 },
  eyebrowLight: { fontFamily, fontSize: 10, fontWeight: '600', letterSpacing: 1.1, color: '#6F7785' },
  balanceValue: { fontFamily, fontSize: 28, fontWeight: '700', letterSpacing: -0.8, color: '#424B5A', marginTop: 6 },
  balanceSub: { fontFamily, fontSize: 12, color: '#6F7785', marginTop: 2, lineHeight: 18 },
  held: { fontFamily, fontSize: 11, color: '#9D8353', marginTop: 8 },
  balanceRow: { flexDirection: 'row', gap: 12, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F1F2F5' },
  miniLabel: { fontFamily, fontSize: 10.5, color: '#8B919C' },
  miniValue: { fontFamily, fontSize: 14, fontWeight: '600', color: '#424B5A', marginTop: 4 },
  depositIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#EEF6F2', alignItems: 'center', justifyContent: 'center' },
  depositOf: { fontSize: 14, fontWeight: '600', color: '#8B919C' },
  track: { height: 6, borderRadius: 3, backgroundColor: '#EEF0F4', overflow: 'hidden', marginTop: 12 },
  trackFill: { height: 6, borderRadius: 3 },
  depositValue: { fontFamily, fontSize: 22, fontWeight: '700', color: '#424B5A', marginTop: 2, letterSpacing: -0.5 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  penaltyAmount: { fontFamily, fontSize: 24, fontWeight: '700', color: '#B81C2A', marginTop: 12 },
  penaltyReason: { fontFamily, fontSize: 13, color: colors.ink, marginTop: 4, lineHeight: 19 },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F2F5' },
  payTitle: { fontFamily, fontSize: 13.5, fontWeight: '600', color: colors.ink },
  ledger: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#F1F2F5', borderRadius: 8 },
  ledgerIcon: { width: 34, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  ledgerTitle: { fontFamily, fontSize: 13, fontWeight: '500', color: '#6F7785' },
  ledgerAmount: { fontFamily, fontSize: 16, fontWeight: '600' },
});
