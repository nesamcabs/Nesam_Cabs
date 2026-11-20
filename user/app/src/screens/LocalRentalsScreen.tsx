// Local Rentals: a full-screen map and a sheet at the bottom. The front sheet asks everything about the places at once:
//   Hourly Rental → pickup and the rental duration (1–15 hours, picked from a grid), then pickup date and time.
//   Pickup & Drop → pickup and drop together, then pickup date and time.
// The pickup starts at the rider's current location; tapping a place opens the search.
// It only collects the trip. The vehicles and fares come from the same booking steps as every other service, and the server
// prices them, so nothing here can change what a rider is charged. (Mirrors the People Taxi / website Local Rentals page.)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Button, Notice, Segmented, Sheet } from '../components/ui';
import { Icon } from '../components/Icon';
import { ServiceNote } from '../components/ServiceNote';
import { DESKTOP_NAV_MIN, DesktopTopBar, PressableScale } from '../components/brand';
import { PlaceInput } from '../components/PlaceInput';
import { TimePickerSheet } from '../components/TimePickerSheet';
import { PinMap, type PinMapPin, type PinMapTarget } from '../components/PinMap';
import { MAPS_ENABLED } from '../components/RideMap';
import { useBookingDraft } from '../context/BookingDraft';
import { useCustomerData } from '../context/CustomerData';
import { useDeviceLocation } from '../hooks/useDeviceLocation';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { LOCATION_ERROR_TEXT, reverseGeocode } from '../services/geoService';
import { makeLocalDisposalPlace } from '../services/pricingService';
import { SCHEDULE_MAX_DAYS, SCHEDULE_MIN_LEAD_MIN } from '../config/constants';
import { earliestSlot, scheduleProblem } from '../utils/bookingRules';
import { formatTime } from '../utils/format';
import { setRentalsMode } from '../utils/rentalsMode';
import { haversineKm } from '../utils/geo';
import { CITY_LIMIT_KM, QUICK_CITIES, RENTAL_PACKAGE_HOURS, pinPlace } from '../data/localRentals';
import type { GeoPlace } from '../types';
import type { TabParamList } from '../navigation/types';
import { colors, fonts, radius, space } from '../theme';
import { useDockPad } from '../context/Dock';

type Mode = 'hourly' | 'pickup';
type Stage = 'plan' | 'when';
type LatLng = { lat: number; lng: number };

