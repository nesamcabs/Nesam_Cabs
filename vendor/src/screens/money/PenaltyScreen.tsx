// Penalty notice (reference vPenaltyDetails): duty, reason, calculation and office remarks, with acknowledge / dispute.
// Acknowledging records that the notice was read — it is not an admission, and it can still be disputed.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useInbox } from '../../context/Inbox';
import { useVendorData } from '../../context/VendorData';
import { DetailGrid, Page } from '../../components/shell/Page';
import { PenaltyAckModal } from '../../components/PenaltyAckModal';
import { Badge, Between, BigAmount, Btn, Empty, Eyebrow, H2, KV, Notice, Panel, Small, type Tone } from '../../components/kit/core';
import { dayTime, firstPart, rupees } from '../../components/kit/format';
import { flash } from '../../components/kit/flash';
import { goSection } from '../../navigation/navigationRef';
import type { RootStackParamList } from '../../navigation/types';
import type { PenaltyStatus } from '../../types/notifications';

export const penaltyTone = (s: PenaltyStatus, acknowledged: boolean): Tone =>
  s === 'Waived' ? 'green' : s === 'Deducted' || s === 'Paid' ? 'neutral' : s === 'Disputed' ? 'blue' : acknowledged || s === 'Acknowledged' ? 'amber' : 'red';

const DEDUCTION: Record<PenaltyStatus, string> = {
  Pending: 'Not confirmed · no deduction yet',
  Acknowledged: 'Awaiting office confirmation',
  Disputed: 'On hold while the office reviews your dispute',
  Deducted: 'Confirmed amount debited from the working wallet',
  Paid: 'Paid',
  Waived: 'Waived · no deduction',
};

export function PenaltyScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'Penalty'>>();
  const navigation = useNavigation();
  const { penalties } = useInbox();
  const { bookings } = useVendorData();
  const [open, setOpen] = useState(false);
  const p = penalties.find((x) => x.id === params.id);
  if (!p) {
    return <Page title="Penalty notice"><Empty icon="warning-outline" title="Notice unavailable" text="Open a notice from Wallet → Penalties." action={<Btn kind="secondary" icon="arrow-back" title="Wallet" onPress={() => goSection('Wallet', { tab: 'Penalties' })} />} /></Page>;
  }
  const b = bookings.find((x) => x.id === p.bookingId);
  const needsAck = p.status === 'Pending' && !p.acknowledged;
  const label = needsAck ? 'Acknowledgement required' : p.status;

  const main = (
    <>
      <Panel>
        <Between><Small>{p.bookingCode ? `Duty ${p.bookingCode}` : 'General notice'}</Small><Badge label={label} tone={penaltyTone(p.status, p.acknowledged)} /></Between>
        <H2 style={{ fontSize: 18, marginTop: 10 }}>{b ? `${firstPart(b.pickupAddress)} → ${firstPart(b.dropAddress)}` : p.category}</H2>
        <KV rows={[b ? ['Pickup', b.pickupAt ? dayTime(b.pickupAt) : `${b.date} ${b.time}`] : null, ['Notice issued', dayTime(p.issuedAt)], p.incidentDate ? ['Incident date', p.incidentDate] : null, ['Issued by', p.issuedByName || 'NESAM office']]} />
      </Panel>
      <Panel>
        <H2>Reason & calculation</H2>
        <Small style={{ marginTop: 8, fontSize: 13 }}>{p.category} — {p.reason}</Small>
        {p.description ? <Small style={{ marginTop: 6 }}>{p.description}</Small> : null}
        <KV rows={[['Total penalty', rupees(p.amount)], ['Wallet entry', DEDUCTION[p.status]]]} />
      </Panel>
      {p.status === 'Disputed' && p.disputeNote ? (
        <Panel>
          <H2>Your review request</H2>
          <Small style={{ marginTop: 8 }}>{p.disputeNote}</Small>
          <Notice tone="blue" icon="time-outline" title="Review under way" text="The office will update its decision here." style={{ marginTop: 12 }} />
        </Panel>
      ) : null}
    </>
  );

  const side = (
    <Panel>
      <Eyebrow>PENALTY NOTICE</Eyebrow>
      <BigAmount value={rupees(p.amount)} />
      <Badge label={label} tone={penaltyTone(p.status, p.acknowledged)} />
      <Small style={{ marginTop: 12 }}>Acknowledging records that you viewed this notice. It does not mean you accept the charge.</Small>
      <View style={{ marginTop: 16, gap: 10 }}>
        {needsAck ? <Btn title="Acknowledge or dispute" icon="checkmark-done" full onPress={() => setOpen(true)} />
          : <Notice tone="green" icon="checkmark-done" title="Acknowledged" text={p.acknowledgedAt ? dayTime(p.acknowledgedAt) : 'Viewing recorded'} />}
        {b ? <Btn kind="secondary" icon="ticket-outline" title="Open booking" full onPress={() => navigation.navigate('Booking', { id: b.id })} /> : null}
        <Btn kind="text" title="Questions? 24/7 Helpdesk" onPress={() => goSection('Helpdesk')} />
      </View>
    </Panel>
  );

  return (
    <Page title="Penalty notice" subtitle={p.bookingCode || p.id.slice(0, 10).toUpperCase()}>
      <DetailGrid main={main} side={side} />
      {open ? <PenaltyAckModal penalty={p} onDone={(m) => { setOpen(false); flash(m); }} /> : null}
    </Page>
  );
}
