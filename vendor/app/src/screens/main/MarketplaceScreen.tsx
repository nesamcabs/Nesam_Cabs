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
import { formatINR, formatDistance } from '../../utils/format';
import {
  subscribeToOpenMarketplaceTrips,
  submitBidToFirestore,
} from '../../services/vendorFirestoreService';
import type { OpenTrip, BidProposal } from '../../types/vendor';

export function MarketplaceScreen() {
  const { user, vendorRecord } = useAuth();
  const [trips, setTrips] = useState<OpenTrip[]>([]);
  const [loading, setLoading] = useState(true);

  // Bidding modal
  const [selectedTrip, setSelectedTrip] = useState<OpenTrip | null>(null);
  const [counterRate, setCounterRate] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const vendorId = user?.uid || '';
  const vendorName = vendorRecord?.business?.businessName || vendorRecord?.business?.vendorName || 'Vendor Partner';

  useEffect(() => {
    return subscribeToOpenMarketplaceTrips((data) => {
      setTrips(data);
      setLoading(false);
    });
  }, []);

  const openBidModal = (t: OpenTrip) => {
    setSelectedTrip(t);
    setCounterRate(String(t.offeredPayout));
    setNote('');
  };

  const handleClaim = async (t: OpenTrip) => {
    Alert.alert(
      'Accept Payout Rate?',
      `Claim this trip at the offered payout of ${formatINR(t.offeredPayout)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept Trip',
          onPress: async () => {
            const bid: BidProposal = {
              id: 'BID-' + Date.now(),
              tripId: t.id,
              bookingId: t.bookingId,
              offeredPayout: t.offeredPayout,
              vendorCounterRate: t.offeredPayout,
              biddingNote: 'Accepted standard payout',
              submittedAt: new Date().toISOString(),
              status: 'Accepted',
            };
            const ok = await submitBidToFirestore(bid, vendorId, vendorName);
            if (ok) {
              Alert.alert('Trip Claimed!', 'Dispatch a driver and vehicle from Trip Assignments.');
            } else {
              Alert.alert('Error', 'Could not claim trip. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleCounterBid = async () => {
    if (!selectedTrip) return;
    const rate = parseFloat(counterRate);
    if (!rate || rate <= 0) {
      Alert.alert('Invalid', 'Please enter a valid counter rate.');
      return;
    }
    setSubmitting(true);
    try {
      const bid: BidProposal = {
        id: 'BID-' + Date.now(),
        tripId: selectedTrip.id,
        bookingId: selectedTrip.bookingId,
        offeredPayout: selectedTrip.offeredPayout,
        vendorCounterRate: rate,
        biddingNote: note.trim(),
        submittedAt: new Date().toISOString(),
        status: 'Pending Review',
      };
      const ok = await submitBidToFirestore(bid, vendorId, vendorName);
      if (ok) {
        Alert.alert('Bid Submitted', 'Your proposal has been submitted to Admin dispatch.');
        setSelectedTrip(null);
      } else {
        Alert.alert('Error', 'Could not submit proposal.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <Text style={s.title}>Open Marketplace</Text>
        <Text style={s.sub}>{trips.length} customer bookings available for dispatch</Text>
      </View>

      <FlatList
        data={trips}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }}
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.topRow}>
              <View style={s.categoryBadge}>
                <Text style={s.categoryText}>{item.vehicleCategory}</Text>
              </View>
              <Text style={s.payoutText}>{formatINR(item.offeredPayout)}</Text>
            </View>

            <View style={s.routeBox}>
              <Text style={s.routePoint}>🟢 {item.pickup.address}, {item.pickup.city}</Text>
              <View style={s.routeLine} />
              <Text style={s.routePoint}>🔴 {item.drop.address}, {item.drop.city}</Text>
            </View>

            <View style={s.metaRow}>
              <Text style={s.metaText}>📅 {item.travelDate} ({item.pickup.time || 'Flexible'})</Text>
              <Text style={s.metaText}>📏 {formatDistance(item.distanceKm)}</Text>
            </View>

            <View style={s.btnRow}>
              <Pressable style={s.counterBtn} onPress={() => openBidModal(item)}>
                <Text style={s.counterBtnText}>Counter Bid</Text>
              </Pressable>
              <Pressable style={s.claimBtn} onPress={() => handleClaim(item)}>
                <Text style={s.claimBtnText}>Claim Trip</Text>
              </Pressable>
            </View>
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={s.empty}>
              <Text style={{ fontSize: 44, marginBottom: 12 }}>🚗</Text>
              <Text style={s.emptyTitle}>No Open Trips</Text>
              <Text style={s.emptySub}>All customer requests are currently assigned.</Text>
            </View>
          ) : (
            <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 40 }} />
          )
        }
      />

      {/* Counter Bid Modal */}
      <Modal visible={!!selectedTrip} transparent animationType="slide" onRequestClose={() => setSelectedTrip(null)}>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Submit Counter Proposal</Text>
            <Text style={s.modalSub}>
              Offered Payout: <Text style={{ color: Colors.online, fontWeight: '700' }}>{formatINR(selectedTrip?.offeredPayout || 0)}</Text>
            </Text>

            <Text style={s.label}>Your Proposed Payout (₹)</Text>
            <TextInput
              style={s.input}
              value={counterRate}
              onChangeText={setCounterRate}
              keyboardType="numeric"
              placeholder="Enter amount"
              placeholderTextColor={Colors.textSecondary}
            />

            <Text style={s.label}>Note for Admin (optional)</Text>
            <TextInput
              style={[s.input, { height: 60 }]}
              value={note}
              onChangeText={setNote}
              placeholder="e.g. Innova Crysta ready for immediate dispatch"
              placeholderTextColor={Colors.textSecondary}
              multiline
            />

            <View style={s.modalActions}>
              <Pressable style={s.modalCancel} onPress={() => setSelectedTrip(null)}>
                <Text style={s.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[s.modalSubmit, submitting && { opacity: 0.6 }]} onPress={handleCounterBid} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.modalSubmitText}>Submit Bid</Text>}
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
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  categoryBadge: { backgroundColor: '#3A1C1C', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  categoryText: { color: Colors.primary, fontSize: 12, fontWeight: '800' },
  payoutText: { color: Colors.online, fontSize: 20, fontWeight: '900' },
  routeBox: { marginBottom: 12 },
  routePoint: { color: Colors.white, fontSize: 13, fontWeight: '600' },
  routeLine: { width: 1, height: 12, backgroundColor: Colors.border, marginLeft: 6, marginVertical: 3 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderColor: Colors.border, paddingTop: 10, marginBottom: 12 },
  metaText: { color: Colors.textSecondary, fontSize: 12 },
  btnRow: { flexDirection: 'row', gap: 10 },
  counterBtn: {
    flex: 1,
    backgroundColor: '#2C2C2E',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  counterBtnText: { color: Colors.white, fontSize: 14, fontWeight: '700' },
  claimBtn: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  claimBtnText: { color: Colors.white, fontSize: 14, fontWeight: '800' },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 20 },
  emptyTitle: { color: Colors.white, fontSize: 18, fontWeight: '800' },
  emptySub: { color: Colors.textSecondary, fontSize: 13, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.cardBg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.white, marginBottom: 4 },
  modalSub: { fontSize: 13, color: Colors.textSecondary, marginBottom: 16 },
  label: { fontSize: 12, color: Colors.textSecondary, fontWeight: '700', marginBottom: 6 },
  input: { backgroundColor: '#2C2C2E', borderRadius: 10, padding: 12, color: Colors.white, fontSize: 15, marginBottom: 12 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modalCancel: { flex: 1, paddingVertical: 13, borderRadius: 10, backgroundColor: '#2C2C2E', alignItems: 'center' },
  modalCancelText: { color: Colors.white, fontWeight: '700' },
  modalSubmit: { flex: 1, paddingVertical: 13, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center' },
  modalSubmitText: { color: Colors.white, fontWeight: '800' },
});