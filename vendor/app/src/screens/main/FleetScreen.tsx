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
  subscribeToFleetVehicles,
  saveVehicleToFirestore,
} from '../../services/vendorFirestoreService';
import type { FleetVehicle } from '../../types/vendor';

export function FleetScreen() {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(true);

  // Add vehicle modal
  const [showAdd, setShowAdd] = useState(false);
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [category, setCategory] = useState<'Sedan' | 'SUV' | 'Mini' | 'Luxury' | 'Tempo Traveller'>('Sedan');
  const [make, setMake] = useState('Toyota');
  const [model, setModel] = useState('Innova Crysta');
  const [saving, setSaving] = useState(false);

  const vendorId = user?.uid || '';

  useEffect(() => {
    if (!vendorId) return;
    return subscribeToFleetVehicles(vendorId, (data) => {
      setVehicles(data);
      setLoading(false);
    });
  }, [vendorId]);

  const handleAddVehicle = async () => {
    if (!vehicleNumber.trim()) {
      Alert.alert('Invalid', 'Please enter a valid registration number.');
      return;
    }
    setSaving(true);
    try {
      const v: FleetVehicle = {
        id: 'VEH-' + Date.now(),
        vehicleNumber: vehicleNumber.trim().toUpperCase(),
        category,
        make: make.trim(),
        model: model.trim(),
        year: '2023',
        seatingCapacity: category === 'SUV' ? 7 : category === 'Tempo Traveller' ? 12 : 4,
        status: 'Active',
        docStatus: 'Approved',
      };
      await saveVehicleToFirestore(v, vendorId);
      Alert.alert('Vehicle Added', `${v.vehicleNumber} is now registered in your fleet.`);
      setShowAdd(false);
      setVehicleNumber('');
    } catch {
      Alert.alert('Error', 'Could not save vehicle.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>Fleet Management</Text>
          <Text style={s.sub}>{vehicles.length} cabs in your registered fleet</Text>
        </View>
        <Pressable style={s.addBtn} onPress={() => setShowAdd(true)}>
          <Text style={s.addBtnText}>+ Add Cab</Text>
        </Pressable>
      </View>

      <FlatList
        data={vehicles}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 60 }}
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.topRow}>
              <View>
                <Text style={s.vNumber}>{item.vehicleNumber}</Text>
                <Text style={s.vModel}>{item.make} {item.model} · {item.category}</Text>
              </View>
              <View style={[s.badge, item.status === 'Active' ? s.badgeActive : s.badgeTrip]}>
                <Text style={[s.badgeText, item.status === 'Active' ? { color: Colors.online } : { color: Colors.warning }]}>
                  {item.status}
                </Text>
              </View>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaText}>Seats: {item.seatingCapacity} Passengers</Text>
              <Text style={s.metaText}>Driver: {item.assignedDriverName || 'None assigned'}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={s.empty}>
              <Text style={{ fontSize: 44, marginBottom: 12 }}>🚗</Text>
              <Text style={s.emptyTitle}>No Vehicles Added</Text>
              <Text style={s.emptySub}>Add cabs to your fleet to dispatch them on marketplace trips.</Text>
            </View>
          ) : (
            <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 40 }} />
          )
        }
      />

      {/* Add Modal */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Register New Fleet Vehicle</Text>

            <Text style={s.label}>Registration Number *</Text>
            <TextInput
              style={s.input}
              value={vehicleNumber}
              onChangeText={(v) => setVehicleNumber(v.toUpperCase())}
              placeholder="e.g. TN 09 BX 4821"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="characters"
            />

            <Text style={s.label}>Category</Text>
            <View style={s.chipRow}>
              {(['Sedan', 'SUV', 'Mini', 'Luxury', 'Tempo Traveller'] as const).map((c) => (
                <Pressable
                  key={c}
                  style={[s.chip, category === c && s.chipActive]}
                  onPress={() => setCategory(c)}
                >
                  <Text style={[s.chipText, category === c && s.chipTextActive]}>{c}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.label}>Vehicle Model</Text>
            <TextInput
              style={s.input}
              value={model}
              onChangeText={setModel}
              placeholder="e.g. Maruti Dzire / Innova Crysta"
              placeholderTextColor={Colors.textSecondary}
            />

            <View style={s.modalActions}>
              <Pressable style={s.modalCancel} onPress={() => setShowAdd(false)}>
                <Text style={s.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[s.modalSubmit, saving && { opacity: 0.5 }]} onPress={handleAddVehicle} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.modalSubmitText}>Save Vehicle</Text>}
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
  vNumber: { fontSize: 17, fontWeight: '900', color: Colors.white },
  vModel: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeActive: { backgroundColor: '#064E3B' },
  badgeTrip: { backgroundColor: '#78350F' },
  badgeText: { fontSize: 11, fontWeight: '800' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderColor: Colors.border, paddingTop: 8 },
  metaText: { fontSize: 12, color: Colors.textSecondary },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 20 },
  emptyTitle: { color: Colors.white, fontSize: 18, fontWeight: '800' },
  emptySub: { color: Colors.textSecondary, fontSize: 13, marginTop: 4, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.cardBg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.white, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8 },
  input: { backgroundColor: '#2C2C2E', borderRadius: 10, padding: 12, color: Colors.white, fontSize: 15, marginBottom: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { backgroundColor: '#2C2C2E', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  chipActive: { backgroundColor: Colors.primary },
  chipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: Colors.white },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  modalCancel: { flex: 1, paddingVertical: 13, borderRadius: 10, backgroundColor: '#2C2C2E', alignItems: 'center' },
  modalCancelText: { color: Colors.white, fontWeight: '700' },
  modalSubmit: { flex: 2, paddingVertical: 13, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center' },
  modalSubmitText: { color: Colors.white, fontWeight: '800' },
});