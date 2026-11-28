// The Drive page with no local duty running: a full-screen map with the driver's car on it, the next assigned duty, and a
// bottom sheet with the duty status switch. Going online (the same duty status as everywhere else) shows live local
// requests in the sheet with a 15 second timer — Accept takes the duty
// (claimMarketplaceDuty, decided by the server), Decline moves to the next one. A fleet driver stays online for the fleet,
// which assigns trips; a planned or running local duty opens the duty card instead (LocalTaxiScreen). The switch does not put
// the car on riders' maps: only a running local duty does, which "Start Local Duty" here sets up.
// Without a GPS fix the map shows a Tamil Nadu demo position.
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { Text } from './Text';
import { NxIcon } from './Icon';
import { NxMapScreen, useShell } from './Shell';
import { DutyDialog } from './Duties';
import { StartDutyDialog } from './StartDutyDialog';
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
import { getCurrentPosition, watchPosition, type DevicePosition } from '../../services/locationService';
import type { DocumentStatus, MarketplaceOffer, TripDetails } from '../../types/driver';
import { formatTime12 } from '../../utils/time';
import { nx } from '../../theme/nx';

/** Shown on the map until the phone gives a position. */
const DEMO = { lat: 9.9252, lng: 78.1198 };
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
/** A live offer is an Hourly Rental or a local Pickup & Drop. */
const serviceOf = (o: MarketplaceOffer): Service => (o.tripType === 'Local Rental' ? 'rental' : 'pickup');

