// Local Taxi — continuous local duty for a fleet driver.
//
// The driver's fleet partner puts them on local duty for a city and a time window (Hourly Rental, Pickup & Drop or both).
// Here the driver:
//   1. does the selfie + vehicle photo check once for the whole duty and starts it (slide);
//   2. sees, per tab (Hourly Rental · Pickup & Drop), the order in hand on the map — with the rental clock running for an
//      hourly rental — and every nearby order, closest first, on the map and in a list;
//   3. takes the next order and moves on, one after another (a current order plus one next order; a rental keeps the car);
//   4. follows the duty totals live: orders, kilometres, fare, what was collected and the cash in hand for the fleet.
// Each order runs through the ordinary trip page (OTP, start, end, kilometres, payments). Every rule is the server's
// (functions/src/localShifts.ts); this page only presents it.
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Text } from '../components/nx/Text';
import { NxScreen, useShell } from '../components/nx/Shell';
import { NxDialog } from '../components/nx/Dialog';
import { NxIcon, type NxIconName } from '../components/nx/Icon';
import { NxBadge, NxButton, NxEmpty, NxField, NxFormError, NxInfo, NxPanel, NxPills, NxSectionHeading, NxTextButton, isHovered, nxText, placeName } from '../components/nx/primitives';
import { NxSwipe } from '../components/nx/Swipe';
import { useLayout } from '../components/nx/layout';
import { LiveMap, type MapData, type MapLine, type MapMarker } from '../components/nx/LiveMap';
import { RentalClock } from '../components/nx/RentalClock';
import { tripStageLabel } from '../components/nx/tripFormat';
import { useDriverData } from '../context/DriverData';
import { useLocalBoard } from '../hooks/useLocalBoard';
import { useNow } from '../hooks/useNow';
import type { TabParamList } from '../navigation/types';
import { ActionError } from '../services/callables';
import { endLocalShift, localDutyCities, localShiftAction, releaseLocalOrder, startMyLocalDuty, takeLocalOrder, type DutyCity } from '../services/localDutyService';
import { getCurrentPosition } from '../services/locationService';
import type { BoardOrder, LocalMode, LocalShift, TripDetails } from '../types/driver';
import { formatINR } from '../utils/format';
import { LOCAL_MODE_LABEL, currentShift, dutyMinutes, liveTotals, pickupWhen, shiftOrders, spanText, takeBlockReason } from '../utils/localDuty';
import { describeError } from '../utils/retry';
import { formatTime12 } from '../utils/time';
import { nx } from '../theme/nx';
import { mapsDirections } from './TripFlowScreen';

