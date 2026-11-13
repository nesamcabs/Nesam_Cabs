// 24/7 Helpdesk — office support and duty requests (reference vHelpdesk): call the office, quick requests, and the
// vendor's cancellation / bank-change / renewal requests with the office's decision.
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Text } from '../../components/kit/Text';
import { Ionicons } from '@expo/vector-icons';
import { useVendorData } from '../../context/VendorData';
import { Page } from '../../components/shell/Page';
import { Badge, Between, Btn, Empty, Grid, MenuItem, Panel, Small } from '../../components/kit/core';
import { dayTime, rupees } from '../../components/kit/format';
import { Sheet } from '../../components/ui';
import { BankSheet } from './AccountScreen';
import { CancellationSheet } from '../bookings/CancellationSheet';
import { colors, fontFamily } from '../../theme';

const TYPE = { cancellation: 'Cancellation', bank_change: 'Bank change', document_renewal: 'Document renewal' } as const;

export function HelpdeskScreen() {
  const d = useVendorData();
  const navigation = useNavigation();
  const [cancel, setCancel] = useState(false);
  const [choose, setChoose] = useState(false);
  const [bank, setBank] = useState(false);
  const phone = d.ops.supportPhone.replace(/^\+91/, '').replace(/(\d{5})(\d{5})/, '$1 $2');

  return (
    <Page title="24/7 Helpdesk">
      {/* Requests section on top */}
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>My requests</Text>
        <Btn small icon="add" title="New request" onPress={() => setChoose(true)} />
      </View>

      {d.requests.length ? (
        <Grid>
          {d.requests.map((r) => (
            <Panel key={r.id} style={{ flexGrow: 1 }}>
              <Between><Small>{r.bookingCode || r.entityName || r.id.slice(0, 8).toUpperCase()}</Small><Badge label={r.status === 'Pending' ? 'Under review' : r.status} tone={r.status === 'Approved' ? 'green' : r.status === 'Declined' ? 'red' : 'amber'} /></Between>
              <Text style={styles.reqTitle}>{TYPE[r.type]}</Text>
              <Small>{r.type === 'cancellation' ? `${r.route} · ${r.reasonLabel}` : r.type === 'document_renewal' ? `${r.documentLabel} · ${r.entityName} · new expiry ${r.expiry}` : `Account ending ${r.accountLast4} · ${r.ifsc}`}</Small>
              {r.type === 'cancellation' ? <Text style={styles.charge}>{r.status === 'Pending' ? 'Potential charge' : 'Cancellation charge'} {rupees(r.status === 'Approved' ? r.finalPenalty ?? 0 : r.status === 'Declined' ? 0 : r.quotedPenalty)}</Text> : null}
              {r.adminReason ? <Small style={{ marginTop: 6 }}>Office: {r.adminReason}</Small> : null}
              <View style={{ flex: 1 }} />
              <Small style={{ marginTop: 10, color: colors.faint }}>Sent {dayTime(r.requestedAt)}{r.decidedAt ? ` · decided ${dayTime(r.decidedAt)}` : ''}</Small>
            </Panel>
          ))}
        </Grid>
      ) : (
        <Empty
          icon="chatbubbles-outline"
          title="No requests yet"
          text="Your submitted requests will appear here."
        />
      )}

      {/* Office contact card below */}
      <Pressable
        onPress={() => void Linking.openURL(`tel:${d.ops.supportPhone}`)}
        accessibilityRole="button"
        accessibilityLabel={`Call Nesam office ${phone}`}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          styles.support,
          hovered && { borderColor: colors.primary },
          pressed && { opacity: 0.92 },
        ]}
      >
        <View style={styles.supportInfo}>
          <View style={styles.supportIcon}>
            <Ionicons name="headset" size={22} color={colors.primary} />
          </View>
          <View style={{ gap: 2, flexShrink: 1 }}>
            <Text style={styles.supportTitle}>Nesam office</Text>
            <Text style={styles.supportSub} numberOfLines={1}>{phone} · 24/7 support</Text>
          </View>
        </View>
        <View style={styles.callBadge}>
          <Ionicons name="call" size={14} color="#FFFFFF" />
          <Text style={styles.callBadgeText}>Call</Text>
        </View>
      </Pressable>

      {choose ? (
        <Sheet visible onClose={() => setChoose(false)} title="Send a request">
          <Small style={{ marginBottom: 6 }}>The office reviews every request and replies here.</Small>
          <MenuItem icon="close-circle-outline" title="Cancel a duty" sub="Office decision and charge details" onPress={() => { setChoose(false); setCancel(true); }} />
          <MenuItem icon="card-outline" title="Change bank details" sub="Takes effect after office approval" onPress={() => { setChoose(false); setBank(true); }} />
          <MenuItem icon="document-text-outline" title="Renew a document" sub="Upload the renewed document and its new expiry" onPress={() => { setChoose(false); navigation.navigate('Documents'); }} last />
        </Sheet>
      ) : null}
      {bank ? <BankSheet onClose={() => setBank(false)} pending={d.requests.find((r) => r.type === 'bank_change' && r.status === 'Pending')?.accountLast4 ?? ''} summary={d.record.payoutSummary} /> : null}
      {cancel ? <CancellationSheet booking={null} onClose={() => setCancel(false)} /> : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitle: {
    fontFamily,
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
  },
  support: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    backgroundColor: colors.white,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 20,
  },
  supportInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  supportIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  supportTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
  },
  supportSub: {
    fontFamily,
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 1,
  },
  callBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 12,
    marginLeft: 10,
    flexShrink: 0,
  },
  callBadgeText: {
    fontFamily,
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  reqTitle: {
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
    marginTop: 10,
    marginBottom: 3,
  },
  charge: {
    fontFamily,
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.ink,
    marginTop: 8,
  },
});
