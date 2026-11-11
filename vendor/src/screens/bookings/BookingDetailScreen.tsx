// Booking details (reference wTripDetails + s-assignment-entry): route and duty facts, assignment entry, driver response,
// cancellation status, office assistance, and the payout / statement side panel.
import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { useInbox } from '../../context/Inbox';
import { Sheet } from '../../components/ui';
import { DetailGrid, Page } from '../../components/shell/Page';
import { Badge, Between, BigAmount, Btn, Empty, Eyebrow, H2, Inline, KV, Notice, Panel, RouteStack, Small, TextLink } from '../../components/kit/core';
import { dayTime, plate, rupees, tripTypeLabel } from '../../components/kit/format';
import { goSection } from '../../navigation/navigationRef';
import { assignDeadline, type PartnerRequestRecord } from '../../services/partnerOps';
import type { RootStackParamList } from '../../navigation/types';
import { CancellationSheet } from './CancellationSheet';
import { TripSummary, TripTimeline } from './TripTimeline';
import { canChange, payoutOf, SETTLEMENT_LABEL, STAGE_BADGE, stageOf } from './logic';

export function BookingDetailScreen() {
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'Booking'>>();
  const d = useVendorData();
  const { penalties } = useInbox();
  const [sheet, setSheet] = useState<'' | 'cancel' | 'terms'>('');
  const [now] = useState(() => Date.now());
  const b = d.bookings.find((x) => x.id === params.id || x.bookingId === params.id);
  const req = d.requests.find((r) => (r.bookingId === params.id || r.bookingId === b?.id) && r.type === 'cancellation') ?? null;

  if (!b) {
    return (
      <Page title="Booking details" subtitle={req?.bookingCode ?? params.id}>
        <Empty icon="ticket-outline" title={req?.status === 'Approved' ? 'Duty cancelled by NESAM' : 'Booking not found'}
          text={req?.status === 'Approved' ? `${req.adminReason || 'The office approved the cancellation.'} Charge: ${rupees(req.finalPenalty ?? 0)}.` : 'This booking is no longer assigned to your business.'}
          action={<Btn kind="secondary" icon="arrow-back" title="Bookings" onPress={() => goSection('Bookings')} />} />
      </Page>
    );
  }

  const st = stageOf(b);
  const deadline = assignDeadline(b.acceptedAt, b.pickupAt, d.ops, b.assignBy);
  const due = d.dues.find((x) => x.id === b.id) ?? null;
  const fines = penalties.filter((p) => p.bookingId === b.id);
  const [badgeLabel, badgeTone] = STAGE_BADGE[st];

  const main = (
    <>
      <Panel>
        <Between>
          <Inline>{b.tripType ? <Badge label={tripTypeLabel(b.tripType)} /> : null}{b.vehicleCategory ? <Badge label={b.vehicleCategory} /> : null}</Inline>
          <Badge label={badgeLabel} tone={badgeTone} />
        </Between>
        <RouteStack from={b.pickupAddress || '—'} fromSub={`Pickup · ${b.pickupAt ? dayTime(b.pickupAt) : [b.date, b.time].filter(Boolean).join(' · ')}`} to={b.dropAddress || '—'} toSub={b.completedAt ? `Completed · ${dayTime(b.completedAt)}` : 'Drop'} />
        <KV rows={[b.includedKm ? ['Included distance', `${b.includedKm} km`] : null, ['Vehicle category', b.vehicleCategory || '—'], ['Customer', b.customerName || '—'], ['Customer mobile', b.customerPhoneMasked || 'Shared with the driver before pickup'], b.paymentMethod ? ['Customer payment', b.paymentMethod] : null]} />
      </Panel>

      {req && req.status !== 'Approved' ? <CancellationStatus r={req} /> : null}

      {st === 'Accepted' ? (
        <Panel>
          <Between><H2>Driver assignment</H2><Badge label="Pending" tone="amber" /></Between>
          <Small style={{ marginTop: 10 }}>Choose your driver, then the vehicle. Review the duty terms before confirming. The customer sees ‘Driver assigned’ only after you confirm the complete pair.</Small>
          {deadline ? <Notice tone={deadline.getTime() < now ? 'red' : 'amber'} icon="time-outline" title={deadline.getTime() < now ? 'Assignment deadline missed' : `Assign by ${dayTime(deadline)}`} text={`Missing the deadline: ${rupees(d.ops.missedAssignmentPenalty)} after office review.`} style={{ marginTop: 14 }} /> : null}
          <View style={{ marginTop: 16, flexDirection: 'row' }}><Btn title="Assign driver" icon="person-add" onPress={() => navigation.navigate('Assign', { id: b.id })} /></View>
        </Panel>
      ) : b.driverId ? (
        <Panel>
          <Between><H2>{st === 'Upcoming' ? 'Assigned team' : 'Assigned driver & vehicle'}</H2>{st === 'Upcoming' ? <Badge label="Confirmed" tone="green" /> : null}</Between>
          <KV rows={[['Driver', b.driverName || '—'], ['Vehicle', b.vehicleNumber ? plate(b.vehicleNumber) : '—']]} />
          {canChange(b) ? <View style={{ marginTop: 14, flexDirection: 'row' }}><Btn kind="secondary" icon="swap-horizontal" title="Change driver or vehicle" onPress={() => navigation.navigate('Assign', { id: b.id })} /></View> : null}
        </Panel>
      ) : null}

      {b.driverId && st !== 'Cancelled' ? <TripTimeline b={b} /> : null}
      {st === 'Completed' ? <TripSummary b={b} /> : null}

      {st === 'On Trip' ? (
        <Notice tone="neutral" icon="headset-outline" title="Trip in progress" text="Contact the office for any driver or vehicle change during a running trip."
          action={<Btn kind="secondary" small icon="call-outline" title="Call NESAM office" onPress={() => void Linking.openURL(`tel:${d.ops.supportPhone}`)} />} />
      ) : null}

      {canChange(b) && !(req && req.status === 'Pending') ? (
        <Panel>
          <H2>Need office assistance?</H2>
          <Small style={{ marginTop: 6 }}>The duty stays active until the office approves a cancellation.</Small>
          <Inline style={{ marginTop: 14, gap: 16 }}>
            <Btn kind="secondary" icon="close-circle-outline" title="Request cancellation" onPress={() => setSheet('cancel')} />
            <TextLink title="24/7 Helpdesk" onPress={() => goSection('Helpdesk')} />
          </Inline>
        </Panel>
      ) : null}

      {fines.length ? (
        <Panel>
          <H2>Penalty notices</H2>
          {fines.map((p) => (
            <Between key={p.id} style={{ marginTop: 12 }}>
              <View style={{ flex: 1 }}><Small>{p.category} · {rupees(p.amount)}</Small></View>
              <TextLink title="View notice" onPress={() => navigation.navigate('Penalty', { id: p.id })} />
            </Between>
          ))}
        </Panel>
      ) : null}
    </>
  );

  const side = (
    <Panel>
      <Eyebrow>VENDOR PAYOUT</Eyebrow>
      <BigAmount value={rupees(payoutOf(b))} />
      <Small>{b.payoutFinalized ? 'Finalised by NESAM finance' : 'Agreed payout for this duty'}</Small>
      {st === 'Completed' ? (
        <>
          <Inline style={{ marginTop: 14 }}>
            <Badge label={b.paymentStatus === 'Paid' ? 'Final bill closed' : 'Final bill processing'} tone={b.paymentStatus === 'Paid' ? 'green' : 'amber'} />
            <Badge label={due ? SETTLEMENT_LABEL[due.status] ?? due.status : 'Settlement pending'} tone={due && ['Paid', 'Wallet'].includes(due.status) ? 'green' : 'amber'} />
          </Inline>
          <KV rows={[due ? ['Fare retained by driver / vendor', rupees(due.collectedByPartner)] : null, due ? ['Trip adjustment', `${due.amount >= 0 ? '+' : '−'}${rupees(Math.abs(due.amount))}`] : null, b.tollCharges ? ['Toll recorded', rupees(b.tollCharges)] : null]} />
          <View style={{ marginTop: 12, flexDirection: 'row' }}><Btn kind="secondary" small icon="receipt-outline" title="Earnings & statements" onPress={() => goSection('Earnings')} /></View>
        </>
      ) : (
        <Notice tone="neutral" icon="receipt-outline" title="Final accounts after the trip" text="Cash reported by the driver is adjusted only after office verification." style={{ marginTop: 16 }} />
      )}
      <View style={{ marginTop: 18, borderTopWidth: 1, borderTopColor: '#EEF1F5', paddingTop: 14 }}>
        <H2 style={{ fontSize: 13 }}>Included & extra costs</H2>
        <Small style={{ marginTop: 6 }}>{b.includedKm ? `${b.includedKm} km included. ` : ''}Toll, parking and state tax are extra and reimbursed against office-approved receipts.</Small>
        <TextLink title="Accepted duty terms" onPress={() => setSheet('terms')} />
      </View>
    </Panel>
  );

  return (
    <Page title="Booking details" subtitle={b.bookingId}>
      <DetailGrid main={main} side={side} />
      {sheet === 'cancel' ? <CancellationSheet booking={b} onClose={() => setSheet('')} /> : null}
      {sheet === 'terms' ? (
        <Sheet visible onClose={() => setSheet('')} title="Duty terms & penalty details">
          <KV rows={[
            ['Agreed vendor payout', rupees(payoutOf(b))],
            b.includedKm ? ['Included distance', `${b.includedKm} km`] : null,
            ['Assignment deadline', deadline ? dayTime(deadline) : '—'],
            ['Missed assignment deadline', rupees(d.ops.missedAssignmentPenalty)],
            [`Cancellation within ${d.ops.cancellation.graceHours} h of accepting`, rupees(0)],
            [`Cancellation after ${d.ops.cancellation.graceHours} h of accepting`, rupees(d.ops.cancellation.afterGraceCharge)],
            [`Cancellation within ${d.ops.cancellation.lastMinuteHours} h of pickup`, rupees(d.ops.cancellation.lastMinuteCharge)],
          ]} />
          <Small style={{ marginTop: 14 }}>Office-confirmed penalties are recorded in the working wallet. Only the confirmed driver and vehicle can operate the duty. Valid reasons may be waived by the NESAM office.</Small>
        </Sheet>
      ) : null}
    </Page>
  );
}

function CancellationStatus({ r }: { r: PartnerRequestRecord }) {
  const declined = r.status === 'Declined';
  return (
    <Panel style={{ borderColor: '#F0E5CB' }}>
      <Between><H2>{declined ? 'Cancellation request declined' : 'Cancellation under review'}</H2><Badge label={declined ? 'Declined' : 'Pending'} tone="amber" /></Between>
      <Small style={{ marginTop: 8 }}>{declined ? 'This duty remains assigned. No cancellation charge has been deducted.' : 'The duty remains assigned until the office approves. Call NESAM if the pickup is approaching.'}</Small>
      <KV rows={[['Reason', r.reasonLabel], ['Requested', dayTime(r.requestedAt)], [declined ? 'Cancellation charge' : 'Potential charge', rupees(declined ? 0 : r.quotedPenalty)], r.adminReason ? ['Office remarks', r.adminReason] : null]} />
    </Panel>
  );
}
