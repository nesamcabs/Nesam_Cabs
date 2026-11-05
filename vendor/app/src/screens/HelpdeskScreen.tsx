// 24/7 Helpdesk — office support and duty requests (client reference vHelpdesk).
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useVendorData } from '../context/VendorData';
import { EmptyState, Screen } from '../components/ui';
import { Feedback, PageHeading, Panel, PBadge, PButton, UTabs, dayTime, rupees } from '../components/partner';
import { CancellationSheet } from './BookingsScreen';
import { colors, space } from '../theme';

const TYPE = { cancellation: 'Cancellation', bank_change: 'Bank change', document_renewal: 'Document renewal' } as const;

export function HelpdeskScreen() {
  const navigation = useNavigation();
  const d = useVendorData();
  const [filter, setFilter] = useState<'Pending' | 'Resolved'>('Pending');
  const [cancel, setCancel] = useState(false);
  const [notice, setNotice] = useState('');
  const phone = d.ops.supportPhone.replace(/^\+91/, '').replace(/(\d{5})(\d{5})/, '$1 $2');
  const list = d.requests.filter((r) => (filter === 'Pending' ? r.status === 'Pending' : r.status !== 'Pending'));
  const action = (icon: React.ComponentProps<typeof Ionicons>['name'], title: string, sub: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={styles.action} accessibilityRole="button" accessibilityLabel={title}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <View style={{ flex: 1 }}><Text style={styles.actionTitle}>{title}</Text><Text style={styles.small}>{sub}</Text></View>
      <Ionicons name="chevron-forward" size={16} color={colors.faint} />
    </Pressable>
  );
  return (
    <Screen edges={[]}>
      <PageHeading title="24/7 Helpdesk" subtitle="Office support and duty requests." />
      <Feedback message={notice} />
      <Panel style={styles.support}>
        <View style={styles.supportIcon}><Ionicons name="headset-outline" size={22} color={colors.primary} /></View>
        <View style={{ flex: 1 }}><Text style={styles.h2}>NESAM office</Text><Text style={styles.small}>Duty, transfer and account assistance.</Text></View>
      </Panel>
      <PButton title={`Call ${phone}`} icon="call-outline" full onPress={() => void Linking.openURL(`tel:${d.ops.supportPhone}`)} containerStyle={{ marginBottom: space.md }} />
      <View style={styles.actions}>
        {action('close-circle-outline', 'Request cancellation', 'Office decision and charge details', () => setCancel(true))}
        {action('people-outline', 'Change driver or vehicle', 'Open a booking and update before trip start', () => navigation.navigate('Tabs', { screen: 'Bookings' }))}
        {action('swap-horizontal-outline', 'Driver / vehicle transfers', 'Linking codes and office review', () => navigation.navigate('Requests'))}
      </View>
      <Text style={styles.section}>My requests</Text>
      <Text style={[styles.small, { marginBottom: space.sm }]}>Duties stay active until the office approves cancellation.</Text>
      <UTabs value={filter} onChange={setFilter} items={[{ id: 'Pending', label: 'Pending' }, { id: 'Resolved', label: 'Resolved' }]} />
      {list.length ? list.map((r) => (
        <Panel key={r.id}>
          <View style={styles.between}><Text style={styles.h3}>{TYPE[r.type]}{r.bookingCode ? ` · ${r.bookingCode}` : ''}</Text><PBadge label={r.status === 'Pending' ? 'Under review' : r.status} tone={r.status === 'Approved' ? 'green' : r.status === 'Declined' ? 'neutral' : 'amber'} /></View>
          <Text style={styles.small}>{r.type === 'cancellation' ? `${r.route} · ${r.reasonLabel}` : r.type === 'document_renewal' ? `${r.documentLabel} · ${r.entityName} · new expiry ${r.expiry}` : `Account ending ${r.accountLast4} · ${r.ifsc}`}</Text>
          {r.type === 'cancellation' ? <Text style={styles.amount}>{r.status === 'Pending' ? 'Potential charge' : 'Cancellation charge'} {rupees(r.status === 'Approved' ? r.finalPenalty ?? 0 : r.status === 'Declined' ? 0 : r.quotedPenalty)}</Text> : null}
          <Text style={styles.small}>Sent {dayTime(r.requestedAt)}{r.decidedAt ? ` · decided ${dayTime(r.decidedAt)}` : ''}</Text>
          {r.adminReason ? <Text style={styles.small}>Office: {r.adminReason}</Text> : null}
        </Panel>
      )) : <EmptyState title={`No ${filter.toLowerCase()} requests`} message="Office decisions appear in the same request." />}
      {cancel ? <CancellationSheet booking={null} onClose={() => setCancel(false)} onDone={(m) => { setCancel(false); setNotice(m); }} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  support: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  supportIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  actions: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, marginBottom: space.lg },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 62, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  actionTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
  section: { fontSize: 17, fontWeight: '700', color: colors.ink },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  h2: { fontSize: 16, fontWeight: '700', color: colors.ink },
  h3: { fontSize: 14, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  small: { fontSize: 12, color: colors.muted, lineHeight: 17, marginTop: 2 },
  amount: { fontSize: 13, fontWeight: '600', color: colors.ink, marginTop: 6 },
});
