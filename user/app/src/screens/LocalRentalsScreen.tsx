// Local Rentals: a full-screen map and a sheet at the bottom, one question at a time.
//   Hourly Rental → pickup on the map, how many hours, pickup date and time.
//   Pickup & Drop → pickup on the map, drop on the map, pickup date and time.
// It only collects the trip. The vehicles and fares come from the same booking steps as every other service, and the server
// prices them, so nothing here can change what a rider is charged. (Mirrors the People Taxi / website Local Rentals page.)
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Button, Chip, Notice, Segmented } from '../components/ui';
import { Icon } from '../components/Icon';
import { PressableScale } from '../components/brand';
import { PlaceSearchModal } from '../components/PlaceSearchModal';
import { TimePickerSheet } from '../components/TimePickerSheet';
import { PinMap, type PinMapPin, type PinMapTarget } from '../components/PinMap';
import { MAPS_ENABLED } from '../components/RideMap';
import { useBookingDraft } from '../context/BookingDraft';
import { useCustomerData } from '../context/CustomerData';
import { useDeviceLocation } from '../hooks/useDeviceLocation';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { LOCATION_ERROR_TEXT, reverseGeocode } from '../services/geoService';
import { makeLocalDisposalPlace } from '../services/pricingService';
import { SCHEDULE_MAX_DAYS } from '../config/constants';
import { earliestSlot, scheduleProblem } from '../utils/bookingRules';
import { formatTime } from '../utils/format';
import { haversineKm } from '../utils/geo';
import { CITY_LIMIT_KM, QUICK_CITIES, RENTAL_PACKAGE_HOURS, STATE_VIEW, pinPlace } from '../data/localRentals';
import type { GeoPlace } from '../types';
import type { TabParamList } from '../navigation/types';
import { colors, fonts, radius, space } from '../theme';

