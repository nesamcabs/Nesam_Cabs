// Wallet (reference "Wallet"): balance, payout requests and the ledger. Every number is the server's
// (wallets/driver_{uid}, wallet_ledger, payout_requests); the app never computes a balance.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../components/nx/Text';
import { useDriverData } from '../context/DriverData';
import { NxScreen, useShell } from '../components/nx/Shell';
import { NxGrid, NxTwoPane, useLayout } from '../components/nx/layout';
import { NxDialog } from '../components/nx/Dialog';
import { NxIcon, type NxIconName } from '../components/nx/Icon';
import { NxBadge, NxButton, NxCardHeading, NxEmpty, NxField, NxFormError, NxInfo, NxListItem, NxPanel, NxPills, NxRow } from '../components/nx/primitives';
import { DriverActionError, MIN_PAYOUT, requestPayout, validatePayoutAmount } from '../services/driverService';
import { formatINR } from '../utils/format';
import { formatDateTime12 } from '../utils/time';
import { describeError } from '../utils/retry';
import { nx } from '../theme/nx';

const ENTRY_LABEL: Record<string, string> = {
  trip_earning: 'Trip earning',
  toll_reimbursement: 'Toll reimbursement',
  extra_charge: 'Approved extra charges',
  cash_collected: 'Cash fare you collected',
  payout: 'Payout',
  penalty: 'Penalty',
};
const ENTRY_STATUS: Record<string, string> = {
  pending: 'Awaiting customer payment',
  available: 'Available',
  reserved: 'Held for payout',
  completed: 'Completed',
  cancelled: 'Released',
};
const ENTRY_ICON: Record<string, NxIconName> = { trip_earning: 'car', toll_reimbursement: 'trip', cash_collected: 'wallet', payout: 'bank', penalty: 'alert' };

