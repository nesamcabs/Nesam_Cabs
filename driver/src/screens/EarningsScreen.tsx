// Earnings (reference "Earnings"): credited earnings today / last 7 days with a bar chart, what is still awaiting
// settlement and the completed trips. Every figure is the server's wallet ledger; nothing is computed on the phone
// beyond summing the entries the server already credited.
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../components/nx/Text';
import { useDriverData } from '../context/DriverData';
import { NxScreen } from '../components/nx/Shell';
import { NxColumns } from '../components/nx/layout';
import { NxIcon } from '../components/nx/Icon';
import { NxBadge, NxEmpty, NxInfo, NxPanel, NxPills, NxRow, NxSectionHeading, nxText, placeName } from '../components/nx/primitives';
import { payoutLabel } from '../components/nx/tripFormat';
import { last7Days, tripEarningStatus } from '../utils/ledger';
import { formatINR } from '../utils/format';
import { formatDate } from '../utils/time';
import { nx } from '../theme/nx';

type Period = 'today' | 'week';
const STATUS: Record<string, string> = { pending: 'Awaiting payment', available: 'In wallet', cancelled: 'Reversed' };

export function EarningsScreen() {
  const { earnings, completedTrips, ledger } = useDriverData();
  const [period, setPeriod] = useState<Period>('today');
  const days = useMemo(() => last7Days(ledger), [ledger]);
  const max = Math.max(1, ...days.map((d) => d.amount));
  const week = period === 'week';
  const range = `${days[0]?.label ?? ''} – ${days[6]?.label ?? ''}`;
  const waiting = completedTrips.filter((t) => tripEarningStatus(ledger, t.id) !== 'available' && !t.fleetTrip);
  const waitingTotal = waiting.reduce((s, t) => s + (t.payoutRecorded ? t.driverEarnings : 0), 0);
  const recent = completedTrips.slice(0, 8);

  return (
    <NxScreen title="Earnings" subtitle="Credited Payouts">
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
      <NxPanel>
        <NxSectionHeading
          title={week ? 'Credited weekly earnings' : 'Today’s credited earnings'}
          caption={week ? range : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
          right={<NxBadge label="Credited" tone="green" />}
        />
        <Text style={styles.total}>{formatINR(week ? earnings.thisWeekEarnings : earnings.todayEarnings)}</Text>
        {week ? (
          <View style={styles.chart} accessible accessibilityRole="image" accessibilityLabel={`Credited daily earnings: ${days.map((d) => `${d.label} ${formatINR(d.amount)}`).join(', ')}`}>
            {days.map((d, i) => (
              <View key={d.key} style={styles.col}>
                <View style={styles.track}>
                  <View style={[styles.bar, i === 6 && styles.barNow, { height: `${Math.max(2, (d.amount / max) * 100)}%` }]} />
                </View>
                <Text style={styles.day} numberOfLines={1}>
                  {d.label}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <NxInfo>The payout for a trip is credited once NESAM verifies the trip fare. Approved toll receipts on non-cash trips are reimbursed.</NxInfo>
        )}
        <View style={{ marginTop: 10 }}>
          <NxRow label="This month" value={formatINR(earnings.thisMonthEarnings)} />
          <NxRow label="Lifetime" value={formatINR(earnings.lifetimeEarnings)} />
          {earnings.tollReimbursements > 0 ? <NxRow label="Toll reimbursements" value={formatINR(earnings.tollReimbursements)} /> : null}
        </View>
      </NxPanel>

      <NxPanel>
        <NxSectionHeading
          title="Pending settlement review"
          caption={`${waiting.length} completed trip${waiting.length === 1 ? '' : 's'} not credited yet`}
          right={<NxIcon name="clock" size={20} color={nx.ink} />}
        />
        <Text style={styles.total}>{formatINR(waitingTotal)}</Text>
        <Text style={nxText.note}>Agreed driver payouts only. NESAM verifies customer collections before settlement.</Text>
      </NxPanel>

      <NxPanel>
        <NxSectionHeading title="Completed trips" caption={`${earnings.totalTripsCompleted} credited · tolls ${formatINR(earnings.tollReimbursements)}`} right={<NxIcon name="chart" size={20} color={nx.ink} />} />
        {recent.length === 0 ? (
          <NxEmpty icon="check" title="No completed trips yet" message="Finished trips and their payouts will appear here." />
        ) : (
          recent.map((t) => {
            const status = tripEarningStatus(ledger, t.id);
            return (
              <View style={styles.item} key={t.id}>
                <View style={styles.itemIcon}>
                  <NxIcon name="car" size={18} color={nx.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle} numberOfLines={2}>
                    {placeName(t.pickup.address)} → {placeName(t.drop.address)}
                  </Text>
                  <Text style={nxText.small}>
                    {t.bookingId} · {t.completedAt ? formatDate(t.completedAt) : t.scheduledDate}
                    {t.payoutRecorded && t.tollCharges ? ` · tolls ${formatINR(t.tollCharges)}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.itemAmount, !t.payoutRecorded && { fontSize: 12, color: nx.muted }]}>{t.payoutRecorded && !t.fleetTrip ? `+${payoutLabel(t)}` : payoutLabel(t)}</Text>
                  <Text style={nxText.small}>{t.fleetTrip ? 'Settled by fleet' : status ? STATUS[status] || status : 'Not credited yet'}</Text>
                </View>
              </View>
            );
          })
        )}
      </NxPanel>
      </NxColumns>
    </NxScreen>
  );
}

const styles = StyleSheet.create({
  total: { fontSize: 32, fontWeight: '800', letterSpacing: -1, color: nx.ink, marginBottom: 12 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 170, gap: 6, marginTop: 6 },
  col: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  track: { flex: 1, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '70%', backgroundColor: '#F0B6BD', borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  barNow: { backgroundColor: nx.red },
  day: { fontSize: 10, color: nx.muted },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  itemIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: nx.page, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: 12.5, fontWeight: '700', color: nx.ink, marginBottom: 3 },
  itemAmount: { fontSize: 14, fontWeight: '800', color: nx.green },
});
