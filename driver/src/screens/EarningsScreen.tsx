// Earnings (reference "Earnings"): credited earnings today / last 7 days with a bar chart, what still awaits settlement and
// the completed trips. Every figure comes from the server's wallet ledger; the phone only sums what the server credited.
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../components/nx/Text';
import { useDriverData } from '../context/DriverData';
import { NxScreen } from '../components/nx/Shell';
import { NxColumns } from '../components/nx/layout';
import { NxIcon } from '../components/nx/Icon';
import { NxBadge, NxButton, NxCardHeading, NxEmpty, NxInfo, NxListItem, NxPanel, NxPills, NxRow, placeName } from '../components/nx/primitives';
import { payoutLabel } from '../components/nx/tripFormat';
import { goTab } from '../navigation/navItems';
import { last7Days, tripEarningStatus } from '../utils/ledger';
import { formatINR } from '../utils/format';
import { formatDate } from '../utils/time';
import { nx } from '../theme/nx';

type Period = 'today' | 'week';
const STATUS: Record<string, string> = { pending: 'Awaiting payment', available: 'In wallet', cancelled: 'Reversed' };

export function EarningsScreen() {
  const { account, earnings, completedTrips, ledger } = useDriverData();
  const [period, setPeriod] = useState<Period>('week');
  const days = useMemo(() => last7Days(ledger), [ledger]);
  const max = Math.max(1, ...days.map((d) => d.amount));
  const week = period === 'week';
  const range = `${days[0]?.label ?? ''} – ${days[6]?.label ?? ''}`;
  const waiting = completedTrips.filter((t) => tripEarningStatus(ledger, t.id) !== 'available' && !t.fleetTrip);
  const waitingTotal = waiting.reduce((s, t) => s + (t.payoutRecorded ? t.driverEarnings : 0), 0);
  const recent = completedTrips.slice(0, 8);

  if (account.driver.vendorId) {
    return (
      <NxScreen>
        <NxEmpty icon="chart" title="Paid by your fleet" message={`${account.driver.vendorName || 'Your fleet operator'} receives the settlement for your trips and pays you directly.`} />
      </NxScreen>
    );
  }

  return (
    <NxScreen>
      <NxPills<Period>
        label="Earnings period"
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'today', label: 'Today' },
          { value: 'week', label: 'Last 7 days' },
        ]}
      />
      <NxColumns>
        <NxPanel style={styles.card}>
          <NxCardHeading
            title={week ? 'Credited weekly earnings' : 'Today’s credited earnings'}
            caption={week ? range : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            right={<NxBadge label="Credited" tone="green" />}
          />
          <Text style={styles.total}>{formatINR(week ? earnings.thisWeekEarnings : earnings.todayEarnings)}</Text>
          {week ? (
            <>
              <View style={styles.chart} accessible accessibilityRole="image" accessibilityLabel={`Credited daily earnings: ${days.map((d) => `${d.label} ${formatINR(d.amount)}`).join(', ')}`}>
                {days.map((d, i) => (
                  <View key={d.key} style={styles.col}>
                    <View style={styles.track}>
                      <View style={[styles.bar, i === 6 && styles.barNow, { height: `${Math.max(2, (d.amount / max) * 100)}%` }]} />
                    </View>
                    <Text style={[styles.day, i === 6 && { color: nx.red, fontWeight: '700' }]} numberOfLines={1}>
                      {d.label}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={styles.legend}>
                <View style={styles.legendDot} />
                <Text style={styles.legendText}>Today · earnings are credited once NESAM verifies the trip fare</Text>
              </View>
            </>
          ) : (
            <NxInfo>The payout for a trip is credited once NESAM verifies the trip fare. Approved toll receipts on non-cash trips are reimbursed.</NxInfo>
          )}
          <View style={{ marginTop: 14 }}>
            <NxRow label="This month" value={formatINR(earnings.thisMonthEarnings)} />
            <NxRow label="Lifetime" value={formatINR(earnings.lifetimeEarnings)} />
            <NxRow label="Toll reimbursements" value={formatINR(earnings.tollReimbursements)} last />
          </View>
        </NxPanel>

        <NxPanel style={styles.card}>
          <NxCardHeading
            title="Pending settlement review"
            caption={`${waiting.length} completed trip${waiting.length === 1 ? '' : 's'} awaiting approval`}
            right={<NxIcon name="clock" size={20} color={nx.ink} />}
          />
          <Text style={styles.total}>{formatINR(waitingTotal)}</Text>
          <Text style={styles.note}>Quoted driver payouts only. NESAM verifies customer collections before settlement.</Text>
          <NxButton title="View wallet status" trailingIcon="arrow" variant="secondary" onPress={() => goTab('Wallet')} style={{ marginTop: 17 }} />
        </NxPanel>

        <NxPanel style={styles.card}>
          <NxCardHeading
            title="Completed trips"
            caption={`${earnings.totalTripsCompleted} credited · tolls ${formatINR(earnings.tollReimbursements)}`}
            right={<NxIcon name="chart" size={20} color={nx.ink} />}
          />
          {recent.length === 0 ? (
            <Text style={styles.note}>Finished trips and their payouts will appear here.</Text>
          ) : (
            recent.map((t, i) => {
              const status = tripEarningStatus(ledger, t.id);
              return (
                <NxListItem
                  key={t.id}
                  icon="car"
                  title={`${placeName(t.pickup.address)} → ${placeName(t.drop.address)}`}
                  caption={`${t.bookingId} · ${t.completedAt ? formatDate(t.completedAt) : t.scheduledDate}`}
                  value={t.payoutRecorded && !t.fleetTrip ? `+${payoutLabel(t)}` : payoutLabel(t)}
                  valueColor={t.payoutRecorded ? nx.green : nx.muted}
                  valueCaption={t.fleetTrip ? 'Settled by fleet' : status ? STATUS[status] || status : 'Not credited yet'}
                  last={i === recent.length - 1}
                />
              );
            })
          )}
        </NxPanel>
      </NxColumns>
    </NxScreen>
  );
}

const styles = StyleSheet.create({
  card: { padding: 23 },
  total: { fontSize: 34, fontWeight: '700', letterSpacing: -1, color: nx.ink, marginTop: -4 },
  note: { fontSize: 11.5, lineHeight: 19, color: nx.muted, marginTop: 10 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 174, gap: 12, marginTop: 22, paddingTop: 8 },
  col: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end', gap: 10, minWidth: 0 },
  track: { flex: 1, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '100%', maxWidth: 38, minHeight: 3, backgroundColor: nx.redBar, borderTopLeftRadius: 6, borderTopRightRadius: 6, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  barNow: { backgroundColor: nx.red },
  day: { fontSize: 10.5, color: nx.muted },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 18 },
  legendDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: nx.red },
  legendText: { flex: 1, fontSize: 11, color: nx.muted },
});
