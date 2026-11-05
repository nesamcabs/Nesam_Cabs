// My Bookings in the modern layout:
// Header shows the logo emblem with "My Bookings" title right to it,
// followed by Upcoming / Ongoing / Completed / Cancelled tabs and booking cards.
import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { FlatList } from '../components/layout';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import { useNavigation } from '@react-navigation/native';
import { useCustomerData } from '../context/CustomerData';
import { Badge, Button, Chip, EmptyState, Notice, type BadgeTone } from '../components/ui';
import { AppHeader } from '../components/brand';
import { Icon } from '../components/Icon';
import { CancelRideSheet } from '../components/CancelRideSheet';
import type { TripRecord } from '../types';
import { cancellationQuote } from '../services/rideService';
import { formatINR, formatTime } from '../utils/format';
import { BOOKING_TABS, bookingTabOf, customerStatus, paymentLabel, tripStatusChip, type BookingTab } from '../utils/tripView';
import { colors, fonts, space } from '../theme';

const dayText = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short' })}`;

const EMPTY: Record<BookingTab, { title: string; message?: string }> = {
  Upcoming: { title: 'No upcoming bookings', message: 'Book your outstation or intercity journey in advance.' },
  Ongoing: { title: 'No trip in progress', message: 'A trip appears here once your driver starts it.' },
  Completed: { title: 'No completed journeys yet' },
  Cancelled: { title: 'No cancelled bookings' },
};

const CHIP_TONE = (bg: string): BadgeTone => (bg === '#DCFCE7' ? 'success' : bg === '#FEF3C7' ? 'warning' : bg === '#FEE2E2' ? 'danger' : 'info');

export function TripsScreen() {
  const navigation = useNavigation();
  const { trips, tripsLoading, tripsError, retryTrips } = useCustomerData();
  const [tab, setTab] = useState<BookingTab>('Upcoming');
  const [cancelTrip, setCancelTrip] = useState<TripRecord | null>(null);

  const counts = useMemo(() => {
    const c: Record<BookingTab, number> = { Upcoming: 0, Ongoing: 0, Completed: 0, Cancelled: 0 };
    for (const t of trips) c[bookingTabOf(t)]++;
    return c;
  }, [trips]);

  const shown = useMemo(() => {
    const list = trips.filter((t) => bookingTabOf(t) === tab);
    const pickupAt = (t: TripRecord) => (t.scheduledAt ?? t.createdAt)?.getTime() ?? 0;
    const closedAt = (t: TripRecord) => (t.completedAt ?? t.cancelledAt ?? t.createdAt)?.getTime() ?? 0;
    return tab === 'Upcoming' || tab === 'Ongoing' ? list.sort((a, b) => pickupAt(a) - pickupAt(b)) : list.sort((a, b) => closedAt(b) - closedAt(a));
  }, [trips, tab]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
<KeyboardAvoid>
      <CancelRideSheet key={cancelTrip?.id ?? 'none'} trip={cancelTrip} onClose={() => setCancelTrip(null)} />
      <AppHeader title="My Bookings" />
      <FlatList
        data={shown}
        kind="narrow"
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={retryTrips} colors={[colors.primary]} />}
        ListHeaderComponent={
          <View style={{ marginBottom: space.sm }}>
            <View style={styles.tabs} accessibilityRole="tablist">
              {BOOKING_TABS.map((t) => (
                <Chip key={t} label={t} active={t === tab} accessibilityLabel={`${t}, ${counts[t]} bookings`} onPress={() => setTab(t)} />
              ))}
            </View>
            {tripsError ? <Notice message={tripsError} onRetry={retryTrips} style={{ marginTop: space.md }} /> : null}
          </View>
        }
        ListEmptyComponent={
          tripsLoading ? (
            <Text style={styles.loading}>Loading your bookings…</Text>
          ) : (
            <EmptyState
              icon="tickets"
              title={EMPTY[tab].title}
              message={EMPTY[tab].message}
              action={tab === 'Upcoming' ? <Button title="Book a cab" onPress={() => navigation.navigate('Tabs', { screen: 'Book' })} /> : undefined}
            />
          )
        }
        renderItem={({ item: t }) => <TripCard trip={t} onOpen={() => navigation.navigate('ActiveRide', { bookingId: t.id })} onCancel={() => setCancelTrip(t)} />}
      />
    </KeyboardAvoid>
</SafeAreaView>
  );
}

