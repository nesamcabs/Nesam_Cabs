// My bids (reference vBids: All / Open / Allocated / Closed) and Duty details for one available duty.
import React, { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { DetailGrid, Page } from '../../components/shell/Page';
import { useLayout, useWindowWidth } from '../../theme/responsive';
import { Text } from '../../components/kit/Text';
import { colors } from '../../theme';
import { Badge, Between, Btn, Empty, Grid, H2, KV, Notice, Panel, RouteTitle, Small, Tabs } from '../../components/kit/core';
import { Amount, Road } from '../../components/kit/DutyCard';
import { dayText, dayTime, marketFrom, marketPickup, marketTo, marketType, rupees, timeText } from '../../components/kit/format';
import { goSection } from '../../navigation/navigationRef';
import type { RootStackParamList } from '../../navigation/types';
import { bidLabel, bidTone, canAccept, canBid, DutyDialogs, isBidding, isFixed, OPEN_BID, opensToVendorsAt, untilText, useNow, type DutyAction } from './parts';
import type { MarketTrip } from '../../types/operations';

type BidTab = 'All' | 'Open' | 'Allocated' | 'Closed';

export function MyBidsScreen() {
  const navigation = useNavigation();
  const d = useVendorData();
  const [tab, setTab] = useState<BidTab>('All');
  const [action, setAction] = useState<DutyAction | null>(null);
  const group = (s: string): BidTab => (s === OPEN_BID ? 'Open' : s === 'Accepted' ? 'Allocated' : 'Closed');
  const count = (t: BidTab) => d.bids.filter((b) => t === 'All' || group(b.status) === t).length;
  const list = d.bids.filter((b) => tab === 'All' || group(b.status) === tab);
  const bookingFor = (id: string) => d.bookings.find((b) => b.id === id || b.bookingId === id);

  return (
    <Page title="My bids" subtitle="Your quotes and NESAM's decisions.">
      <Tabs value={tab} onChange={setTab} items={(['All', 'Open', 'Allocated', 'Closed'] as BidTab[]).map((id) => ({ id, label: id, count: count(id) }))} />
      {d.errors.bids ? <Notice tone="red" title="Bids could not load" text={d.errors.bids} /> : null}
      {list.length === 0 ? (
        <Empty icon="document-text-outline" title="No bids here" text="Place a bid from an available duty on Trips." action={<Btn kind="secondary" icon="arrow-back" title="Go to Trips" onPress={() => goSection('Trips')} />} />
      ) : (
        <Grid>
          {list.map((b) => {
            const t = d.marketTrips.find((x) => x.id === b.tripId);
            const booking = bookingFor(b.bookingId);
            return (
              <Panel key={b.id}>
                <Between><Small>{t?.bookingId || booking?.bookingId || b.bookingId}</Small><Badge label={bidLabel(b.status)} tone={bidTone(b.status)} /></Between>
                <View style={{ marginTop: 10 }}>
                  {t ? <RouteTitle from={marketFrom(t)} to={marketTo(t)} size={17} /> : booking ? <RouteTitle from={booking.pickupAddress.split(',')[0]} to={booking.dropAddress.split(',')[0]} size={17} /> : <H2>Duty {b.bookingId}</H2>}
                </View>
                {t ? <Small style={{ marginTop: 6 }}>{dayTime(marketPickup(t))} · {t.vehicleCategory} · {marketType(t)}</Small> : null}
                <KV rows={[['Your minimum payout', rupees(b.vendorCounterRate)], ['Current offer', rupees(t?.offeredPayout ?? b.offeredPayout)], ['Submitted', dayTime(b.submittedAt)], b.status === OPEN_BID && t?.cutoffMs ? ['Valid until', dayTime(new Date(t.cutoffMs))] : null]} />
                {b.status === OPEN_BID && !b.autoAcceptConsent ? <Notice tone="amber" title="Action needed" text="Update the bid and confirm the allocation terms." style={{ marginTop: 12 }} /> : null}
                <View style={{ marginTop: 14, flexDirection: 'row' }}>
                  {b.status === 'Accepted' && booking ? <Btn title="Open booking" icon="ticket-outline" onPress={() => navigation.navigate('Booking', { id: booking.id })} />
                    : b.status === OPEN_BID ? <Btn kind="secondary" title="View bid" icon="open-outline" onPress={() => setAction({ kind: 'bid-detail', bid: b })} />
                    : t ? <Btn kind="secondary" title="View duty" icon="open-outline" onPress={() => navigation.navigate('Duty', { id: t.id })} /> : null}
                </View>
              </Panel>
            );
          })}
        </Grid>
      )}
      <DutyDialogs action={action} setAction={setAction} onAccepted={() => goSection('Bookings', { tab: 'Accepted' })} />
    </Page>
  );
}

export function DutyScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'Duty'>>();
  const navigation = useNavigation();
  const d = useVendorData();
  const [action, setAction] = useState<DutyAction | null>(null);
  const t = d.marketTrips.find((x) => x.id === params.id);
  if (!t) {
    const booking = d.bookings.find((b) => b.id === params.id || b.bookingId === params.id);
    return (
      <Page title="Duty details">
        <Empty icon="map-outline" title={booking ? 'This duty is in your bookings' : 'Duty unavailable'}
          text={booking ? 'It has been allocated to your business.' : 'It may have been taken by another partner or withdrawn by NESAM.'}
          action={booking ? <Btn title="Open booking" icon="ticket-outline" onPress={() => navigation.navigate('Booking', { id: booking.id })} /> : <Btn kind="secondary" icon="arrow-back" title="Back to Trips" onPress={() => goSection('Trips')} />} />
      </Page>
    );
  }
  return <DutyDetail t={t} setAction={setAction} action={action} />;
}

