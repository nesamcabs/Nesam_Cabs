// 24/7 Helpdesk — office support and duty requests (reference vHelpdesk): call the office, quick requests, and the
// vendor's cancellation / bank-change / renewal requests with the office's decision.
import React, { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Text } from '../../components/kit/Text';
import { Ionicons } from '@expo/vector-icons';
import { useVendorData } from '../../context/VendorData';
import { Page } from '../../components/shell/Page';
import { Badge, Between, Btn, Empty, Grid, H2, MenuItem, Panel, SectionLine, Small, Tabs } from '../../components/kit/core';
import { dayTime, rupees } from '../../components/kit/format';
import { goSection } from '../../navigation/navigationRef';
import { CancellationSheet } from '../bookings/CancellationSheet';
import { SUPPORT_EMAIL, WHATSAPP_SUPPORT } from '../../config/constants';
import { colors, fontFamily } from '../../theme';
import { useLayout } from '../../theme/responsive';

const TYPE = { cancellation: 'Cancellation', bank_change: 'Bank change', document_renewal: 'Document renewal' } as const;

export function HelpdeskScreen() {
  const d = useVendorData();
  const { wide } = useLayout();
  const [filter, setFilter] = useState<'Pending' | 'Resolved'>('Pending');
  const [cancel, setCancel] = useState(false);
  const phone = d.ops.supportPhone.replace(/^\+91/, '').replace(/(\d{5})(\d{5})/, '$1 $2');
  const pending = d.requests.filter((r) => r.status === 'Pending');
  const list = filter === 'Pending' ? pending : d.requests.filter((r) => r.status !== 'Pending');

  return (
    <Page title="24/7 Helpdesk">
      <View style={[styles.support, !wide && { flexWrap: 'wrap' }]}>
        <View style={styles.supportIcon}><Ionicons name="headset-outline" size={23} color={colors.primary} /></View>
        <View style={{ flex: 1, minWidth: 180 }}>
          <H2>NESAM office</H2>
          <Small>Duty, transfer and account assistance, any time.</Small>
        </View>
        <Btn icon="call-outline" title={`Call ${phone}`} onPress={() => void Linking.openURL(`tel:${d.ops.supportPhone}`)} style={!wide ? { flexGrow: 1 } : undefined} />
      </View>

      <Grid gap={14}>
        <Panel style={{ paddingVertical: 6, flexGrow: 1 }}>
          <MenuItem icon="close-circle-outline" title="Request cancellation" sub="Office decision and charge details" onPress={() => setCancel(true)} />
          <MenuItem icon="people-outline" title="Change driver or vehicle" sub="Open a booking and update before trip start" onPress={() => goSection('Bookings', { tab: 'Upcoming' })} last />
        </Panel>
        <Panel style={{ paddingVertical: 6, flexGrow: 1 }}>
          <MenuItem icon="swap-horizontal-outline" title="Driver / vehicle linking" sub="Codes and office verification" onPress={() => goSection('Fleet', { tab: 'Vehicles', swap: Date.now() })} />
          <MenuItem icon="logo-whatsapp" title="WhatsApp NESAM" sub={`Or email ${SUPPORT_EMAIL}`} onPress={() => void Linking.openURL(WHATSAPP_SUPPORT)} last />
        </Panel>
      </Grid>

      <View style={{ height: 26 }} />
      <SectionLine title="My requests" meta="Duties stay active until the office approves cancellation." />
      <Tabs value={filter} onChange={setFilter} style={{ marginTop: 0 }} items={[{ id: 'Pending', label: 'Pending', count: pending.length }, { id: 'Resolved', label: 'Resolved', count: d.requests.length - pending.length }]} />
      {list.length ? (
        <Grid>
          {list.map((r) => (
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
        <Empty icon="chatbubbles-outline" title={`No ${filter.toLowerCase()} requests`} text="Cancellation, bank change and document renewal requests appear here with the office decision." />
      )}
      {cancel ? <CancellationSheet booking={null} onClose={() => setCancel(false)} /> : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  support: { flexDirection: 'row', alignItems: 'center', gap: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 15, backgroundColor: colors.card, padding: 22, marginBottom: 18 },
  supportIcon: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  reqTitle: { fontFamily, fontSize: 15, fontWeight: '600', color: colors.ink, marginTop: 10, marginBottom: 3 },
  charge: { fontFamily, fontSize: 12.5, fontWeight: '600', color: colors.ink, marginTop: 8 },
});
