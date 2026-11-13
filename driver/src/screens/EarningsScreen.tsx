// Earnings & Wallet: one page for the driver's money. The balance and the payout action sit on top, then what was credited
// (7-day chart and totals), what is still under settlement review, where payouts are sent, and one activity list for trip
// payouts, wallet ledger entries and payout requests. Every figure comes from the server's wallet ledger
// (wallets/driver_{uid}, wallet_ledger, payout_requests); the phone only sums what the server credited.
import React, { useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from '../components/nx/Text';
import { useDriverData } from '../context/DriverData';
import { NxScreen, useShell } from '../components/nx/Shell';
import { useLayout } from '../components/nx/layout';
import { NxDialog } from '../components/nx/Dialog';
import { NxIcon, type NxIconName } from '../components/nx/Icon';
import { NxBadge, NxButton, NxCardHeading, NxEmpty, NxField, NxFormError, NxInfo, NxListItem, NxPanel, NxPills, NxRow, NxTextButton, placeName } from '../components/nx/primitives';
import { payoutLabel } from '../components/nx/tripFormat';
import { goTab } from '../navigation/navItems';
import { DriverActionError, MIN_PAYOUT, requestPayout, validatePayoutAmount } from '../services/driverService';
import { last7Days, tripEarningStatus } from '../utils/ledger';
import { formatINR } from '../utils/format';
import { formatDate, formatDateTime12 } from '../utils/time';
import { describeError } from '../utils/retry';
import { nx } from '../theme/nx';

const TRIP_STATUS: Record<string, string> = { pending: 'Awaiting payment', available: 'In wallet', reserved: 'Held for payout', completed: 'Paid out', cancelled: 'Reversed' };
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

type Activity = 'trips' | 'ledger' | 'payouts';
/** Rows shown before "Show all"; the full list is capped at the server's latest entries. */
const PREVIEW = 6;
const MAX_ROWS = 50;

/** The width a block was laid out at (0 until the first layout pass). */
function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (e) => setWidth(Math.round(e.nativeEvent.layout.width))];
}

/** "₹850", "₹4.9k", "₹1.2L": short enough to sit above a chart bar on a phone. */
function compactINR(v: number): string {
  const trim = (n: number) => n.toFixed(1).replace(/\.0$/, '');
  if (v >= 100000) return `₹${trim(v / 100000)}L`;
  if (v >= 1000) return `₹${v >= 10000 ? Math.round(v / 1000) : trim(v / 1000)}k`;
  return `₹${Math.round(v)}`;
}