/**
 * One available duty, in the same look as its card on the list: the route on the NESAM road with the payout centred under
 * it, then the trip's facts in a centred grid and the charges the payout leaves out. Accept / bid stay pinned at the bottom.
 */
function DutyDetail({ t, action, setAction }: { t: MarketTrip; action: DutyAction | null; setAction: (a: DutyAction | null) => void }) {
  const d = useVendorData();
  const now = useNow();
  const { sideBySide } = useLayout();
  const bid = d.bids.find((b) => b.tripId === t.id && b.status === OPEN_BID);
  const pickup = marketPickup(t);
  const opensAt = opensToVendorsAt(t, d.ops.vendorReleaseSeconds, now);
  const accept = canAccept(t) && !opensAt;
  const bidOpen = canBid(t, now) && !opensAt;
  const payout = t.offeredPayout > 0 ? rupees(t.offeredPayout) : 'Your quote';
  const payLabel = isBidding(t) ? 'Bidding payout' : isFixed(t) ? 'Fixed payout' : 'Vendor payout';
  const payColor = isBidding(t) ? colors.info : isFixed(t) ? colors.success : colors.muted;
  const fromName = marketFrom(t);
  const toName = marketTo(t);
  // The full address goes under the place name when it says more than the name.
  const fromAddress = t.pickup.address && t.pickup.address !== fromName ? t.pickup.address : '';
  const toAddress = t.drop.address && t.drop.address !== toName ? t.drop.address : '';
  const untilMs = pickup ? pickup.getTime() - now : 0;
  const urgent = untilMs > 0 && untilMs < 3 * 3600000;
  const km = t.distanceKm ? `${Math.round(t.distanceKm).toLocaleString('en-IN')} km` : '';
  const terms = isFixed(t) ? 'Allocated to the first eligible partner who accepts.'
    : isBidding(t) && bidOpen ? 'Accept the current payout, or submit your quote for NESAM to review.'
    : '';
  const included = [t.addOns?.roofCarrier ? 'Roof carrier' : '', t.addOns?.pets ? 'Pet travel' : ''].filter(Boolean).join(', ');

  const actions = accept || bid || bidOpen ? (
    <View style={[styles.actions, sideBySide && styles.actionsSide]}>
      {accept ? <Btn kind="accept" title="Accept duty" icon="checkmark-done" onPress={() => setAction({ kind: 'accept', trip: t })} style={{ flex: 1 }} /> : null}
      {bid ? <Btn kind="bid" title={`My bid ${rupees(bid.vendorCounterRate)}`} icon="create-outline" onPress={() => setAction({ kind: 'bid-detail', bid })} style={{ flex: 1 }} />
        : bidOpen ? <Btn kind="bid" title="Place bid" icon="trending-up" onPress={() => setAction({ kind: 'bid', trip: t })} style={{ flex: 1 }} /> : null}
    </View>
  ) : null;

  return (
    <Page title="Duty details" subtitle={t.bookingId} footer={actions}>
      {opensAt ? <Notice tone="amber" icon="time-outline" title="Not yet open for acceptance" text={`This duty opens to partners at ${timeText(new Date(opensAt))}.`} style={{ marginBottom: 12 }} /> : null}
      {isBidding(t) && !bidOpen && !opensAt && !actions ? <Notice tone="neutral" title="Bidding closed" text="This duty is no longer accepting bids." style={{ marginBottom: 12 }} /> : null}

      <DetailGrid
        sideWidth={360}
        main={
          <View style={styles.sheet}>
            <View style={styles.route}>
              <View style={styles.head}>
                <Text style={styles.dutyId} numberOfLines={1}>{t.bookingId}</Text>
                {untilMs > 0 ? (
                  <View style={styles.eta}>
                    <Ionicons name="time-outline" size={14} color={urgent ? colors.warning : colors.muted} />
                    <Text style={[styles.etaText, urgent && { color: colors.warning }]} numberOfLines={1}>Pickup {untilText(untilMs)}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.place, styles.placeTop]}>{fromName}</Text>
              {fromAddress ? <Text style={styles.address} numberOfLines={2}>{fromAddress}</Text> : null}
              <Road distance={km} style={styles.road} />
              <Text style={[styles.place, styles.right]}>{toName}</Text>
              {toAddress ? <Text style={[styles.address, styles.right]} numberOfLines={2}>{toAddress}</Text> : null}
            </View>
            <View style={styles.pay} accessible accessibilityLabel={`${payLabel} ${payout}`}>
              <Text style={[styles.payLabel, { color: payColor }]}>{payLabel.toUpperCase()}</Text>
              <Amount text={payout} big />
              {terms ? <Text style={styles.terms}>{terms}</Text> : null}
            </View>
          </View>
        }
        side={
          <View style={styles.sheet}>
            <FactGrid
              items={[
                ['Pickup date', pickup ? keep(dayText(pickup)) : t.travelDate || '—'],
                ['Pickup time', pickup ? keep(timeText(pickup)) : t.pickup.time || '—'],
                ['Trip type', marketType(t)],
                ['Vehicle', t.vehicleCategory || '—'],
                t.fuelType ? ['Fuel', t.fuelType === 'cng' ? 'CNG' : 'Diesel / Petrol'] : null,
                km ? ['Included km', km] : null,
                t.cutoffMs ? ['Valid until', `${keep(dayText(new Date(t.cutoffMs)))}, ${keep(timeText(new Date(t.cutoffMs)))}`] : null,
                isBidding(t) ? ['Bids', String(t.bidCount)] : null,
              ]}
              wide={[
                t.packageLine ? ['Package', t.packageLine.split(' · ').join('\n')] : null,
                t.via?.length ? ['Tour route', [fromName, ...t.via, toName].join('  →  ')] : null,
                bid ? ['Your bid', `${rupees(bid.vendorCounterRate)} · ${bid.autoAcceptConsent ? 'allocated when the payout reaches this amount' : 'update to confirm allocation terms'}`] : null,
                included ? ['Included in payout', included] : null,
              ]}
            />
            <View style={styles.charges}>
              <Ionicons name="receipt-outline" size={17} color={colors.muted} />
              <Text style={styles.chargesLabel}>NOT INCLUDED IN PAYOUT</Text>
              <Text style={styles.chargesText}>{'Toll, parking, state permit / tax\nand hill charges'}</Text>
              <Text style={styles.chargesNote}>The customer pays these. The driver collects each one and gives a receipt.</Text>
            </View>
          </View>
        }
      />
      <DutyDialogs action={action} setAction={setAction} onAccepted={() => goSection('Bookings', { tab: 'Accepted' })} />
    </Page>
  );
}

