// The duty as the assigned driver runs it in the NESAM Driver app — assigned, acknowledged, reached pickup, customer
// boarded (OTP), trip started, completed — and, once it ends, the kilometres, tolls and collections recorded.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Badge, Between, H2, KV, Notice, Panel, Small } from '../../components/kit/core';
import { dayTime, rupees, timeText } from '../../components/kit/format';
import type { VendorBooking } from '../../types/operations';
import { colors, fontFamily } from '../../theme';
import { stageOf } from './logic';

/** One-line live status of a running or upcoming duty, from the driver's app. */
export function liveLabel(b: VendorBooking): string {
  const t = b.trip;
  if (b.status === 'Completed') return t.endedAt ? `Completed · ${timeText(t.endedAt)}` : 'Completed';
  if (t.startedAt) return `Trip in progress since ${timeText(t.startedAt)}`;
  if (t.boardingVerifiedAt) return `Customer boarded · ${timeText(t.boardingVerifiedAt)}`;
  if (t.reachedPickupAt) return `Driver at pickup since ${timeText(t.reachedPickupAt)}`;
  if (b.driverResponse?.acknowledgedAt) return 'Driver acknowledged · trip not started';
  if (b.driverResponse?.viewedAt) return 'Driver viewed · acknowledgement pending';
  return b.driverId ? 'Sent to driver · not viewed yet' : '';
}

