import React, { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useInbox } from '../context/Inbox';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import { Badge, EmptyState } from '../components/ui';
import { PenaltyAckModal } from '../components/PenaltyAckModal';
import { formatDateTime12 } from '../utils/time';
import type { PartnerPenalty } from '../types/notifications';
import { colors, radius, space, type } from '../theme';

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const TONE: Record<PartnerPenalty['status'], 'warning' | 'info' | 'success' | 'neutral' | 'danger'> = {
  Pending: 'danger',
  Acknowledged: 'warning',
  Disputed: 'info',
  Paid: 'success',
  Deducted: 'success',
  Waived: 'neutral',
};

export function PenaltiesScreen() {
  const { penalties } = useInbox();
  const [open, setOpen] = useState<PartnerPenalty | null>(null);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoid>
      <FlatList
        data={penalties}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: space.lg }}
        ListEmptyComponent={<EmptyState title="No penalties" message="Penalties issued by NESAM appear here with their status." />}
        renderItem={({ item: p }) => (
          <Pressable
            style={styles.item}
            onPress={() => !p.acknowledged && p.status === 'Pending' && setOpen(p)}
            accessibilityRole="button"
          >
            <View style={styles.head}>
              <Text style={styles.amount}>{rupees(p.amount)}</Text>
              <Badge label={p.status} tone={TONE[p.status]} />
            </View>
            <Text style={type.h3}>{p.category}</Text>
            <Text style={[type.small, { marginTop: 2 }]}>{p.reason}</Text>
            {p.bookingCode ? <Text style={[type.tiny, { marginTop: 4 }]}>Booking {p.bookingCode}</Text> : null}
            <Text style={[type.tiny, { marginTop: 2 }]}>{p.issuedAt ? formatDateTime12(p.issuedAt) : ''}</Text>
            {p.acknowledged && p.acknowledgedAt ? <Text style={[type.tiny, { marginTop: 2 }]}>Acknowledged {formatDateTime12(p.acknowledgedAt)}</Text> : null}
            {p.status === 'Disputed' && p.disputeNote ? <Text style={[type.small, { marginTop: 4 }]}>Your dispute: {p.disputeNote}</Text> : null}
          </Pressable>
        )}
      />
      </KeyboardAvoid>
      {open ? <PenaltyAckModal penalty={open} onDone={() => setOpen(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.md, marginBottom: space.sm },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.xs },
  amount: { fontSize: 20, fontWeight: '900', color: colors.danger },
});
