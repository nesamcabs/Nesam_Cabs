// Earnings — duty payouts, verified collections and statements (reference qEarnings + duty statement).
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/kit/Text';
import { useVendorData } from '../../context/VendorData';
import { useInbox } from '../../context/Inbox';
import { Page } from '../../components/shell/Page';
import { Sheet } from '../../components/ui';
import { Badge, Btn, Empty, Grid, Inline, KV, Notice, Small, Tabs, TextLink } from '../../components/kit/core';
import { dayTime, firstPart, rupees } from '../../components/kit/format';
import { navigationRef } from '../../navigation/navigationRef';
import { payoutOf, SETTLEMENT_LABEL } from '../bookings/logic';
import { ExtraTag } from '../trips/parts';
import { colors, fontFamily } from '../../theme';
import { useLayout } from '../../theme/responsive';

type Tab = 'All' | 'Wallet posted' | 'Bank settled' | 'Processing';
const GROUP: Record<string, Tab> = { Wallet: 'Wallet posted', Paid: 'Bank settled', Due: 'Processing', Processing: 'Processing', 'On Hold': 'Processing', Failed: 'Processing' };

export function EarningsScreen() {
  const d = useVendorData();
  const { penalties } = useInbox();
  const { wide } = useLayout();
  const [tab, setTab] = useState<Tab>('All');
  const [open, setOpen] = useState('');
  const completed = d.bookings.filter((b) => b.status === 'Completed').sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  // No settlement record is created when your driver collected the whole fare (nothing to pay out): once finance has
  // finalised the trip, the adjustment is a wallet entry.
  const groupOf = (id: string): Tab => {
    const due = d.dues.find((x) => x.id === id);
    if (due) return GROUP[due.status] ?? 'Processing';
    return d.bookings.find((x) => x.id === id)?.payoutFinalized ? 'Wallet posted' : 'Processing';
  };
  const list = completed.filter((b) => tab === 'All' || groupOf(b.id) === tab);
  const count = (t: Tab) => completed.filter((b) => t === 'All' || groupOf(b.id) === t).length;
  const b = completed.find((x) => x.id === open) ?? null;
  const due = b ? d.dues.find((x) => x.id === b.id) ?? null : null;
  const fines = b ? penalties.filter((p) => p.bookingId === b.id && p.status === 'Deducted').reduce((s, p) => s + p.amount, 0) : 0;
  const totals = [
    ['Vendor payout', completed.reduce((s, x) => s + (payoutOf(x) ?? 0), 0), 'Completed duties'],
    ['Fare collected', d.dues.reduce((s, x) => s + x.collectedByPartner, 0), 'Held by your drivers'],
    ['Trip adjustment', d.dues.reduce((s, x) => s + x.amount, 0), 'Wallet / bank'],
    ['This month', d.monthEarnings, 'Credited by NESAM'],
  ] as const;

  return (
    <Page>
      <Grid columns={wide ? 4 : 2} gap={10}>
        {totals.map(([k, v, sub]) => (
          <View key={k} style={styles.tile}>
            <Text style={styles.tileLabel} numberOfLines={1}>{k}</Text>
            <Text style={[styles.tileValue, v < 0 && { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>{v < 0 ? `−${rupees(Math.abs(v))}` : rupees(v)}</Text>
            <Text style={styles.tileSub} numberOfLines={1}>{sub}</Text>
          </View>
        ))}
      </Grid>
      <Tabs value={tab} onChange={setTab} items={(['All', 'Wallet posted', 'Bank settled', 'Processing'] as Tab[]).map((id) => ({ id, label: id, count: count(id) }))} />
      {list.length ? (
        <View style={{ gap: 12 }}>
          {list.map((x) => {
            const g = groupOf(x.id);
            return (
              <Pressable key={x.id} onPress={() => setOpen(x.id)} accessibilityRole="button" accessibilityLabel={`Statement ${x.bookingId}`}
                style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.row, hovered && { borderColor: '#D8DFE9' }, !wide && { flexDirection: 'column', alignItems: 'stretch' }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.code}>{x.bookingId}</Text>
                  <Text style={styles.route} numberOfLines={1}>{firstPart(x.pickupAddress)} → {firstPart(x.dropAddress)}</Text>
                  <Inline style={{ marginTop: 6 }}><Small>{dayTime(x.pickupAt ?? x.completedAt)}</Small><Badge label={g} tone={g === 'Processing' ? 'amber' : 'green'} /></Inline>
                </View>
                <View style={[{ alignItems: wide ? 'flex-end' : 'flex-start' }, !wide && styles.rowBottom]}>
                  <View style={{ alignItems: wide ? 'flex-end' : 'flex-start' }}>
                    <Text style={styles.amount}>{rupees(payoutOf(x))}</Text>
                    <Small>Vendor payout</Small>
                  </View>
                  <TextLink title="View statement" onPress={() => setOpen(x.id)} />
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Empty icon="stats-chart-outline" title={completed.length ? 'No duties here' : 'No duty statements yet'} text={completed.length ? 'Completed duty statements appear here.' : 'Statements appear after your first completed trip.'} />
      )}

      {b ? (
        <Sheet visible onClose={() => setOpen('')} title="Duty statement">
          <Inline><Badge label={b.bookingId} /><Badge label={due ? SETTLEMENT_LABEL[due.status] ?? due.status : b.payoutFinalized ? 'Adjusted in wallet' : 'Settlement pending'} tone={(due && ['Paid', 'Wallet'].includes(due.status)) || (!due && b.payoutFinalized) ? 'green' : 'amber'} /></Inline>
          <Text style={[styles.route, { marginTop: 12, fontSize: 16 }]}>{firstPart(b.pickupAddress)} → {firstPart(b.dropAddress)}</Text>
          <Small>{dayTime(b.pickupAt)}{b.completedAt ? ` · completed ${dayTime(b.completedAt)}` : ''}</Small>
          <KV rows={[
            ['Agreed vendor payout', rupees(payoutOf(b))],
            ['Approved reimbursements', rupees(due ? Math.max(0, due.entitlement - (payoutOf(b) ?? 0)) : 0)],
            ['Fare retained by driver / vendor', due ? rupees(due.collectedByPartner) : 'After office verification'],
            ['Trip adjustment', due ? (due.amount < 0 ? `−${rupees(Math.abs(due.amount))}` : rupees(due.amount)) : 'After office verification'],
            ['Confirmed penalties', `${rupees(fines)} · separate wallet entries`],
          ]} />
          <Notice tone="neutral" icon="receipt-outline" title="How this is settled" text="Customer advances paid to NESAM are not counted again as driver collection. Toll and parking follow approved receipts." style={{ marginTop: 14 }} />
          <ExtraTag />
          <Btn kind="secondary" icon="ticket-outline" title="Open booking" full style={{ marginTop: 16 }} onPress={() => { setOpen(''); if (navigationRef.isReady()) navigationRef.navigate('Booking', { id: b.id }); }} />
        </Sheet>
      ) : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  tile: { flexGrow: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14 },
  tileLabel: { fontFamily, fontSize: 11, fontWeight: '500', color: '#6F7785' },
  tileValue: { fontFamily, fontSize: 19, fontWeight: '700', color: '#2B3340', letterSpacing: -0.4, marginTop: 4 },
  tileSub: { fontFamily, fontSize: 10, color: '#9AA3AF', marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 13, paddingVertical: 18, paddingHorizontal: 20 },
  rowBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#F1F2F5', paddingTop: 12 },
  code: { fontFamily, fontSize: 13, fontWeight: '600', color: colors.ink },
  route: { fontFamily, fontSize: 14, color: colors.text, marginTop: 3 },
  amount: { fontFamily, fontSize: 19, fontWeight: '700', color: colors.ink },
});