function TripCard({ trip: t, onOpen, onCancel }: { trip: TripRecord; onOpen: () => void; onCancel: () => void }) {
  const chip = tripStatusChip(t);
  const status = customerStatus(t);
  const pay = paymentLabel(t);
  const when = t.scheduledAt ?? t.createdAt;
  // Same rule as the trip page and the websites (and firestore.rules): cancellable until the trip starts, including after a driver is assigned.
  const cancellable = cancellationQuote(t).allowed;
  const total = t.status === 'Completed' ? t.fare + t.tollCharges + (t.extraCharges ?? 0) : t.fare;
  const tab = bookingTabOf(t);
  const destination = t.tripType === 'Local Rental' ? 'Local Rental' : t.drop.name;
  return (
    <View style={styles.card}>
      <Pressable
        onPress={onOpen}
        style={({ pressed }) => [styles.cardBody, pressed && { opacity: 0.8 }]}
        accessibilityRole="button"
        accessibilityLabel={`${t.pickup.name} to ${destination}, ${chip.label}, ${formatINR(total)}. Open booking`}
      >
        <View style={styles.badges}>
          <Badge label={t.tripType === 'Airport Taxi' ? 'Airport' : t.tripType} tone="success" />
          <Badge label={chip.label} tone={CHIP_TONE(chip.bg)} />
        </View>
        <Text style={styles.route} numberOfLines={2}>
          {t.pickup.name}
          <Text style={styles.arrow}>{'  →  '}</Text>
          {destination}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{when ? `${dayText(when)} · ${formatTime(when).replace(/^0/, '')}` : t.date}</Text>
          <Text style={styles.fare}>{formatINR(total)}</Text>
        </View>
      </Pressable>
      <Pressable onPress={onOpen} style={styles.foot} accessibilityRole="button" accessibilityLabel={`${status.label}. Open booking`}>
        <Icon name="clock-3" size={17} color="#8A929E" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.footText} numberOfLines={2}>
            {t.driver && tab !== 'Cancelled' && tab !== 'Completed' ? `${t.driver.name}${t.driver.vehicleNumber ? ` · ${t.driver.vehicleNumber}` : ''}` : status.label}
          </Text>
          <Text style={[styles.pay, pay.tone === 'success' && { color: colors.success }, pay.tone === 'danger' && { color: colors.primaryDark }]}>{pay.text}</Text>
        </View>
        <Icon name="chevron-right" size={15} color="#9BA1AB" />
      </Pressable>
      {cancellable ? (
        <Pressable onPress={onCancel} style={styles.cancel} accessibilityRole="button" accessibilityLabel="Cancel booking" hitSlop={6}>
          <Icon name="circle-x" size={15} color="#7A8494" />
          <Text style={styles.cancelText}>Cancel booking</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  list: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xxl },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: space.sm },
  loading: { fontFamily: fonts.medium, textAlign: 'center', color: colors.muted, marginTop: space.xl, fontSize: 13 },
  card: { borderWidth: 1, borderColor: '#E3E7EC', borderRadius: 10, marginBottom: 12, backgroundColor: colors.white, overflow: 'hidden' },
  cardBody: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 14 },
  badges: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  route: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 24, color: colors.text, marginTop: 12 },
  arrow: { fontFamily: fonts.regular, color: '#8A929E' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: '#6D7785' },
  fare: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 14, paddingVertical: 12, minHeight: 50, backgroundColor: '#FAFAF8', borderTopWidth: 1, borderTopColor: '#EEF0F4' },
  footText: { fontFamily: fonts.regular, fontSize: 12, color: '#55606F' },
  pay: { fontFamily: fonts.regular, fontSize: 10.5, color: '#8A929E', marginTop: 2 },
  cancel: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, minHeight: 44, borderTopWidth: 1, borderTopColor: '#EEF0F4' },
  cancelText: { fontFamily: fonts.medium, fontSize: 12, color: '#55606F' },
});