export function WalletScreen() {
  const { account, wallet, walletError, payouts, ledger } = useDriverData();
  const { openSupport } = useShell();
  const { wide } = useLayout();
  const { driver, bank } = account;
  const [open, setOpen] = useState(false);
  const withdrawable = Math.max(0, Math.floor(wallet.available));
  const negative = wallet.available < 0;

  if (driver.vendorId && ledger.length === 0 && payouts.length === 0) {
    return (
      <NxScreen>
        <NxEmpty icon="wallet" title="Settled by your fleet" message={`You drive for ${driver.vendorName || 'a fleet operator'}. They receive the payout for your trips and pay you directly, so NESAM keeps no wallet balance for you.`} />
      </NxScreen>
    );
  }

  const left = (
    <>
      <View style={styles.hero}>
        <View style={styles.heroRing} pointerEvents="none" />
        <Text style={styles.heroEyebrow}>AVAILABLE WALLET BALANCE</Text>
        <Text style={[styles.heroValue, negative && { color: '#FF8A97' }]} numberOfLines={1} adjustsFontSizeToFit>
          {formatINR(wallet.available)}
        </Text>
        <NxButton title="Request payout" trailingIcon="arrow" disabled={withdrawable < MIN_PAYOUT} onPress={() => setOpen(true)} style={styles.heroButton} />
        <View style={styles.heroFoot}>
          <NxIcon name="shield" size={14} color={nx.walletMuted} />
          <Text style={styles.heroFootText}>Approved settlements and adjustments</Text>
        </View>
        {withdrawable < MIN_PAYOUT ? <Text style={styles.heroNote}>You can request a payout once your available balance reaches {formatINR(MIN_PAYOUT)}.</Text> : null}
      </View>
      <NxGrid columns={2} phoneColumns={2} gap={12}>
        <Small label="Awaiting customer payment" value={formatINR(wallet.pending)} />
        <Small label="Held for payout requests" value={formatINR(wallet.reserved)} />
        <Small label="Paid out" value={formatINR(wallet.paidOut)} />
        <Small label="Cash fares collected" value={formatINR(wallet.cashCollected)} />
      </NxGrid>
      {negative ? (
        <NxInfo tone="amber">Cash fares you collected exceed your earnings; upcoming earnings settle this first.</NxInfo>
      ) : (
        <NxInfo>Closing a trip does not mark its payment as received. Earnings move to your balance once NESAM verifies the customer’s payment.</NxInfo>
      )}
      <NxPanel style={[styles.card, { marginTop: 18 }]}>
        <NxCardHeading title="Payout account" caption="NESAM pays only to this saved account" right={<NxIcon name="bank" size={20} color={nx.ink} />} />
        <NxRow label="Account holder" value={bank.accountHolder || 'No account on file'} />
        {bank.accountNumber ? <NxRow label="Account no." value={`••••${bank.accountNumber.slice(-4)}`} /> : null}
        {bank.ifsc ? <NxRow label="IFSC" value={`${bank.ifsc}${bank.bankName ? ` · ${bank.bankName}` : ''}`} /> : null}
        <NxRow label="UPI" value={bank.upiId || '—'} last />
        <Text style={styles.note}>Change it from Profile › Contact & payout account.</Text>
      </NxPanel>
    </>
  );

  const right = (
    <>
      <NxPanel style={styles.card}>
        <NxCardHeading title="Payout requests" caption="Reviewed by NESAM finance" right={<NxIcon name="clock" size={20} color={nx.ink} />} />
        {payouts.length === 0 ? (
          <Text style={styles.note}>No payout requests yet.</Text>
        ) : (
          payouts.map((po, i) => (
            <NxListItem
              key={po.id}
              icon="bank"
              title={`${po.method} · ${formatINR(po.amount)}`}
              caption={[po.details, `Requested ${po.requestedAt}`, po.utr ? `UTR ${po.utr}` : '', po.processedAt ? `Processed ${formatDateTime12(po.processedAt)}` : ''].filter(Boolean).join(' · ')}
              right={<NxBadge label={po.status} tone={po.status === 'Paid' ? 'green' : po.status === 'Pending' || po.status === 'Deferred' ? 'amber' : 'neutral'} />}
              last={i === payouts.length - 1}
            />
          ))
        )}
        <NxButton title="Get settlement help" icon="help" variant="secondary" onPress={() => openSupport()} style={{ marginTop: 18 }} />
      </NxPanel>

      <NxPanel style={styles.card}>
        <NxCardHeading title="Wallet ledger" caption={ledger.length ? `Latest ${Math.min(ledger.length, 50)} entries` : 'Credits and debits recorded by NESAM'} right={<NxIcon name="wallet" size={20} color={nx.ink} />} />
        {ledger.length === 0 ? (
          <Text style={styles.note}>Earnings, cash collected and payouts recorded by NESAM appear here.</Text>
        ) : (
          ledger.slice(0, 50).map((e, i, list) => (
            <NxListItem
              key={e.id}
              icon={ENTRY_ICON[e.type] ?? 'wallet'}
              title={`${ENTRY_LABEL[e.type] ?? e.type}${e.bookingCode ? ` · ${e.bookingCode}` : ''}`}
              caption={[e.createdAt ? formatDateTime12(e.createdAt) : '', ENTRY_STATUS[e.status] ?? ''].filter(Boolean).join(' · ')}
              value={`${e.direction === 'debit' ? '−' : '+'}${formatINR(e.amount)}`}
              valueColor={e.direction === 'debit' ? nx.red : nx.green}
              strike={e.status === 'cancelled'}
              last={i === list.length - 1}
            />
          ))
        )}
        <Text style={[styles.note, { marginTop: 14 }]}>Driver ID {driver.id.slice(0, 8).toUpperCase()}</Text>
      </NxPanel>
    </>
  );

  return (
    <NxScreen>
      {walletError ? <NxInfo tone="red" style={{ marginTop: 0, marginBottom: 16 }}>{walletError}</NxInfo> : null}
      <NxTwoPane left={left} right={right} leftFlex={1} rightFlex={1} when={wide} />
      {open ? <PayoutDialog key="payout" withdrawable={withdrawable} onClose={() => setOpen(false)} /> : null}
    </NxScreen>
  );
}

