import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { Colors } from '../../theme/colors';
import { formatINR } from '../../utils/format';
import {
  subscribeToVendorActiveTrips,
  subscribeToFleetVehicles,
  subscribeToFleetDrivers,
  assignTripInFirestore,
} from '../../services/vendorFirestoreService';
import type { VendorTrip, FleetVehicle, FleetDriver } from '../../types/vendor';

export function TripAssignmentScreen() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<VendorTrip[]>([]);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [loading, setLoading] = useState(true);

  // Dispatch modal
  const [selectedTrip, setSelectedTrip] = useState<VendorTrip | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<FleetDriver | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(null);
  const [dispatching, setDispatching] = useState(false);

  const vendorId = user?.uid || '';

  useEffect(() => {
    if (!vendorId) return;
    const unsubT = subscribeToVendorActiveTrips(vendorId, (t) => {
      setTrips(t);
      setLoading(false);
    });
    const unsubV = subscribeToFleetVehicles(vendorId, setVehicles);
    const unsubD = subscribeToFleetDrivers(vendorId, setDrivers);
    return () => {
      unsubT();
      unsubV();
      unsubD();
    };
  }, [vendorId]);

  const openDispatch = (t: VendorTrip) => {
    setSelectedTrip(t);
    setSelectedDriver(null);
    setSelectedVehicle(null);
  };

  const handleAssign = async () => {
    if (!selectedTrip || !selectedDriver || !selectedVehicle) {
      Alert.alert('Incomplete', 'Please select both a driver and a vehicle.');
      return;
    }
    setDispatching(true);
    try {
      const ok = await assignTripInFirestore(
        selectedTrip.id,
        selectedDriver.id,
        selectedDriver.name,
        selectedVehicle.vehicleNumber,
        vendorId
      );
      if (ok) {
        Alert.alert('Trip Dispatched!', `Assigned to ${selectedDriver.name} (${selectedVehicle.vehicleNumber}).`);
        setSelectedTrip(null);
      } else {
        Alert.alert('Error', 'Could not assign trip. Please try again.');
      }
    } finally {
      setDispatching(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Text style={s.title}>Trip Assignments</Text>
        <Text style={s.sub}>{trips.length} active bookings in your dispatch queue</Text>
      </View>

      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }}
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.topRow}>
              <Text style={s.bookingId}>{item.bookingId}</Text>
              <View style={s.statusBadge}>
                <Text style={s.statusText}>{item.status}</Text>
              </View>
            </View>

            <Text style={s.customerText}>Passenger: {item.customerName} ({item.customerPhoneMasked || item.customerPhone})</Text>

            <View style={s.routeBox}>
              <Text style={s.routeText}>📍 {item.pickupAddress}</Text>
              <Text style={s.routeText}>🏁 {item.dropAddress}</Text>
            </View>

            <View style={s.assignmentBox}>
              <Text style={s.assignedText}>
                🚗 {item.vehicleNumber || 'Unassigned'} · 👤 {item.driverName || 'Unassigned'}
              </Text>
              <Text style={s.payoutText}>Net Payout: {formatINR(item.vendorPayout)}</Text>
            </View>

            <Pressable style={s.dispatchBtn} onPress={() => openDispatch(item)}>
              <Text style={s.dispatchBtnText}>
                {item.driverId ? 'Reassign Driver / Cab' : 'Dispatch Driver & Cab →'}
              </Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={s.empty}>
              <Text style={{ fontSize: 44, marginBottom: 12 }}>📋</Text>
              <Text style={s.emptyTitle}>No Trips in Queue</Text>
              <Text style={s.emptySub}>Claim bookings from the Open Marketplace to assign them.</Text>
            </View>
          ) : (
            <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 40 }} />
          )
        }
      />

      {/* Assignment Modal */}
      <Modal visible={!!selectedTrip} transparent animationType="slide" onRequestClose={() => setSelectedTrip(null)}>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Dispatch Booking: {selectedTrip?.bookingId}</Text>

            <Text style={s.label}>1. Select Driver</Text>
            <View style={s.chipRow}>
              {drivers.map((d) => (
                <Pressable
                  key={d.id}
                  style={[s.chip, selectedDriver?.id === d.id && s.chipActive]}
                  onPress={() => setSelectedDriver(d)}
                >
                  <Text style={[s.chipText, selectedDriver?.id === d.id && s.chipTextActive]}>
                    {d.name} ({d.status})
                  </Text>
                </Pressable>
              ))}
              {drivers.length === 0 && <Text style={s.emptyHint}>No drivers added to fleet yet.</Text>}
            </View>

            <Text style={s.label}>2. Select Vehicle</Text>
            <View style={s.chipRow}>
              {vehicles.map((v) => (
                <Pressable
                  key={v.id}
                  style={[s.chip, selectedVehicle?.id === v.id && s.chipActive]}
                  onPress={() => setSelectedVehicle(v)}
                >
                  <Text style={[s.chipText, selectedVehicle?.id === v.id && s.chipTextActive]}>
                    {v.vehicleNumber} ({v.model})
                  </Text>
                </Pressable>
              ))}
              {vehicles.length === 0 && <Text style={s.emptyHint}>No vehicles in fleet yet.</Text>}
            </View>

            <View style={s.modalActions}>
              <Pressable style={s.modalCancel} onPress={() => setSelectedTrip(null)}>
                <Text style={s.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.modalSubmit, (!selectedDriver || !selectedVehicle || dispatching) && { opacity: 0.5 }]}
                onPress={handleAssign}
                disabled={!selectedDriver || !selectedVehicle || dispatching}
              >
                {dispatching ? <ActivityIndicator color="#fff" /> : <Text style={s.modalSubmitText}>Confirm Dispatch</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.darkBg },
  header: { padding: 16, paddingTop: 12, borderBottomWidth: 1, borderColor: Colors.border },
  title: { fontSize: 24, fontWeight: '900', color: Colors.white },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  card: { backgroundColor: Colors.cardBg, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.border },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  bookingId: { fontSize: 16, fontWeight: '900', color: Colors.white },
  statusBadge: { backgroundColor: '#1E1B4B', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { color: '#818CF8', fontSize: 11, fontWeight: '800' },
  customerText: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8 },
  routeBox: { backgroundColor: '#2C2C2E', borderRadius: 8, padding: 10, gap: 4, marginBottom: 10 },
  routeText: { fontSize: 13, color: Colors.white, fontWeight: '600' },
  assignmentBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  assignedText: { fontSize: 13, color: Colors.textSecondary },
  payoutText: { fontSize: 15, fontWeight: '900', color: Colors.online },
  dispatchBtn: { backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  dispatchBtnText: { color: Colors.white, fontSize: 14, fontWeight: '800' },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 20 },
  emptyTitle: { color: Colors.white, fontSize: 18, fontWeight: '800' },
  emptySub: { color: Colors.textSecondary, fontSize: 13, marginTop: 4, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.cardBg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.white, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { backgroundColor: '#2C2C2E', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: Colors.white },
  emptyHint: { color: Colors.textSecondary, fontSize: 12, fontStyle: 'italic' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  modalCancel: { flex: 1, paddingVertical: 13, borderRadius: 10, backgroundColor: '#2C2C2E', alignItems: 'center' },
  modalCancelText: { color: Colors.white, fontWeight: '700' },
  modalSubmit: { flex: 2, paddingVertical: 13, borderRadius: 10, backgroundColor: Colors.online, alignItems: 'center' },
  modalSubmitText: { color: Colors.white, fontWeight: '800' },
});