const errorText = (e: unknown, fallback: string) => (e instanceof ActionError ? e.message : describeError(e, fallback));
const EARLY_START_MS = 30 * 60000;
const MODES: LocalMode[] = ['rental', 'pickup_drop'];
const dayText = (d: Date | null) => (d ? d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' }) : '');
const windowText = (s: LocalShift) => (s.startsAt && s.endsAt ? `${formatTime12(s.startsAt)} – ${formatTime12(s.endsAt)}` : '—');
const isToday = (d: Date | null, now: number) => !!d && dayText(d) === dayText(new Date(now));

export function LocalTaxiScreen() {
  const route = useRoute<RouteProp<TabParamList, 'Local'>>();
  const { shifts, shiftsLoaded, bookings, refreshShifts } = useDriverData();
  const now = useNow(15000);
  const shift = currentShift(shifts, now);
  const upcoming = shifts.filter((s) => s.status === 'Scheduled' && s.id !== shift?.id && (s.endsAt?.getTime() ?? 0) > now).reverse();

  useEffect(() => {
    refreshShifts();
  }, [refreshShifts]);

  if (!shiftsLoaded) {
    return (
      <NxScreen>
        <NxPanel>
          <Text style={nxText.copy}>Loading your local duty…</Text>
        </NxPanel>
      </NxScreen>
    );
  }
  if (!shift) return <NoDuty upcoming={upcoming} onRefresh={refreshShifts} />;
  // Keyed so dialogs and selections never leak from one duty into the next.
  return <Duty key={shift.id} shift={shift} trips={bookings} upcoming={upcoming} now={now} initialTab={route.params?.tab} />;
}

// ── No duty ─────────────────────────────────────────────────────────────────

function NoDuty({ upcoming, onRefresh }: { upcoming: LocalShift[]; onRefresh: () => void }) {
  const { dashboard } = useLayout();
  const start = <StartDutyCard onRefresh={onRefresh} />;
  return (
    <NxScreen>
      <View style={{ marginBottom: 12, flexDirection: 'row', justifyContent: 'flex-end' }}>
        <NxTextButton title="Check for fleet duty" icon="refresh" onPress={onRefresh} />
      </View>
      {dashboard ? (
        <View style={styles.twoPane}>
          <View style={{ flex: 1.2, minWidth: 0 }}>{start}</View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <HowItWorks />
          </View>
        </View>
      ) : (
        <>
          {start}
          <HowItWorks />
        </>
      )}
      {upcoming.length ? <UpcomingDuties list={upcoming} /> : null}
    </NxScreen>
  );
}

const HOURS = [4, 6, 8, 10, 12];
const RADII = [5, 10, 15, 25];

/** A fleet driver goes on local duty themselves: city, order types, hours and area. Their paired vehicle is used. */
function StartDutyCard({ onRefresh }: { onRefresh: () => void }) {
  const { account } = useDriverData();
  const { notify } = useShell();
  const [cities, setCities] = useState<DutyCity[] | null>(null);
  const [cityId, setCityId] = useState('');
  const [cityName, setCityName] = useState('');
  const [services, setServices] = useState<LocalMode[]>(['rental', 'pickup_drop']);
  const [hours, setHours] = useState(8);
  const [radius, setRadius] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    localDutyCities()
      .then((r) => alive && setCities(r.cities))
      .catch(() => alive && setCities([]));
    return () => {
      alive = false;
    };
  }, []);
  const chosen = cities?.find((c) => c.id === cityId) ?? null;
  const city = chosen?.name ?? cityName.trim();
  const toggle = (m: LocalMode) => setServices((l) => (l.includes(m) ? l.filter((x) => x !== m) : MODES.filter((x) => x === m || l.includes(x))));
  const go = async () => {
    if (city.length < 2) return setError('Choose or type your city.');
    if (!services.length) return setError('Choose Hourly Rental, Pickup & Drop or both.');
    setBusy(true);
    setError('');
    try {
      await startMyLocalDuty({ cityId: chosen?.id ?? '', cityName: city, services, hours, radiusKm: radius });
      notify('ok', `Local duty active in ${city}.`);
      onRefresh();
    } catch (e) {
      setError(errorText(e, 'Local duty could not be set.'));
    } finally {
      setBusy(false);
    }
    return undefined;
  };
  return (
    <NxPanel accent>
      <NxBadge label="Local Taxi" tone="green" icon="taxi" />
      <Text style={[nxText.routeTitle, { marginTop: 12 }]}>Go on local duty</Text>
      <Text style={[nxText.copy, { marginTop: 4 }]}>
        Take Hourly Rental and Pickup & Drop orders one after another in your city{account.driver.vendorName ? ` for ${account.driver.vendorName}` : ''}. {account.driver.vendorId ? 'Your paired vehicle is used and your fleet partner is told.' : 'Your attached vehicle is used.'}
      </Text>

      <Text style={styles.formLabel}>City</Text>
      {cities === null ? <Text style={nxText.small}>Loading cities…</Text> : null}
      {cities && cities.length ? (
        <View style={styles.reasons}>
          {cities.slice(0, 12).map((c) => (
            <Pressable key={c.id} onPress={() => setCityId(cityId === c.id ? '' : c.id)} style={[styles.reason, cityId === c.id && styles.reasonOn]} accessibilityRole="radio" accessibilityState={{ selected: cityId === c.id }}>
              <Text style={[styles.reasonText, cityId === c.id && { color: nx.white }]}>{c.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {cities && !cityId ? <NxField label={cities.length ? 'Or type your city' : 'Your city'} value={cityName} onChangeText={setCityName} placeholder="e.g. Erode" maxLength={80} /> : null}

      <Text style={styles.formLabel}>Orders</Text>
      <View style={styles.reasons}>
        {MODES.map((m) => (
          <Pressable key={m} onPress={() => toggle(m)} style={[styles.reason, services.includes(m) && styles.reasonOn]} accessibilityRole="checkbox" accessibilityState={{ checked: services.includes(m) }}>
            <Text style={[styles.reasonText, services.includes(m) && { color: nx.white }]}>{LOCAL_MODE_LABEL[m]}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.formLabel}>Hours on duty</Text>
      <View style={styles.reasons}>
        {HOURS.map((h) => (
          <Pressable key={h} onPress={() => setHours(h)} style={[styles.reason, hours === h && styles.reasonOn]} accessibilityRole="radio" accessibilityState={{ selected: hours === h }}>
            <Text style={[styles.reasonText, hours === h && { color: nx.white }]}>{h} h</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.formLabel}>Area around you</Text>
      <View style={styles.reasons}>
        {RADII.map((r) => (
          <Pressable key={r} onPress={() => setRadius(r)} style={[styles.reason, radius === r && styles.reasonOn]} accessibilityRole="radio" accessibilityState={{ selected: radius === r }}>
            <Text style={[styles.reasonText, radius === r && { color: nx.white }]}>{r} km</Text>
          </Pressable>
        ))}
      </View>

      <NxFormError message={error} />
      <NxButton title={busy ? 'Setting up…' : 'Go on local duty'} icon="taxi" loading={busy} onPress={() => void go()} style={{ marginTop: 16 }} />
      <Text style={nxText.note}>Next: one selfie + vehicle photo check for the whole duty, then slide to start.</Text>
    </NxPanel>
  );
}

function HowItWorks() {
  const steps: [NxIconName, string, string][] = [
    ['camera', 'One photo check', 'Selfie and vehicle photos once at the start of the duty — not for every order.'],
    ['map', 'Orders around you', 'Nearby orders on the map, closest first. Take one, finish it, take the next.'],
    ['clock', 'Hourly rentals', 'The rental clock runs from boarding. Stay with the customer for the booked hours.'],
    ['wallet', 'Everything added up', 'Orders, kilometres, fares and cash in hand are totalled for you and your fleet.'],
  ];
  return (
    <NxPanel>
      <Text style={nxText.eyebrow}>How local duty works</Text>
      <View style={styles.how}>
        {steps.map(([icon, title, text]) => (
          <View key={title} style={styles.howItem}>
            <View style={styles.howIcon}>
              <NxIcon name={icon} size={18} color={nx.red} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.howTitle}>{title}</Text>
              <Text style={nxText.small}>{text}</Text>
            </View>
          </View>
        ))}
      </View>
    </NxPanel>
  );
}

function UpcomingDuties({ list }: { list: LocalShift[] }) {
  return (
    <NxPanel>
      <Text style={nxText.eyebrow}>Planned local duty</Text>
      {list.map((s, i) => (
        <View key={s.id} style={[styles.upcoming, i === list.length - 1 && { borderBottomWidth: 0 }]}>
          <NxIcon name="calendar" size={16} color={nx.muted} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.upcomingTitle} numberOfLines={1}>
              {s.cityName} · {dayText(s.startsAt)}
            </Text>
            <Text style={nxText.small} numberOfLines={1}>
              {windowText(s)} · {s.vehicleNumber} · {s.services.map((m) => LOCAL_MODE_LABEL[m]).join(' + ')}
            </Text>
          </View>
        </View>
      ))}
    </NxPanel>
  );
}

// ── The duty ────────────────────────────────────────────────────────────────

function Duty({ shift, trips, upcoming, now, initialTab }: { shift: LocalShift; trips: TripDetails[]; upcoming: LocalShift[]; now: number; initialTab?: LocalMode }) {
  const navigation = useNavigation();
  const { notify } = useShell();
  const { dashboard, phone } = useLayout();
  const orders = useMemo(() => shiftOrders(trips, shift.id), [trips, shift.id]);
  const totals = useMemo(() => liveTotals(orders.all), [orders.all]);
  const running = shift.status === 'Active';
  const closed = shift.status !== 'Active' && shift.status !== 'Scheduled';
  const planned = shift.status === 'Scheduled';
  const boardOpen = running && !shift.paused && !shift.endRequested;
  const board = useLocalBoard(running ? shift.id : null, running);

  const firstMode = orders.current?.localMode ?? (initialTab && shift.services.includes(initialTab) ? initialTab : shift.services[0] ?? 'pickup_drop');
  const [tab, setTab] = useState<LocalMode>(firstMode);
  const [seenTab, setSeenTab] = useState(initialTab);
  if (initialTab !== seenTab) {
    setSeenTab(initialTab);
    if (initialTab) setTab(initialTab);
  }
  const [selected, setSelected] = useState<string | null>(null);
  const [taking, setTaking] = useState<BoardOrder | null>(null);
  const [handBack, setHandBack] = useState<TripDetails | null>(null);
  const [ending, setEnding] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, ok: string, fallback: string) => {
    if (busy) return false;
    setBusy(true);
    try {
      await fn();
      if (ok) notify('ok', ok);
      return true;
    } catch (e) {
      notify('error', errorText(e, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const here = () => getCurrentPosition(10000).catch(() => null);
  const start = () =>
    act(
      async () => {
        const fix = await here();
        await localShiftAction(shift.id, 'start', fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : null);
      },
      `Local duty started in ${shift.cityName}. Nearby orders are on the map.`,
      'Could not start the duty.',
    );
  const pause = () => act(() => localShiftAction(shift.id, 'pause'), 'You are on a break. No new orders are shown.', 'Could not start the break.');
  const resume = () => act(() => localShiftAction(shift.id, 'resume'), 'Back on duty.', 'Could not resume the duty.');

  const boardOrders = (board.board?.orders ?? []).filter((o) => o.mode === tab);
  const block = takeBlockReason(orders.inHand, tab);
  const inHandHere = orders.inHand.filter((t) => t.localMode === tab);
  const inHandOther = orders.inHand.filter((t) => t.localMode !== tab);
  const chosen = boardOrders.find((o) => o.id === selected) ?? null;

  const counts = (m: LocalMode) => (board.board?.orders ?? []).filter((o) => o.mode === m).length;
  const tabOptions = MODES.map((m) => ({
    value: m,
    label: `${LOCAL_MODE_LABEL[m]}${shift.services.includes(m) && running && counts(m) ? ` · ${counts(m)}` : ''}`,
  }));

  const mapData = ((): MapData => {
    const markers: MapMarker[] = [];
    const lines: MapLine[] = [];
    const point = (l: TripDetails['pickup']) => (l.lat != null && l.lng != null ? { lat: l.lat, lng: l.lng } : null);
    orders.inHand.forEach((t, i) => {
      const p = point(t.pickup);
      const d = t.localMode === 'rental' ? null : point(t.drop);
      const next = i > 0;
      if (p && t.subStatus !== 'Trip Started') markers.push({ id: `trip:${t.id}`, ...p, kind: next ? 'next' : 'pickup', label: next ? 'N' : 'P', title: `${next ? 'Next' : 'Pickup'} · ${placeName(t.pickup.address)}` });
      if (d && !next) markers.push({ id: `trip:${t.id}:drop`, ...d, kind: 'drop', label: 'D', title: `Drop · ${placeName(t.drop.address)}` });
      if (p && d && !next) lines.push({ from: p, to: d, tone: 'ink' });
    });
    if (boardOpen && shift.services.includes(tab)) {
      boardOrders.forEach((o, i) => {
        markers.push({ id: o.id, lat: o.pickup.lat, lng: o.pickup.lng, kind: 'order', label: String(i + 1), selected: o.id === selected, approx: o.pickup.approx, title: `${i + 1}. ${placeName(o.pickup.name)} · ${o.awayKm} km` });
        if (o.id === selected && o.drop?.lat != null && o.drop.lng != null) lines.push({ from: { lat: o.pickup.lat, lng: o.pickup.lng }, to: { lat: o.drop.lat, lng: o.drop.lng }, tone: 'red' });
      });
    }
    const centre = board.board?.centre ?? shift.centre;
    return {
      me: board.me ? { lat: board.me.lat, lng: board.me.lng } : null,
      markers,
      lines,
      area: centre ? { centre, radiusKm: board.board?.radiusKm ?? shift.radiusKm } : null,
      fitKey: `${tab}|${orders.inHand.map((t) => `${t.id}:${t.subStatus}`).join(',')}|${boardOrders.length}|${board.me ? 1 : 0}`,
    };
  })();

  const openTrip = (t: TripDetails) => navigation.navigate('TripFlow', { bookingId: t.id });

  // ── pieces ──
  const dutyCard = (
    <DutyCard
      shift={shift}
      totals={totals}
      now={now}
      busy={busy}
      onPhotoCheck={() => navigation.navigate('PreTrip', { shiftId: shift.id })}
      onStart={start}
      onPause={() => void pause()}
      onResume={() => void resume()}
      onEnd={() => setEnding(true)}
    />
  );

  const tabs = (
    <NxPills<LocalMode>
      options={tabOptions}
      value={tab}
      onChange={(m) => {
        setTab(m);
        setSelected(null);
      }}
      label="Local order type"
      fill
      style={{ marginBottom: 16 }}
    />
  );

  const notInDuty = !shift.services.includes(tab);
  const inHandCards = (
    <>
      {inHandOther.length ? (
        <NxInfo tone="amber" icon="info" style={{ marginTop: 0, marginBottom: 14 }}>
          {`You have ${inHandOther.length === 1 ? 'a' : inHandOther.length} ${LOCAL_MODE_LABEL[inHandOther[0]!.localMode ?? 'pickup_drop']} order${inHandOther.length === 1 ? '' : 's'} in hand (${inHandOther.map((t) => t.bookingId).join(', ')}). It is on the ${LOCAL_MODE_LABEL[inHandOther[0]!.localMode ?? 'pickup_drop']} tab.`}
        </NxInfo>
      ) : null}
      {inHandHere.map((t) => (
        <OrderInHand key={t.id} trip={t} next={orders.current?.id !== t.id} onOpen={() => openTrip(t)} onHandBack={() => setHandBack(t)} />
      ))}
    </>
  );

  const mapAndList = closed ? null : notInDuty ? (
    <NxEmpty icon="info" title={`${LOCAL_MODE_LABEL[tab]} is not part of this duty`} message={`Your fleet partner set today’s duty for ${shift.services.map((m) => LOCAL_MODE_LABEL[m]).join(' + ')}.`} />
  ) : (
    <>
      <LiveMap data={mapData} height={phone ? 270 : 400} onSelect={(id) => (id.startsWith('trip:') ? undefined : setSelected(id))} label={`${LOCAL_MODE_LABEL[tab]} map`} />
      <MapLegend />
      {chosen ? <SelectedOrder order={chosen} now={now} block={block} busy={busy} onTake={() => setTaking(chosen)} onClose={() => setSelected(null)} /> : null}
      <BoardSection
        mode={tab}
        orders={boardOrders}
        open={boardOpen}
        reason={running ? (board.board && !board.board.open ? board.board.reason : shift.paused ? 'You are on a break. Resume to see orders.' : shift.endRequested ? 'The duty is ending. Finish the orders in hand.' : '') : 'Start the duty to see nearby orders.'}
        loading={board.loading}
        error={board.error || board.locationError}
        updatedAt={board.updatedAt}
        now={now}
        selected={selected}
        block={block}
        onSelect={setSelected}
        onTake={setTaking}
        onRefresh={() => void board.refresh()}
      />
    </>
  );

  const summary = <DutySummary shift={shift} totals={totals} done={orders.done} now={now} onOpen={openTrip} />;

  return (
    <NxScreen>
      {dashboard ? (
        <View style={styles.twoPane}>
          <View style={{ flex: 1.45, minWidth: 0 }}>
            {planned ? (
              <HowItWorks />
            ) : (
              <>
                {tabs}
                {inHandCards}
                {mapAndList}
                {closed ? summary : null}
              </>
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0, maxWidth: 420 }}>
            {dutyCard}
            {closed ? null : summary}
            {upcoming.length ? <UpcomingDuties list={upcoming} /> : null}
          </View>
        </View>
      ) : (
        <>
          {dutyCard}
          {planned ? (
            <HowItWorks />
          ) : closed ? (
            summary
          ) : (
            <>
              {tabs}
              {inHandCards}
              {mapAndList}
              {summary}
            </>
          )}
          {upcoming.length ? <UpcomingDuties list={upcoming} /> : null}
        </>
      )}

      <TakeDialog
        order={taking}
        queued={orders.inHand.length > 0}
        now={now}
        onClose={() => setTaking(null)}
        onTake={async (o) => {
          const ok = await act(
            () => takeLocalOrder(shift.id, o.id),
            orders.inHand.length ? `${o.code} added as your next order.` : `${o.code} is yours. Head to the pickup.`,
            'Could not take this order.',
          );
          setTaking(null);
          setSelected(null);
          if (ok) void board.refresh();
        }}
        busy={busy}
      />
      <HandBackDialog
        trip={handBack}
        busy={busy}
        onClose={() => setHandBack(null)}
        onConfirm={async (t, reason) => {
          const ok = await act(() => releaseLocalOrder(shift.id, t.id, reason), `${t.bookingId} handed back to ${shift.vendorName}.`, 'Could not hand the order back.');
          if (ok) setHandBack(null);
        }}
      />
      <EndDialog
        visible={ending}
        shift={shift}
        inHand={orders.inHand.length}
        busy={busy}
        onClose={() => setEnding(false)}
        onConfirm={async (reason) => {
          let message = '';
          const ok = await act(
            async () => {
              const r = await endLocalShift(shift.id, reason);
              message = r.status === 'Ending' ? 'No new orders. Your duty closes when the orders in hand are finished.' : r.status === 'Cancelled' ? 'Planned duty cancelled.' : 'Local duty ended. Your totals are below.';
            },
            '',
            'Could not end the duty.',
          );
          if (ok) {
            notify('ok', message);
            setEnding(false);
          }
        }}
      />
    </NxScreen>
  );
}

// ── Duty card ───────────────────────────────────────────────────────────────

function DutyCard({
  shift,
  totals,
  now,
  busy,
  onPhotoCheck,
  onStart,
  onPause,
  onResume,
  onEnd,
}: {
  shift: LocalShift;
  totals: ReturnType<typeof liveTotals>;
  now: number;
  busy: boolean;
  onPhotoCheck: () => void;
  onStart: () => Promise<boolean>;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
}) {
  const scheduled = shift.status === 'Scheduled';
  const running = shift.status === 'Active';
  const badge = scheduled
    ? { label: 'Planned', tone: 'amber' as const, icon: 'calendar' as NxIconName }
    : running
      ? shift.endRequested
        ? { label: 'Ending', tone: 'amber' as const, icon: 'clock' as NxIconName }
        : shift.paused
          ? { label: 'On break', tone: 'amber' as const, icon: 'pause' as NxIconName }
          : { label: 'On duty', tone: 'green' as const, icon: 'check' as NxIconName }
      : { label: shift.status === 'Ended' ? 'Closed' : shift.status === 'Missed' ? 'Not started' : 'Cancelled', tone: 'neutral' as const, icon: 'check' as NxIconName };
  const opensAt = shift.startsAt ? shift.startsAt.getTime() - EARLY_START_MS : 0;
  const tooEarly = scheduled && now < opensAt;
  const left = shift.endsAt ? shift.endsAt.getTime() - now : 0;
  const worked = dutyMinutes(shift, now);

  return (
    <NxPanel accent={running && !shift.paused}>
      <View style={styles.spread}>
        <NxBadge label={badge.label} tone={badge.tone} icon={badge.icon} />
        <Text style={nxText.small}>{isToday(shift.startsAt, now) ? 'Today' : dayText(shift.startsAt)}</Text>
      </View>
      <Text style={[nxText.routeTitle, { marginTop: 12 }]} numberOfLines={2}>
        Local duty · {shift.cityName}
      </Text>
      <Text style={[nxText.small, { marginTop: 3 }]} numberOfLines={2}>
        {shift.vendorName} · {shift.vehicleNumber}
        {shift.vehicleCategory ? ` · ${shift.vehicleCategory}` : ''}
      </Text>

      <View style={styles.facts}>
        <Fact icon="clock" label="Hours" value={windowText(shift)} />
        <Fact icon="pin" label="Area" value={`${shift.radiusKm} km around ${shift.centre ? 'the city' : 'your start'}`} />
      </View>
      <View style={styles.chips}>
        {shift.services.map((m) => (
          <View key={m} style={styles.chip}>
            <NxIcon name={m === 'rental' ? 'clock' : 'navigate'} size={12} color={nx.ink} />
            <Text style={styles.chipText}>{LOCAL_MODE_LABEL[m]}</Text>
          </View>
        ))}
      </View>
      {shift.note ? <Text style={[nxText.note, { marginTop: 10 }]}>Note from your fleet: {shift.note}</Text> : null}

      {scheduled ? (
        <View style={{ marginTop: 16 }}>
          <Step n={1} done={shift.verified} title="Start-of-duty photo check" text={shift.verified ? 'Submitted. Every order today uses it.' : 'Selfie and vehicle photos, once for the whole duty.'}>
            {!shift.verified ? <NxButton title="Start photo check" icon="camera" compact onPress={onPhotoCheck} style={{ marginTop: 10, alignSelf: 'flex-start' }} /> : null}
          </Step>
          <Step n={2} done={false} title="Start the duty" text={tooEarly ? `You can start from ${formatTime12(new Date(opensAt))}.` : 'Your location sets the duty area and nearby orders appear.'} last />
          <NxSwipe key="start-duty" label="Slide to Start Duty" disabled={!shift.verified || tooEarly} busy={busy} onCommit={onStart} />
          {shift.verificationFlagged ? <Text style={nxText.note}>NESAM will review one of your duty photos. You can still start.</Text> : null}
        </View>
      ) : null}

      {running ? (
        <>
          <View style={styles.dutyStats}>
            <MiniStat label="On duty" value={spanText(worked)} />
            <MiniStat label="Orders done" value={String(totals.done)} />
            <MiniStat label={left > 0 ? 'Time left' : 'Over by'} value={spanText(Math.abs(left) / 60000)} tone={left > 0 ? undefined : 'red'} />
          </View>
          {shift.endRequested ? (
            <NxInfo tone="amber" icon="clock" style={{ marginTop: 14 }}>
              {totals.inHand ? `No new orders. The duty closes when your ${totals.inHand === 1 ? 'order' : `${totals.inHand} orders`} in hand ${totals.inHand === 1 ? 'is' : 'are'} finished.` : 'The duty is closing.'}
              {shift.endReason ? ` (${shift.endReason})` : ''}
            </NxInfo>
          ) : (
            <View style={styles.actions}>
              {shift.paused ? (
                <NxButton title="Resume duty" icon="play" onPress={onResume} loading={busy} style={{ flex: 1 }} />
              ) : (
                <NxButton title="Take a break" icon="pause" variant="secondary" onPress={onPause} disabled={busy} style={{ flex: 1 }} />
              )}
              <NxButton title="End duty" icon="power" variant="secondary" onPress={onEnd} disabled={busy} style={{ flex: 1 }} />
            </View>
          )}
        </>
      ) : null}

      {scheduled ? <NxTextButton title="Cancel this duty" icon="close" color={nx.muted} onPress={onEnd} disabled={busy} /> : null}
    </NxPanel>
  );
}

function Fact({ icon, label, value }: { icon: NxIconName; label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <NxIcon name={icon} size={14} color={nx.muted} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.factLabel}>{label}</Text>
        <Text style={styles.factValue} numberOfLines={2}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'red' }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.miniValue, tone === 'red' && { color: nx.red }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function Step({ n, done, title, text, last, children }: { n: number; done: boolean; title: string; text: string; last?: boolean; children?: React.ReactNode }) {
  return (
    <View style={[styles.step, last && { borderBottomWidth: 0 }]}>
      <View style={[styles.stepNo, done && { backgroundColor: nx.greenSoft, borderColor: nx.greenLine }]}>
        {done ? <NxIcon name="check" size={14} color={nx.green} /> : <Text style={styles.stepNoText}>{n}</Text>}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={nxText.small}>{text}</Text>
        {children}
      </View>
    </View>
  );
}

// ── Orders in hand ──────────────────────────────────────────────────────────

function OrderInHand({ trip, next, onOpen, onHandBack }: { trip: TripDetails; next: boolean; onOpen: () => void; onHandBack: () => void }) {
  const rental = trip.localMode === 'rental';
  const started = trip.subStatus === 'Trip Started';
  const target = started ? trip.drop : trip.pickup;
  const canNavigate = !(rental && started) && (target.lat != null || !!target.address);
  return (
    <NxPanel accent={!next} style={{ marginBottom: 16 }}>
      <View style={styles.spread}>
        <NxBadge label={next ? 'Up next' : rental ? 'Current rental' : 'Current order'} tone={next ? 'amber' : 'green'} icon={next ? 'clock' : rental ? 'clock' : 'navigate'} />
        <Text style={nxText.small}>
          {trip.bookingId} · {tripStageLabel(trip)}
        </Text>
      </View>
      <View style={styles.routeBox}>
        <RouteLine dot="from" name={placeName(trip.pickup.address)} detail={trip.subStatus === 'Not Started' && trip.pickupAt ? `Pickup ${formatTime12(trip.pickupAt)}` : 'Pickup'} />
        {rental ? null : <RouteLine dot="to" name={placeName(trip.drop.address)} detail="Drop" />}
      </View>
      {rental ? <RentalClock trip={trip} /> : null}
      <View style={styles.orderMeta}>
        <Text style={nxText.small}>{trip.customerName}</Text>
        <Text style={nxText.small}>
          {formatINR(trip.fareAmount)} · {trip.paymentMode}
          {!rental && trip.distanceKm ? ` · ${Math.round(trip.distanceKm * 10) / 10} km` : ''}
        </Text>
      </View>
      <View style={styles.actions}>
        <NxButton title={next ? 'View order' : 'Open trip'} trailingIcon="arrow" onPress={onOpen} variant={next ? 'secondary' : 'primary'} style={{ flex: 1 }} />
        {canNavigate && !next ? (
          <NxButton title={started ? 'To drop' : 'To pickup'} icon="navigate" variant="secondary" onPress={() => void Linking.openURL(mapsDirections(target))} style={{ flex: 1 }} />
        ) : null}
      </View>
      {trip.subStatus === 'Not Started' && trip.status === 'Assigned' ? (
        <View style={{ alignItems: 'flex-start', marginTop: 4 }}>
          <NxTextButton title="Hand this order back" icon="close" color={nx.muted} onPress={onHandBack} />
        </View>
      ) : null}
    </NxPanel>
  );
}

function RouteLine({ dot, name, detail }: { dot: 'from' | 'to'; name: string; detail: string }) {
  return (
    <View style={styles.routeLine}>
      <View style={[styles.routeDot, dot === 'from' ? styles.routeFrom : styles.routeTo]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.routeName} numberOfLines={2}>
          {name}
        </Text>
        <Text style={nxText.small}>{detail}</Text>
      </View>
    </View>
  );
}

// ── Nearby orders ───────────────────────────────────────────────────────────

function MapLegend() {
  const items: [string, string, string][] = [
    ['#2563EB', '#2563EB', 'You'],
    [nx.green, nx.green, 'Pickup'],
    [nx.ink, nx.ink, 'Drop'],
    [nx.white, nx.red, 'Nearby order'],
  ];
  return (
    <View style={styles.legend}>
      {items.map(([bg, border, label]) => (
        <View key={label} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: bg, borderColor: border }]} />
          <Text style={styles.legendText}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function orderTitle(o: BoardOrder) {
  return o.mode === 'rental' ? placeName(o.pickup.name) : `${placeName(o.pickup.name)} → ${placeName(o.drop?.name ?? '')}`;
}
function orderMeta(o: BoardOrder, now: number) {
  const parts = [`${o.awayKm} km away`, pickupWhen(o.pickupAtMs, now)];
  if (o.mode === 'rental') parts.push(`${o.rentalHours ?? '—'} h package${o.includedKm ? ` · ${o.includedKm} km` : ''}`);
  else if (o.tripKm) parts.push(`${o.tripKm} km trip`);
  return parts.join(' · ');
}

function SelectedOrder({ order, now, block, busy, onTake, onClose }: { order: BoardOrder; now: number; block: string; busy: boolean; onTake: () => void; onClose: () => void }) {
  return (
    <NxPanel accent style={{ marginTop: 12, marginBottom: 0 }}>
      <View style={styles.spread}>
        <NxBadge label={order.source === 'fleet' ? 'Fleet order' : 'NESAM order'} tone={order.overdue ? 'amber' : 'neutral'} icon={order.mode === 'rental' ? 'clock' : 'navigate'} />
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close order details">
          <NxIcon name="close" size={18} color={nx.muted} />
        </Pressable>
      </View>
      <Text style={[nxText.heading, { marginTop: 10 }]} numberOfLines={2}>
        {orderTitle(order)}
      </Text>
      <Text style={[nxText.small, { marginTop: 3 }]}>{orderMeta(order, now)}</Text>
      <View style={[styles.spread, { marginTop: 12 }]}>
        <Text style={styles.fare}>{formatINR(order.fare)}</Text>
        <Text style={nxText.small}>
          {order.paymentMethod} · {order.code}
        </Text>
      </View>
      {block ? <Text style={nxText.note}>{block}</Text> : null}
      <NxButton title="Take this order" icon="check" onPress={onTake} disabled={!!block || busy} style={{ marginTop: 12 }} />
    </NxPanel>
  );
}

function BoardSection({
  mode,
  orders,
  open,
  reason,
  loading,
  error,
  updatedAt,
  now,
  selected,
  block,
  onSelect,
  onTake,
  onRefresh,
}: {
  mode: LocalMode;
  orders: BoardOrder[];
  open: boolean;
  reason: string;
  loading: boolean;
  error: string;
  updatedAt: number | null;
  now: number;
  selected: string | null;
  block: string;
  onSelect: (id: string) => void;
  onTake: (o: BoardOrder) => void;
  onRefresh: () => void;
}) {
  const ago = updatedAt ? Math.max(0, Math.round((now - updatedAt) / 1000)) : null;
  return (
    <View style={{ marginTop: 20 }}>
      <NxSectionHeading
        title={`Nearby ${mode === 'rental' ? 'rentals' : 'pickup & drop orders'}`}
        caption={open ? `Closest first${ago != null ? ` · updated ${ago < 10 ? 'just now' : ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)} min ago`}` : ''}` : undefined}
        right={open ? <NxButton title={loading ? 'Refreshing' : 'Refresh'} icon="refresh" variant="secondary" compact loading={loading} onPress={onRefresh} /> : null}
      />
      {error ? <NxInfo tone="red" icon="alert" style={{ marginTop: 0, marginBottom: 12 }}>{error}</NxInfo> : null}
      {!open || reason ? (
        <NxPanel>
          <Text style={nxText.copy}>{reason || 'Start the duty to see nearby orders.'}</Text>
        </NxPanel>
      ) : orders.length === 0 ? (
        <NxPanel>
          <View style={styles.waiting}>
            <NxIcon name="map" size={22} color={nx.faint} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.waitingTitle}>{loading && !updatedAt ? 'Looking for orders near you…' : 'No orders nearby right now'}</Text>
              <Text style={nxText.small}>New orders appear here automatically. Stay in your duty area.</Text>
            </View>
          </View>
        </NxPanel>
      ) : (
        <NxPanel style={{ paddingVertical: 4 }}>
          {orders.map((o, i) => (
            <Pressable
              key={o.id}
              onPress={() => onSelect(o.id)}
              style={(s) => [styles.orderRow, i === orders.length - 1 && { borderBottomWidth: 0 }, o.id === selected && styles.orderRowOn, isHovered(s) && o.id !== selected && { backgroundColor: nx.page }]}
              accessibilityRole="button"
              accessibilityLabel={`Order ${i + 1}: ${orderTitle(o)}. ${orderMeta(o, now)}. Fare ${formatINR(o.fare)}.`}
            >
              <View style={[styles.orderNo, o.id === selected && { backgroundColor: nx.red, borderColor: nx.red }]}>
                <Text style={[styles.orderNoText, o.id === selected && { color: nx.white }]}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.orderTitle} numberOfLines={1}>
                  {orderTitle(o)}
                </Text>
                <Text style={[nxText.small, o.overdue && { color: nx.amber }]} numberOfLines={2}>
                  {orderMeta(o, now)}
                </Text>
                <Text style={styles.orderTag} numberOfLines={1}>
                  {o.source === 'fleet' ? 'Fleet order' : 'NESAM order'} · {o.paymentMethod}
                  {o.pickup.approx ? ' · area shown' : ''}
                </Text>
              </View>
              <View style={styles.orderRight}>
                <Text style={styles.orderFare}>{formatINR(o.fare)}</Text>
                <NxButton title="Take" compact onPress={() => onTake(o)} disabled={!!block} accessibilityLabel={`Take order ${o.code}`} />
              </View>
            </Pressable>
          ))}
          {block ? <Text style={[nxText.note, { marginTop: 8, marginBottom: 10, paddingHorizontal: 4 }]}>{block}</Text> : null}
        </NxPanel>
      )}
    </View>
  );
}

// ── Totals ──────────────────────────────────────────────────────────────────

function DutySummary({ shift, totals, done, now, onOpen }: { shift: LocalShift; totals: ReturnType<typeof liveTotals>; done: TripDetails[]; now: number; onOpen: (t: TripDetails) => void }) {
  const closed = shift.status !== 'Active' && shift.status !== 'Scheduled';
  if (shift.status === 'Scheduled') return null;
  const rows: [string, string, boolean?][] = [
    ['Orders completed', `${totals.done}${totals.inHand ? ` · ${totals.inHand} in hand` : ''}`],
    ['Hourly rentals · Pickup & Drop', `${totals.rental} · ${totals.pickupDrop}`],
    ['Kilometres', `${totals.km} km`],
    ['Time on duty', spanText(dutyMinutes(shift, now))],
    ['Fare billed', formatINR(totals.fare)],
    ['Collected', formatINR(totals.collected)],
    ['Still to collect', formatINR(totals.balanceDue), totals.balanceDue > 0],
  ];
  return (
    <NxPanel style={{ marginTop: closed ? 0 : 20 }}>
      <Text style={nxText.eyebrow}>{closed ? 'Duty closed' : 'Today’s duty so far'}</Text>
      <View style={styles.cashBox}>
        <Text style={styles.cashLabel}>Cash with you</Text>
        <Text style={styles.cashValue} numberOfLines={1} adjustsFontSizeToFit>
          {formatINR(totals.cashInHand)}
        </Text>
        <Text style={styles.cashNote}>Collected by you on this duty · settle it with {shift.vendorName}</Text>
      </View>
      {rows.map(([label, value, warn], i) => (
        <View key={label} style={[styles.sumRow, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
          <Text style={styles.sumLabel}>{label}</Text>
          <Text style={[styles.sumValue, warn && { color: nx.red }]}>{value}</Text>
        </View>
      ))}
      {totals.overtimeMinutes > 0 ? <Text style={nxText.note}>Rental extra time recorded: {spanText(totals.overtimeMinutes)} (billed by the office).</Text> : null}
      {done.length ? (
        <>
          <Text style={[nxText.eyebrow, { marginTop: 18 }]}>Completed orders</Text>
          {done.map((t) => (
            <Pressable key={t.id} onPress={() => onOpen(t)} style={(s) => [styles.doneRow, isHovered(s) && { backgroundColor: nx.page }]} accessibilityRole="button" accessibilityLabel={`Open ${t.bookingId}`}>
              <NxIcon name={t.localMode === 'rental' ? 'clock' : 'navigate'} size={15} color={nx.muted} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.doneTitle} numberOfLines={1}>
                  {t.localMode === 'rental' ? `${placeName(t.pickup.address)} · ${t.rentalHours ?? ''} h rental` : `${placeName(t.pickup.address)} → ${placeName(t.drop.address)}`}
                </Text>
                <Text style={nxText.small} numberOfLines={1}>
                  {t.bookingId}
                  {t.completedAt ? ` · ${formatTime12(t.completedAt)}` : ''}
                  {t.totalKm ? ` · ${t.totalKm} km` : ''}
                  {(t.balanceDue ?? 0) > 0 ? ` · ${formatINR(t.balanceDue ?? 0)} due` : ' · paid'}
                </Text>
              </View>
              <Text style={styles.doneFare}>{formatINR(t.fareAmount)}</Text>
            </Pressable>
          ))}
        </>
      ) : closed ? null : (
        <Text style={nxText.note}>Completed orders appear here with their fares and payments.</Text>
      )}
    </NxPanel>
  );
}

// ── Dialogs ─────────────────────────────────────────────────────────────────

function TakeDialog({ order, queued, busy, now, onClose, onTake }: { order: BoardOrder | null; queued: boolean; busy: boolean; now: number; onClose: () => void; onTake: (o: BoardOrder) => Promise<void> }) {
  return (
    <NxDialog
      visible={!!order}
      onClose={onClose}
      eyebrow={order ? `${LOCAL_MODE_LABEL[order.mode]} · ${order.code}` : ''}
      title={queued ? 'Take as your next order?' : 'Take this order?'}
      locked={busy}
      footer={order ? <NxButton title={busy ? 'Taking…' : queued ? 'Take as next order' : 'Take order'} icon="check" loading={busy} onPress={() => void onTake(order)} /> : null}
    >
      {order ? (
        <>
          <View style={styles.routeBox}>
            <RouteLine dot="from" name={placeName(order.pickup.name)} detail={`${order.awayKm} km from you · pickup ${pickupWhen(order.pickupAtMs, now).toLowerCase()}`} />
            {order.mode === 'rental' ? null : <RouteLine dot="to" name={placeName(order.drop?.name ?? '')} detail={order.tripKm ? `${order.tripKm} km trip` : 'Drop'} />}
          </View>
          <View style={[styles.spread, { marginTop: 4 }]}>
            <Text style={nxText.copy}>{order.mode === 'rental' ? `${order.rentalHours ?? '—'} hour package${order.includedKm ? ` · ${order.includedKm} km included` : ''}` : 'Fare'}</Text>
            <Text style={styles.fare}>{formatINR(order.fare)}</Text>
          </View>
          <Text style={nxText.note}>
            {queued
              ? 'It is added after the order in hand. The customer is told you are coming.'
              : 'The customer is told you are coming. Open the trip to see the exact pickup and verify the boarding OTP.'}
            {order.source === 'marketplace' ? ' This is a NESAM order taken for your fleet on its published terms.' : ''}
          </Text>
        </>
      ) : null}
    </NxDialog>
  );
}

const HAND_BACK_REASONS = ['Too far from me', 'Vehicle problem', 'Customer not reachable', 'Other'];

function HandBackDialog({ trip, busy, onClose, onConfirm }: { trip: TripDetails | null; busy: boolean; onClose: () => void; onConfirm: (t: TripDetails, reason: string) => Promise<void> }) {
  const [choice, setChoice] = useState(HAND_BACK_REASONS[0]!);
  const [other, setOther] = useState('');
  const [error, setError] = useState('');
  const reason = choice === 'Other' ? other.trim() : choice;
  return (
    <NxDialog
      visible={!!trip}
      onClose={onClose}
      eyebrow={trip?.bookingId}
      title="Hand this order back?"
      locked={busy}
      footer={
        <NxButton
          title={busy ? 'Handing back…' : 'Hand back to fleet'}
          variant="dark"
          loading={busy}
          onPress={() => {
            if (reason.length < 3) return setError('Say why you are handing it back.');
            setError('');
            if (trip) void onConfirm(trip, reason);
            return undefined;
          }}
        />
      }
    >
      <Text style={nxText.copy}>Your fleet partner assigns it to another driver. Hand back only before reaching the pickup — at most 3 orders per duty.</Text>
      <View style={styles.reasons}>
        {HAND_BACK_REASONS.map((r) => (
          <Pressable key={r} onPress={() => setChoice(r)} style={[styles.reason, choice === r && styles.reasonOn]} accessibilityRole="radio" accessibilityState={{ selected: choice === r }}>
            <Text style={[styles.reasonText, choice === r && { color: nx.white }]}>{r}</Text>
          </Pressable>
        ))}
      </View>
      {choice === 'Other' ? <NxField label="Reason" value={other} onChangeText={setOther} maxLength={200} /> : null}
      <NxFormError message={error} />
    </NxDialog>
  );
}

function EndDialog({ visible, shift, inHand, busy, onClose, onConfirm }: { visible: boolean; shift: LocalShift; inHand: number; busy: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const scheduled = shift.status === 'Scheduled';
  const [reason, setReason] = useState('');
  return (
    <NxDialog
      visible={visible}
      onClose={onClose}
      eyebrow={`Local duty · ${shift.cityName}`}
      title={scheduled ? 'Cancel this planned duty?' : inHand ? 'End after the orders in hand?' : 'End your local duty?'}
      locked={busy}
      footer={<NxButton title={busy ? 'Please wait…' : scheduled ? 'Cancel duty' : inHand ? 'Stop new orders' : 'End duty'} icon="power" variant="dark" loading={busy} onPress={() => void onConfirm(reason.trim())} />}
    >
      <Text style={nxText.copy}>
        {scheduled
          ? `${shift.vendorName} is told that you will not run this duty.`
          : inHand
            ? `No new orders are shown. Finish your ${inHand === 1 ? 'order' : `${inHand} orders`} in hand; the duty then closes and ${shift.vendorName} gets the totals.`
            : `The duty closes now and ${shift.vendorName} gets the totals: orders, kilometres, fares and the cash you collected.`}
      </Text>
      <NxField label="Reason (optional)" value={reason} onChangeText={setReason} maxLength={200} placeholder="e.g. Vehicle needs service" />
    </NxDialog>
  );
}

const styles = StyleSheet.create({
  twoPane: { flexDirection: 'row', alignItems: 'flex-start', gap: 24 },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  how: { marginTop: 12, gap: 14 },
  howItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  howIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: nx.redSoft, alignItems: 'center', justifyContent: 'center' },
  howTitle: { fontSize: 13, fontWeight: '700', color: nx.ink, marginBottom: 2 },
  upcoming: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: nx.line },
  upcomingTitle: { fontSize: 13, fontWeight: '600', color: nx.ink, marginBottom: 2 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flexGrow: 1, flexBasis: 150, minWidth: 0 },
  factLabel: { fontSize: 10.5, color: nx.muted, marginBottom: 2 },
  factValue: { fontSize: 12.5, fontWeight: '600', color: nx.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: nx.page, borderWidth: 1, borderColor: nx.line },
  chipText: { fontSize: 11.5, fontWeight: '600', color: nx.ink },
  dutyStats: { flexDirection: 'row', gap: 10, marginTop: 16 },
  miniStat: { flex: 1, minWidth: 0, backgroundColor: nx.page, borderRadius: 11, paddingVertical: 10, paddingHorizontal: 11 },
  miniLabel: { fontSize: 10.5, color: nx.muted },
  miniValue: { fontSize: 16, fontWeight: '700', letterSpacing: -0.3, color: nx.ink, marginTop: 3 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: nx.line },
  stepNo: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: nx.line, backgroundColor: nx.white, alignItems: 'center', justifyContent: 'center' },
  stepNoText: { fontSize: 12, fontWeight: '700', color: nx.muted },
  stepTitle: { fontSize: 13, fontWeight: '700', color: nx.ink, marginBottom: 2 },
  routeBox: { marginTop: 14, gap: 12 },
  routeLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  routeDot: { width: 11, height: 11, borderRadius: 6, marginTop: 4 },
  routeFrom: { backgroundColor: nx.white, borderWidth: 3, borderColor: nx.green },
  routeTo: { backgroundColor: nx.ink },
  routeName: { fontSize: 14, fontWeight: '700', letterSpacing: -0.2, color: nx.ink },
  orderMeta: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: nx.line },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 11, height: 11, borderRadius: 6, borderWidth: 2 },
  legendText: { fontSize: 11, color: nx.muted },
  fare: { fontSize: 20, fontWeight: '700', letterSpacing: -0.5, color: nx.ink },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  waitingTitle: { fontSize: 13, fontWeight: '600', color: nx.ink, marginBottom: 2 },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: nx.line, borderRadius: 8 },
  orderRowOn: { backgroundColor: nx.redSoft },
  orderNo: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: nx.red, backgroundColor: nx.white, alignItems: 'center', justifyContent: 'center' },
  orderNoText: { fontSize: 11.5, fontWeight: '700', color: nx.red },
  orderTitle: { fontSize: 13.5, fontWeight: '700', color: nx.ink, marginBottom: 2 },
  orderTag: { fontSize: 10.5, color: nx.faint, marginTop: 3 },
  orderRight: { alignItems: 'flex-end', gap: 6 },
  orderFare: { fontSize: 14, fontWeight: '700', color: nx.ink },
  cashBox: { alignItems: 'center', backgroundColor: nx.greenSoft, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 14, marginTop: 12, marginBottom: 6 },
  cashLabel: { fontSize: 11.5, fontWeight: '600', color: '#286B4C' },
  cashValue: { fontSize: 30, fontWeight: '700', letterSpacing: -1, color: nx.green, marginTop: 4 },
  cashNote: { fontSize: 11, color: '#286B4C', textAlign: 'center', marginTop: 3 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: nx.line },
  sumLabel: { fontSize: 12.5, color: nx.muted, flexShrink: 1 },
  sumValue: { fontSize: 12.5, fontWeight: '700', color: nx.ink },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: nx.line, borderRadius: 6 },
  doneTitle: { fontSize: 12.5, fontWeight: '600', color: nx.ink, marginBottom: 2 },
  doneFare: { fontSize: 12.5, fontWeight: '700', color: nx.ink },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  reason: { paddingHorizontal: 12, minHeight: 38, borderRadius: 9, borderWidth: 1, borderColor: nx.line, backgroundColor: nx.white, alignItems: 'center', justifyContent: 'center' },
  reasonOn: { backgroundColor: nx.ink, borderColor: nx.ink },
  reasonText: { fontSize: 12, fontWeight: '600', color: nx.muted },
  formLabel: { fontSize: 12.5, fontWeight: '700', color: nx.ink, marginTop: 18, marginBottom: 8 },
});