/** "8 Nov – 14 Nov": the seven days the chart covers, ending today. */
function weekRange(now = new Date()): string {
  const fmt = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6))} – ${fmt(now)}`;
}

export function EarningsScreen() {
  const { account, wallet, walletError } = useDriverData();
  const { dashboard } = useLayout();

  if (account.driver.vendorId) {
    return (
      <NxScreen>
        <NxEmpty icon="wallet" title="Paid by your fleet" message={`${account.driver.vendorName || 'Your fleet operator'} receives the settlement for your trips and pays you directly, so NESAM keeps no wallet balance for you.`} />
      </NxScreen>
    );
  }

  return (
    <NxScreen>
      {walletError ? (
        <NxInfo tone="red" style={styles.pageNote}>
          {walletError}
        </NxInfo>
      ) : null}
      <BalanceCard />
      {wallet.available < 0 ? (
        <NxInfo tone="amber" style={styles.pageNote}>
          Cash fares you collected exceed your earnings; upcoming earnings settle this first.
        </NxInfo>
      ) : null}
      {dashboard ? (
        <View style={styles.columns}>
          <View style={styles.mainCol}>
            <EarningsCard />
            <ActivityCard />
          </View>
          <View style={styles.sideCol}>
            <ReviewCard />
            <AccountCard />
          </View>
        </View>
      ) : (
        <>
          <EarningsCard />
          <ReviewCard />
          <ActivityCard />
          <AccountCard />
        </>
      )}
    </NxScreen>
  );
}

// ── Balance ─────────────────────────────────────────────────────────────────

function BalanceCard() {
  const { wallet } = useDriverData();
  const { wide } = useLayout();
  const [open, setOpen] = useState(false);
  const withdrawable = Math.max(0, Math.floor(wallet.available));
  const canWithdraw = withdrawable >= MIN_PAYOUT;
  const negative = wallet.available < 0;
  return (
    <>
      <View style={[styles.hero, wide && styles.heroWide]}>
        <View style={styles.heroRing} pointerEvents="none" />
        <View style={wide ? styles.heroMainWide : undefined}>
          <Text style={styles.heroEyebrow}>AVAILABLE BALANCE</Text>
          <Text style={[styles.heroValue, negative && { color: '#FF8A97' }]} numberOfLines={1} adjustsFontSizeToFit>
            {formatINR(wallet.available)}
          </Text>
          <NxButton title="Request payout" trailingIcon="arrow" disabled={!canWithdraw} onPress={() => setOpen(true)} style={styles.heroButton} />
          <View style={styles.heroFoot}>
            <NxIcon name="shield" size={13} color={nx.walletMuted} />
            <Text style={styles.heroFootText}>{canWithdraw ? 'Approved settlements, ready to withdraw' : `Payouts open once ${formatINR(MIN_PAYOUT)} is available`}</Text>
          </View>
        </View>
        <View style={[styles.heroFigures, wide ? styles.heroFiguresWide : styles.heroFiguresPhone]}>
          <Figure label="Awaiting payment" value={wallet.pending} />
          <Figure label="Held for payout" value={wallet.reserved} />
          <Figure label="Paid out" value={wallet.paidOut} />
          <Figure label="Cash collected" value={wallet.cashCollected} />
        </View>
      </View>
      {open ? <PayoutDialog key="payout" withdrawable={withdrawable} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.figureValue} numberOfLines={1} adjustsFontSizeToFit>
        {formatINR(value)}
      </Text>
    </View>
  );
}

// ── Credited earnings ───────────────────────────────────────────────────────

function EarningsCard() {
  const { earnings, ledger } = useDriverData();
  const { phone } = useLayout();
  const [width, onLayout] = useWidth();
  const days = useMemo(() => last7Days(ledger), [ledger]);
  const max = Math.max(0, ...days.map((d) => d.amount));
  const four = width >= 520;
  const stats: [string, number][] = [
    ['Today', earnings.todayEarnings],
    ['This month', earnings.thisMonthEarnings],
    ['Lifetime', earnings.lifetimeEarnings],
    ['Toll refunds', earnings.tollReimbursements],
  ];
  return (
    <NxPanel style={styles.card}>
      <NxCardHeading title="Credited earnings" caption={`Last 7 days · ${weekRange()}`} right={<NxBadge label="Credited" tone="green" icon="check" />} />
      <Text style={styles.total}>{formatINR(earnings.thisWeekEarnings)}</Text>
      <View
        style={[styles.chart, phone ? { height: 136, gap: 4 } : { height: 168, gap: 10 }]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Credited daily earnings: ${days.map((d) => `${d.label} ${formatINR(d.amount)}`).join(', ')}`}
      >
        {days.map((d, i) => {
          const today = i === days.length - 1;
          return (
            <View key={d.key} style={styles.col}>
              <Text style={[styles.barValue, today && { color: nx.red }]} numberOfLines={1}>
                {d.amount > 0 ? compactINR(d.amount) : ' '}
              </Text>
              <View style={styles.track}>
                <View style={[styles.bar, today && styles.barNow, { height: `${max > 0 ? Math.max(3, (d.amount / max) * 100) : 3}%` }]} />
              </View>
              <Text style={[styles.day, today && styles.dayNow]} numberOfLines={1}>
                {today ? 'Today' : d.label}
              </Text>
            </View>
          );
        })}
        {max === 0 ? (
          <View style={styles.chartEmpty} pointerEvents="none">
            <Text style={styles.chartEmptyText}>No credited earnings in the last 7 days</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.stats} onLayout={onLayout}>
        {stats.map(([label, value], i) => (
          <View key={label} style={[styles.stat, { width: four ? '25%' : '50%' }, (four ? i > 0 : i % 2 === 1) && styles.statDivider]}>
            <Text style={styles.statLabel} numberOfLines={1}>
              {label}
            </Text>
            <Text style={[styles.statValue, i === 0 && { color: nx.red }]} numberOfLines={1} adjustsFontSizeToFit>
              {formatINR(value)}
            </Text>
          </View>
        ))}
      </View>
      <Text style={styles.note}>Earnings are credited once NESAM verifies the trip fare. Approved toll receipts on non-cash trips are reimbursed.</Text>
    </NxPanel>
  );
}