type Fact = [string, string] | null;

/** Keeps "28 Nov 2026" or "09:30 AM" on one line (no-break spaces). */
const keep = (text: string) => text.replace(/ /g, '\u00A0');

/**
 * The trip's short facts in rows of up to three (two on very small phones), each centred under its label with hairlines between; the rows are kept
 * as even as possible (four facts make two rows of two). Longer facts (package, tour route) get a full row each.
 */
function FactGrid({ items, wide }: { items: Fact[]; wide: Fact[] }) {
  const perRow = useWindowWidth() < 360 ? 2 : 3;
  const short = items.filter(Boolean) as [string, string][];
  const long = wide.filter(Boolean) as [string, string][];
  const count = Math.ceil(short.length / perRow);
  const rows: [string, string][][] = [];
  for (let r = 0, at = 0; r < count; r += 1) {
    const size = Math.floor(short.length / count) + (r < short.length % count ? 1 : 0);
    rows.push(short.slice(at, at + size));
    at += size;
  }
  return (
    <View>
      {rows.map((row, r) => (
        <View key={r} style={[styles.row, r > 0 && styles.rowLine]}>
          {row.map(([label, value], i) => <FactCell key={label} label={label} value={value} line={i > 0} />)}
        </View>
      ))}
      {long.map(([label, value]) => (
        <View key={label} style={[styles.row, styles.rowLine]}>
          <FactCell label={label} value={value} />
        </View>
      ))}
    </View>
  );
}

