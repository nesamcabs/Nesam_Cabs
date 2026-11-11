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
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { Colors } from '../../theme/colors';
import {
  subscribeToFleetDrivers,
  inviteDriverByVendor,
} from '../../services/vendorFirestoreService';
import type { FleetDriver } from '../../types/vendor';

export function DriversScreen() {
  const { user, vendorRecord } = useAuth();
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite driver modal
  const [showInvite, setShowInvite] = useState(false);
  const [driverPhone, setDriverPhone] = useState('');
  const [inviting, setInviting] = useState(false);

  const vendorId = user?.uid || '';
  const vendorName = vendorRecord?.business?.businessName || vendorRecord?.business?.vendorName || 'Fleet Partner';

  useEffect(() => {
    if (!vendorId) return;
    return subscribeToFleetDrivers(vendorId, (data) => {
      setDrivers(data);
      setLoading(false);
    });
  }, [vendorId]);

  const handleInvite = async () => {
    const digits = driverPhone.replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) {
      Alert.alert('Invalid', 'Enter a valid 10-digit mobile number.');
      return;
    }
    setInviting(true);
    try {
      const ok = await inviteDriverByVendor(digits, vendorId, vendorName);
      if (ok) {
        Alert.alert(
          'Driver Pre-Registered!',
          `When +91 ${digits} signs into the NESAM Driver Partner App, they will automatically be linked to your agency fleet.`
        );
        setShowInvite(false);
        setDriverPhone('');
      } else {
        Alert.alert('Error', 'Could not create driver invite.');
      }
    } finally {
      setInviting(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>Driver Partners</Text>
          <Text style={s.sub}>{drivers.length} drivers attached to your vendor agency</Text>
        </View>
        <Pressable style={s.addBtn} onPress={() => setShowInvite(true)}>
          <Text style={s.addBtnText}>+ Link Driver</Text>
        </Pressable>
      </View>

      <FlatList
        data={drivers}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 60 }}
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.topRow}>
              <View>
                <Text style={s.dName}>{item.name}</Text>
                <Text style={s.dPhone}>{item.phone}</Text>
              </View>
              <View style={[s.badge, item.status === 'Available' ? s.badgeAvailable : s.badgeTrip]}>
                <Text style={[s.badgeText, item.status === 'Available' ? { color: Colors.online } : { color: Colors.warning }]}>
                  {item.status}
                </Text>
              </View>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaText}>⭐ {item.rating.toFixed(1)} Rating</Text>
              <Text style={s.metaText}>Assigned: {item.assignedVehicleNumber || 'None'}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={s.empty}>
              <Text style={{ fontSize: 44, marginBottom: 12 }}>👤</Text>
              <Text style={s.emptyTitle}>No Drivers Linked</Text>
              <Text style={s.emptySub}>
                Link your drivers by mobile number. When they sign in, they will appear in your dispatch list.
              </Text>
            </View>
          ) : (
            <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 40 }} />
          )
        }
      />

      {/* Invite Modal */}
      <Modal visible={showInvite} transparent animationType="slide" onRequestClose={() => setShowInvite(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Link Driver to Agency Fleet</Text>
            <Text style={s.modalSub}>
              Enter the driver's phone number. Once verified, they will be able to drive for your agency.
            </Text>

            <Text style={s.label}>Driver Mobile Number (10 digits) *</Text>
            <TextInput
              style={s.input}
              value={driverPhone}
              onChangeText={(v) => setDriverPhone(v.replace(/\D/g, '').slice(0, 10))}
              placeholder="e.g. 9845012345"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="phone-pad"
              maxLength={10}
            />

            <View style={s.modalActions}>
              <Pressable style={s.modalCancel} onPress={() => setShowInvite(false)}>
                <Text style={s.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[s.modalSubmit, inviting && { opacity: 0.5 }]} onPress={handleInvite} disabled={inviting}>
                {inviting ? <ActivityIndicator color="#fff" /> : <Text style={s.modalSubmitText}>Pre-Register Driver</Text>}
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
  header: {
    padding: 16,
    paddingTop: 12,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 24, fontWeight: '900', color: Colors.white },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  addBtn: { backgroundColor: Colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  addBtnText: { color: Colors.white, fontWeight: '800', fontSize: 13 },
  card: { backgroundColor: Colors.cardBg, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  dName: { fontSize: 16, fontWeight: '800', color: Colors.white },
  dPhone: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeAvailable: { backgroundColor: '#064E3B' },
  badgeTrip: { backgroundColor: '#78350F' },
  badgeText: { fontSize: 11, fontWeight: '800' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderColor: Colors.border, paddingTop: 8 },
  metaText: { fontSize: 12, color: Colors.textSecondary },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 20 },
  emptyTitle: { color: Colors.white, fontSize: 18, fontWeight: '800' },
  emptySub: { color: Colors.textSecondary, fontSize: 13, marginTop: 4, textAlign: 'center', lineHeight: 18 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.cardBg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.white, marginBottom: 6 },
  modalSub: { fontSize: 13, color: Colors.textSecondary, marginBottom: 16, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8 },
  input: { backgroundColor: '#2C2C2E', borderRadius: 10, padding: 12, color: Colors.white, fontSize: 16, fontWeight: '700', marginBottom: 14, letterSpacing: 2 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  modalCancel: { flex: 1, paddingVertical: 13, borderRadius: 10, backgroundColor: '#2C2C2E', alignItems: 'center' },
  modalCancelText: { color: Colors.white, fontWeight: '700' },
  modalSubmit: { flex: 2, paddingVertical: 13, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center' },
  modalSubmitText: { color: Colors.white, fontWeight: '800' },
});