/** The duration shown before the rider picks another one. */
const DEFAULT_HOURS = 4;
const MAX_HOURS = RENTAL_PACKAGE_HOURS[RENTAL_PACKAGE_HOURS.length - 1]!;
const hoursText = (h: number) => `${h} ${h === 1 ? 'hour' : 'hours'}`;
const noop = () => undefined;

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const formatDay = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export function LocalRentalsScreen() {
  const navigation = useNavigation();
  // The floating bottom bar covers the foot of the screen; the sheet sits above it.
  const dockPad = useDockPad();
  const tabNav = useNavigation<NavigationProp<TabParamList, 'Rentals'>>();
  const route = useRoute<RouteProp<TabParamList, 'Rentals'>>();
  const { draft, update, setService } = useBookingDraft();
  const { savedPlaces } = useCustomerData();
  const { position, locate, locating, error: locError } = useDeviceLocation(true);
  const { online } = useNetworkStatus();

  const [mode, setMode] = useState<Mode>(route.params?.mode === 'hourly' ? 'hourly' : 'pickup');
  const [pickup, setPickup] = useState<GeoPlace | null>(null);
  const [drop, setDrop] = useState<GeoPlace | null>(null);
  const [hours, setHours] = useState<number>(draft.tripType === 'Local Rental' && draft.rentalHours && RENTAL_PACKAGE_HOURS.includes(draft.rentalHours) ? draft.rentalHours : DEFAULT_HOURS);
  const [when, setWhen] = useState<Date>(() => (draft.scheduledAt && draft.scheduledAt.getTime() > Date.now() ? draft.scheduledAt : earliestSlot()));
  // Ride Now books the earliest pickup the server accepts (it follows the clock); Schedule lets the rider choose the day and time.
  const [timing, setTiming] = useState<'now' | 'schedule'>(draft.scheduledAt && draft.scheduledAt.getTime() > Date.now() ? 'schedule' : 'now');
  const timingRef = useRef(timing);
  timingRef.current = timing;
  const [stage, setStage] = useState<Stage>('plan');
  // The bottom bar lights Pickup & Drop or Hourly Rental from this.
  useEffect(() => setRentalsMode(mode), [mode]);
  const [target, setTarget] = useState<PinMapTarget | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const pickupFromGps = useRef(false);
  const started = useRef(false);

  const flyTo = useCallback((ll: LatLng, delta = 0.012) => setTarget({ lat: ll.lat, lng: ll.lng, delta, n: ++seq.current }), []);

  // First screen: look for where the rider is. With no pickup chosen yet, that is the pickup.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void locate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!position || pickupFromGps.current || pickup) return;
    pickupFromGps.current = true;
    flyTo({ lat: position.lat, lng: position.lng });
    void reverseGeocode(position)
      .catch(() => pinPlace(position))
      .then((p) => setPickup((now) => now ?? { ...p, type: 'current' }));
  }, [position?.lat, position?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the clock moving: a time that has become too soon is replaced by the new earliest one (never an error at the button).
  useEffect(() => {
    const id = setInterval(() => {
      setWhen((w) => (timingRef.current === 'now' || w.getTime() < earliestSlot().getTime() ? earliestSlot() : w));
    }, 15000);
    return () => clearInterval(id);
  }, []);

  const leave = useCallback(() => {
    setService('outstation');
    navigation.navigate('Tabs', { screen: 'Book' });
  }, [navigation, setService]);
  const back = useCallback(() => {
    if (stage === 'when') {
      setStage('plan');
      setError('');
    } else leave();
  }, [stage, leave]);
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (timeOpen || hoursOpen) return false;
        back();
        return true;
      });
      return () => sub.remove();
    }, [back, timeOpen, hoursOpen]),
  );

  const modeRef = useRef<Mode>(mode);
  const switchModeRef = useRef<(m: Mode) => void>(() => undefined);
  const farApart = mode === 'pickup' && !!pickup && !!drop && haversineKm(pickup, drop) > CITY_LIMIT_KM;

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setError('');
    setStage('plan');
  };
  useEffect(() => {
    modeRef.current = mode;
    switchModeRef.current = switchMode;
  });

  // A link such as "Hourly Rental" from elsewhere in the app switches the tab once, when the screen is shown.
  const paramMode = route.params?.mode;
  useFocusEffect(
    useCallback(() => {
      if (!paramMode) return;
      if (paramMode !== modeRef.current) switchModeRef.current(paramMode);
      tabNav.setParams({ mode: undefined });
    }, [paramMode, tabNav]),
  );

  const chooseTiming = (t: 'now' | 'schedule') => {
    if (t === timing) return;
    setTiming(t);
    setError('');
    if (t === 'now') setWhen(earliestSlot());
  };

  // The front sheet's button: the places (and, for an hourly rental, the duration) are set, so ask for the day and time.
  const confirmPlan = () => {
    if (!pickup) return setError('Choose your pickup location.');
    if (mode === 'pickup') {
      if (!drop) return setError('Choose your drop location.');
      if (farApart) return;
      if (haversineKm(pickup, drop) < 0.2) return setError('Pickup and drop cannot be the same place.');
    } else if (!hours) return setError('Select how many hours you need the car.');
    setError('');
    setStage('when');
  };

  const onSearchPick = (field: 'pickup' | 'drop', p: GeoPlace) => {
    setError('');
    if (field === 'drop') setDrop(p);
    else {
      pickupFromGps.current = true;
      setPickup(p);
    }
    flyTo(p, 0.012);
  };
  const goToMyLocation = async () => {
    const p = await locate();
    if (!p) return;
    flyTo({ lat: p.lat, lng: p.lng });
    if (stage === 'when') return; // the trip is already set; just show the rider where they are
    pickupFromGps.current = true;
    setError('');
    void reverseGeocode(p)
      .catch(() => pinPlace(p))
      .then((place) => setPickup({ ...place, type: 'current' }));
  };

  // ── When: day, time, hours ──
  const openDate = () => {
    const min = dayStart(new Date());
    const max = new Date(Date.now() + SCHEDULE_MAX_DAYS * 86400000);
    try {
      DateTimePickerAndroid.open({
        value: dayStart(when) < min ? min : dayStart(when),
        mode: 'date',
        minimumDate: min,
        maximumDate: max,
        onChange: (event, picked) => {
          if (event.type !== 'set' || !picked) return;
          const next = new Date(picked);
          next.setHours(when.getHours(), when.getMinutes(), 0, 0);
          // Moving to today with a time that has already gone: fall back to the earliest time instead of an error.
          setWhen(next.getTime() < earliestSlot().getTime() && dayStart(next).getTime() === dayStart(new Date()).getTime() ? earliestSlot() : next);
          setError('');
        },
      });
    } catch {
      setError('Date selection is not available on this device. Please call NESAM to book.');
    }
  };

  const submit = () => {
    if (!online) return setError('You’re offline. Reconnect to see fares.');
    if (!pickup) return setError('Choose your pickup location.');
    if (mode === 'pickup' && !drop) return setError('Choose your drop location.');
    if (mode === 'hourly' && !hours) return setError('Select how many hours you need the car.');
    // Ride Now is the earliest pickup right now; Schedule is the day and time the rider chose.
    const at = timing === 'now' ? earliestSlot() : when;
    const problem = scheduleProblem(at);
    if (problem) {
      if (timing === 'schedule' && dayStart(at).getTime() === dayStart(new Date()).getTime()) {
        setWhen(earliestSlot());
        return setError(`That time has passed. Pickup moved to the earliest time, ${formatTime(earliestSlot()).replace(/^0/, '')}. Tap again to continue.`);
      }
      return setError(problem);
    }
    if (mode === 'pickup' && pickup && drop && haversineKm(pickup, drop) > CITY_LIMIT_KM) {
      return setError('Pickup & Drop is for trips inside one city. For a longer trip choose Outstation.');
    }
    setService('rental');
    update(
      mode === 'hourly'
        ? { pickup, drop: makeLocalDisposalPlace(pickup), tripType: 'Local Rental', rentalHours: hours, scheduledAt: at, tripEndAt: null, stops: [], multicity: false }
        : { pickup, drop, tripType: 'One Way', rentalHours: null, scheduledAt: at, tripEndAt: null, stops: [], multicity: false },
    );
    navigation.navigate('ChooseRide');
  };

  const pins: PinMapPin[] = useMemo(() => {
    const out: PinMapPin[] = [];
    if (pickup) out.push({ ...pickup, kind: 'from' });
    if (mode === 'pickup' && drop) out.push({ ...drop, kind: 'to' });
    return out;
  }, [mode, pickup, drop]);

  const locationHint = locating ? 'Finding your current location…' : locError ? LOCATION_ERROR_TEXT[locError.kind] : '';
  const timeProblemOf = useCallback((at: Date) => scheduleProblem(at), []);

  const winW = useWindowDimensions().width;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {winW >= DESKTOP_NAV_MIN ? <DesktopTopBar /> : null}
      {timeOpen ? (
        <TimePickerSheet
          visible
          title="Pickup time"
          day={dayStart(when)}
          value={when}
          problemOf={timeProblemOf}
          onClose={() => setTimeOpen(false)}
          onConfirm={(at) => {
            setWhen(at);
            setError('');
            setTimeOpen(false);
          }}
        />
      ) : null}

      <Sheet visible={hoursOpen} onClose={() => setHoursOpen(false)} title="Rental duration" subtitle={`Choose from 1 to ${MAX_HOURS} hours, then continue to choose your cab.`}>
        <View style={styles.hoursGrid} accessibilityRole="radiogroup">
          {RENTAL_PACKAGE_HOURS.map((h) => {
            const on = hours === h;
            return (
              <View key={h} style={styles.hoursCell}>
                <PressableScale
                  onPress={() => {
                    setHours(h);
                    setError('');
                    setHoursOpen(false);
                  }}
                  activeScale={0.96}
                  style={[styles.hoursOpt, on && styles.hoursOptOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={hoursText(h)}
                >
                  <Text style={[styles.hoursText, on && styles.hoursTextOn]}>{hoursText(h)}</Text>
                </PressableScale>
              </View>
            );
          })}
        </View>
      </Sheet>

      {/* ── Map area ── */}
      <View style={styles.mapArea}>
        {MAPS_ENABLED ? (
          <PinMap picking={false} target={target} pins={pins} onPick={noop} />
        ) : (
          <View style={styles.noMap}>
            <Icon name="map-pin" size={30} color={colors.primary} strokeWidth={1.8} />
            <Text style={styles.noMapTitle}>{stage === 'plan' ? (mode === 'hourly' ? 'Set your pickup and duration' : 'Set your pickup and drop') : 'Your trip'}</Text>
            <Text style={styles.noMapText}>
              {stage === 'plan' ? 'Tap a place below to search for it. The map appears when this build has a Google Maps key.' : 'Check the details below, then see the fares.'}
            </Text>
          </View>
        )}

        <View style={styles.top} pointerEvents="box-none">
          <PressableScale onPress={back} activeScale={0.9} style={styles.round} accessibilityRole="button" accessibilityLabel="Back" hitSlop={6}>
            <Icon name="arrow-left" size={20} color={colors.ink} strokeWidth={2.2} />
          </PressableScale>
          <View style={styles.titlePill}>
            <Text style={styles.titlePillText}>Local Rentals</Text>
          </View>
        </View>

        <PressableScale onPress={() => void goToMyLocation()} activeScale={0.9} style={styles.locate} accessibilityRole="button" accessibilityLabel="Use my location" disabled={locating}>
          <Icon name="locate-fixed" size={20} color={colors.primary} strokeWidth={2.2} />
        </PressableScale>
      </View>

      {/* ── Sheet ── */}
      {stage === 'plan' ? (
        <View style={[styles.sheet, { paddingBottom: space.lg + dockPad }]} accessibilityLabel={mode === 'hourly' ? 'Hourly rental details' : 'Trip locations'}>
          <View style={styles.grip} />
          <ServiceNote kind={mode === 'hourly' ? 'rental' : 'local'} compact />
          {locationHint && !pickup ? <Text style={[styles.hint, !!locError && !locating && styles.hintWarn]}>{locationHint}</Text> : null}
          <View style={styles.cards}>
            <PlaceInput
              label="Pickup location"
              value={pickup}
              placeholder={locating ? 'Finding your location…' : 'Choose pickup location'}
              onSelect={(p) => onSearchPick('pickup', p)}
              leading={<View style={[styles.dot, styles.dotFrom]} />}
              saved={savedPlaces}
              suggestions={QUICK_CITIES}
              near={position}
            />
            {mode === 'pickup' ? (
              <PlaceInput
                label="Drop location"
                value={drop}
                placeholder="Choose drop location"
                onSelect={(p) => onSearchPick('drop', p)}
                leading={<View style={[styles.dot, styles.dotTo]} />}
                saved={savedPlaces}
                suggestions={QUICK_CITIES}
                near={pickup}
              />
            ) : null}
            {mode === 'hourly' ? (
              <View style={styles.card}>
                <PlaceRow kind="none" label="Rental duration" value={hoursText(hours)} sub={`Choose from 1–${MAX_HOURS} hours`} chevron="down" onPress={() => setHoursOpen(true)} />
              </View>
            ) : null}
          </View>
          {farApart ? <Notice tone="warning" message="Pickup & Drop is for trips inside one city. For a longer trip choose Outstation." style={{ marginTop: 10 }} /> : null}
          {error ? <Notice tone="warning" message={error} style={{ marginTop: 10 }} /> : null}
          <Button title={mode === 'hourly' ? 'Confirm rental details' : 'Confirm locations'} onPress={confirmPlan} disabled={farApart} style={{ marginTop: 12 }} />
        </View>
      ) : (
        <View style={[styles.sheet, styles.sheetTall, { paddingBottom: space.lg + dockPad }]} accessibilityLabel="Plan your trip">
          <View style={styles.grip} />
          <Text style={styles.h2}>{mode === 'hourly' ? 'Plan your rental' : 'Plan your trip'}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
            <View style={styles.trip}>
              <TripRow kind="from" label="Pickup" value={pickup?.name ?? 'Choose pickup'} onPress={() => setStage('plan')} />
              {mode === 'pickup' ? (
                <TripRow kind="to" label="Drop" value={drop?.name ?? 'Choose drop'} onPress={() => setStage('plan')} divider />
              ) : (
                <TripRow kind="time" label="Duration" value={hoursText(hours)} onPress={() => setHoursOpen(true)} divider />
              )}
            </View>

            <Segmented<'now' | 'schedule'>
              style={{ marginTop: 14 }}
              options={[
                { value: 'now', label: 'Ride Now' },
                { value: 'schedule', label: 'Schedule' },
              ]}
              value={timing}
              onChange={chooseTiming}
            />
            {timing === 'schedule' ? (
              <View style={styles.pair}>
                <PickerBox label="Pickup date" value={formatDay(when)} icon="calendar-days" onPress={openDate} />
                <PickerBox label="Pickup time" value={formatTime(when).replace(/^0/, '')} icon="clock-3" onPress={() => setTimeOpen(true)} />
              </View>
            ) : (
              <View style={styles.pickupNote} accessibilityLiveRegion="polite">
                <Icon name="clock-3" size={16} color={colors.primary} strokeWidth={2} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.pickupNoteTitle}>Estimated pickup · {formatTime(earliestSlot()).replace(/^0/, '')}</Text>
                  <Text style={styles.pickupNoteSub}>Minimum {SCHEDULE_MIN_LEAD_MIN} min from now</Text>
                </View>
              </View>
            )}
          </ScrollView>
          {error ? <Notice tone="warning" message={error} style={{ marginTop: 10 }} /> : null}
          {!online ? <Notice tone="error" message="You’re offline. Reconnect to see fares." style={{ marginTop: 10 }} /> : null}
          <Button title={mode === 'hourly' ? 'View cabs & fares' : 'See vehicles & fares'} iconRight="arrow-right" onPress={submit} style={{ marginTop: 12 }} />
        </View>
      )}
    </SafeAreaView>
  );
}

