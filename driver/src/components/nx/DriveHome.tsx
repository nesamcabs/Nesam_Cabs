// The Drive page with no local duty running: a full-screen map with the driver's car on it, a location chip, the Local
// Online / Offline switch, the next assigned duty, and a bottom sheet. GO simply puts the driver online (the same duty
// status as everywhere else): live local requests then appear in the sheet with a 15 second timer — Accept takes the duty
// (claimMarketplaceDuty, decided by the server), Decline moves to the next one. A fleet driver stays online for the fleet,
// which assigns trips; a planned fleet duty opens the duty card instead (LocalTaxiScreen).
// Without a GPS fix the map shows a Tamil Nadu demo position, labelled as such.
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { Text } from './Text';
import { NxIcon } from './Icon';
import { NxMapScreen, useShell } from './Shell';
import { DutyDialog } from './Duties';
import { LiveMap, type MapData } from './LiveMap';
import { NxBadge, NxButton, NxRouteStack, placeName } from './primitives';
import { tripIsActive } from './tripFormat';
import { useDriverData } from '../../context/DriverData';
import { useNow } from '../../hooks/useNow';
import { usePresence } from '../../hooks/usePresence';
import { acceptMarketplaceTrip, DriverActionError } from '../../services/driverService';
import { categoryMatches } from '../../utils/earnings';
import { formatINR } from '../../utils/format';
import { describeError } from '../../utils/retry';
import { timePackageLine } from '../../utils/timePackage';
import { getCurrentPosition, reverseCity, watchPosition, type DevicePosition } from '../../services/locationService';
import type { DocumentStatus, MarketplaceOffer, TripDetails } from '../../types/driver';
import { formatTime12 } from '../../utils/time';
import { nx } from '../../theme/nx';

/** Shown on the map until the phone gives a position. */
const DEMO = { lat: 9.9252, lng: 78.1198, city: 'Madurai' };
const TZ = 'Asia/Kolkata';
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });

/** "Today", "Tomorrow", else "21 Nov". */
export function dutyDay(d: Date | null | undefined, now: number): string {
  if (!d) return '';
  if (dayKey(d) === dayKey(new Date(now))) return 'Today';
  if (dayKey(d) === dayKey(new Date(now + 24 * 3600000))) return 'Tomorrow';
  return d.toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short' });
}

/** "6:00 PM · Madurai → Theni" (a rental has no drop). */
export function dutyLine(t: TripDetails): string {
  const time = t.pickupAt ? formatTime12(t.pickupAt) : '';
  const from = placeName(t.pickup.address);
  const to = t.localMode === 'rental' || !t.drop.address ? '' : placeName(t.drop.address);
  return [time, to ? `${from} → ${to}` : from].filter(Boolean).join(' · ');
}

const REQUEST_SECONDS = 15;
type Service = 'all' | 'pickup' | 'rental';
const SERVICE_BUTTONS: [Service, string][] = [['all', 'All local'], ['pickup', 'Pickup & Drop'], ['rental', 'Rental']];
/** A live offer is an Hourly Rental or a local Pickup & Drop. */
const serviceOf = (o: MarketplaceOffer): Service => (o.tripType === 'Local Rental' ? 'rental' : 'pickup');

const DOC: Record<DocumentStatus, { label: string; color: string; icon: 'shield' | 'clock' | 'alert' }> = {
  Approved: { label: 'Verified', color: nx.green, icon: 'shield' },
  Pending: { label: 'In review', color: nx.amber, icon: 'clock' },
  Rejected: { label: 'Action needed', color: nx.red, icon: 'alert' },
};