// ── Under settlement review ─────────────────────────────────────────────────

function ReviewCard() {
  const { completedTrips, ledger } = useDriverData();
  const { openSupport } = useShell();
  // Completed trips whose earning is not credited yet, or is credited but waiting for the customer's payment.
  const waiting = completedTrips.filter((t) => {
    if (t.fleetTrip) return false;
    const status = tripEarningStatus(ledger, t.id);
    return status === '' || status === 'pending';
  });
  const total = waiting.reduce((s, t) => s + (t.payoutRecorded ? t.driverEarnings : 0), 0);
  return (
    <NxPanel style={styles.card}>
      <NxCardHeading
        title="Under settlement review"
        caption={waiting.length ? `${waiting.length} completed trip${waiting.length === 1 ? '' : 's'} awaiting approval` : 'No trips waiting for approval'}
        right={<NxIcon name="clock" size={20} color={nx.ink} />}
      />
      <Text style={styles.total}>{formatINR(total)}</Text>
      <Text style={styles.note}>Quoted driver payouts. Closing a trip does not mark its payment as received; earnings move to your balance once NESAM verifies the customer’s payment.</Text>
      <NxButton title="Get settlement help" icon="help" variant="secondary" onPress={() => openSupport()} style={{ marginTop: 18 }} />
    </NxPanel>
  );
}

// ── Payout account ──────────────────────────────────────────────────────────

function AccountCard() {
  const { account } = useDriverData();
  const { bank } = account;
  return (
    <NxPanel style={styles.card}>
      <NxCardHeading title="Payout account" caption="NESAM pays only to this saved account" right={<NxTextButton title="Manage" trailingIcon="chevron" onPress={() => goTab('Profile')} />} />
      <NxRow label="Account holder" value={bank.accountHolder || 'No account on file'} />
      {bank.accountNumber ? <NxRow label="Account no." value={`••••${bank.accountNumber.slice(-4)}`} /> : null}
      {bank.ifsc ? <NxRow label="IFSC" value={`${bank.ifsc}${bank.bankName ? ` · ${bank.bankName}` : ''}`} /> : null}
      <NxRow label="UPI" value={bank.upiId || '—'} last />
    </NxPanel>
  );
}

// ── Activity: trip payouts, ledger, payout requests ─────────────────────────