/** A tappable row of the front sheet: a small label, the place (or duration) and a chevron. */
function PlaceRow({ kind, label, value, sub, empty, chevron = 'right', onPress, divider }: { kind: 'from' | 'to' | 'none'; label: string; value: string; sub?: string; empty?: boolean; chevron?: 'right' | 'down'; onPress: () => void; divider?: boolean }) {
  return (
    <PressableScale onPress={onPress} activeScale={0.98} style={[styles.placeRow, divider && styles.tripDivider]} accessibilityRole="button" accessibilityLabel={`${label}: ${value}. Change`}>
      {kind === 'none' ? null : <View style={[styles.dot, kind === 'to' ? styles.dotTo : styles.dotFrom]} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.placeLabel}>{label}</Text>
        <Text style={[styles.placeValue, empty && styles.placeEmpty]} numberOfLines={1}>{value}</Text>
        {sub ? <Text style={styles.placeSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
      <Icon name={chevron === 'down' ? 'chevron-down' : 'chevron-right'} size={18} color={colors.muted} strokeWidth={2} />
    </PressableScale>
  );
}

function TripRow({ kind, label, value, onPress, divider }: { kind: 'from' | 'to' | 'time'; label: string; value: string; onPress: () => void; divider?: boolean }) {
  return (
    <PressableScale onPress={onPress} activeScale={0.98} style={[styles.tripRow, divider && styles.tripDivider]} accessibilityRole="button" accessibilityLabel={`${label}: ${value}. Edit`}>
      {kind === 'time' ? <Icon name="clock-3" size={12} color="#E31E24" strokeWidth={2.4} /> : <View style={[styles.dot, kind === 'to' ? styles.dotTo : styles.dotFrom]} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.tripLabel}>{label}</Text>
        <Text style={styles.tripValue} numberOfLines={1}>{value}</Text>
      </View>
      <Text style={styles.tripEdit}>Edit</Text>
    </PressableScale>
  );
}

function PickerBox({ label, value, icon, onPress }: { label: string; value: string; icon: 'calendar-days' | 'clock-3'; onPress: () => void }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={styles.label}>{label}</Text>
      <PressableScale onPress={onPress} activeScale={0.96} style={styles.pickerBox} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}>
        <Text style={styles.pickerValue} numberOfLines={1}>{value}</Text>
        <Icon name={icon} size={16} color={colors.primary} strokeWidth={2} />
      </PressableScale>
    </View>
  );
}

