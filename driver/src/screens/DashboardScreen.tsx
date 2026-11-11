import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Switch, TouchableOpacity, ScrollView } from 'react-native';
import { Text } from '../components/nx/Text';
import { useAuth } from '../context/AuthContext';
import { Colors } from '../theme/colors';
import { formatINR } from '../utils/format';
import { subscribeToDriverBookings, setDriverPresence, subscribeToPayoutRequests } from '../services/driverFirestoreService';
import type { TripDetails, PayoutRequest } from '../types/driver';

export default function DashboardScreen({ navigation }: any) {
  const { account, user } = useAuth();
  const [trips, setTrips] = useState<TripDetails[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);

  useEffect(() => {
    if (!user) return;
    const unsubBookings = subscribeToDriverBookings(user.uid, (data) => setTrips(data));
    const unsubPayouts = subscribeToPayoutRequests(user.uid, (data) => setPayouts(data));
    return () => {
      unsubBookings();
      unsubPayouts();
    };
  }, [user]);

  const toggleOnline = async (val: boolean) => {
    if (!user) return;
    try {
      await setDriverPresence(user.uid, val ? 'Online' : 'Offline');
    } catch (e) {
      console.error(e);
    }
  };

  const isOnline = account?.driver.presenceStatus === 'Online';
  const name = account?.driver.name || 'Partner';
  const rating = account?.driver.rating || 5.0;

  const todayStr = new Date().toDateString();
  const todayTrips = trips.filter(
    (b) => b.status === 'Completed' && b.completedAt && b.completedAt.toDateString() === todayStr
  );
  const todayEarnings = todayTrips.reduce((sum, b) => sum + (b.driverEarnings || 0), 0);

  const totalEarnings = trips
    .filter((b) => b.status === 'Completed')
    .reduce((sum, b) => sum + (b.driverEarnings || 0), 0);
  const totalPaidOut = payouts
    .filter((p) => p.status === 'Paid' || p.status === 'Completed')
    .reduce((sum, p) => sum + p.amount, 0);
  const pendingPayout = payouts
    .filter((p) => p.status === 'Pending')
    .reduce((sum, p) => sum + p.amount, 0);
  const balance = totalEarnings - totalPaidOut - pendingPayout;

  const activeTrip = trips.find((b) => b.status === 'Assigned' || b.status === 'Ongoing');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hello, {name}</Text>
          <Text style={styles.rating}>⭐ {rating.toFixed(1)} Rating</Text>
        </View>
        <View style={styles.toggleContainer}>
          <Text style={[styles.statusText, { color: isOnline ? Colors.online : Colors.offline }]}>
            {isOnline ? 'Online' : 'Offline'}
          </Text>
          <Switch
            value={isOnline}
            onValueChange={toggleOnline}
            trackColor={{ true: Colors.online, false: Colors.offline }}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>TODAY'S EARNINGS</Text>
        <Text style={styles.bigAmount}>{formatINR(todayEarnings)}</Text>
        <Text style={styles.subtext}>{todayTrips.length} Completed Trips Today</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>WALLET BALANCE</Text>
        <Text style={styles.bigAmount}>{formatINR(balance)}</Text>
        <Text style={styles.subtext}>Total Earnings: {formatINR(totalEarnings)}</Text>
      </View>

      {activeTrip && (
        <View style={[styles.card, styles.activeTripCard]}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>ACTIVE TRIP: {activeTrip.stage}</Text>
          </View>
          <Text style={styles.tripCustomer}>{activeTrip.customerName}</Text>
          <Text style={styles.tripRoute}>
            📍 {activeTrip.pickup.address} → {activeTrip.drop.address}
          </Text>
          <Text style={styles.tripFare}>Earnings: {formatINR(activeTrip.driverEarnings)}</Text>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => navigation.navigate('TripTab')}
          >
            <Text style={styles.btnText}>Open Trip Execution</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.quickBtn, { backgroundColor: Colors.primary }]}
          onPress={() => navigation.navigate('MarketplaceTab')}
        >
          <Text style={styles.btnText}>View Marketplace Trips</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.quickBtn, { backgroundColor: Colors.black }]}
          onPress={() => navigation.navigate('EarningsTab')}
        >
          <Text style={styles.btnText}>Request Payout</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.darkBg },
  content: { padding: 16, paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingTop: 10,
  },
  greeting: { fontSize: 22, fontWeight: '800', color: Colors.white },
  rating: { fontSize: 14, color: Colors.warning, marginTop: 4 },
  toggleContainer: { alignItems: 'center' },
  statusText: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  card: {
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  cardLabel: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5 },
  bigAmount: { fontSize: 28, fontWeight: '900', color: Colors.white, marginVertical: 6 },
  subtext: { fontSize: 13, color: Colors.textSecondary },
  activeTripCard: { borderColor: Colors.primary, borderWidth: 1.5 },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 8,
  },
  badgeText: { color: Colors.white, fontSize: 11, fontWeight: '800' },
  tripCustomer: { fontSize: 16, fontWeight: '800', color: Colors.white },
  tripRoute: { fontSize: 13, color: '#D1D5DB', marginVertical: 6 },
  tripFare: { fontSize: 14, fontWeight: '700', color: Colors.online, marginBottom: 12 },
  actionBtn: {
    backgroundColor: Colors.primary,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionsRow: { gap: 10, marginTop: 8 },
  quickBtn: {
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnText: { color: Colors.white, fontWeight: '800', fontSize: 15 },
});