export function DriveHome({ onRefresh }: { onRefresh: () => void }) {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const { notify } = useShell();
  const { account, nextTrip, activeTrip, offers } = useDriverData();
  const { driver, vehicle } = account;
  const presence = usePresence(notify);
  const fleet = !!driver.vendorId;
  const now = useNow(1000);
  const [fix, setFix] = useState<DevicePosition | null>(null);
  const [city, setCity] = useState('');
  const [recentre, setRecentre] = useState(0);
  const [service, setService] = useState<Service>('all');
  const [skipped, setSkipped] = useState<string[]>([]);
  const [detail, setDetail] = useState<MarketplaceOffer | null>(null);
  const [accepting, setAccepting] = useState(false);

  // The request in front of the driver: the first live offer for their vehicle and chosen service they have not skipped.
  const request = fleet || !presence.online ? null : offers.find((o) => !skipped.includes(o.id) && categoryMatches(o.vehicleCategory, vehicle.vehicleType) && (service === 'all' || serviceOf(o) === service)) ?? null;
  const requestId = request?.id ?? '';
  // The 15 second countdown restarts for each request (and after the details dialog closes); state is derived while rendering.
  const timerKey = `${requestId}|${detail ? 1 : 0}`;
  const [timer, setTimer] = useState({ key: '', at: 0 });
  if (timer.key !== timerKey) setTimer({ key: timerKey, at: now });
  const left = request && !detail ? Math.max(0, REQUEST_SECONDS - Math.floor((now - timer.at) / 1000)) : REQUEST_SECONDS;
  useEffect(() => {
    if (!requestId || detail) return undefined;
    const t = setTimeout(() => {
      setSkipped((l) => [...l, requestId]);
      notify('ok', 'Request expired. You are still online.');
    }, REQUEST_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [requestId, detail, notify]);

  const toggleOnline = () => {
    setSkipped([]);
    if (presence.locked) return notify('error', 'Finish your current trip before changing your duty status.');
    return void presence.toggle().then(() => undefined);
  };
  const accept = async (o: MarketplaceOffer) => {
    if (accepting) return;
    setAccepting(true);
    try {
      await acceptMarketplaceTrip(driver, vehicle.vehicleNumber, o);
      notify('ok', 'Duty assigned. Take the vehicle photos before you head to the pickup.');
      navigation.navigate('TripFlow', { bookingId: o.bookingId || o.id });
    } catch (e) {
      notify('error', e instanceof DriverActionError ? e.message : describeError(e, 'This duty is no longer available.'));
    } finally {
      setAccepting(false);
    }
  };

  // The car follows the phone while this page is on screen; with no fix the map stays on the demo position.
  useEffect(() => {
    if (!focused) return undefined;
    return watchPosition(setFix, () => undefined);
  }, [focused]);

  const cell = fix ? `${fix.lat.toFixed(2)},${fix.lng.toFixed(2)}` : '';
  useEffect(() => {
    if (!cell) return undefined;
    const [lat, lng] = cell.split(',').map(Number) as [number, number];
    let alive = true;
    reverseCity(lat, lng).then((c) => alive && setCity(c));
    return () => {
      alive = false;
    };
  }, [cell]);

  const live = !!fix;
  const place = live ? city || driver.city || 'Your location' : DEMO.city;
  const data = useMemo<MapData>(
    () => ({ me: live ? { lat: fix!.lat, lng: fix!.lng } : { lat: DEMO.lat, lng: DEMO.lng }, markers: [], lines: [], area: null, fitKey: `${live ? 'gps' : 'demo'}|${recentre}`, meStyle: 'car', plain: true }),
    [live, fix, recentre],
  );

  const locate = async () => {
    try {
      setFix(await getCurrentPosition(8000));
    } catch (e) {
      notify('error', e instanceof Error && e.message ? e.message : 'Could not get your location.');
    }
    setRecentre((n) => n + 1);
  };

  const doc = DOC[driver.docStatus] ?? DOC.Approved;
  const model = [vehicle.make, vehicle.model].filter(Boolean).join(' ');
  const vehicleLine = [model, vehicle.vehicleType].filter(Boolean).join(' · ') || (driver.vendorId ? 'Vehicle assigned by your fleet' : 'Vehicle details not added');

  const state: 'offline' | 'online' | 'busy' = activeTrip ? 'busy' : presence.online ? 'online' : 'offline';

  const overlay = (
    <>
      <View style={styles.topRow}>
        <View style={[styles.card, styles.place]} accessibilityLabel={`${place}. ${live ? 'Live location' : 'Demo map'}`}>
          <NxIcon name="pin" size={20} color={nx.red} />
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text style={styles.placeName} numberOfLines={1}>
              {place}
            </Text>
            <Text style={styles.placeNote} numberOfLines={1}>
              {live ? 'LIVE LOCATION' : 'DEMO MAP · TAMIL NADU'}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={toggleOnline}
          disabled={presence.busy}
          style={[styles.card, styles.pill, presence.busy && { opacity: 0.6 }, state === 'busy' && styles.pillBusy, state === 'online' && styles.pillOnline]}
          accessibilityRole="switch"
          accessibilityState={{ checked: presence.online, disabled: presence.busy }}
          accessibilityLabel={presence.locked ? 'Duty status locked during a trip' : presence.online ? 'Local online. Go offline' : 'Local offline. Go online'}
        >
          <View style={[styles.pillDot, state === 'online' && { backgroundColor: nx.green }, state === 'busy' && { backgroundColor: nx.red }]} />
          <Text style={[styles.pillText, state === 'online' && { color: nx.green }, state === 'busy' && { color: nx.red }]}>{state === 'busy' ? 'On trip' : state === 'online' ? 'Local Online' : 'Local Offline'}</Text>
        </Pressable>
      </View>
      {nextTrip ? (
        <Pressable
          onPress={() => navigation.navigate('TripFlow', { bookingId: nextTrip.id })}
          style={({ pressed }) => [styles.card, styles.duty, pressed && { opacity: 0.92 }]}
          accessibilityRole="button"
          accessibilityLabel={`${tripIsActive(nextTrip) ? 'Current duty' : 'Next assigned duty'}, ${dutyDay(nextTrip.pickupAt, now)}. ${dutyLine(nextTrip)}. View`}
        >
          <View style={styles.dutyIcon}>
            <NxIcon name="calendar" size={18} color={nx.red} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.dutyLabel} numberOfLines={1}>
              {tripIsActive(nextTrip) ? 'Current duty' : 'Next assigned duty'}
              {nextTrip.pickupAt ? ` · ${dutyDay(nextTrip.pickupAt, now)}` : ''}
            </Text>
            <Text style={styles.dutyLine} numberOfLines={1}>
              {dutyLine(nextTrip)}
            </Text>
          </View>
          <Text style={styles.dutyView}>View ›</Text>
        </Pressable>
      ) : null}
    </>
  );

  const floating = (
    <Pressable onPress={() => void locate()} style={({ pressed }) => [styles.card, styles.locate, pressed && { opacity: 0.9 }]} accessibilityRole="button" accessibilityLabel="Centre the map on my location">
      <NxIcon name="locate" size={21} color={nx.ink} />
    </Pressable>
  );

  return (
    <>
      <NxMapScreen map={() => <LiveMap data={data} fill label="Drive map" />} overlay={overlay} floating={floating} status={false}>
        <View style={styles.vehicleRow}>
          <View style={styles.vehicleIcon}>
            <NxIcon name="car" size={22} color={nx.muted} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.plate} numberOfLines={1}>
              {vehicle.vehicleNumber || (driver.vendorId ? 'Assigned by fleet' : 'No vehicle')}
            </Text>
            <Text style={styles.vehicleLine} numberOfLines={1}>
              {vehicleLine}
            </Text>
          </View>
          <View style={styles.verified}>
            <NxIcon name={doc.icon} size={14} color={doc.color} />
            <Text style={[styles.verifiedText, { color: doc.color }]}>{doc.label}</Text>
          </View>
        </View>

        {activeTrip ? (
          <>
            <View style={styles.readyRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.live}>Duty in progress</Text>
                <Text style={styles.ready} numberOfLines={2}>
                  {placeName(activeTrip.pickup.address)} → {placeName(activeTrip.drop.address)}
                </Text>
                <Text style={styles.readyNote}>Local requests are paused while you are on this duty.</Text>
              </View>
            </View>
            <NxButton title="Resume duty" trailingIcon="arrow" onPress={() => navigation.navigate('TripFlow', { bookingId: activeTrip.id })} style={{ marginTop: 16 }} />
          </>
        ) : request ? (
          <RequestPanel
            offer={request}
            left={left}
            busy={accepting}
            onDecline={() => {
              setSkipped((l) => [...l, request.id]);
              notify('ok', 'Request declined. You are still online.');
            }}
            onAccept={() => (request.mode === 'bid_review' ? setDetail(request) : void accept(request))}
            onDetails={() => setDetail(request)}
          />
        ) : (
          <>
            <View style={styles.readyRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                {presence.online ? (
                  <View style={styles.liveRow}>
                    <View style={styles.pulse} />
                    <Text style={styles.live}>{fleet ? 'Available to your fleet' : 'Ready for nearby requests'}</Text>
                  </View>
                ) : null}
                <Text style={styles.ready}>{presence.online ? 'You’re online' : 'Ready when you are.'}</Text>
                <Text style={styles.readyNote}>
                  {presence.online
                    ? fleet
                      ? `${driver.vendorName || 'Your fleet'} assigns your trips. They appear in My Trips.`
                      : 'Local Pickup & Drop and Hourly Rental.'
                    : 'Go online to receive local rides and hourly rentals.'}
                </Text>
              </View>
              <Pressable
                onPress={toggleOnline}
                disabled={presence.busy}
                style={({ pressed }) => [styles.goRing, (pressed || presence.busy) && { opacity: 0.8 }]}
                accessibilityRole="button"
                accessibilityLabel={presence.online ? 'Go offline for local requests' : 'Go online for local requests'}
              >
                <View style={styles.go}>{presence.online ? <NxIcon name="power" size={28} color={nx.white} /> : <Text style={styles.goText}>GO</Text>}</View>
              </Pressable>
            </View>
            {presence.online && !fleet ? (
              <View style={styles.controls}>
                <View style={styles.services}>
                  {SERVICE_BUTTONS.map(([k, label]) => (
                    <Pressable key={k} onPress={() => { setService(k); setSkipped([]); }} style={[styles.service, service === k && styles.serviceOn]} accessibilityRole="radio" accessibilityState={{ selected: service === k }}>
                      <Text style={[styles.serviceText, service === k && { color: nx.red, fontWeight: '700' }]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable onPress={() => { setSkipped([]); notify('ok', 'Checking for nearby requests…'); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Check for requests again">
                  <NxIcon name="refresh" size={17} color={nx.red} />
                </Pressable>
              </View>
            ) : null}
            {!presence.online ? <Text style={styles.footnote}>Bookings and assigned trips are available while offline.</Text> : null}
          </>
        )}
      </NxMapScreen>
      <DutyDialog offer={detail} onClose={() => setDetail(null)} onAccepted={(o) => navigation.navigate('TripFlow', { bookingId: o.bookingId || o.id })} />
    </>
  );
}

function RequestPanel({ offer, left, busy, onDecline, onAccept, onDetails }: { offer: MarketplaceOffer; left: number; busy: boolean; onDecline: () => void; onAccept: () => void; onDetails: () => void }) {
  const rental = serviceOf(offer) === 'rental';
  const bid = offer.mode === 'bid_review';
  return (
    <View>
      <View style={styles.reqTop}>
        <View style={styles.reqTitle}>
          <NxIcon name={rental ? 'clock' : 'pin'} size={15} color={nx.red} />
          <Text style={styles.reqTitleText}>{rental ? 'Hourly Rental' : 'Local Pickup & Drop'}</Text>
        </View>
        <Text style={styles.reqTimer}>{left}s</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.trackFill, { width: `${Math.min(100, (left / REQUEST_SECONDS) * 100)}%` }]} />
      </View>
      <View style={styles.reqPrice}>
        <View>
          <Text style={styles.reqSmall}>{bid ? 'NESAM offer' : 'Your payout'}</Text>
          <Text style={styles.reqAmount}>{formatINR(offer.offeredPayout)}</Text>
        </View>
        <NxBadge label={offer.vehicleCategory || 'Any vehicle'} tone="neutral" icon="car" />
      </View>
      <NxRouteStack pickup={offer.pickup.address} drop={rental ? '' : offer.drop.address} compact />
      {offer.timePackage ? <NxBadge label={timePackageLine(offer.timePackage)} tone="neutral" icon="clock" style={{ marginTop: 6 }} /> : null}
      <Pressable onPress={onDetails} hitSlop={6} accessibilityRole="button" style={{ alignSelf: 'flex-end', marginTop: 4 }}>
        <Text style={styles.reqMore}>Details</Text>
      </Pressable>
      <View style={styles.reqActions}>
        <NxButton title="Decline" variant="secondary" onPress={onDecline} style={{ flex: 1 }} />
        <NxButton title={bid ? 'Place bid' : `Accept ${rental ? 'rental' : 'ride'}`} trailingIcon="arrow" loading={busy} onPress={onAccept} style={{ flex: 2 }} />
      </View>
    </View>
  );
}

const SHADOW = { shadowColor: '#162033', shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 5 } as const;

const styles = StyleSheet.create({
  card: { backgroundColor: nx.white, ...SHADOW },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  place: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 14, borderRadius: 16 },
  placeName: { fontSize: 14, fontWeight: '700', color: nx.ink, letterSpacing: -0.2 },
  placeNote: { fontSize: 9, fontWeight: '600', color: nx.muted, letterSpacing: 0.6, marginTop: 1 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 16, borderRadius: 24 },
  pillDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#818792' },
  pillText: { fontSize: 12.5, fontWeight: '700', color: nx.ink },
  pillOnline: { backgroundColor: '#F5FFF9' },
  pillBusy: { backgroundColor: nx.redSoft },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  pulse: { width: 9, height: 9, borderRadius: 5, backgroundColor: nx.green, borderWidth: 3, borderColor: '#BFE3D0' },
  live: { fontSize: 11, color: nx.green, fontWeight: '600' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 15, paddingTop: 14, borderTopWidth: 1, borderTopColor: nx.line },
  services: { flexDirection: 'row', gap: 5, flexShrink: 1, flexWrap: 'wrap' },
  service: { paddingHorizontal: 9, minHeight: 35, borderRadius: 7, borderWidth: 1, borderColor: nx.line, alignItems: 'center', justifyContent: 'center' },
  serviceOn: { backgroundColor: nx.redSoft, borderColor: '#EFD3DC' },
  serviceText: { fontSize: 10, color: '#84909F' },
  reqTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  reqTitle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reqTitleText: { fontSize: 11.5, fontWeight: '700', color: nx.ink },
  reqTimer: { fontSize: 11.5, fontWeight: '800', color: nx.red },
  track: { height: 3, borderRadius: 3, backgroundColor: nx.redSoft, overflow: 'hidden', marginBottom: 14 },
  trackFill: { height: '100%', backgroundColor: nx.red },
  reqPrice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  reqSmall: { fontSize: 9.5, color: nx.muted },
  reqAmount: { fontSize: 32, fontWeight: '800', letterSpacing: -1, color: nx.ink },
  reqMore: { fontSize: 10.5, fontWeight: '700', color: nx.red },
  reqActions: { flexDirection: 'row', gap: 9, marginTop: 10 },
  duty: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
  dutyIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: nx.redSoft, alignItems: 'center', justifyContent: 'center' },
  dutyLabel: { fontSize: 10.5, color: nx.muted },
  dutyLine: { fontSize: 13, fontWeight: '700', color: nx.ink, marginTop: 1 },
  dutyView: { fontSize: 11.5, fontWeight: '600', color: nx.muted },
  locate: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vehicleIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: nx.page, borderWidth: 1, borderColor: nx.line, alignItems: 'center', justifyContent: 'center' },
  plate: { fontSize: 14, fontWeight: '700', color: nx.ink, letterSpacing: -0.1 },
  vehicleLine: { fontSize: 11.5, color: nx.muted, marginTop: 2 },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  verifiedText: { fontSize: 11, fontWeight: '600' },
  readyRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16 },
  ready: { fontSize: 25, lineHeight: 31, fontWeight: '800', color: nx.ink, letterSpacing: -0.8 },
  readyNote: { fontSize: 12.5, lineHeight: 18, color: nx.muted, marginTop: 6 },
  goRing: { width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(207,0,53,0.08)', borderWidth: 1, borderColor: 'rgba(207,0,53,0.16)', alignItems: 'center', justifyContent: 'center' },
  go: { width: 78, height: 78, borderRadius: 39, backgroundColor: nx.red, alignItems: 'center', justifyContent: 'center', shadowColor: nx.red, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  goText: { fontSize: 20, fontWeight: '800', color: nx.white, letterSpacing: 0.5 },
  footnote: { fontSize: 11, color: nx.muted, textAlign: 'center', marginTop: 12 },
});
