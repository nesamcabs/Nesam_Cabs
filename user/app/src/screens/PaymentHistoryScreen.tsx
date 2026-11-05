// Payments & Refunds: what each booking cost, what has been paid, balances and refunds, from the
// server-derived payment summary on the customer's own bookings.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import { FlatList } from '../components/layout';
import { useNavigation } from '@react-navigation/native';
import { useCustomerData } from '../context/CustomerData';
import { Badge, EmptyState, type BadgeTone } from '../components/ui';
import { AppHeader } from '../components/brand';
import { Icon } from '../components/Icon';
import { formatINR } from '../utils/format';
import { paymentLabel, paymentRows } from '../utils/tripView';
import { colors, fonts, space } from '../theme';

const dayText = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`;

export function PaymentHistoryScreen() {
  const navigation = useNavigation();
  const { trips, profile } = useCustomerData();
  const rows = paymentRows(trips);
  const refunds = trips.filter((t) => t.refund && t.refund.amount > 0);
  const owed = trips.filter((t) => t.status !== 'Cancelled' && t.status !== 'Rejected' && t.paid && t.paid.balanceDue > 0).reduce((n, t) => n + (t.paid?.balanceDue ?? 0), 0);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
<KeyboardAvoid>
      <AppHeader title="Payments & Refunds" onBack={() => navigation.goBack()} />
      <FlatList
        data={rows}
        kind="narrow"
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ marginBottom: space.md }}>
            <View style={styles.summary}>
              <Line label="Refund credits" value={formatINR(profile.walletBalance)} />
              {owed > 0 ? <Line label="Balance on active bookings" value={formatINR(owed)} /> : null}
              <Line label="Refunds recorded" value={String(refunds.length)} last />
            </View>
            <Text style={styles.note}>Refunds for cancelled bookings appear here once NESAM records them.</Text>
          </View>
        }
        ListEmptyComponent={<EmptyState icon="wallet" title="No payments yet" message="Completed trips and any refunds will be listed here." />}
        renderItem={({ item: t }) => {
          const when = t.completedAt ?? t.cancelledAt ?? t.createdAt;
          const closed = t.status === 'Cancelled' || t.status === 'Rejected';
          const total = t.status === 'Completed' ? t.fare + t.tollCharges + (t.extraCharges ?? 0) : closed ? t.cancellationFee : (t.paid?.totalPaid ?? 0);
          const pay = paymentLabel(t);
          const tone: BadgeTone = t.status === 'Completed' ? (pay.tone === 'success' ? 'success' : 'warning') : 'neutral';
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
              onPress={() => navigation.navigate('ActiveRide', { bookingId: t.id })}
              accessibilityRole="button"
              accessibilityLabel={`Booking ${t.bookingId}, ${t.pickup.name} to ${t.drop.name}, ${pay.text}`}
            >
              <View style={styles.rowTop}>
                <Text style={styles.route} numberOfLines={2}>
                  {t.pickup.name}
                  <Text style={styles.arrow}>{'  →  '}</Text>
                  {t.tripType === 'Local Rental' ? 'Local Rental' : t.drop.name}
                </Text>
                <Badge label={t.status === 'Completed' ? pay.text : t.status} tone={tone} />
              </View>
              <Text style={styles.meta}>{`${when ? dayText(when) : t.date} · #${t.bookingId}`}</Text>
              {t.paid && !closed ? (
                <Text style={styles.meta}>{`Paid ${formatINR(t.paid.totalPaid)}${t.paid.balanceDue > 0 ? ` · Balance ${formatINR(t.paid.balanceDue)}` : ''}`}</Text>
              ) : null}
              {t.refund && t.refund.amount > 0 ? <Text style={styles.refund}>{`Refund ${t.refund.status.toLowerCase()} · ${formatINR(t.refund.amount)}`}</Text> : null}
              <View style={styles.rowFoot}>
                <Text style={styles.amount}>{formatINR(total)}</Text>
                <View style={styles.viewLink}>
                  <Text style={styles.viewText}>{t.status === 'Completed' ? 'Receipt' : 'Details'}</Text>
                  <Icon name="chevron-right" size={14} color={colors.primary} />
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </KeyboardAvoid>
</SafeAreaView>
  );
}

function Line({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.line, !last && styles.lineRule]}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  list: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xxl },
  summary: { borderWidth: 1, borderColor: '#E3E7EC', borderRadius: 13, paddingHorizontal: 18, backgroundColor: colors.white },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  lineRule: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  lineLabel: { fontFamily: fonts.regular, fontSize: 13, color: '#55606F' },
  lineValue: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.ink },
  note: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, color: '#6D7785', marginTop: 10, marginBottom: 16 },
  row: { borderWidth: 1, borderColor: '#E3E7EC', borderRadius: 10, padding: 14, marginBottom: 12, backgroundColor: colors.white },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  route: { flex: 1, fontFamily: fonts.bold, fontSize: 14.5, lineHeight: 21, color: colors.text },
  arrow: { fontFamily: fonts.regular, color: '#8A929E' },
  meta: { fontFamily: fonts.regular, fontSize: 11.5, color: '#6D7785', marginTop: 5 },
  refund: { fontFamily: fonts.medium, fontSize: 11.5, color: colors.success, marginTop: 5 },
  rowFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EEF0F4' },
  amount: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  viewLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  viewText: { fontFamily: fonts.medium, fontSize: 12, color: colors.primary },
});