const SHADOW = { shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.16, shadowRadius: 8, elevation: 4 } as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  mapArea: { flex: 1, backgroundColor: '#EAF0EC', overflow: 'hidden' },
  noMap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 8 },
  noMapTitle: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.ink, textAlign: 'center' },
  noMapText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.muted, textAlign: 'center' },
  top: { position: 'absolute', top: 10, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  round: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...SHADOW },
  titlePill: { minHeight: 42, borderRadius: radius.pill, backgroundColor: colors.white, justifyContent: 'center', paddingHorizontal: 18, ...SHADOW },
  titlePillText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.ink },
  locate: { position: 'absolute', right: 14, bottom: 14, width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...SHADOW },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingHorizontal: space.xl,
    paddingTop: 8,
    paddingBottom: space.lg,
    marginTop: -16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 10,
  },
  sheetTall: { maxHeight: '68%' },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 10 },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  hintWarn: { color: colors.primaryDark },
  h2: { fontFamily: fonts.heading, fontSize: 19, lineHeight: 26, color: colors.text, marginTop: 4, letterSpacing: -0.3 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.white },
  dotFrom: { backgroundColor: '#2A7555' },
  dotTo: { backgroundColor: '#E31E24' },
  cards: { gap: 10, marginTop: 10 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.white, paddingHorizontal: 14 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62, paddingVertical: 8 },
  placeLabel: { fontFamily: fonts.semiBold, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.muted },
  placeValue: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.value, marginTop: 1 },
  placeEmpty: { fontFamily: fonts.regular, color: colors.faint },
  placeSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 1 },
  hoursGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  hoursCell: { width: '33.333%', padding: 5 },
  hoursOpt: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  hoursOptOn: { borderColor: colors.primary, backgroundColor: '#FFF1F1' },
  hoursText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.ink },
  hoursTextOn: { color: colors.primary },
  trip: { marginTop: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: 14, backgroundColor: '#F7F5F2' },
  tripRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  tripDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  tripLabel: { fontFamily: fonts.regular, fontSize: 11, color: colors.label },
  tripValue: { fontFamily: fonts.semiBold, fontSize: 14.5, color: colors.value },
  tripEdit: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.primary },
  label: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.muted, marginBottom: 6 },
  pair: { flexDirection: 'row', gap: 11, marginTop: 14 },
  pickupNote: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.white },
  pickupNoteTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  pickupNoteSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 1 },
  pickerBox: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.white },
  pickerValue: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
});