type Mode = 'hourly' | 'pickup';
type Stage = 'pickup' | 'drop' | 'when';
type LatLng = { lat: number; lng: number };

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const formatDay = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export function LocalRentalsScreen() {
  const navigation = useNavigation();
  const tabNav = useNavigation<NavigationProp<TabParamList, 'Rentals'>>();
  const route = useRoute<RouteProp<TabParamList, 'Rentals'>>();
  const { draft, update, setService } = useBookingDraft();
  const { savedPlaces } = useCustomerData();
  const { position, locate, locating, error: locError } = useDeviceLocation(true);
  const { online } = useNetworkStatus();

  const [mode, setMode] = useState<Mode>(route.params?.mode === 'hourly' ? 'hourly' : 'pickup');
  const [pickup, setPickup] = useState<GeoPlace | null>(null);
  const [drop, setDrop] = useState<GeoPlace | null>(null);
  const [hours, setHours] = useState<number | null>(draft.tripType === 'Local Rental' ? draft.rentalHours ?? null : null);
  const [when, setWhen] = useState<Date>(() => (draft.scheduledAt && draft.scheduledAt.getTime() > Date.now() ? draft.scheduledAt : earliestSlot()));
  const [stage, setStage] = useState<Stage>('pickup');
  const [cand, setCand] = useState<GeoPlace | null>(null);
  const [resolving, setResolving] = useState(false);
  const [target, setTarget] = useState<PinMapTarget | null>(null);
  const [picker, setPicker] = useState<'pickup' | 'drop' | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const resolveToken = useRef(0);
  const userMoved = useRef(false);
  const started = useRef(false);

  const picking = stage !== 'when';
  const steps = mode === 'hourly' ? 2 : 3;
  const stepNo = stage === 'pickup' ? 1 : stage === 'drop' ? 2 : steps;

  const flyTo = useCallback((ll: LatLng, delta = 0.012) => setTarget({ lat: ll.lat, lng: ll.lng, delta, n: ++seq.current }), []);

  // Read the place under the pin (debounced, the newest answer wins).
  const resolveAt = useCallback((ll: LatLng) => {
    const token = ++resolveToken.current;
    const fresh = () => token === resolveToken.current;
    setResolving(true);
    const ask = setTimeout(() => {
      reverseGeocode(ll)
        .then((p) => {
          if (fresh()) {
            setCand({ ...p, lat: ll.lat, lng: ll.lng });
            setResolving(false);
          }
        })
        .catch(() => {
          if (fresh()) {
            setCand(pinPlace(ll));
            setResolving(false);
          }
        });
    }, 300);
    // On a slow connection the rider is not kept waiting: the pin's coordinates stand in, and the address replaces them if it arrives.
    const giveUp = setTimeout(() => {
      if (fresh()) {
        setCand((c) => (c && c.lat === ll.lat && c.lng === ll.lng ? c : pinPlace(ll)));
        setResolving(false);
      }
    }, 3500);
    return () => {
      clearTimeout(ask);
      clearTimeout(giveUp);
    };
  }, []);

  const onPick = useCallback(
    (ll: LatLng) => {
      userMoved.current = true;
      setError('');
      resolveAt(ll);
    },
    [resolveAt],
  );

  // Enter a stage: put the map on the place already chosen for it, or on where the rider is.
  const enter = useCallback(
    (s: Stage) => {
      resolveToken.current += 1; // a lookup still running for the step we leave must not land in the next one
      setResolving(false);
      setStage(s);
      setError('');
      if (s === 'when') return;
      const have = s === 'pickup' ? pickup : drop;
      setCand(have);
      const at = have ?? (s === 'drop' ? pickup : null) ?? (position ? { lat: position.lat, lng: position.lng } : null);
      if (at) flyTo(at, have ? 0.012 : s === 'drop' ? 0.12 : 0.012);
      else setTarget({ lat: STATE_VIEW.lat, lng: STATE_VIEW.lng, delta: STATE_VIEW.latDelta, n: ++seq.current });
    },
    [pickup, drop, position, flyTo],
  );

  // First screen: start where the rider is.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    enter('pickup');
    void locate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (stage !== 'pickup' || userMoved.current || !position) return;
    flyTo({ lat: position.lat, lng: position.lng });
    resolveAt({ lat: position.lat, lng: position.lng });
  }, [position?.lat, position?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the clock moving: a time that has become too soon is replaced by the new earliest one (never an error at the button).
  useEffect(() => {
    const id = setInterval(() => {
      setWhen((w) => (w.getTime() < earliestSlot().getTime() ? earliestSlot() : w));
    }, 15000);
    return () => clearInterval(id);
  }, []);

  const leave = useCallback(() => {
    setService('outstation');
    navigation.navigate('Tabs', { screen: 'Book' });
  }, [navigation, setService]);
  const back = useCallback(() => {
    if (stage === 'drop') enter('pickup');
    else if (stage === 'when') enter(mode === 'pickup' ? 'drop' : 'pickup');
    else leave();
  }, [stage, mode, enter, leave]);
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (picker || timeOpen) return false;
        back();
        return true;
      });
      return () => sub.remove();
    }, [back, picker, timeOpen]),
  );

  const modeRef = useRef<Mode>(mode);
  const switchModeRef = useRef<(m: Mode) => void>(() => undefined);
  const farApart = stage === 'drop' && !!pickup && !!cand && haversineKm(pickup, cand) > CITY_LIMIT_KM;

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setError('');
    // Either tab starts by asking the pickup (the one chosen before is prefilled). Pickup & Drop then asks the drop again.
    if (m === 'pickup') setDrop(null);
    enter('pickup');
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

  const confirmStage = () => {
    if (!cand) return;
    if (stage === 'pickup') {
      setPickup(cand);
      if (mode === 'pickup') {
        resolveToken.current += 1;
        setResolving(false);
        if (drop && haversineKm(cand, drop) <= CITY_LIMIT_KM) {
          setStage('when');
          setError('');
        } else {
          setDrop(null);
          setStage('drop');
          setError('');
          setCand(null);
          flyTo(cand, 0.12);
        }
      } else enter('when');
    } else if (stage === 'drop') {
      if (farApart) return;
      resolveToken.current += 1;
      setResolving(false);
      setDrop(cand);
      setStage('when');
      setError('');
    }
  };

  const chooseCity = (c: GeoPlace) => {
    userMoved.current = true;
    setCand(c);
    setResolving(false);
    flyTo(c, 0.1);
  };
  const onSearchPick = (p: GeoPlace) => {
    userMoved.current = true;
    setPicker(null);
    setCand(p);
    setResolving(false);
    flyTo(p, 0.012);
  };
  const goToMyLocation = async () => {
    const p = await locate();
    if (!p) return;
    userMoved.current = true;
    flyTo({ lat: p.lat, lng: p.lng });
    resolveAt({ lat: p.lat, lng: p.lng });
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
    const problem = scheduleProblem(when);
    if (problem) {
      if (dayStart(when).getTime() === dayStart(new Date()).getTime()) {
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
        ? { pickup, drop: makeLocalDisposalPlace(pickup), tripType: 'Local Rental', rentalHours: hours, scheduledAt: when, tripEndAt: null, stops: [], multicity: false }
        : { pickup, drop, tripType: 'One Way', rentalHours: null, scheduledAt: when, tripEndAt: null, stops: [], multicity: false },
    );
    navigation.navigate('ChooseRide');
  };

  const pins: PinMapPin[] = useMemo(() => {
    const out: PinMapPin[] = [];
    if (stage === 'drop' && pickup) out.push({ ...pickup, kind: 'from' });
    if (stage === 'when') {
      if (pickup) out.push({ ...pickup, kind: 'from' });
      if (mode === 'pickup' && drop) out.push({ ...drop, kind: 'to' });
    }
    return out;
  }, [stage, mode, pickup, drop]);

  const place = cand;
  const addrLine = place && place.address && place.address !== place.name ? place.address : '';
  const locationHint = locating ? 'Finding your current location…' : locError ? LOCATION_ERROR_TEXT[locError.kind] : '';
  const timeProblemOf = useCallback((at: Date) => scheduleProblem(at), []);

  const modeSeg = (
    <Segmented<Mode>
      style={{ marginTop: 12 }}
      options={[
        { value: 'pickup', label: 'Pickup & Drop' },
        { value: 'hourly', label: 'Hourly Rental' },
      ]}
      value={mode}
      onChange={switchMode}
    />
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <PlaceSearchModal
        visible={picker !== null}
        title={picker === 'drop' ? 'Drop location' : 'Pickup location'}
        subtitle={picker === 'drop' ? 'Search for a place inside the same city.' : 'Search a city, area or landmark.'}
        onClose={() => setPicker(null)}
        onSelect={onSearchPick}
        savedPlaces={savedPlaces}
        suggestions={QUICK_CITIES}
        suggestionsLabel="Popular locations"
        near={picker === 'drop' ? pickup : position}
        onUseCurrentLocation={picker === 'pickup' ? () => { setPicker(null); void goToMyLocation(); } : undefined}
      />
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

      {/* ── Map area ── */}
      <View style={styles.mapArea}>
        {MAPS_ENABLED ? (
          <PinMap picking={picking} target={target} pins={pins} onPick={onPick} />
        ) : (
          <View style={styles.noMap}>
            <Icon name="map-pin" size={30} color={colors.primary} strokeWidth={1.8} />
            <Text style={styles.noMapTitle}>{picking ? (stage === 'drop' ? 'Search for your drop' : 'Search for your pickup') : 'Your trip'}</Text>
            <Text style={styles.noMapText}>
              {picking ? 'Pick a city below or search for a place. The map appears when this build has a Google Maps key.' : 'Check the details below, then see the fares.'}
            </Text>
          </View>
        )}

        <View style={styles.top} pointerEvents="box-none">
          <PressableScale onPress={back} activeScale={0.9} style={styles.round} accessibilityRole="button" accessibilityLabel="Back" hitSlop={6}>
            <Icon name="arrow-left" size={20} color={colors.ink} strokeWidth={2.2} />
          </PressableScale>
          {picking ? (
            <View style={{ flex: 1, minWidth: 0 }}>
              <PressableScale onPress={() => setPicker(stage === 'drop' ? 'drop' : 'pickup')} activeScale={0.98} style={styles.search} accessibilityRole="button" accessibilityLabel="Search a place">
                <Icon name="search" size={17} color={colors.primary} strokeWidth={2.2} />
                <Text style={[styles.searchText, !place && styles.searchEmpty]} numberOfLines={1}>
                  {place ? place.name : stage === 'drop' ? 'Search a drop location' : 'Search a place or city'}
                </Text>
              </PressableScale>
            </View>
          ) : (
            <View style={styles.titlePill}>
              <Text style={styles.titlePillText}>Local Rentals</Text>
            </View>
          )}
        </View>

        {picking && stage === 'pickup' ? (
          <View style={styles.cities} pointerEvents="box-none">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: space.lg }} keyboardShouldPersistTaps="handled">
              {QUICK_CITIES.map((c) => (
                <Chip key={c.id} label={c.name} active={place?.id === c.id} onPress={() => chooseCity(c)} />
              ))}
            </ScrollView>
          </View>
        ) : null}

        {picking && MAPS_ENABLED ? (
          <View style={styles.pin} pointerEvents="none">
            <View style={[styles.pinHead, stage === 'drop' ? styles.pinHeadDrop : styles.pinHeadPickup]}>
              <View style={styles.pinDot} />
            </View>
            <View style={[styles.pinStem, stage === 'drop' ? styles.pinStemDrop : styles.pinStemPickup]} />
            <View style={styles.pinShadow} />
          </View>
        ) : null}

        <PressableScale onPress={() => void goToMyLocation()} activeScale={0.9} style={styles.locate} accessibilityRole="button" accessibilityLabel="Use my location" disabled={locating}>
          <Icon name="locate-fixed" size={20} color={colors.primary} strokeWidth={2.2} />
        </PressableScale>
      </View>

      {/* ── Sheet ── */}
      {picking ? (
        <View style={styles.sheet} accessibilityLabel={stage === 'drop' ? 'Set drop location' : 'Set pickup location'}>
          <View style={styles.grip} />
          <Text style={styles.step}>
            STEP {stepNo} OF {steps}
          </Text>
          {locationHint && stage === 'pickup' ? <Text style={[styles.hint, !!locError && !locating && styles.hintWarn]}>{locationHint}</Text> : null}
          <Text style={styles.h2}>{stage === 'drop' ? 'Where should we drop you?' : mode === 'hourly' ? 'Where should the car meet you?' : 'Where should we pick you up?'}</Text>

          <View style={styles.addr}>
            <View style={[styles.dot, stage === 'drop' ? styles.dotTo : styles.dotFrom]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              {resolving ? (
                <Text style={[styles.addrName, styles.addrEmpty]}>Finding this place…</Text>
              ) : place ? (
                <>
                  <Text style={styles.addrName} numberOfLines={1}>{place.name}</Text>
                  {addrLine ? <Text style={styles.addrLine} numberOfLines={2}>{addrLine}</Text> : null}
                </>
              ) : (
                <Text style={[styles.addrName, styles.addrEmpty]}>{MAPS_ENABLED ? 'Move the map to place the pin' : 'Search for a place or pick a city'}</Text>
              )}
            </View>
          </View>
          <Button
            title={resolving ? 'Finding address…' : stage === 'drop' ? 'Confirm drop' : 'Confirm pickup'}
            onPress={confirmStage}
            disabled={!place || resolving || farApart}
            style={{ marginTop: 12 }}
          />
          {modeSeg}
          {farApart ? <Notice tone="warning" message="Pickup & Drop is for trips inside one city. For a longer trip choose Outstation." style={{ marginTop: 10 }} /> : null}
          {stage === 'drop' ? (
            <Pressable onPress={() => enter('pickup')} accessibilityRole="button" style={styles.linkBtn}>
              <Text style={styles.linkText}>Change pickup</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={[styles.sheet, styles.sheetTall]} accessibilityLabel="Plan your trip">
          <View style={styles.grip} />
          <Text style={styles.step}>
            STEP {steps} OF {steps}
          </Text>
          <Text style={styles.h2}>{mode === 'hourly' ? 'Plan your rental' : 'Plan your trip'}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
            <View style={styles.trip}>
              <TripRow kind="from" label="Pickup" value={pickup?.name ?? 'Choose pickup'} onPress={() => enter('pickup')} />
              {mode === 'pickup' ? <TripRow kind="to" label="Drop" value={drop?.name ?? 'Choose drop'} onPress={() => enter('drop')} divider /> : null}
            </View>
            {modeSeg}

            {mode === 'hourly' ? (
              <View style={{ marginTop: 14 }}>
                <Text style={styles.label}>Rental duration</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {RENTAL_PACKAGE_HOURS.map((h) => (
                    <Chip
                      key={h}
                      label={`${h} ${h === 1 ? 'hour' : 'hours'}`}
                      active={hours === h}
                      onPress={() => {
                        setHours(h);
                        setError('');
                      }}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <View style={styles.pair}>
              <PickerBox label="Pickup date" value={formatDay(when)} icon="calendar-days" onPress={openDate} />
              <PickerBox label="Pickup time" value={formatTime(when).replace(/^0/, '')} icon="clock-3" onPress={() => setTimeOpen(true)} />
            </View>
          </ScrollView>
          {error ? <Notice tone="warning" message={error} style={{ marginTop: 10 }} /> : null}
          {!online ? <Notice tone="error" message="You’re offline. Reconnect to see fares." style={{ marginTop: 10 }} /> : null}
          <Button title={mode === 'hourly' ? 'View cabs & fares' : 'See vehicles & fares'} iconRight="arrow-right" onPress={submit} style={{ marginTop: 12 }} />
        </View>
      )}
    </SafeAreaView>
  );
}

function TripRow({ kind, label, value, onPress, divider }: { kind: 'from' | 'to'; label: string; value: string; onPress: () => void; divider?: boolean }) {
  return (
    <PressableScale onPress={onPress} activeScale={0.98} style={[styles.tripRow, divider && styles.tripDivider]} accessibilityRole="button" accessibilityLabel={`${label}: ${value}. Edit`}>
      <View style={[styles.dot, kind === 'to' ? styles.dotTo : styles.dotFrom]} />
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
  search: { minHeight: 42, borderRadius: radius.pill, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, ...SHADOW },
  searchText: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.value },
  searchEmpty: { color: colors.faint, fontFamily: fonts.regular },
  titlePill: { minHeight: 42, borderRadius: radius.pill, backgroundColor: colors.white, justifyContent: 'center', paddingHorizontal: 18, ...SHADOW },
  titlePillText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.ink },
  cities: { position: 'absolute', top: 62, left: 0, right: 0 },
  pin: { position: 'absolute', top: '50%', left: '50%', width: 36, height: 56, marginLeft: -18, marginTop: -56, alignItems: 'center' },
  pinHead: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.white, ...SHADOW },
  pinHeadPickup: { backgroundColor: '#16A34A' },
  pinHeadDrop: { backgroundColor: '#DC2626' },
  pinDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.white },
  pinStem: { width: 3, height: 16, marginTop: -2 },
  pinStemPickup: { backgroundColor: '#16A34A' },
  pinStemDrop: { backgroundColor: '#DC2626' },
  pinShadow: { width: 12, height: 4, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.25)', marginTop: 1 },
  locate: { position: 'absolute', right: 14, bottom: 14, width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...SHADOW },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
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
  step: { fontFamily: fonts.semiBold, fontSize: 11, letterSpacing: 1, color: colors.eyebrow },
  hint: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  hintWarn: { color: colors.primaryDark },
  h2: { fontFamily: fonts.heading, fontSize: 19, lineHeight: 26, color: colors.text, marginTop: 4, letterSpacing: -0.3 },
  addr: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, minHeight: 54, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#FAFBFC' },
  addrName: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.value },
  addrEmpty: { fontFamily: fonts.regular, color: colors.faint },
  addrLine: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 1 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.white },
  dotFrom: { backgroundColor: '#16A34A' },
  dotTo: { backgroundColor: '#DC2626' },
  linkBtn: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 12 },
  linkText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.primary },
  trip: { marginTop: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: 14, backgroundColor: '#FAFBFC' },
  tripRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  tripDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  tripLabel: { fontFamily: fonts.regular, fontSize: 11, color: colors.label },
  tripValue: { fontFamily: fonts.semiBold, fontSize: 14.5, color: colors.value },
  tripEdit: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.primary },
  label: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.muted, marginBottom: 6 },
  pair: { flexDirection: 'row', gap: 11, marginTop: 14 },
  pickerBox: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.white },
  pickerValue: { flex: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.text },
});
