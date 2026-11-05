import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { Colors } from '../../theme/colors';
import { formatINR } from '../../utils/format';
import {
  subscribeToFleetVehicles,
  subscribeToFleetDrivers,
  subscribeToOpenMarketplaceTrips,
  subscribeToVendorActiveTrips,
  subscribeToVendorWalletBalance,
} from '../../services/vendorFirestoreService';
import type { FleetVehicle, FleetDriver, OpenTrip, VendorTrip } from '../../types/vendor';

export function DashboardScreen({ navigation }: any) {
  const { user, vendorRecord } = useAuth();
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [openTrips, setOpenTrips] = useState<OpenTrip[]>([]);
  const [activeTrips, setActiveTrips] = useState<VendorTrip[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const vendorId = user?.uid || '';
  const vendorName = vendorRecord?.business?.businessName || vendorRecord?.business?.vendorName || 'Fleet Partner';

  useEffect(() => {
    if (!vendorId) return;
    const unsubV = subscribeToFleetVehicles(vendorId, (v) => setVehicles(v));
    const unsubD = subscribeToFleetDrivers(vendorId, (d) => setDrivers(d));
    const unsubO = subscribeToOpenMarketplaceTrips((o) => {
      setOpenTrips(o);
      setLoading(false);
    });
    const unsubA = subscribeToVendorActiveTrips(vendorId, (a) => setActiveTrips(a));
    const unsubB = subscribeToVendorWalletBalance(vendorId, (b) => setBalance(b));

    return () => {
      unsubV();
      unsubD();
      unsubO();
      unsubA();
      unsubB();
    };
  }, [vendorId]);

  const activeVehicleCount = vehicles.filter((v) => v.status === 'Active' || v.status === 'On Trip').length;
  const availableDriverCount = drivers.filter((d) => d.status === 'Available').length;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={loading} tintColor={Colors.primary} />}
      >
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.greeting}>Welcome back,</Text>
            <Text style={s.agencyName} numberOfLines={1}>{vendorName} 🏢</Text>
          </View>
          <View style={s.badge}>
            <Text style={s.badgeText}>VERIFIED</Text>
          </View>
        </View>

        {/* Wallet Overview */}
        <View style={s.walletCard}>
          <Text style={s.walletLabel}>SETTLED WALLET BALANCE</Text>
          <Text style={s.walletAmount}>{formatINR(balance)}</Text>
          <View style={s.walletRow}>
            <Text style={s.walletSub}>Next settlement: Tuesday</Text>
            <Pressable
              style={s.payoutBtn}
              onPress={() => navigation.navigate('WalletTab')}
            >
              <Text style={s.payoutBtnText}>Request Payout →</Text>
            </Pressable>
          </View>
        </View>

        {/* Quick Stats Grid */}
        <View style={s.grid}>
          <Pressable style={s.gridCard} onPress={() => navigation.navigate('FleetTab')}>
            <Text style={s.gridIcon}>🚗</Text>
            <Text style={s.gridCount}>{vehicles.length}</Text>
            <Text style={s.gridLabel}>{activeVehicleCount} Active Vehicles</Text>
          </Pressable>

          <Pressable style={s.gridCard} onPress={() => navigation.navigate('DriversTab')}>
            <Text style={s.gridIcon}>👤</Text>
            <Text style={s.gridCount}>{drivers.length}</Text>
            <Text style={s.gridLabel}>{availableDriverCount} Available Drivers</Text>
          </Pressable>
        </View>

        {/* Active Trips Banner */}
        {activeTrips.length > 0 && (
          <Pressable
            style={s.activeTripsBanner}
            onPress={() => navigation.navigate('AssignmentsTab')}
          >
            <View style={s.activeDot} />
            <View style={{ flex: 1 }}>
              <Text style={s.activeBannerTitle}>{activeTrips.length} Active Dispatch Trips</Text>
              <Text style={s.activeBannerSub} numberOfLines={1}>
                Next: {activeTrips[0]?.pickupAddress} → {activeTrips[0]?.dropAddress}
              </Text>
            </View>
            <Text style={s.activeBannerArrow}>›</Text>
          </Pressable>
        )}

        {/* Marketplace Preview */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Open Marketplace ({openTrips.length})</Text>
          <Pressable onPress={() => navigation.navigate('MarketplaceTab')}>
            <Text style={s.seeAllText}>See all →</Text>
          </Pressable>
        </View>

        {openTrips.slice(0, 3).map((item) => (
          <Pressable
            key={item.id}
            style={s.tripCard}
            onPress={() => navigation.navigate('MarketplaceTab')}
          >
            <View style={s.tripTop}>
              <Text style={s.tripCat}>{item.vehicleCategory}</Text>
              <Text style={s.tripPayout}>{formatINR(item.offeredPayout)}</Text>
            </View>
            <Text style={s.tripRoute} numberOfLines={2}>
              📍 {item.pickup.address} → {item.drop.address}
            </Text>
            <Text style={s.tripDate}>📅 {item.travelDate} · {item.distanceKm} km</Text>
          </Pressable>
        ))}

        {openTrips.length === 0 && !loading && (
          <View style={s.emptyBox}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>🗺️</Text>
            <Text style={{ color: Colors.white, fontWeight: '700' }}>No open trips right now</Text>
            <Text style={{ color: Colors.textSecondary, fontSize: 12, marginTop: 4 }}>
              New trip requests from customers will appear here in real time.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.darkBg },
  content: { padding: 16, paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingTop: 8,
  },
  greeting: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },
  agencyName: { fontSize: 20, fontWeight: '900', color: Colors.white, maxWidth: 220 },
  badge: {
    backgroundColor: '#064E3B',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: { color: Colors.online, fontSize: 11, fontWeight: '800' },
  walletCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  walletLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5 },
  walletAmount: { fontSize: 32, fontWeight: '900', color: Colors.white, marginVertical: 6 },
  walletRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  walletSub: { fontSize: 12, color: Colors.textSecondary },
  payoutBtn: { backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  payoutBtnText: { color: Colors.white, fontSize: 12, fontWeight: '800' },
  grid: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  gridCard: {
    flex: 1,
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  gridIcon: { fontSize: 24, marginBottom: 6 },
  gridCount: { fontSize: 22, fontWeight: '900', color: Colors.white },
  gridLabel: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  activeTripsBanner: {
    backgroundColor: '#1E1B4B',
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#4338CA',
  },
  activeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#6366F1' },
  activeBannerTitle: { fontSize: 14, fontWeight: '800', color: Colors.white },
  activeBannerSub: { fontSize: 12, color: '#C7D2FE', marginTop: 2 },
  activeBannerArrow: { fontSize: 20, color: '#A5B4FC' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: Colors.white },
  seeAllText: { fontSize: 13, color: Colors.primary, fontWeight: '700' },
  tripCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
  },
  tripTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  tripCat: { fontSize: 13, fontWeight: '800', color: Colors.primary },
  tripPayout: { fontSize: 18, fontWeight: '900', color: Colors.online },
  tripRoute: { fontSize: 13, color: Colors.white, fontWeight: '600', marginBottom: 6 },
  tripDate: { fontSize: 12, color: Colors.textSecondary },
  emptyBox: { alignItems: 'center', padding: 32, backgroundColor: Colors.cardBg, borderRadius: 14 },
});