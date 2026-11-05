import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, ScrollView, ActivityIndicator, Linking } from 'react-native';
import { Text, TextInput } from '../components/nx/Text';
import { useAuth } from '../context/AuthContext';
import { Colors } from '../theme/colors';
import { formatINR, formatDistance } from '../utils/format';
import {
  subscribeToDriverBookings,
  submitPreTripVerification,
  markReachedPickup,
  startTripWithOtp,
  markArrivedDestination,
  completeTrip,
} from '../services/driverFirestoreService';
import type { TripDetails, PreTripPhotos } from '../types/driver';

export default function TripExecutionScreen() {
  const { user } = useAuth();
  const [trips, setTrips] = useState<TripDetails[]>([]);
  const [otpInput, setOtpInput] = useState('');
  const [endOdoInput, setEndOdoInput] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToDriverBookings(user.uid, (data) => setTrips(data));
    return () => unsub();
  }, [user]);

  const activeTrip = trips.find((b) => b.status === 'Assigned' || b.status === 'Ongoing');

  if (!activeTrip) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>📍</Text>
        <Text style={styles.emptyTitle}>No Active Trip</Text>
        <Text style={styles.emptySub}>Accepted trips will appear here for execution.</Text>
      </View>
    );
  }

  const handleStartPreTrip = async () => {
    setLoading(true);
    try {
      const photos: PreTripPhotos = {
        selfie: 'verified',
        vehicleFront: 'verified',
        odometer: 'verified',
        rearSeat: 'verified',
        odometerReading: 0,
        capturedAt: new Date().toISOString(),
      };
      await submitPreTripVerification(activeTrip.id, photos);
      Alert.alert('Verification Complete', 'Proceed to customer pickup location.');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not save pre-trip verification.');
    } finally {
      setLoading(false);
    }
  };

  const handleReachedPickup = async () => {
    setLoading(true);
    try {
      await markReachedPickup(activeTrip.id);
      Alert.alert('Reached Pickup', 'Customer notified that you have arrived.');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not update status.');
    } finally {
      setLoading(false);
    }
  };

  const handleStartWithOtp = async () => {
    if (otpInput.length < 4) {
      Alert.alert('Enter OTP', 'Please enter the 4-digit or 6-digit boarding OTP provided by the passenger.');
      return;
    }
    setLoading(true);
    try {
      await startTripWithOtp(activeTrip.id, otpInput.trim());
      Alert.alert('Trip Started!', 'Drive safely. Destination is set.');
      setOtpInput('');
    } catch (e: any) {
      const code = e?.code || '';
      if (code === 'permission-denied') {
        Alert.alert('Invalid OTP', 'Incorrect OTP entered. Please ask the passenger for the correct code.');
      } else {
        Alert.alert('Error', e.message || 'Could not verify OTP.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleArrivedDest = async () => {
    setLoading(true);
    try {
      await markArrivedDestination(activeTrip.id);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not update arrival.');
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    const odo = parseFloat(endOdoInput) || 0;
    setLoading(true);
    try {
      await completeTrip(activeTrip.id, odo, activeTrip.tolls || []);
      Alert.alert('Trip Completed!', `Earned ${formatINR(activeTrip.driverEarnings)}. Great job!`);
      setEndOdoInput('');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not complete trip.');
    } finally {
      setLoading(false);
    }
  };

  const callCustomer = () => {
    if (activeTrip.customerPhone) {
      Linking.openURL(`tel:${activeTrip.customerPhone}`);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.stageBadge}>
          <Text style={styles.stageText}>{activeTrip.stage}</Text>
        </View>
        <Text style={styles.bookingId}>Booking: {activeTrip.bookingId}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.customerRow}>
          <View>
            <Text style={styles.customerName}>{activeTrip.customerName}</Text>
            <Text style={styles.serviceText}>{activeTrip.vehicleType} • {activeTrip.serviceType || 'Standard'}</Text>
          </View>
          {activeTrip.customerPhone ? (
            <TouchableOpacity style={styles.callBtn} onPress={callCustomer}>
              <Text style={styles.callBtnText}>📞 Call</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.routeLabel}>PICKUP</Text>
        <Text style={styles.routeAddress}>📍 {activeTrip.pickup.address}</Text>
        <View style={styles.divider} />
        <Text style={styles.routeLabel}>DROP</Text>
        <Text style={styles.routeAddress}>🏁 {activeTrip.drop.address}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>Distance: {formatDistance(activeTrip.distanceKm)}</Text>
          <Text style={styles.metaPayout}>Payout: {formatINR(activeTrip.driverEarnings)}</Text>
        </View>
      </View>

      {/* Stage Actions */}
      <View style={styles.actionCard}>
        {activeTrip.stage === 'Assigned' && (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleStartPreTrip} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Start Pre-Trip Verification</Text>}
          </TouchableOpacity>
        )}

        {activeTrip.stage === 'En Route Pickup' && (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleReachedPickup} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>I Have Reached Pickup</Text>}
          </TouchableOpacity>
        )}

        {activeTrip.stage === 'Reached Pickup' && (
          <View>
            <Text style={styles.otpPrompt}>Ask Passenger for Boarding OTP:</Text>
            <TextInput
              style={styles.otpInput}
              value={otpInput}
              onChangeText={setOtpInput}
              placeholder="Enter OTP"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="number-pad"
              maxLength={6}
            />
            <TouchableOpacity style={styles.primaryBtn} onPress={handleStartWithOtp} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Verify OTP & Start Trip</Text>}
            </TouchableOpacity>
          </View>
        )}

        {activeTrip.stage === 'In Progress' && (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleArrivedDest} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Arrived at Destination</Text>}
          </TouchableOpacity>
        )}

        {activeTrip.stage === 'Arrived Destination' && (
          <View>
            <Text style={styles.otpPrompt}>Enter Final Odometer Reading (km):</Text>
            <TextInput
              style={styles.otpInput}
              value={endOdoInput}
              onChangeText={setEndOdoInput}
              placeholder="e.g. 54280"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="number-pad"
            />
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: Colors.online }]} onPress={handleComplete} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Complete Trip & Collect Payment</Text>}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.darkBg },
  content: { padding: 16, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: Colors.darkBg, justifyContent: 'center', alignItems: 'center', padding: 20 },
  emptyIcon: { fontSize: 44, marginBottom: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: Colors.white },
  emptySub: { fontSize: 13, color: Colors.textSecondary, marginTop: 6, textAlign: 'center' },
  header: { marginBottom: 16, paddingTop: 10 },
  stageBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 6,
  },
  stageText: { color: Colors.white, fontSize: 12, fontWeight: '800' },
  bookingId: { color: Colors.textSecondary, fontSize: 13 },
  card: {
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  customerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  customerName: { fontSize: 18, fontWeight: '800', color: Colors.white },
  serviceText: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  callBtn: {
    backgroundColor: '#2C2C2E',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  callBtnText: { color: Colors.white, fontWeight: '700', fontSize: 13 },
  routeLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5 },
  routeAddress: { fontSize: 14, color: Colors.white, fontWeight: '600', marginTop: 2, marginBottom: 8 },
  divider: { height: 1, backgroundColor: '#2C2C2E', marginVertical: 6 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  metaText: { fontSize: 13, color: Colors.textSecondary },
  metaPayout: { fontSize: 15, fontWeight: '800', color: Colors.online },
  actionCard: { marginTop: 10 },
  primaryBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  primaryBtnText: { color: Colors.white, fontSize: 16, fontWeight: '800' },
  otpPrompt: { fontSize: 14, color: Colors.white, fontWeight: '700', marginBottom: 8 },
  otpInput: {
    backgroundColor: '#2C2C2E',
    borderRadius: 10,
    padding: 14,
    color: Colors.white,
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: 4,
  },
});