// Local duty ("continuous moving") for the fleet partner.
//
// Put a driver and a vehicle on local duty for a city and hours — Hourly Rental, Pickup & Drop or both. During the duty
// the driver takes local orders one after another in the NESAM Driver app (Local Taxi): your own unassigned local orders
// and open NESAM duties of the same kind around them, after one selfie + vehicle photo check for the whole duty. Here the
// partner plans the duty, follows it live (what the driver is on, where they were last seen) and sees every order,
// kilometre, fare, payout and the cash the driver holds, worked out from the orders themselves.
//
//   LocalDutyTab     Fleet → Local duty: running, planned and recent duties
//   LocalDutySheet   plan a duty (driver, vehicle, city, services, start, hours, area)
//   ChangeDutySheet  change the end time, services or area of a planned / running duty
//   LocalShiftScreen one duty: status, orders, totals, actions
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { Text } from '../../components/kit/Text';
import { Sheet, TextField } from '../../components/ui';
import { PickerField } from '../../components/fleet/PickerField';
import { DetailGrid, Page } from '../../components/shell/Page';
import { Avatar, Badge, Between, Btn, Choice, Empty, Eyebrow, Feedback, Grid, H2, Inline, KV, MenuItem, Notice, Panel, SectionLine, Small } from '../../components/kit/core';
import { plate } from '../../components/kit/format';
import { flash } from '../../components/kit/flash';
import { useVendorData } from '../../context/VendorData';
import { goSection } from '../../navigation/navigationRef';
import type { RootStackParamList } from '../../navigation/types';
import {
  DEFAULT_DUTY_CITIES, LOCAL_MODE_LABEL, createLocalShift, dutyMinutes, endLocalShift, localDutyOptions, shiftState, spanText, subscribeToLocalShifts, updateLocalShift,
  type DutyCity, type LocalMode, type LocalShift,
} from '../../services/localDutyService';
import type { FleetDriver, FleetVehicle, VendorBooking } from '../../types/operations';
import { formatINR, formatPhone } from '../../utils/format';
import { describeDataError } from '../../utils/retry';
import { colors, fontFamily } from '../../theme';

const MODES: LocalMode[] = ['rental', 'pickup_drop'];
const HOURS = [4, 6, 8, 10, 12, 14];
const RADII = [5, 10, 15, 25, 40];
const OPEN = (s: LocalShift) => s.status === 'Scheduled' || s.status === 'Active';
const time = (d: Date | null) => (d ? d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }) : '—');
const day = (d: Date | null) => (d ? d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' }) : '');
const windowText = (s: LocalShift) => `${day(s.startsAt)} · ${time(s.startsAt)} – ${time(s.endsAt)}`;
const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : describeDataError(e) || fallback);