function ActivityCard() {
  const { account, completedTrips, ledger, payouts, earnings } = useDriverData();
  const [tab, setTab] = useState<Activity>('trips');
  const [all, setAll] = useState(false);
  const choose = (t: Activity) => {
    setTab(t);
    setAll(false);
  };

  const trips = completedTrips.slice(0, MAX_ROWS);
  const entries = ledger.slice(0, MAX_ROWS);
  const count = tab === 'trips' ? trips.length : tab === 'ledger' ? entries.length : payouts.length;
  const limit = all ? count : PREVIEW;

  let body: React.ReactNode;
  if (count === 0) {
    body = (
      <Text style={styles.empty}>
        {tab === 'trips' ? 'Finished trips and their payouts appear here.' : tab === 'ledger' ? 'Earnings, cash collected and payouts recorded by NESAM appear here.' : 'No payout requests yet.'}
      </Text>
    );
  } else if (tab === 'trips') {
    const shown = trips.slice(0, limit);
    body = shown.map((t, i) => {
      const status = tripEarningStatus(ledger, t.id);
      return (
        <NxListItem
          key={t.id}
          icon="car"
          title={`${placeName(t.pickup.address)} → ${placeName(t.drop.address)}`}
          caption={`${t.bookingId} · ${t.completedAt ? formatDate(t.completedAt) : t.scheduledDate}`}
          value={t.payoutRecorded && !t.fleetTrip ? `+${payoutLabel(t)}` : payoutLabel(t)}
          valueColor={t.payoutRecorded ? nx.green : nx.muted}
          valueCaption={t.fleetTrip ? 'Settled by fleet' : status ? TRIP_STATUS[status] || status : 'Not credited yet'}
          last={i === shown.length - 1}
        />
      );
    });
  } else if (tab === 'ledger') {
    const shown = entries.slice(0, limit);
    body = shown.map((e, i) => (
      <NxListItem
        key={e.id}
        icon={ENTRY_ICON[e.type] ?? 'wallet'}
        title={`${ENTRY_LABEL[e.type] ?? e.type}${e.bookingCode ? ` · ${e.bookingCode}` : ''}`}
        caption={[e.createdAt ? formatDateTime12(e.createdAt) : '', ENTRY_STATUS[e.status] ?? ''].filter(Boolean).join(' · ')}
        value={`${e.direction === 'debit' ? '−' : '+'}${formatINR(e.amount)}`}
        valueColor={e.direction === 'debit' ? nx.red : nx.green}
        strike={e.status === 'cancelled'}
        last={i === shown.length - 1}
      />
    ));
  } else {
    const shown = payouts.slice(0, limit);
    body = shown.map((po, i) => (
      <NxListItem
        key={po.id}
        icon="bank"
        title={`${po.method} · ${formatINR(po.amount)}`}
        caption={[po.details, `Requested ${po.requestedAt}`, po.utr ? `UTR ${po.utr}` : '', po.processedAt ? `Processed ${formatDateTime12(po.processedAt)}` : ''].filter(Boolean).join(' · ')}
        right={<NxBadge label={po.status} tone={po.status === 'Paid' ? 'green' : po.status === 'Pending' || po.status === 'Deferred' ? 'amber' : 'neutral'} />}
        last={i === shown.length - 1}
      />
    ));
  }

  const caption =
    tab === 'trips'
      ? `${earnings.totalTripsCompleted} credited · tolls ${formatINR(earnings.tollReimbursements)}`
      : tab === 'ledger'
        ? 'Credits and debits recorded by NESAM'
        : 'Reviewed by NESAM finance';

  return (
    <NxPanel style={styles.card}>
      <NxCardHeading title="Activity" caption={caption} right={<NxIcon name="wallet" size={20} color={nx.ink} />} />
      <NxPills<Activity>
        label="Activity type"
        value={tab}
        onChange={choose}
        fill
        style={styles.tabs}
        options={[
          { value: 'trips', label: `Trips (${trips.length})` },
          { value: 'ledger', label: `Ledger (${entries.length})` },
          { value: 'payouts', label: `Payouts (${payouts.length})` },
        ]}
      />
      {body}
      {count > PREVIEW ? <NxButton title={all ? 'Show less' : `Show all ${count}`} variant="secondary" compact onPress={() => setAll((v) => !v)} style={{ marginTop: 14 }} /> : null}
      {tab === 'ledger' ? <Text style={[styles.note, { marginTop: 14 }]}>Driver ID {account.driver.id.slice(0, 8).toUpperCase()}</Text> : null}
    </NxPanel>
  );
}