function FactCell({ label, value, line }: { label: string; value: string; line?: boolean }) {
  return (
    <View style={[styles.cell, line && styles.cellLine]}>
      <Text style={styles.cellLabel} numberOfLines={1}>{label.toUpperCase()}</Text>
      <Text style={styles.cellValue}>{value}</Text>
    </View>
  );
}

const shadow = Platform.select({ web: { boxShadow: '0 6px 22px rgba(22,32,51,0.07)' } as object, default: { shadowColor: '#162033', shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2 } });
const HAIRLINE = '#EDF0F4';

const styles = StyleSheet.create({
  sheet: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: '#E3E7ED', overflow: 'hidden', ...shadow },
  route: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 20 },
  dutyId: { fontSize: 12, fontWeight: '600', color: colors.muted, letterSpacing: 0.4, flexShrink: 1 },
  eta: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  etaText: { fontSize: 12, fontWeight: '600', color: colors.muted },
  place: { fontSize: 18, fontWeight: '700', color: colors.ink, lineHeight: 24, letterSpacing: -0.3 },
  placeTop: { marginTop: 14 },
  address: { fontSize: 12, color: colors.muted, lineHeight: 17, marginTop: 1 },
  right: { textAlign: 'right' },
  road: { marginTop: 8, marginBottom: 4 },
  pay: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, borderTopWidth: 1, borderTopColor: HAIRLINE, backgroundColor: '#FBFCFD' },
  payLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8 },
  terms: { fontSize: 12, color: colors.muted, lineHeight: 17, textAlign: 'center', marginTop: 2 },
  row: { flexDirection: 'row' },
  rowLine: { borderTopWidth: 1, borderTopColor: HAIRLINE },
  cell: { flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 11, paddingHorizontal: 6 },
  cellLine: { borderLeftWidth: 1, borderLeftColor: HAIRLINE },
  cellLabel: { fontSize: 10, fontWeight: '700', color: colors.muted, letterSpacing: 0.6, textAlign: 'center' },
  cellValue: { fontSize: 13.5, fontWeight: '600', color: colors.ink, lineHeight: 19, textAlign: 'center', marginTop: 3 },
  charges: { alignItems: 'center', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 14, borderTopWidth: 1, borderTopColor: HAIRLINE, backgroundColor: '#FBFCFD' },
  chargesLabel: { fontSize: 10, fontWeight: '700', color: colors.muted, letterSpacing: 0.6, marginTop: 4 },
  chargesText: { fontSize: 13, fontWeight: '600', color: colors.ink, lineHeight: 19, textAlign: 'center', marginTop: 3 },
  chargesNote: { fontSize: 11.5, color: colors.muted, lineHeight: 17, textAlign: 'center', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 10 },
  actionsSide: { width: 360, alignSelf: 'flex-end' },
});