/** This fleet's duties, live. */
export function useLocalShifts(): { shifts: LocalShift[]; loaded: boolean; error: string } {
  const { profile } = useVendorData();
  const [shifts, setShifts] = useState<LocalShift[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  useEffect(
    () =>
      subscribeToLocalShifts(
        profile.id,
        (list) => {
          setShifts(list);
          setLoaded(true);
          setError('');
        },
        (e) => {
          setLoaded(true);
          setError(describeDataError(e));
        },
      ),
    [profile.id],
  );
  return { shifts, loaded, error };
}

export interface DutyTotals {
  done: number;
  inHand: number;
  rental: number;
  pickupDrop: number;
  km: number;
  fare: number;
  payout: number;
  cashInHand: number;
  paidOnline: number;
  balanceDue: number;
  overtimeMinutes: number;
}

/** A duty's totals from its own orders (the same figures the server keeps on the duty record). */
export function dutyTotals(orders: VendorBooking[]): DutyTotals {
  const t: DutyTotals = { done: 0, inHand: 0, rental: 0, pickupDrop: 0, km: 0, fare: 0, payout: 0, cashInHand: 0, paidOnline: 0, balanceDue: 0, overtimeMinutes: 0 };
  for (const b of orders) {
    if (b.status === 'Cancelled' || b.status === 'Rejected') continue;
    if (b.tripType === 'Hourly Rental') t.rental += 1;
    else t.pickupDrop += 1;
    if (b.status === 'Assigned' || b.status === 'Ongoing') t.inHand += 1;
    if (b.status !== 'Completed') continue;
    t.done += 1;
    t.km += b.trip.totalKm;
    t.fare += b.fare;
    t.payout += b.vendorPayout;
    t.cashInHand += b.payment?.partnerCashHeld ?? 0;
    t.paidOnline += b.payment?.companyCollected ?? 0;
    t.balanceDue += Math.max(0, b.payment?.balanceDue ?? 0);
    t.overtimeMinutes += b.rentalUsage?.overtimeMinutes ?? 0;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { ...t, km: Math.round(t.km * 10) / 10, fare: r2(t.fare), payout: r2(t.payout), cashInHand: r2(t.cashInHand), paidOnline: r2(t.paidOnline), balanceDue: r2(t.balanceDue) };
}

const ordersOf = (bookings: VendorBooking[], shiftId: string) => bookings.filter((b) => b.localShiftId === shiftId);

function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// ── Fleet → Local duty ──────────────────────────────────────────────────────

export function LocalDutyTab({ onPlan }: { onPlan: () => void }) {
  const { shifts, loaded, error } = useLocalShifts();
  const { bookings } = useVendorData();
  const now = useNow();
  const open = shifts.filter(OPEN);
  const recent = shifts.filter((s) => !OPEN(s) && (s.endedAt?.getTime() ?? s.endsAt?.getTime() ?? 0) > now - 7 * 86400000);
  return (
    <View>
      <Notice
        tone="blue"
        icon="navigate-circle-outline"
        title="Local duty: one driver, many local orders"
        text="Put a driver on local duty for a city and hours. They do one photo check, then take Hourly Rental and Pickup & Drop orders one after another — your own local orders and open NESAM duties nearby. Every order, kilometre, fare and the cash they collect is added up here."
        style={{ marginBottom: 16 }}
      />
      {error ? <Feedback tone="error" message={error} /> : null}
      <SectionLine title="Running & planned" meta={loaded ? `${open.length} ${open.length === 1 ? 'duty' : 'duties'}` : 'Loading…'} />
      {loaded && open.length === 0 ? (
        <Empty icon="navigate-outline" title="No local duty running" text="Choose a driver and a vehicle, the city and the hours. The driver gets it in the NESAM Driver app." action={<Btn icon="add" title="Start local duty" onPress={onPlan} />} />
      ) : (
        <Grid>{open.map((s) => <ShiftCard key={s.id} shift={s} orders={ordersOf(bookings, s.id)} now={now} />)}</Grid>
      )}
      {recent.length ? (
        <>
          <View style={{ height: 22 }} />
          <SectionLine title="Recent" meta="Last 7 days" />
          <Grid>{recent.map((s) => <ShiftCard key={s.id} shift={s} orders={ordersOf(bookings, s.id)} now={now} />)}</Grid>
        </>
      ) : null}
    </View>
  );
}

function ShiftCard({ shift, orders, now }: { shift: LocalShift; orders: VendorBooking[]; now: number }) {
  const navigation = useNavigation();
  const state = shiftState(shift);
  const t = dutyTotals(orders);
  const onIt = orders.find((b) => b.status === 'Ongoing') ?? orders.find((b) => b.status === 'Assigned');
  const seen = shift.lastLocation?.at ? Math.max(0, Math.round((now - shift.lastLocation.at.getTime()) / 60000)) : null;
  return (
    <Panel onPress={() => navigation.navigate('LocalShift', { id: shift.id })} label={`Local duty, ${shift.driverName}, ${shift.cityName}`} style={{ flexGrow: 1 }}>
      <Between>
        <Text style={styles.eyebrow}>LOCAL DUTY · {shift.cityName.toUpperCase()}</Text>
        <Badge label={state.label} tone={state.tone} />
      </Between>
      <View style={styles.person}>
        <Avatar name={shift.driverName} size={44} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{shift.driverName}</Text>
          <Small lines={1}>{plate(shift.vehicleNumber)} · {windowText(shift)}</Small>
        </View>
      </View>
      <Inline style={{ marginTop: 12 }}>
        {shift.services.map((m) => <Badge key={m} label={LOCAL_MODE_LABEL[m]} />)}
        {shift.status === 'Scheduled' ? <Badge label={shift.verified ? 'Photo check done' : 'Photo check pending'} tone={shift.verified ? 'green' : 'amber'} /> : null}
      </Inline>
      {shift.status !== 'Scheduled' ? (
        <View style={styles.statRow}>
          <MiniStat label="Orders" value={`${t.done}${t.inHand ? ` +${t.inHand}` : ''}`} />
          <MiniStat label="KM" value={String(t.km)} />
          <MiniStat label="Fare" value={formatINR(t.fare)} />
          <MiniStat label="Cash with driver" value={formatINR(t.cashInHand)} />
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      <Between style={{ marginTop: 14 }}>
        <Small lines={1} style={{ flexShrink: 1 }}>
          {shift.status === 'Active'
            ? onIt
              ? `On ${onIt.bookingId} · ${onIt.tripType}`
              : shift.paused
                ? 'On a break'
                : seen != null
                  ? `Waiting for orders · seen ${seen < 1 ? 'just now' : `${seen} min ago`}`
                  : 'Waiting for orders'
            : shift.status === 'Scheduled'
              ? `Starts ${time(shift.startsAt)}`
              : shift.endedAt
                ? `Closed ${time(shift.endedAt)}`
                : 'Closed'}
        </Small>
        <Ionicons name="chevron-forward" size={16} color="#A9AEB8" />
      </Between>
    </Panel>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.mini}>
      <Text style={styles.miniLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.miniValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

// ── Plan a duty ─────────────────────────────────────────────────────────────

const driverProblem = (x: FleetDriver, busy: Set<string>) =>
  x.approvalStatus !== 'Approved' ? 'Not approved by NESAM yet' : x.fleetStatus === 'Suspended' ? 'Suspended in your fleet' : busy.has(x.id) ? 'Already on local duty' : '';
const vehicleProblem = (v: FleetVehicle, driverId: string, busy: Set<string>) =>
  v.docStatus !== 'Approved' ? 'Documents not approved' : v.status !== 'Active' ? 'Not in service' : v.assignedDriverId && v.assignedDriverId !== driverId ? 'Paired with another driver' : busy.has(v.id) ? 'Already on local duty' : '';

export function LocalDutySheet({ onClose, driverId: initialDriver }: { onClose: () => void; driverId?: string }) {
  const { drivers, vehicles } = useVendorData();
  const { shifts } = useLocalShifts();
  const busyDrivers = useMemo(() => new Set(shifts.filter(OPEN).map((s) => s.driverId)), [shifts]);
  const busyVehicles = useMemo(() => new Set(shifts.filter(OPEN).map((s) => s.vehicleId)), [shifts]);
  const [driverId, setDriverId] = useState(initialDriver ?? '');
  const driver = drivers.find((x) => x.id === driverId) ?? null;
  const [vehicleId, setVehicleId] = useState(() => drivers.find((x) => x.id === initialDriver)?.assignedVehicleId ?? '');
  const [cities, setCities] = useState<DutyCity[]>(DEFAULT_DUTY_CITIES);
  const [cityId, setCityId] = useState('erode');
  const [cityName, setCityName] = useState('Erode');
  const [services, setServices] = useState<LocalMode[]>(['rental', 'pickup_drop']);
  const [startNow, setStartNow] = useState(true);
  const [startAt, setStartAt] = useState(() => {
    const d = new Date(Date.now() + 86400000);
    d.setHours(8, 0, 0, 0);
    return d;
  });
  const [hours, setHours] = useState(8);
  const [radius, setRadius] = useState(15);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    localDutyOptions()
      .then((r) => {
        if (!alive || !r.cities.length) return;
        setCities(r.cities);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const pickDriver = (id: string) => {
    setDriverId(id);
    const paired = drivers.find((x) => x.id === id)?.assignedVehicleId;
    if (paired) setVehicleId(paired);
  };
  const toggle = (m: LocalMode) => setServices((list) => (list.includes(m) ? list.filter((x) => x !== m) : MODES.filter((x) => x === m || list.includes(x))));
  const pickStart = (mode: 'date' | 'time') =>
    DateTimePickerAndroid.open({
      value: startAt,
      mode,
      is24Hour: false,
      minimumDate: mode === 'date' ? new Date() : undefined,
      onChange: (event, d) => {
        if (event.type !== 'set' || !d) return;
        const next = new Date(startAt);
        if (mode === 'date') next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
        else next.setHours(d.getHours(), d.getMinutes(), 0, 0);
        setStartAt(next);
      },
    });

  const chosenCity = cities?.find((c) => c.id === cityId) ?? null;
  const cityLabel = chosenCity?.name || cityName.trim();
  const [nowAtOpen] = useState(() => Date.now());
  const startMs = startNow ? nowAtOpen : startAt.getTime();
  const endMs = startMs + hours * 3600000;

  const submit = async () => {
    if (!driver) return setError('Choose the driver.');
    if (!vehicleId) return setError('Choose the vehicle.');
    if (!cityLabel) return setError('Choose the city.');
    if (!services.length) return setError('Choose Hourly Rental, Pickup & Drop or both.');
    setBusy(true);
    setError('');
    try {
      const v = vehicles.find((veh) => veh.id === vehicleId);
      await createLocalShift({
        driverId: driver.id,
        driverName: driver.name,
        driverPhone: driver.phone,
        vehicleId,
        vehicleNumber: v?.vehicleNumber ?? '',
        vehicleCategory: v?.category ?? '',
        vehicleClass: v?.vehicleClass ?? v?.category ?? '',
        cityId: chosenCity?.id ?? '',
        cityName: cityLabel,
        services,
        startsAt: startNow ? 'now' : startMs,
        endsAt: startNow ? Date.now() + hours * 3600000 : endMs,
        radiusKm: radius,
        note: note.trim(),
      });
      flash(`${driver.name} is on local duty in ${cityLabel}. The driver has been notified.`);
      onClose();
    } catch (e) {
      setError(message(e, 'The local duty was not saved.'));
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const usableDrivers = drivers.filter((x) => !driverProblem(x, busyDrivers) || x.id === driverId);
  const otherDrivers = drivers.filter((x) => !usableDrivers.includes(x));
  return (
    <Sheet visible onClose={onClose} title="Start local duty" dismissible={!busy}>
      <Small style={{ marginBottom: 14 }}>The driver takes local orders one after another in the NESAM Driver app until the duty ends.</Small>

      <Text style={styles.label}>Driver</Text>
      {drivers.length === 0 ? <Notice tone="amber" title="No drivers in your fleet" text="Add a driver under Fleet → Drivers first." /> : null}
      <View style={styles.choices}>
        {[...usableDrivers, ...otherDrivers].slice(0, 30).map((x) => {
          const problem = driverProblem(x, busyDrivers);
          return (
            <Choice key={x.id} title={x.name} sub={`${formatPhone(x.phone)}${x.assignedVehicleNumber ? ` · ${plate(x.assignedVehicleNumber)}` : ''}${x.presenceStatus ? ` · ${x.presenceStatus}` : ''}`}
              selected={driverId === x.id} disabled={!!problem} reason={problem} onPress={() => pickDriver(x.id)} left={<Avatar name={x.name} size={34} />} />
          );
        })}
      </View>

      <Text style={styles.label}>Vehicle</Text>
      <View style={styles.choices}>
        {vehicles.length === 0 ? <Notice tone="amber" title="No vehicles in your fleet" text="Add a vehicle under Fleet → Vehicles first." /> : null}
        {vehicles.slice(0, 30).map((v) => {
          const problem = vehicleProblem(v, driverId, busyVehicles);
          return <Choice key={v.id} title={plate(v.vehicleNumber)} sub={[v.category, [v.make, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')} selected={vehicleId === v.id} disabled={!!problem} reason={problem} onPress={() => setVehicleId(v.id)} />;
        })}
      </View>

      <Text style={styles.label}>City</Text>
      <PickerField
        label="City"
        value={cityId}
        placeholder="Choose the city"
        options={[...cities.map((c) => ({ value: c.id, label: c.name, hint: c.state })), { value: '__other', label: 'Another city (type it)' }]}
        onChange={(v) => {
          setCityId(v === '__other' ? '' : v);
          if (v !== '__other') {
            const found = cities.find((c) => c.id === v);
            if (found) setCityName(found.name);
          } else {
            setCityName('');
          }
        }}
        hint={chosenCity && !chosenCity.hasCentre ? 'The duty area is set around the driver when they start.' : undefined}
      />
      {cityId === '' ? (
        <TextField
          label="Type city name"
          value={cityName}
          onChangeText={setCityName}
          placeholder="e.g. Erode, Tiruppur, Karur"
          maxLength={80}
          hint="The duty area is set around the driver when they start."
          style={{ marginTop: 8 }}
        />
      ) : null}

      <Text style={styles.label}>Orders the driver takes</Text>
      <View style={styles.chips}>
        {MODES.map((m) => (
          <Pressable key={m} onPress={() => toggle(m)} style={[styles.chip, services.includes(m) && styles.chipOn]} accessibilityRole="checkbox" accessibilityState={{ checked: services.includes(m) }}>
            <Ionicons name={services.includes(m) ? 'checkbox' : 'square-outline'} size={16} color={services.includes(m) ? colors.white : colors.muted} />
            <Text style={[styles.chipText, services.includes(m) && { color: colors.white }]}>{LOCAL_MODE_LABEL[m]}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Start</Text>
      <View style={styles.chips}>
        <ChipButton label="Now" on={startNow} onPress={() => setStartNow(true)} />
        <ChipButton label="Later" on={!startNow} onPress={() => setStartNow(false)} />
      </View>
      {!startNow ? (
        <View style={[styles.chips, { marginTop: 8 }]}>
          <Pressable onPress={() => pickStart('date')} style={styles.pick} accessibilityRole="button" accessibilityLabel="Start date">
            <Ionicons name="calendar-outline" size={17} color={colors.muted} />
            <Text style={styles.pickText}>{startAt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</Text>
          </Pressable>
          <Pressable onPress={() => pickStart('time')} style={styles.pick} accessibilityRole="button" accessibilityLabel="Start time">
            <Ionicons name="time-outline" size={17} color={colors.muted} />
            <Text style={styles.pickText}>{startAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.label}>Hours on duty</Text>
      <View style={styles.chips}>{HOURS.map((h) => <ChipButton key={h} label={`${h} h`} on={hours === h} onPress={() => setHours(h)} />)}</View>

      <Text style={styles.label}>Duty area</Text>
      <View style={styles.chips}>{RADII.map((r) => <ChipButton key={r} label={`${r} km`} on={radius === r} onPress={() => setRadius(r)} />)}</View>
      <Small style={{ marginTop: 6 }}>Orders with a pickup within this distance of the city centre (or the driver’s start) are shown.</Small>

      <View style={{ height: 14 }} />
      <TextField label="Note for the driver (optional)" value={note} onChangeText={setNote} placeholder="e.g. Stay near the railway station after 6 PM" maxLength={200} />

      <View style={styles.summary}>
        <Ionicons name="navigate-circle-outline" size={20} color={colors.primary} />
        <Text style={styles.summaryText}>
          {driver ? driver.name : 'Driver'} · {vehicleId ? plate(vehicles.find((v) => v.id === vehicleId)?.vehicleNumber ?? '') : 'vehicle'} · {cityLabel || 'city'} ·{' '}
          {startNow ? `now – ${time(new Date(Date.now() + hours * 3600000))}` : `${day(startAt)} ${time(startAt)} – ${time(new Date(endMs))}`} · {services.map((m) => LOCAL_MODE_LABEL[m]).join(' + ') || 'no service'}
        </Text>
      </View>
      <Feedback tone="error" message={error} />
      <Btn title={startNow ? 'Start local duty' : 'Plan local duty'} icon="checkmark" busy={busy} full onPress={() => void submit()} />
    </Sheet>
  );
}

function ChipButton({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
      <Text style={[styles.chipText, on && { color: colors.white }]}>{label}</Text>
    </Pressable>
  );
}

// ── Change a duty ───────────────────────────────────────────────────────────

function ChangeDutySheet({ shift, onClose }: { shift: LocalShift; onClose: () => void }) {
  const [end, setEnd] = useState(() => shift.endsAt ?? new Date());
  const [services, setServices] = useState<LocalMode[]>(shift.services);
  const [radius, setRadius] = useState(shift.radiusKm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shiftEnd = (h: number) => setEnd((d) => new Date(d.getTime() + h * 3600000));
  const toggle = (m: LocalMode) => setServices((list) => (list.includes(m) ? list.filter((x) => x !== m) : MODES.filter((x) => x === m || list.includes(x))));
  const save = async () => {
    if (!services.length) return setError('Choose Hourly Rental, Pickup & Drop or both.');
    setBusy(true);
    setError('');
    try {
      const r = await updateLocalShift({
        shiftId: shift.id,
        ...(end.getTime() !== shift.endsAt?.getTime() ? { endsAt: end.getTime() } : {}),
        ...(services.join() !== shift.services.join() ? { services } : {}),
        ...(radius !== shift.radiusKm ? { radiusKm: radius } : {}),
      });
      flash(r.changed ? 'Local duty updated. The driver has been notified.' : 'Nothing changed.');
      onClose();
    } catch (e) {
      setError(message(e, 'The change was not saved.'));
    } finally {
      setBusy(false);
    }
    return undefined;
  };
  return (
    <Sheet visible onClose={onClose} title="Change local duty" dismissible={!busy}>
      <Text style={styles.label}>Ends at</Text>
      <Text style={styles.endText}>{end.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
      <View style={styles.chips}>
        <ChipButton label="− 1 h" on={false} onPress={() => shiftEnd(-1)} />
        <ChipButton label="+ 1 h" on={false} onPress={() => shiftEnd(1)} />
        <ChipButton label="+ 2 h" on={false} onPress={() => shiftEnd(2)} />
      </View>
      <Small style={{ marginTop: 6 }}>A duty can last up to 16 hours from its start.</Small>
      <Text style={styles.label}>Orders the driver takes</Text>
      <View style={styles.chips}>
        {MODES.map((m) => (
          <Pressable key={m} onPress={() => toggle(m)} style={[styles.chip, services.includes(m) && styles.chipOn]} accessibilityRole="checkbox" accessibilityState={{ checked: services.includes(m) }}>
            <Ionicons name={services.includes(m) ? 'checkbox' : 'square-outline'} size={16} color={services.includes(m) ? colors.white : colors.muted} />
            <Text style={[styles.chipText, services.includes(m) && { color: colors.white }]}>{LOCAL_MODE_LABEL[m]}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Duty area</Text>
      <View style={styles.chips}>{RADII.map((r) => <ChipButton key={r} label={`${r} km`} on={radius === r} onPress={() => setRadius(r)} />)}</View>
      <View style={{ height: 16 }} />
      <Feedback tone="error" message={error} />
      <Btn title="Save changes" icon="checkmark" busy={busy} full onPress={() => void save()} />
    </Sheet>
  );
}

// ── One duty ────────────────────────────────────────────────────────────────

export function LocalShiftScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'LocalShift'>>();
  const navigation = useNavigation();
  const { shifts, loaded } = useLocalShifts();
  const { bookings } = useVendorData();
  const now = useNow();
  const [changing, setChanging] = useState(false);
  const [ending, setEnding] = useState(false);
  const shift = shifts.find((s) => s.id === params.id) ?? null;
  if (!shift) {
    return (
      <Page title="Local duty">
        {loaded ? <Empty icon="navigate-outline" title="Local duty not found" text="It may belong to another account." action={<Btn kind="secondary" icon="arrow-back" title="Fleet" onPress={() => goSection('Fleet', { tab: 'Local duty' })} />} /> : <Small>Loading…</Small>}
      </Page>
    );
  }
  const orders = ordersOf(bookings, shift.id).sort((a, b) => (b.trip.assignedAt?.getTime() ?? 0) - (a.trip.assignedAt?.getTime() ?? 0));
  const t = dutyTotals(orders);
  const state = shiftState(shift);
  const open = OPEN(shift);
  const worked = dutyMinutes(shift, now);
  const seen = shift.lastLocation?.at ? Math.max(0, Math.round((now - shift.lastLocation.at.getTime()) / 60000)) : null;

  const end = () =>
    Alert.alert(
      shift.status === 'Scheduled' ? 'Cancel this local duty?' : t.inHand ? 'End after the orders in hand?' : 'End this local duty?',
      shift.status === 'Scheduled' ? `${shift.driverName} is told the duty is cancelled.` : t.inHand ? 'The driver gets no new orders. The duty closes when the orders in hand are finished.' : 'The duty closes now and the totals are final.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: shift.status === 'Scheduled' ? 'Cancel duty' : 'End duty',
          style: 'destructive',
          onPress: () => {
            setEnding(true);
            endLocalShift(shift.id)
              .then((r) => flash(r.status === 'Ending' ? 'No new orders. The duty closes after the orders in hand.' : r.status === 'Cancelled' ? 'Local duty cancelled.' : 'Local duty ended.'))
              .catch((e: unknown) => flash(message(e, 'The duty was not ended.'), 'error'))
              .finally(() => setEnding(false));
          },
        },
      ],
    );

  const main = (
    <>
      <Panel>
        <Between>
          <Eyebrow>LOCAL DUTY · {shift.cityName.toUpperCase()}</Eyebrow>
          <Badge label={state.label} tone={state.tone} />
        </Between>
        <View style={styles.person}>
          <Avatar name={shift.driverName} size={52} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.big}>{shift.driverName}</Text>
            <Small>{plate(shift.vehicleNumber)}{shift.vehicleCategory ? ` · ${shift.vehicleCategory}` : ''}</Small>
          </View>
        </View>
        <Inline style={{ marginTop: 12 }}>
          {shift.services.map((m) => <Badge key={m} label={LOCAL_MODE_LABEL[m]} />)}
          <Badge label={shift.verified ? (shift.verificationFlagged ? 'Photos under review' : 'Photo check done') : 'Photo check pending'} tone={shift.verified ? (shift.verificationFlagged ? 'amber' : 'green') : 'amber'} />
        </Inline>
        <KV
          rows={[
            ['Hours', windowText(shift)],
            ['Area', `${shift.radiusKm} km around ${shift.cityName}`],
            shift.startedAt ? ['Started', time(shift.startedAt)] : null,
            shift.status === 'Active' ? ['Last seen', seen == null ? 'Not yet' : seen < 1 ? 'Just now' : `${seen} min ago`] : null,
            shift.endedAt ? ['Closed', `${time(shift.endedAt)}${shift.endedBy ? ` · by ${shift.endedBy}` : ''}`] : null,
            shift.endReason ? ['Reason', shift.endReason] : null,
            shift.releases ? ['Orders handed back', String(shift.releases)] : null,
            shift.note ? ['Note to driver', shift.note] : null,
          ]}
        />
        {shift.endRequested && shift.status === 'Active' ? <Notice tone="amber" title="Ending" text="No new orders. The duty closes when the orders in hand are finished." style={{ marginTop: 12 }} /> : null}
      </Panel>

      <Panel>
        <Between>
          <H2>Orders on this duty</H2>
          <Small>{orders.length}</Small>
        </Between>
        {orders.length === 0 ? (
          <Small style={{ marginTop: 10 }}>{shift.status === 'Scheduled' ? 'Orders appear here once the driver starts the duty and takes them.' : 'No orders yet. Your unassigned local orders in the area appear in the driver’s list automatically.'}</Small>
        ) : (
          orders.map((b, i) => (
            <Pressable key={b.id} onPress={() => navigation.navigate('Booking', { id: b.id })} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.order, i === orders.length - 1 && { borderBottomWidth: 0 }, hovered && { backgroundColor: colors.bg }]} accessibilityRole="button" accessibilityLabel={`Open ${b.bookingId}`}>
              <View style={[styles.orderIcon, b.status === 'Completed' && { backgroundColor: colors.successSoft }]}>
                <Ionicons name={b.tripType === 'Hourly Rental' ? 'time-outline' : 'navigate-outline'} size={16} color={b.status === 'Completed' ? colors.success : colors.muted} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.orderTitle} numberOfLines={1}>
                  {b.tripType === 'Hourly Rental' ? `${b.pickupAddress.split(',')[0]} · ${b.rentalHours || ''} h rental` : `${b.pickupAddress.split(',')[0]} → ${b.dropAddress.split(',')[0]}`}
                </Text>
                <Small lines={2}>
                  {b.bookingId} · {b.status === 'Completed' ? 'Completed' : b.status === 'Ongoing' ? 'On trip' : b.status === 'Assigned' ? 'Heading to pickup' : b.status}
                  {b.trip.totalKm ? ` · ${b.trip.totalKm} km` : ''}
                  {b.rentalUsage && b.rentalUsage.overtimeMinutes > 0 ? ` · ${spanText(b.rentalUsage.overtimeMinutes)} over package` : ''}
                  {b.payment ? ` · ${b.payment.balanceDue > 0 ? `${formatINR(b.payment.balanceDue)} due` : 'paid'}` : ''}
                </Small>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.orderFare}>{formatINR(b.fare)}</Text>
                {b.payoutRecorded ? <Small>Payout {formatINR(b.vendorPayout)}</Small> : null}
              </View>
            </Pressable>
          ))
        )}
      </Panel>
    </>
  );

  const side = (
    <>
      <Panel>
        <Eyebrow>{open ? 'SO FAR' : 'DUTY TOTALS'}</Eyebrow>
        <View style={styles.cash}>
          <Text style={styles.cashLabel}>Cash with driver</Text>
          <Text style={styles.cashValue} numberOfLines={1} adjustsFontSizeToFit>{formatINR(t.cashInHand)}</Text>
          <Text style={styles.cashNote}>Collected by {shift.driverName} on this duty</Text>
        </View>
        <KV
          rows={[
            ['Orders completed', `${t.done}${t.inHand ? ` · ${t.inHand} in hand` : ''}`],
            ['Rentals · Pickup & Drop', `${t.rental} · ${t.pickupDrop}`],
            ['Kilometres', `${t.km} km`],
            ['Time on duty', spanText(worked)],
            ['Fare billed', formatINR(t.fare)],
            ['Your payout', formatINR(t.payout)],
            ['Paid to NESAM directly', formatINR(t.paidOnline)],
            ['Still to collect', formatINR(t.balanceDue)],
            t.overtimeMinutes ? ['Rental extra time', spanText(t.overtimeMinutes)] : null,
          ]}
        />
        <Small style={{ marginTop: 10 }}>Worked out from the duty’s orders. Payouts settle through your wallet as usual.</Small>
      </Panel>
      <Panel style={{ paddingVertical: 8 }}>
        {shift.driverPhone ? <MenuItem icon="call-outline" title="Call driver" sub={formatPhone(shift.driverPhone)} onPress={() => void Linking.openURL(`tel:${shift.driverPhone}`)} /> : null}
        {open && !shift.endRequested ? <MenuItem icon="create-outline" title="Change duty" sub="End time, services or area" onPress={() => setChanging(true)} /> : null}
        {open && !shift.endRequested ? (
          <MenuItem icon="power-outline" title={shift.status === 'Scheduled' ? 'Cancel duty' : 'End duty'} sub={ending ? 'Please wait…' : t.inHand ? 'After the orders in hand' : 'Close it now'} danger last onPress={end} />
        ) : (
          <MenuItem icon="list-outline" title="All local duties" onPress={() => goSection('Fleet', { tab: 'Local duty' })} last />
        )}
      </Panel>
    </>
  );

  return (
    <Page title="Local duty" subtitle={`${shift.driverName} · ${shift.cityName}`}>
      <DetailGrid main={main} side={side} sideWidth={320} />
      {changing ? <ChangeDutySheet shift={shift} onClose={() => setChanging(false)} /> : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontFamily, fontSize: 10, fontWeight: '600', letterSpacing: 1, color: '#8B919C', flexShrink: 1 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 16 },
  name: { fontFamily, fontSize: 16, fontWeight: '600', color: colors.ink, marginBottom: 3 },
  big: { fontFamily, fontSize: 20, fontWeight: '600', color: colors.ink, marginBottom: 3, letterSpacing: -0.2 },
  statRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  mini: { flex: 1, minWidth: 0, backgroundColor: colors.bg, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 9 },
  miniLabel: { fontFamily, fontSize: 10, color: colors.muted },
  miniValue: { fontFamily, fontSize: 14, fontWeight: '600', color: colors.ink, marginTop: 2 },
  label: { fontFamily, fontSize: 12.5, fontWeight: '600', color: colors.ink, marginTop: 16, marginBottom: 8 },
  choices: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 13, borderRadius: 10, borderWidth: 1, borderColor: colors.field, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily, fontSize: 12.5, fontWeight: '600', color: colors.text },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.field, backgroundColor: colors.white },
  pickText: { fontFamily, fontSize: 13, fontWeight: '500', color: colors.ink },
  summary: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 12, backgroundColor: colors.primarySoft, marginBottom: 12 },
  summaryText: { flex: 1, fontFamily, fontSize: 12.5, lineHeight: 19, color: colors.ink },
  endText: { fontFamily, fontSize: 16, fontWeight: '600', color: colors.ink, marginBottom: 10 },
  order: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider, borderRadius: 6 },
  orderIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  orderTitle: { fontFamily, fontSize: 13, fontWeight: '600', color: colors.ink, marginBottom: 2 },
  orderFare: { fontFamily, fontSize: 13.5, fontWeight: '600', color: colors.ink },
  cash: { alignItems: 'center', backgroundColor: colors.successSoft, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 12, marginTop: 10, marginBottom: 6 },
  cashLabel: { fontFamily, fontSize: 11.5, fontWeight: '600', color: '#286B4C' },
  cashValue: { fontFamily, fontSize: 28, fontWeight: '700', color: colors.success, marginTop: 4, letterSpacing: -0.6 },
  cashNote: { fontFamily, fontSize: 11, color: '#286B4C', marginTop: 3, textAlign: 'center' },
});
