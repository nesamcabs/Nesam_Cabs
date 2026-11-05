import React from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { Text } from '../components/nx/Text';
import { useAuth } from '../context/AuthContext';
import { Colors } from '../theme/colors';
import { initials } from '../utils/format';

export default function DriverProfileScreen() {
  const { account, signOut } = useAuth();

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const driver = account?.driver;
  const vehicle = account?.vehicle;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(driver?.name || 'Driver')}</Text>
        </View>
        <Text style={styles.name}>{driver?.name || 'Driver Partner'}</Text>
        <Text style={styles.phone}>{driver?.phone || ''}</Text>
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>{driver?.approvalStatus || 'Pending'} Partner</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Vehicle Details</Text>
        <Row label="Vehicle No." value={vehicle?.vehicleNumber || '—'} />
        <Row label="Type" value={vehicle?.vehicleType || '—'} />
        <Row label="Model" value={`${vehicle?.make || ''} ${vehicle?.model || ''}`.trim() || '—'} />
        <Row label="Capacity" value={`${vehicle?.capacity || 4} Passengers`} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Partner Info</Text>
        <Row label="City" value={driver?.city || '—'} />
        <Row label="Rating" value={`⭐ ${(driver?.rating || 5.0).toFixed(1)}`} />
        <Row label="Partner Since" value={driver?.joiningDate || 'New'} />
        <Row label="Emergency Contact" value={driver?.emergencyContact || '—'} />
      </View>

      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowVal}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.darkBg },
  content: { padding: 16, paddingBottom: 40 },
  avatarSection: { alignItems: 'center', paddingVertical: 20 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  avatarText: { fontSize: 28, fontWeight: '900', color: Colors.white },
  name: { fontSize: 20, fontWeight: '800', color: Colors.white },
  phone: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  statusBadge: {
    marginTop: 8,
    backgroundColor: '#064E3B',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: { color: Colors.online, fontSize: 11, fontWeight: '800' },
  card: {
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#2C2C2E',
  },
  cardTitle: { fontSize: 14, fontWeight: '800', color: Colors.textSecondary, marginBottom: 8, letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#2C2C2E',
  },
  rowLabel: { fontSize: 13, color: Colors.textSecondary },
  rowVal: { fontSize: 13, fontWeight: '700', color: Colors.white },
  signOutBtn: {
    backgroundColor: '#7F1D1D',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  signOutText: { color: Colors.white, fontWeight: '800', fontSize: 15 },
});