export function TripTimeline({ b }: { b: VendorBooking }) {
  const t = b.trip;
  const st = stageOf(b);
  const steps: { title: string; at: Date | null; sub?: string; done: boolean }[] = [
    { title: 'Driver & vehicle assigned', at: t.assignedAt, sub: [b.driverName, b.vehicleNumber].filter(Boolean).join(' · '), done: !!b.driverId },
    { title: 'Driver acknowledged', at: b.driverResponse?.acknowledgedAt ?? null, sub: b.driverResponse?.viewedAt && !b.driverResponse.acknowledgedAt ? `Viewed ${dayTime(b.driverResponse.viewedAt)}` : undefined, done: !!b.driverResponse?.acknowledgedAt || !!t.reachedPickupAt || !!t.startedAt },
    { title: 'Reached pickup', at: t.reachedPickupAt, done: !!t.reachedPickupAt || !!t.startedAt },
    { title: 'Customer boarded (OTP verified)', at: t.boardingVerifiedAt, sub: t.vehicleCheck === 'Submitted' ? 'Vehicle photos submitted' : undefined, done: !!t.boardingVerifiedAt || !!t.startedAt },
    { title: 'Trip started', at: t.startedAt, sub: t.startOdometer ? `Start odometer ${t.startOdometer.toLocaleString('en-IN')} km` : undefined, done: !!t.startedAt },
    { title: 'Trip completed', at: t.endedAt, sub: t.totalKm ? `${t.totalKm.toLocaleString('en-IN')} km driven` : undefined, done: st === 'Completed' },
  ];
  const current = steps.findIndex((s) => !s.done);
  const live = st === 'On Trip';
  return (
    <Panel>
      <Between>
        <H2>Trip progress</H2>
        {live ? <View style={styles.live}><View style={styles.liveDot} /><Text style={styles.liveText}>Live</Text></View>
          : <Badge label={st === 'Completed' ? 'Completed' : b.driverId ? 'Upcoming' : 'Not assigned'} tone={st === 'Completed' ? 'green' : 'neutral'} />}
      </Between>
      <Small style={{ marginTop: 4 }}>Updated by the assigned driver in the NESAM Driver app.</Small>
      <View style={{ marginTop: 16 }}>
        {steps.map((s, i) => {
          const on = i === current;
          return (
            <View key={s.title} style={styles.row}>
              <View style={styles.rail}>
                <View style={[styles.dot, s.done && styles.dotDone, on && styles.dotOn]}>
                  {s.done ? <Ionicons name="checkmark" size={12} color={colors.white} /> : null}
                </View>
                {i < steps.length - 1 ? <View style={[styles.line, s.done && { backgroundColor: '#BFDCCB' }]} /> : null}
              </View>
              <View style={{ flex: 1, paddingBottom: i < steps.length - 1 ? 16 : 0 }}>
                <Text style={[styles.title, !s.done && !on && { color: '#8492A4' }, on && { color: colors.primary }]}>{s.title}</Text>
                {s.at ? <Text style={styles.at}>{dayTime(s.at)}</Text> : on ? <Text style={[styles.at, { color: colors.primary }]}>{live || st === 'Upcoming' ? 'Next' : 'Waiting'}</Text> : null}
                {s.sub ? <Text style={styles.sub}>{s.sub}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
    </Panel>
  );
}

/** Kilometres, tolls and collections recorded when the trip ended. */
export function TripSummary({ b }: { b: VendorBooking }) {
  const t = b.trip;
  const p = b.payment;
  const tolls = t.tolls.reduce((n, x) => n + x.amount, 0) || b.tollCharges;
  return (
    <Panel>
      <H2>Trip summary</H2>
      <KV rows={[
        t.totalKm ? ['Total distance (driver entry)', `${t.totalKm.toLocaleString('en-IN')} km`] : null,
        b.includedKm ? ['Included distance', `${b.includedKm} km`] : null,
        t.extraKm ? ['Extra distance', `${t.extraKm} km`] : null,
        t.startOdometer && t.endOdometer ? ['Odometer', `${t.startOdometer.toLocaleString('en-IN')} → ${t.endOdometer.toLocaleString('en-IN')} km`] : null,
        t.startedAt && t.endedAt ? ['Duration', duration(t.startedAt, t.endedAt)] : null,
        tolls ? ['Tolls recorded', rupees(tolls)] : null,
        t.finalFare ? ['Final customer fare', rupees(t.finalFare)] : null,
      ]} />
      {t.tolls.length > 1 ? <Small style={{ marginTop: 8 }}>{t.tolls.map((x) => `${x.name} ${rupees(x.amount)}`).join(' · ')}</Small> : null}
      {t.distanceFlagged ? <Notice tone="amber" title="Distance under office review" text="The kilometres entered and the odometer differ. NESAM confirms the distance before the final bill." style={{ marginTop: 12 }} /> : null}
      {p ? (
        <>
          <H2 style={{ fontSize: 14, marginTop: 18 }}>Collections</H2>
          <KV rows={[
            ['Collected by your driver / business', rupees(p.partnerCashHeld)],
            ['Received by NESAM', rupees(p.companyCollected)],
            p.balanceDue > 0 ? ['Balance due from customer', rupees(p.balanceDue)] : null,
            p.status ? ['Payment status', p.status] : null,
          ]} />
          <Small style={{ marginTop: 8 }}>Money your driver collects is adjusted against your payout at settlement, after office verification.</Small>
        </>
      ) : null}
    </Panel>
  );
}

function duration(a: Date, b: Date): string {
  const min = Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
  const h = Math.floor(min / 60);
  return h ? `${h} h ${min % 60} min` : `${min} min`;
}

const styles = StyleSheet.create({
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFECEA', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  liveText: { fontFamily, fontSize: 10.5, fontWeight: '700', color: '#B42323' },
  row: { flexDirection: 'row', gap: 12 },
  rail: { width: 22, alignItems: 'center' },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#D3DCE7', backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: colors.success, borderColor: colors.success },
  dotOn: { borderColor: colors.primary, borderWidth: 2 },
  line: { flex: 1, width: 2, backgroundColor: '#E3E9F1', marginVertical: 2 },
  title: { fontFamily, fontSize: 13.5, fontWeight: '600', color: colors.ink, marginTop: 1 },
  at: { fontFamily, fontSize: 11.5, color: colors.muted, marginTop: 2 },
  sub: { fontFamily, fontSize: 11.5, color: '#7A8A9D', marginTop: 2 },
});