// ── Payout request dialog ───────────────────────────────────────────────────

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
          <NxField
            label="Amount (₹)"
            value={amount}
            onChangeText={(t) => {
              setAmount(t.replace(/\D/g, '').slice(0, 7));
              setError('');
            }}
            keyboardType="number-pad"
            style={{ marginTop: 0 }}
          />
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
          <NxRow
            label="Paid to"
            value={method === 'UPI' ? bank.upiId || 'No UPI ID in your profile' : bank.accountNumber ? `${bank.accountHolder} · A/c ••••${bank.accountNumber.slice(-4)}` : bank.accountHolder || 'No account on file'}
          />
          {method === 'Bank Transfer' && bank.accountNumber ? <NxRow label="IFSC" value={bank.ifsc} last /> : null}
          <NxFormError message={error} />
        </>
      )}
    </NxDialog>
  );
}

const styles = StyleSheet.create({
  pageNote: { marginTop: 0, marginBottom: 16 },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },
  mainCol: { flex: 1.5, minWidth: 0 },
  sideCol: { flex: 1, minWidth: 0 },
  card: { padding: 22 },
  total: { fontSize: 32, fontWeight: '700', letterSpacing: -1, color: nx.ink, marginTop: -6 },
  note: { fontSize: 11.5, lineHeight: 19, color: nx.muted, marginTop: 12 },
  empty: { fontSize: 12, lineHeight: 19, color: nx.muted, paddingVertical: 18, textAlign: 'center' },
  tabs: { marginBottom: 6, maxWidth: '100%' },

  // Balance
  hero: { backgroundColor: nx.wallet, borderRadius: 16, padding: 22, marginBottom: 16, overflow: 'hidden' },
  heroWide: { flexDirection: 'row', alignItems: 'center', gap: 28, padding: 28 },
  heroMainWide: { flex: 1, minWidth: 0 },
  heroRing: { position: 'absolute', top: -45, right: -55, width: 180, height: 180, borderRadius: 90, borderWidth: 28, borderColor: 'rgba(255,255,255,0.03)' },
  heroEyebrow: { fontSize: 10, letterSpacing: 1.35, color: nx.walletMuted, fontWeight: '700' },
  heroValue: { fontSize: 38, fontWeight: '700', letterSpacing: -1.5, color: nx.white, marginTop: 8, marginBottom: 18 },
  heroButton: { alignSelf: 'flex-start', paddingHorizontal: 18 },
  heroFoot: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  heroFootText: { flex: 1, fontSize: 11, lineHeight: 16, color: nx.walletMuted },
  heroFigures: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  heroFiguresPhone: { marginTop: 20, paddingTop: 18, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.09)' },
  heroFiguresWide: { flex: 1, minWidth: 0, alignSelf: 'stretch', alignContent: 'center', paddingLeft: 28, borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.09)' },
  figure: { width: '50%', paddingRight: 10 },
  figureLabel: { fontSize: 11, color: nx.walletMuted },
  figureValue: { fontSize: 17, fontWeight: '700', letterSpacing: -0.4, color: nx.white, marginTop: 4 },

  // Chart
  chart: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 18 },
  col: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end', gap: 6, minWidth: 0 },
  barValue: { fontSize: 9.5, fontWeight: '600', color: nx.muted, height: 14 },
  track: { flex: 1, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '100%', maxWidth: 38, minHeight: 3, backgroundColor: nx.redBar, borderTopLeftRadius: 6, borderTopRightRadius: 6, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  barNow: { backgroundColor: nx.red },
  day: { fontSize: 10, color: nx.muted },
  dayNow: { color: nx.red, fontWeight: '700' },
  chartEmpty: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 24, alignItems: 'center', justifyContent: 'center' },
  chartEmptyText: { fontSize: 11.5, color: nx.muted, backgroundColor: nx.white, paddingHorizontal: 10, paddingVertical: 4, textAlign: 'center' },

  // Totals strip
  stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 4, marginTop: 18, borderRadius: 12, backgroundColor: nx.page, paddingVertical: 6 },
  stat: { paddingVertical: 8, paddingHorizontal: 14 },
  statDivider: { borderLeftWidth: 1, borderLeftColor: nx.line },
  statLabel: { fontSize: 11, color: nx.muted },
  statValue: { fontSize: 15, fontWeight: '700', letterSpacing: -0.3, color: nx.ink, marginTop: 3 },
});
