import React from 'react';
import {
  Alert,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { Colors } from '../../theme/colors';
import { initials } from '../../utils/format';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY, WHATSAPP_SUPPORT } from '../../config/constants';

export function ProfileScreen() {
  const { user, vendorRecord, signOut } = useAuth();

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const b = vendorRecord?.business;
  const p = vendorRecord?.payoutSummary;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.avatarSection}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials(b?.businessName || b?.vendorName || 'V')}</Text>
          </View>
          <Text style={s.name}>{b?.businessName || 'Fleet Partner'}</Text>
          <Text style={s.phone}>{user?.phoneNumber || ''}</Text>
          <View style={s.badge}>
            <Text style={s.badgeText}>{vendorRecord?.status || 'APPROVED'}</Text>
          </View>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Business Information</Text>
          <Row label="Owner / Contact" value={b?.vendorName || '—'} />
          <Row label="Agency Name" value={b?.businessName || '—'} />
          <Row label="Email" value={b?.email || '—'} />
          <Row label="City" value={b?.address?.city || '—'} />
          <Row label="Office" value={b?.address?.line1 || '—'} />
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Banking & Settlement</Text>
          <Row label="Account Holder" value={p?.accountHolderName || '—'} />
          <Row label="Bank Account" value={p?.bankLast4 ? `**** **** ${p.bankLast4}` : '—'} />
          <Row label="IFSC Code" value={p?.ifsc || '—'} />
          <Row label="UPI ID" value={p?.upiId || '—'} />
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Partner Support</Text>
          <Pressable style={s.supportRow} onPress={() => Linking.openURL(WHATSAPP_SUPPORT)}>
            <Text style={s.supportIcon}>💬</Text>
            <Text style={s.supportText}>WhatsApp Dispatch Support</Text>
          </Pressable>
          <Pressable style={s.supportRow} onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)}>
            <Text style={s.supportIcon}>📞</Text>
            <Text style={s.supportText}>Call Helpline: {SUPPORT_PHONE_DISPLAY}</Text>
          </Pressable>
        </View>

        <Pressable style={s.signOutBtn} onPress={handleSignOut}>
          <Text style={s.signOutText}>Sign Out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowVal}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.darkBg },
  content: { padding: 16, paddingBottom: 40 },
  avatarSection: { alignItems: 'center', paddingVertical: 16 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  avatarText: { fontSize: 26, fontWeight: '900', color: Colors.white },
  name: { fontSize: 20, fontWeight: '900', color: Colors.white },
  phone: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  badge: { backgroundColor: '#064E3B', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, marginTop: 8 },
  badgeText: { color: Colors.online, fontSize: 11, fontWeight: '800' },
  card: {
    backgroundColor: Colors.cardBg,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  cardTitle: { fontSize: 13, fontWeight: '800', color: Colors.textSecondary, letterSpacing: 0.5, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: '#2C2C2E' },
  rowLabel: { fontSize: 13, color: Colors.textSecondary },
  rowVal: { fontSize: 13, fontWeight: '700', color: Colors.white, maxWidth: '60%' },
  supportRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#2C2C2E' },
  supportIcon: { fontSize: 20 },
  supportText: { fontSize: 14, fontWeight: '600', color: Colors.white },
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