const DOC: Record<DocumentStatus, { label: string; color: string; bg: string; icon: 'shield' | 'clock' | 'alert' }> = {
  Approved: { label: 'Verified', color: nx.green, bg: nx.greenSoft, icon: 'shield' },
  Pending: { label: 'In review', color: nx.amber, bg: nx.amberSoft, icon: 'clock' },
  Rejected: { label: 'Action needed', color: nx.red, bg: nx.redSoft, icon: 'alert' },
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
  const [recentre, setRecentre] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [detail, setDetail] = useState<MarketplaceOffer | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [planning, setPlanning] = useState(false);

  // The request in front of the driver: the first live offer for their vehicle and chosen service they have not skipped.
  const request = fleet || !presence.online ? null : offers.find((o) => !skipped.includes(o.id) && categoryMatches(o.vehicleCategory, vehicle.vehicleType)) ?? null;
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

  const live = !!fix;
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
  // The car's name in capitals ("TOYOTA ETIOS"), like the plate beside it.
  const carName = model ? model.toUpperCase() : (vehicle.vehicleType || '').toUpperCase() || (driver.vendorId ? 'Assigned by your fleet' : 'Vehicle not added');
  const carClass = (model ? vehicle.vehicleType : '') || (vehicle.vehicleNumber ? 'Your vehicle' : 'Add it in your profile');

  const overlay = (
    <>
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
          {/* The registration in the style of a number plate. */}
          <View style={styles.plateBox}>
            <Text style={styles.plateText} numberOfLines={1}>{vehicle.vehicleNumber || (driver.vendorId ? 'FLEET' : 'NO VEHICLE')}</Text>
          </View>
          {/* The car in two lines: its name, and the category it is booked as. */}
          <View style={styles.vehicleText}>
            <Text style={styles.carName} numberOfLines={1}>{carName}</Text>
            <Text style={styles.carClass} numberOfLines={1}>{carClass}</Text>
          </View>
          <View style={[styles.docChip, { backgroundColor: doc.bg }]}>
            <NxIcon name={doc.icon} size={13} color={doc.color} />
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
            {/* The duty status: what the driver is now, and a switch to change it. */}
            <Pressable
              onPress={toggleOnline}
              disabled={presence.busy}
              style={({ pressed }) => [styles.status, presence.online && styles.statusOn, (pressed || presence.busy) && { opacity: 0.88 }]}
              accessibilityRole="switch"
              accessibilityState={{ checked: presence.online, disabled: presence.busy }}
              accessibilityLabel={presence.online ? 'On duty. Go offline' : 'Off duty. Go online'}
            >
              <View style={[styles.statusIcon, presence.online && styles.statusIconOn]}>
                <NxIcon name="power" size={20} color={presence.online ? nx.white : '#64748B'} />
              </View>
              <Text style={[styles.statusTitle, { flex: 1 }]} numberOfLines={1}>{presence.busy ? 'Updating…' : presence.online ? 'Online' : 'Offline'}</Text>
              <View style={[styles.swTrack, presence.online && styles.swTrackOn]}>
                <View style={[styles.swThumb, presence.online && styles.swThumbOn]} />
              </View>
            </Pressable>
            {presence.online && fleet ? <Text style={styles.footnote}>{`${driver.vendorName || 'Your fleet'} assigns your trips. They appear in My Trips.`}</Text> : null}
            {!presence.online ? <Text style={styles.footnote}>Bookings and assigned trips are available while offline.</Text> : null}
            {driver.fleetSuspended ? null : (
              <>
                <NxButton title="Start Local Duty" variant="secondary" onPress={() => setPlanning(true)} style={{ marginTop: 10 }} />
                <Text style={styles.footnote}>Riders see your vehicle on their map only during a running Local Duty.</Text>
              </>
            )}
          </>
        )}
      </NxMapScreen>
      {planning ? <StartDutyDialog onClose={() => setPlanning(false)} onCreated={onRefresh} /> : null}
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
  live: { fontSize: 11, color: nx.green, fontWeight: '600' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 },
  services: { flexDirection: 'row', gap: 5, flexShrink: 1, flexWrap: 'wrap' },
  service: { paddingHorizontal: 9, minHeight: 35, borderRadius: 7, borderWidth: 1, borderColor: nx.line, alignItems: 'center', justifyContent: 'center' },
  serviceOn: { backgroundColor: nx.redSoft, borderColor: '#EFD3DC' },
  serviceText: { fontSize: 11, fontWeight: '600', color: '#4B5563' },
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
  // Plate, car and document status: three blocks of one height (40), on one line.
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 40 },
  carName: { fontSize: 13.5, lineHeight: 18, fontWeight: '800', color: nx.ink, letterSpacing: 0.4 },
  carClass: { fontSize: 10, lineHeight: 14, fontWeight: '700', letterSpacing: 1, color: '#64748B', textTransform: 'uppercase' },
  docChip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 40, paddingHorizontal: 12, borderRadius: 8 },
  vehicleText: { flex: 1, minWidth: 0, height: 40, justifyContent: 'center' },
  plate: { fontSize: 13.5, fontWeight: '700', color: nx.ink, letterSpacing: -0.1 },
  vehicleLine: { fontSize: 12, color: '#4B5563' },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  verifiedText: { fontSize: 12.5, fontWeight: '700' },
  readyRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16 },
  ready: { fontSize: 25, lineHeight: 31, fontWeight: '800', color: nx.ink, letterSpacing: -0.8 },
  readyNote: { fontSize: 12.5, lineHeight: 18, color: nx.muted, marginTop: 6 },
  road: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 64, marginTop: 10, paddingHorizontal: 6, borderRadius: 32, backgroundColor: '#121212' },
  roadOn: { paddingLeft: 20 },
  roadLabel: { flexShrink: 1, minWidth: 0 },
  roadTitle: { fontSize: 15.5, fontWeight: '800', color: nx.white, letterSpacing: -0.3 },
  roadNote: { fontSize: 11, fontWeight: '600', color: '#A9AEB8', marginTop: 1 },
  lanes: { flex: 1, minWidth: 0, flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'center', overflow: 'hidden' },
  lane: { width: 10, height: 3, borderRadius: 2, backgroundColor: nx.red },
  knob: { width: 52, height: 52, borderRadius: 26, backgroundColor: nx.red, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.18)' },
  knobOn: { backgroundColor: nx.green },
  knobText: { fontSize: 16, fontWeight: '800', color: nx.white, letterSpacing: 0.5 },
  footnote: { fontSize: 11, color: '#4B5563', textAlign: 'center', marginTop: 8 },
  plateBox: { height: 40, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 8, borderWidth: 1.5, borderColor: '#1F2937', backgroundColor: '#FFF6CC' },
  plateText: { fontSize: 13.5, fontWeight: '800', color: '#111827', letterSpacing: 1.2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 12, paddingVertical: 13, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: nx.line, backgroundColor: '#F8FAFC' },
  statusOn: { borderColor: '#BBE5CC', backgroundColor: '#F2FBF5' },
  statusIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8ECF1' },
  statusIconOn: { backgroundColor: nx.green },
  statusEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: '#64748B' },
  statusTitle: { fontSize: 17, fontWeight: '800', color: nx.ink, letterSpacing: -0.3 },
  statusNote: { fontSize: 11.5, color: '#64748B', marginTop: 1 },
  swTrack: { width: 52, height: 30, borderRadius: 15, padding: 3, backgroundColor: '#CBD2DC', justifyContent: 'center' },
  swTrackOn: { backgroundColor: nx.green },
  swThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: nx.white, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  swThumbOn: { alignSelf: 'flex-end' },
});
