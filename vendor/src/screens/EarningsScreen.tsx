// Earnings — duty payouts, verified collections and statements (client reference qEarnings / duty statement).
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVendorData } from '../context/VendorData';
import { useInbox } from '../context/Inbox';
import { EmptyState, Screen, Sheet } from '../components/ui';
import { ExtraTag, KV, PageHeading, Panel, PBadge, UTabs, dayTime, rupees } from '../components/partner';
import { colors, space } from '../theme';

type Tab = 'All' | 'Wallet posted' | 'Bank settled' | 'Processing';
const GROUP: Record<string, Tab> = { Wallet: 'Wallet posted', Paid: 'Bank settled', Due: 'Processing', Processing: 'Processing', 'On Hold': 'Processing', Failed: 'Processing' };

export function EarningsScreen() {
  const d = useVendorData();
  const { penalties } = useInbox();
  const [tab, setTab] = useState<Tab>('All');
  const [open, setOpen] = useState('');
  const completed = d.bookings.filter((b) => b.status === 'Completed').sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  const groupOf = (id: string): Tab => { const due = d.dues.find((x) => x.id === id); return due ? GROUP[due.status] ?? 'Processing' : 'Processing'; };
  const list = completed.filter((b) => tab === 'All' || groupOf(b.id) === tab);
  const b = completed.find((x) => x.id === open) ?? null;
  const due = b ? d.dues.find((x) => x.id === b.id) ?? null : null;
  const fines = b ? penalties.filter((p) => p.bookingId === b.id && p.status === 'Deducted').reduce((s, p) => s + p.amount, 0) : 0;
  return (
    <Screen edges={[]}>
      <PageHeading title="Earnings" subtitle="Duty payouts, verified collections and statements." />
      <View style={styles.summary}>
        {[['Total vendor payout', completed.reduce((s, x) => s + (x.payoutRecorded ? x.vendorPayout : 0), 0)], ['Verified fare collected', d.dues.reduce((s, x) => s + x.collectedByPartner, 0)], ['Net trip adjustment', d.dues.reduce((s, x) => s + x.amount, 0)]].map(([k, v]) => (
          <View key={k as string} style={styles.sumItem}><Text style={styles.sumLabel}>{k}</Text><Text style={styles.sumValue}>{rupees(v as number)}</Text></View>
        ))}
      </View>
      <UTabs value={tab} onChange={setTab} items={(['All', 'Wallet posted', 'Bank settled', 'Processing'] as Tab[]).map((id) => ({ id, label: id }))} />
      {list.length ? list.map((x) => (
        <Pressable key={x.id} onPress={() => setOpen(x.id)} accessibilityRole="button">
          <Panel style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.code}>{x.bookingId}</Text>
              <Text style={styles.route} numberOfLines={1}>{x.pickupAddress} → {x.dropAddress}</Text>
              <Text style={styles.small}>{dayTime(x.pickupAt ?? x.completedAt)} · {groupOf(x.id)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.amount}>{rupees(x.payoutRecorded ? x.vendorPayout : null)}</Text>
              <Text style={styles.small}>Vendor payout</Text>
              <View style={styles.link}><Text style={styles.linkText}>View statement</Text><Ionicons name="chevron-forward" size={13} color={colors.primary} /></View>
            </View>
          </Panel>
        </Pressable>
      )) : <EmptyState title={completed.length ? 'No duties here' : 'No duty statements'} message={completed.length ? 'Completed duty statements appear here.' : 'Statements will appear after completed trips.'} />}
      {b ? (
        <Sheet visible onClose={() => setOpen('')} title="Duty statement">
          <View style={{ flexDirection: 'row', gap: 6 }}><PBadge label={b.bookingId} /><PBadge label={due ? GROUP[due.status] ?? due.status : 'Settlement pending'} tone={due && ['Paid', 'Wallet'].includes(due.status) ? 'green' : 'amber'} /></View>
          <Text style={[styles.route, { marginTop: space.sm }]}>{b.pickupAddress} → {b.dropAddress}</Text>
          <KV rows={[
            ['Agreed vendor payout', rupees(b.payoutRecorded ? b.vendorPayout : null)],
            ['Approved reimbursements', rupees(due ? Math.max(0, due.entitlement - (b.payoutRecorded ? b.vendorPayout : 0)) : 0)],
            ['Fare retained by driver / vendor (fare only)', due ? rupees(due.collectedByPartner) : 'After office verification'],
            ['Trip adjustment', due ? `${due.amount >= 0 ? '+' : '−'}${rupees(Math.abs(due.amount))}` : 'After office verification'],
            ['Confirmed penalties', `${rupees(fines)} · separate wallet entries`],
          ]} />
          <Text style={[styles.small, { marginTop: space.md }]}>Customer advances paid to NESAM are not counted again as driver collection. Toll and parking follow approved receipts.</Text>
          <ExtraTag />
        </Sheet>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: space.md },
  sumItem: { flexGrow: 1, flexBasis: '30%', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12 },
  sumLabel: { fontSize: 11, color: colors.muted },
  sumValue: { fontSize: 17, fontWeight: '700', color: colors.ink, marginTop: 4 },
  row: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  code: { fontSize: 13, fontWeight: '700', color: colors.ink },
  route: { fontSize: 14, color: colors.text, marginTop: 2 },
  small: { fontSize: 11.5, color: colors.muted, marginTop: 2 },
  amount: { fontSize: 18, fontWeight: '700', color: colors.ink },
  link: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 6 },
  linkText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
});
