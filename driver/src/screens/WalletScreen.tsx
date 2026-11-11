// Wallet, payout requests and ledger (reference "Wallet"). Every number is the server's (wallets/driver_{uid},
// wallet_ledger); the app never computes a balance.
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../components/nx/Text';
import { useDriverData } from '../context/DriverData';
import { NxScreen, useShell } from '../components/nx/Shell';
import { NxColumns } from '../components/nx/layout';
import { NxDialog } from '../components/nx/Dialog';
import { NxIcon, NxIconName } from '../components/nx/Icon';
import { NxBadge, NxButton, NxEmpty, NxField, NxFormError, NxInfo, NxPanel, NxPills, NxRow, NxSectionHeading, nxText } from '../components/nx/primitives';
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
};
const ENTRY_STATUS: Record<string, string> = {
  pending: 'Awaiting customer payment',
  available: 'Available',
  reserved: 'Held for payout',
  completed: 'Completed',
  cancelled: 'Released',
};
const ENTRY_ICON: Record<string, NxIconName> = { trip_earning: 'car', toll_reimbursement: 'trip', cash_collected: 'wallet', payout: 'bank' };

export function WalletScreen() {
  const { account, wallet, walletError, payouts, ledger } = useDriverData();
  const { openSupport } = useShell();
  const { driver, bank } = account;
  const [open, setOpen] = useState(false);
  const withdrawable = Math.max(0, Math.floor(wallet.available));
  const fleet = !!driver.vendorId;

  if (fleet && ledger.length === 0 && payouts.length === 0) {
    return (
      <NxScreen title="Wallet" subtitle="Fleet Driver Payouts">
        <NxPanel>
          <NxSectionHeading title="Settled by your fleet" caption="Driver wallet" right={<NxBadge label="Fleet driver" />} />
          <NxInfo>
            You drive for {driver.vendorName || 'a fleet operator'}. They receive the payout for your trips and pay you directly, so NESAM does not keep a wallet balance for you.
          </NxInfo>
        </NxPanel>
      </NxScreen>
    );
  }

  const negative = wallet.available < 0;
  return (
    <NxScreen title="Wallet" subtitle="Balance & Settlements">
      {walletError ? <NxInfo tone="red" style={{ marginTop: 0, marginBottom: 16 }}>{walletError}</NxInfo> : null}
      <NxColumns>
      <View>
      <View style={styles.hero}>
        <Text style={styles.heroEyebrow}>AVAILABLE TO WITHDRAW</Text>
        <Text style={[styles.heroValue, negative && { color: '#FF8A97' }]}>{formatINR(wallet.available)}</Text>
        <NxButton title="Request payout" trailingIcon="arrow" disabled={withdrawable < MIN_PAYOUT} onPress={() => setOpen(true)} style={styles.heroButton} />
        <View style={styles.heroFoot}>
          <NxIcon name="shield" size={13} color="#AEB4C0" />
          <Text style={styles.heroFootText}>Kept by NESAM from your trip ledger</Text>
        </View>
        {withdrawable < MIN_PAYOUT ? <Text style={styles.heroNote}>You can request a payout once your available balance reaches {formatINR(MIN_PAYOUT)}.</Text> : null}
      </View>

      <View style={styles.grid}>
        <Small label="Awaiting customer payment" value={formatINR(wallet.pending)} />
        <Small label="Held for requests" value={formatINR(wallet.reserved)} />
        <Small label="Paid out" value={formatINR(wallet.paidOut)} />
        <Small label="Cash fares collected" value={formatINR(wallet.cashCollected)} />
      </View>
      {negative ? (
        <NxInfo tone="amber" style={{ marginTop: 0, marginBottom: 16 }}>Cash fares you collected exceed your earnings; upcoming earnings settle this first.</NxInfo>
      ) : (
        <NxInfo style={{ marginTop: 0, marginBottom: 16 }}>Closing a trip does not mark its payment as received. Earnings move to your balance once NESAM verifies the customer’s payment.</NxInfo>
      )}
      </View>

      <NxPanel>
        <NxSectionHeading title="Payout account" caption="NESAM pays only to this saved account" right={<NxIcon name="bank" size={20} color={nx.ink} />} />
        <NxRow label="Account holder" value={bank.accountHolder || 'No account on file'} />
        {bank.accountNumber ? <NxRow label="Account no." value={`••••${bank.accountNumber.slice(-4)}`} /> : null}
        {bank.ifsc ? <NxRow label="IFSC" value={`${bank.ifsc}${bank.bankName ? ` · ${bank.bankName}` : ''}`} /> : null}
        {bank.upiId ? <NxRow label="UPI" value={bank.upiId} /> : null}
        <Text style={nxText.note}>Change it from Profile › Contact & payout account.</Text>
      </NxPanel>

      <NxPanel>
        <NxSectionHeading title="Payout requests" caption="Reviewed by NESAM finance" right={<NxIcon name="clock" size={20} color={nx.ink} />} />
        {payouts.length === 0 ? (
          <Text style={nxText.copy}>No payout requests yet.</Text>
        ) : (
          payouts.map((po) => (
            <View style={styles.item} key={po.id}>
              <View style={styles.itemIcon}>
                <NxIcon name="bank" size={18} color={nx.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>{po.method}</Text>
                <Text style={nxText.small} numberOfLines={2}>
                  {po.details ? `${po.details} · ` : ''}Requested {po.requestedAt}
                  {po.utr ? ` · UTR ${po.utr}` : ''}
                  {po.processedAt ? ` · Processed ${formatDateTime12(po.processedAt)}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={styles.itemAmount}>{formatINR(po.amount)}</Text>
                <NxBadge label={po.status} tone={po.status === 'Paid' ? 'green' : po.status === 'Pending' || po.status === 'Deferred' ? 'amber' : 'neutral'} />
              </View>
            </View>
          ))
        )}
        <NxButton title="Get settlement help" icon="help" variant="secondary" onPress={() => openSupport()} style={{ marginTop: 18 }} />
      </NxPanel>

      <NxPanel>
        <NxSectionHeading title="Wallet ledger" caption={`Latest ${Math.min(ledger.length, 50)} entries`} right={<NxIcon name="wallet" size={20} color={nx.ink} />} />
        {ledger.length === 0 ? (
          <NxEmpty icon="wallet" title="No entries yet" message="Earnings, cash collected and payouts recorded by NESAM appear here." />
        ) : (
          ledger.slice(0, 50).map((e) => (
            <View style={styles.item} key={e.id}>
              <View style={styles.itemIcon}>
                <NxIcon name={ENTRY_ICON[e.type] ?? 'wallet'} size={18} color={nx.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle}>
                  {ENTRY_LABEL[e.type] ?? e.type}
                  {e.bookingCode ? ` · ${e.bookingCode}` : ''}
                </Text>
                <Text style={nxText.small}>
                  {e.createdAt ? formatDateTime12(e.createdAt) : ''}
                  {ENTRY_STATUS[e.status] ? ` · ${ENTRY_STATUS[e.status]}` : ''}
                </Text>
              </View>
              <Text style={[styles.itemAmount, e.direction === 'debit' && { color: nx.red }, e.status === 'cancelled' && { textDecorationLine: 'line-through', opacity: 0.6 }]}>
                {e.direction === 'debit' ? '−' : '+'}
                {formatINR(e.amount)}
              </Text>
            </View>
          ))
        )}
        <Text style={[nxText.small, { marginTop: 14 }]}>Driver ID {driver.id.slice(0, 8).toUpperCase()}</Text>
      </NxPanel>

      </NxColumns>

      {open ? <PayoutDialog key="payout" withdrawable={withdrawable} onClose={() => setOpen(false)} /> : null}
    </NxScreen>
  );
}

function Small({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.small}>
      <Text style={nxText.small}>{label}</Text>
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
    <NxDialog visible onClose={onClose} eyebrow={`AVAILABLE ${formatINR(withdrawable)} · MINIMUM ${formatINR(MIN_PAYOUT)}`} title="Request payout" locked={submitting}>
      {done ? (
        <>
          <NxInfo style={{ marginTop: 0 }}>Payout request submitted. The amount is held from your balance until NESAM finance pays it.</NxInfo>
          <NxButton title="Done" trailingIcon="check" onPress={onClose} style={{ marginTop: 16 }} />
        </>
      ) : (
        <>
          <NxField label="Amount (₹)" value={amount} onChangeText={(t) => { setAmount(t.replace(/\D/g, '').slice(0, 7)); setError(''); }} keyboardType="number-pad" />
          <View style={{ marginTop: 16 }}>
            <NxPills<'UPI' | 'Bank Transfer'>
              label="Payout method"
              value={method}
              onChange={setMethod}
              options={[
                { value: 'Bank Transfer', label: 'Bank (NEFT/IMPS)' },
                { value: 'UPI', label: 'UPI' },
              ]}
            />
          </View>
          <NxRow label="Paid to" value={method === 'UPI' ? bank.upiId || 'No UPI ID in your profile' : bank.accountNumber ? `${bank.accountHolder} · A/c ••••${bank.accountNumber.slice(-4)}` : bank.accountHolder || 'No account on file'} />
          {method === 'Bank Transfer' && bank.accountNumber ? <NxRow label="IFSC" value={bank.ifsc} /> : null}
          <NxFormError message={error} />
          <NxButton title={submitting ? 'Submitting…' : 'Confirm request'} trailingIcon="check" loading={submitting} onPress={() => void submit()} style={{ marginTop: 14 }} />
        </>
      )}
    </NxDialog>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: '#1D1F27', borderRadius: 18, padding: 22, marginBottom: 14 },
  heroEyebrow: { fontSize: 10, letterSpacing: 1.8, color: '#AEB4C0', fontWeight: '700' },
  heroValue: { fontSize: 38, fontWeight: '800', letterSpacing: -1.2, color: nx.white, marginVertical: 12 },
  heroButton: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 16 },
  heroFoot: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  heroFootText: { fontSize: 11, color: '#AEB4C0' },
  heroNote: { fontSize: 11, lineHeight: 17, color: '#AEB4C0', marginTop: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 14 },
  small: { flexGrow: 1, flexBasis: '45%', backgroundColor: nx.white, borderWidth: 1, borderColor: nx.line, borderRadius: 14, padding: 16, gap: 8 },
  smallValue: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5, color: nx.ink },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  itemIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: nx.page, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: 12.5, fontWeight: '700', color: nx.ink, marginBottom: 3 },
  itemAmount: { fontSize: 13.5, fontWeight: '800', color: nx.green },
});
