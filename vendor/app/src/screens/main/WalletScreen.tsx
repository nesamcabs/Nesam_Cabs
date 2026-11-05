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
import { formatINR } from '../../utils/format';
import {
  subscribeToVendorPayouts,
  subscribeToVendorWalletBalance,
  submitPayoutRequestToFirestore,
} from '../../services/vendorFirestoreService';
import type { PayoutRequest } from '../../types/vendor';

export function WalletScreen() {
  const { user, vendorRecord } = useAuth();
  const [balance, setBalance] = useState<number>(0);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [showRequest, setShowRequest] = useState(false);
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const vendorId = user?.uid || '';
  const bankInfo = vendorRecord?.payoutSummary;

  useEffect(() => {
    if (!vendorId) return;
    const unsubB = subscribeToVendorWalletBalance(vendorId, setBalance);
    const unsubP = subscribeToVendorPayouts(vendorId, setPayouts);
    return () => {
      unsubB();
      unsubP();
    };
  }, [vendorId]);

  const handleRequestPayout = async () => {
    const num = parseFloat(amount);
    if (!num || num < 500) {
      Alert.alert('Minimum Amount', 'Minimum withdrawal amount is ₹500.');
      return;
    }
    if (num > balance) {
      Alert.alert('Insufficient Balance', 'Amount exceeds your available wallet balance.');
      return;
    }
    setSubmitting(true);
    try {
      const upi = bankInfo?.upiId || 'Bank Transfer';
      const req: PayoutRequest = {
        id: 'PAY-' + Date.now(),
        amount: num,
        requestedAt: new Date().toISOString(),
        payoutMethod: 'UPI',
        targetDetails: upi,
        status: 'Pending',
      };
      await submitPayoutRequestToFirestore(req, vendorId);
      Alert.alert('Payout Requested', 'Your withdrawal request has been submitted to Admin.');
      setShowRequest(false);
      setAmount('');
    } catch {
      Alert.alert('Error', 'Could not request payout.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <FlatList
        data={payouts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
        ListHeaderComponent={
          <>
            <View style={s.header}>
              <Text style={s.title}>Wallet & Payouts</Text>
            </View>

            <View style={s.balanceCard}>
              <Text style={s.balanceLabel}>AVAILABLE SETTLEMENT BALANCE</Text>
              <Text style={s.balanceAmount}>{formatINR(balance)}</Text>
              <Text style={s.balanceSub}>Net earnings from completed customer bookings (post-platform fee).</Text>

              <Pressable
                style={[s.withdrawBtn, balance < 500 && { opacity: 0.5 }]}
                onPress={() => setShowRequest(true)}
                disabled={balance < 500}
              >
                <Text style={s.withdrawBtnText}>Request Withdrawal</Text>
              </Pressable>
            </View>

            <Text style={s.sectionTitle}>Payout History</Text>
          </>
        }
        renderItem={({ item }) => (
          <View style={s.payoutItem}>
            <View>
              <Text style={s.payoutAmount}>{formatINR(item.amount)}</Text>
              <Text style={s.payoutDate}>{item.requestedAt.split('T')[0] || item.requestedAt}</Text>
            </View>
            <View
              style={[
                s.badge,
                item.status === 'Completed' || item.status === 'Approved'
                  ? s.badgeSuccess
                  : item.status === 'Pending'
                  ? s.badgePending
                  : s.badgeRejected,
              ]}
            >
              <Text
                style={[
                  s.badgeText,
                  item.status === 'Completed' || item.status === 'Approved'
                    ? { color: Colors.online }
                    : item.status === 'Pending'
                    ? { color: Colors.warning }
                    : { color: Colors.error },
                ]}
              >
                {item.status}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyText}>No payout requests yet.</Text>
          </View>
        }
      />

      {/* Withdrawal Modal */}
      <Modal visible={showRequest} transparent animationType="slide" onRequestClose={() => setShowRequest(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Request Wallet Payout</Text>
            <Text style={s.modalSub}>Available Balance: {formatINR(balance)}</Text>

            <Text style={s.label}>Amount to Withdraw (Min ₹500)</Text>
            <TextInput
              style={s.input}
              value={amount}
              onChangeText={setAmount}
              placeholder="e.g. 5000"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="numeric"
            />

            <View style={s.bankPreview}>
              <Text style={s.bankPreviewLabel}>Payout Target:</Text>
              <Text style={s.bankPreviewVal}>
                {bankInfo?.upiId ? `UPI: ${bankInfo.upiId}` : `A/C ending with ${bankInfo?.bankLast4 || '...'}`}
              </Text>
            </View>

            <View style={s.modalActions}>
              <Pressable style={s.modalCancel} onPress={() => setShowRequest(false)}>
                <Text style={s.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.modalSubmit, submitting && { opacity: 0.5 }]}
                onPress={handleRequestPayout}
                disabled={submitting}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.modalSubmitText}>Submit Request</Text>}
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
  header: { marginBottom: 16, paddingTop: 10 },
  title: { fontSize: 24, fontWeight: '900', color: Colors.white },
  balanceCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
  },
  balanceLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5 },
  balanceAmount: { fontSize: 34, fontWeight: '900', color: Colors.online, marginVertical: 8 },
  balanceSub: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18, marginBottom: 16 },
  withdrawBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  withdrawBtnText: { color: Colors.white, fontSize: 15, fontWeight: '800' },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: Colors.white, marginBottom: 12 },
  payoutItem: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  payoutAmount: { fontSize: 16, fontWeight: '800', color: Colors.white },
  payoutDate: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeSuccess: { backgroundColor: '#064E3B' },
  badgePending: { backgroundColor: '#78350F' },
  badgeRejected: { backgroundColor: '#7F1D1D' },
  badgeText: { fontSize: 11, fontWeight: '800' },
  empty: { alignItems: 'center', marginTop: 20 },
  emptyText: { color: Colors.textSecondary, fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.cardBg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.white, marginBottom: 4 },
  modalSub: { fontSize: 13, color: Colors.online, fontWeight: '700', marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8 },
  input: { backgroundColor: '#2C2C2E', borderRadius: 10, padding: 14, color: Colors.white, fontSize: 18, fontWeight: '800', marginBottom: 12 },
  bankPreview: { backgroundColor: '#2C2C2E', borderRadius: 8, padding: 10, marginBottom: 16 },
  bankPreviewLabel: { fontSize: 11, color: Colors.textSecondary },
  bankPreviewVal: { fontSize: 13, color: Colors.white, fontWeight: '700', marginTop: 2 },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancel: { flex: 1, paddingVertical: 13, borderRadius: 10, backgroundColor: '#2C2C2E', alignItems: 'center' },
  modalCancelText: { color: Colors.white, fontWeight: '700' },
  modalSubmit: { flex: 2, paddingVertical: 13, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center' },
  modalSubmitText: { color: Colors.white, fontWeight: '800' },
});