function Small({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.small}>
      <Text style={styles.smallLabel} numberOfLines={2}>
        {label}
      </Text>
      <Text style={styles.smallValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function PayoutDialog({ withdrawable, onClose }: { withdrawable: number; onClose: () => void }) {
  const { account } = useDriverData();
  const { bank } = account;
  const [amount, setAmount] = useState(String(withdrawable));
  const [method, setMethod] = useState<'UPI' | 'Bank Transfer'>(bank.accountNumber || !bank.upiId ? 'Bank Transfer' : 'UPI');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    const value = Number(amount);
    const invalid = validatePayoutAmount(value, withdrawable);
    if (invalid) return setError(invalid);
    // The server pays only to the account saved in the profile.
    if (method === 'UPI' && !bank.upiId) return setError('No UPI ID in your profile. Add one from Profile first.');
    if (method === 'Bank Transfer' && !bank.accountNumber) return setError('No bank account in your profile. Add one from Profile first.');
    setSubmitting(true);
    setError('');
    try {
      await requestPayout(value, withdrawable, method);
      setDone(true);
    } catch (e) {
      setError(e instanceof DriverActionError ? e.message : describeError(e, 'Could not submit the payout request.'));
    } finally {
      setSubmitting(false);
    }
    return undefined;
  };

  return (
    <NxDialog
      visible
      onClose={onClose}
      eyebrow={`Available ${formatINR(withdrawable)} · minimum ${formatINR(MIN_PAYOUT)}`}
      title={done ? 'Payout requested' : 'Request payout'}
      locked={submitting}
      footer={
        done ? (
          <NxButton title="Done" trailingIcon="check" onPress={onClose} />
        ) : (
          <NxButton title={submitting ? 'Submitting…' : 'Confirm request'} trailingIcon="check" loading={submitting} onPress={() => void submit()} />
        )
      }
    >
      {done ? (
        <NxInfo tone="green" icon="check" style={{ marginTop: 0 }}>
          Payout request submitted. The amount is held from your balance until NESAM finance pays it.
        </NxInfo>
      ) : (
        <>
          <NxField label="Amount (₹)" value={amount} onChangeText={(t) => { setAmount(t.replace(/\D/g, '').slice(0, 7)); setError(''); }} keyboardType="number-pad" style={{ marginTop: 0 }} />
          <View style={{ marginTop: 16 }}>
            <NxPills<'UPI' | 'Bank Transfer'>
              label="Payout method"
              value={method}
              onChange={setMethod}
              style={{ marginBottom: 6 }}
              options={[
                { value: 'Bank Transfer', label: 'Bank (NEFT/IMPS)' },
                { value: 'UPI', label: 'UPI' },
              ]}
            />
          </View>
          <NxRow label="Paid to" value={method === 'UPI' ? bank.upiId || 'No UPI ID in your profile' : bank.accountNumber ? `${bank.accountHolder} · A/c ••••${bank.accountNumber.slice(-4)}` : bank.accountHolder || 'No account on file'} />
          {method === 'Bank Transfer' && bank.accountNumber ? <NxRow label="IFSC" value={bank.ifsc} last /> : null}
          <NxFormError message={error} />
        </>
      )}
    </NxDialog>
  );
}

const styles = StyleSheet.create({
  card: { padding: 23 },
  note: { fontSize: 11.5, lineHeight: 19, color: nx.muted, marginTop: 10 },
  hero: { backgroundColor: nx.wallet, borderRadius: 16, padding: 27, marginBottom: 18, overflow: 'hidden' },
  heroRing: { position: 'absolute', top: -45, right: -55, width: 180, height: 180, borderRadius: 90, borderWidth: 28, borderColor: 'rgba(255,255,255,0.03)' },
  heroEyebrow: { fontSize: 10, letterSpacing: 1.35, color: nx.walletMuted, fontWeight: '700' },
  heroValue: { fontSize: 39, fontWeight: '700', letterSpacing: -1.5, color: nx.white, marginTop: 10, marginBottom: 22 },
  heroButton: { alignSelf: 'flex-start', paddingHorizontal: 18 },
  heroFoot: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 17 },
  heroFootText: { fontSize: 11, color: nx.walletMuted },
  heroNote: { fontSize: 11, lineHeight: 17, color: nx.walletMuted, marginTop: 10 },
  small: { flex: 1, backgroundColor: nx.white, borderWidth: 1, borderColor: nx.line, borderRadius: 13, padding: 17 },
  smallLabel: { fontSize: 11, color: nx.muted, minHeight: 30 },
  smallValue: { fontSize: 21, fontWeight: '700', letterSpacing: -0.5, color: nx.ink, marginTop: 6 },
});
