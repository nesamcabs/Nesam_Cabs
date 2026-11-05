// Home / booking step 1, in the modern mobile layout:
// Header displays the logo with the dynamic page heading right to it (Airport Transfers, Round Trip, One Way, etc.),
// One Way / Round Trip tabs, route + schedule form, and popular routes from Chennai.
// All click interactions have modern tactile micro-animations.
// Website footers, marketing copy, and FAQs are cleanly omitted from the mobile application.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Linking, Pressable, ScrollView as RNScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import { useNavigation } from '@react-navigation/native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Button, Disclosure, Notice, Segmented, Tabs } from '../components/ui';
import { ScrollView } from '../components/layout';
import { AppHeader, PressableScale } from '../components/brand';
import { Icon, type IconName } from '../components/Icon';
import { PlaceSearchModal } from '../components/PlaceSearchModal';
import { TimePickerSheet } from '../components/TimePickerSheet';
import { useCustomerData } from '../context/CustomerData';
import { useBookingDraft, type HomeService } from '../context/BookingDraft';
import { useDeviceLocation } from '../hooks/useDeviceLocation';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { LOCATION_ERROR_TEXT, reverseGeocode } from '../services/geoService';
import {
  SCHEDULE_MAX_DAYS,
  SUPPORT_PHONE,
  SUPPORT_PHONE_DISPLAY,
} from '../config/constants';
import { scheduleProblem } from '../utils/bookingRules';
import { POPULAR_AIRPORTS, makeLocalDisposalPlace } from '../services/pricingService';
import type { GeoPlace, TripType } from '../types';
import { formatTime } from '../utils/format';
import { haversineKm, isValidLatLng } from '../utils/geo';
import { colors, fonts, space } from '../theme';
import { ROUTE_ART } from '../assets/images';
import { useRideFocus } from '../navigation/MainNavigator';

type Field = 'pickup' | 'drop';
type TimeTarget = 'pickup' | 'return' | null;

const SERVICE_TITLE: Record<HomeService, string> = {
  airport: 'Airport Transfers',
  multicity: 'Multicity',
  outstation: 'One Way',
  rental: 'Local Rental',
};

const CHENNAI: GeoPlace = { id: 'city-chennai', name: 'Chennai', address: 'Chennai, Tamil Nadu', lat: 13.0827, lng: 80.2707, type: 'other' };

/** Six popular journeys from Chennai, with real city-centre coordinates. */
const POPULAR: { city: string; art: keyof typeof ROUTE_ART; place: GeoPlace }[] = [
  { city: 'Trichy', art: 'trichy', place: { id: 'city-trichy', name: 'Trichy', address: 'Tiruchirappalli, Tamil Nadu', lat: 10.7905, lng: 78.7047, type: 'other' } },
  { city: 'Madurai', art: 'madurai', place: { id: 'city-madurai', name: 'Madurai', address: 'Madurai, Tamil Nadu', lat: 9.9252, lng: 78.1198, type: 'other' } },
  { city: 'Thanjavur', art: 'thanjavur', place: { id: 'city-thanjavur', name: 'Thanjavur', address: 'Thanjavur, Tamil Nadu', lat: 10.787, lng: 79.1378, type: 'other' } },
  { city: 'Puducherry', art: 'puducherry', place: { id: 'city-puducherry', name: 'Puducherry', address: 'Puducherry', lat: 11.9416, lng: 79.8083, type: 'other' } },
  { city: 'Coimbatore', art: 'coimbatore', place: { id: 'city-coimbatore', name: 'Coimbatore', address: 'Coimbatore, Tamil Nadu', lat: 11.0168, lng: 76.9558, type: 'other' } },
  { city: 'Rameswaram', art: 'rameswaram', place: { id: 'city-rameswaram', name: 'Rameswaram', address: 'Rameswaram, Tamil Nadu', lat: 9.2876, lng: 79.3129, type: 'other' } },
];

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const formatDay = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');

export function BookScreen() {
  const navigation = useNavigation();
  const { trips, liveRide, savedPlaces } = useCustomerData();
  const { draft, update, service, setService } = useBookingDraft();
  const { undismiss } = useRideFocus();
  const { pickup, drop, tripType, scheduledAt, tripEndAt, airportDirection } = draft;
  const { position, error: locError, permission, locating, locate } = useDeviceLocation(true);
  const { online } = useNetworkStatus();
  const [picker, setPicker] = useState<Field | null>(null);
  const [timeTarget, setTimeTarget] = useState<TimeTarget>(null);
  // A date picked before its time is kept here; once a time is chosen the draft's instant is the truth.
  const [pendingPickupDay, setPendingPickupDay] = useState<Date | null>(null);
  const [pendingReturnDay, setPendingReturnDay] = useState<Date | null>(null);
  const pickupDay = scheduledAt ? dayStart(scheduledAt) : pendingPickupDay;
  const returnDay = tripEndAt ? dayStart(tripEndAt) : pendingReturnDay;
  const [problem, setProblem] = useState('');
  const [fieldError, setFieldError] = useState<Partial<Record<'pickup' | 'drop' | 'date' | 'time' | 'return', string>>>({});
  const scroller = useRef<RNScrollView>(null);

  const isAirport = service === 'airport';
  const isRental = service === 'rental';
  const isMulti = service === 'multicity';
  const isRound = service === 'outstation' && tripType === 'Round Trip';

  // Fill the pickup from GPS once, unless the customer already chose one.
  const pickupFromGps = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!position || pickupFromGps.current || pickup || (isAirport && airportDirection === 'from')) return;
    pickupFromGps.current = true;
    void reverseGeocode(position).then((p) => {
      if (mounted.current) update((d) => (d.pickup ? {} : { pickup: { ...p, type: 'current' } }));
    });
  }, [position, pickup, update, isAirport, airportDirection]);

  const recentPlaces = useMemo(() => {
    const seen = new Set<string>();
    const out: GeoPlace[] = [];
    for (const t of trips) {
      for (const p of [t.drop, t.pickup]) {
        if (!isValidLatLng(p) || seen.has(p.name)) continue;
        seen.add(p.name);
        out.push(p);
      }
    }
    return out;
  }, [trips]);

  const locateMe = async () => {
    const p = await locate();
    if (!p) return;
    const place = await reverseGeocode(p);
    if (mounted.current) {
      pickupFromGps.current = true;
      update({ pickup: { ...place, type: 'current' } });
      clearErrors();
      setPicker(null);
    }
  };

  const clearErrors = () => {
    setFieldError({});
    setProblem('');
  };

  // ── Trip switching ──────────────────────────────────────────────────────────
  const switchOutstation = (t: TripType) => {
    update({ tripType: t });
    clearErrors();
  };

  const setDirection = (d: 'to' | 'from') => {
    update((prev) => {
      if (prev.airportDirection === d) return {};
      // Swap places so the airport stays in the airport slot.
      const p = prev.pickup;
      const drop = prev.drop;
      return { airportDirection: d, pickup: drop, drop: p };
    });
    clearErrors();
  };

  const airportField: Field = isAirport ? (airportDirection === 'to' ? 'drop' : 'pickup') : 'pickup';

  // ── Scheduling ──────────────────────────────────────────────────────────────
  const openDate = (target: 'pickup' | 'return') => {
    const current = (target === 'return' ? returnDay : pickupDay) ?? dayStart(new Date());
    const min = target === 'return' && pickupDay ? pickupDay : dayStart(new Date());
    const max = new Date(Date.now() + SCHEDULE_MAX_DAYS * 86400000);
    try {
      DateTimePickerAndroid.open({
        value: current < min ? min : current,
        mode: 'date',
        minimumDate: min,
        maximumDate: max,
        onChange: (event, date) => {
          if (event.type !== 'set' || !date) return;
          const chosen = dayStart(date);
          if (target === 'pickup') {
            setPendingPickupDay(chosen);
            if (scheduledAt) {
              const adjusted = new Date(chosen);
              adjusted.setHours(scheduledAt.getHours(), scheduledAt.getMinutes(), 0, 0);
              update({ scheduledAt: adjusted });
            }
            if (returnDay && returnDay < chosen) {
              setPendingReturnDay(chosen);
              if (tripEndAt) {
                const adjustedReturn = new Date(chosen);
                adjustedReturn.setHours(tripEndAt.getHours(), tripEndAt.getMinutes(), 0, 0);
                update({ tripEndAt: adjustedReturn });
              }
            }
          } else {
            setPendingReturnDay(chosen);
            if (tripEndAt) {
              const adjusted = new Date(chosen);
              adjusted.setHours(tripEndAt.getHours(), tripEndAt.getMinutes(), 0, 0);
              update({ tripEndAt: adjusted });
            }
          }
          setFieldError((e) => ({ ...e, date: '', return: '' }));
          // Move directly to time selection.
          setTimeTarget(target);
        },
      });
    } catch {
      setProblem('Date selection is not available on this device. Please call NESAM to book.');
    }
  };

  const openTime = (target: 'pickup' | 'return') => {
    if (target === 'pickup' && !pickupDay) return openDate('pickup');
    if (target === 'return' && !returnDay) return openDate('return');
    setTimeTarget(target);
  };

  const returnProblem = (at: Date) => {
    if (!scheduledAt) return 'Choose the pickup date and time first.';
    if (at.getTime() <= scheduledAt.getTime()) return 'The return must be after the pickup time.';
    if (at.getTime() - Date.now() > (SCHEDULE_MAX_DAYS + 7) * 86400000) return 'Choose an earlier return date.';
    return '';
  };

  // ── Search ──────────────────────────────────────────────────────────────────
  const findCab = () => {
    let targetDrop = drop;
    if (isRental && pickup) {
      targetDrop = makeLocalDisposalPlace(pickup);
      update({ drop: targetDrop });
    }
    const errs: typeof fieldError = {};
    if (!pickup) errs.pickup = airportField === 'pickup' ? 'Choose the airport.' : 'Choose your pickup location.';
    if (!targetDrop) errs.drop = airportField === 'drop' ? 'Choose the airport.' : 'Choose your drop location.';
    if (isAirport && airportField === 'drop' && drop && drop.type !== 'airport') errs.drop = 'Choose an airport for an airport drop.';
    if (isAirport && airportField === 'pickup' && pickup && pickup.type !== 'airport') errs.pickup = 'Choose the airport you are arriving at.';
    if (pickup && targetDrop && !isRental && !isRound && haversineKm(pickup, targetDrop) < 0.2) errs.drop = 'Pickup and drop cannot be the same place.';
    if (!pickupDay) errs.date = 'Choose the pickup date.';
    const sched = scheduleProblem(scheduledAt);
    if (pickupDay && sched) errs.time = sched;
    if (isRound) {
      if (!tripEndAt) errs.return = 'Choose your return date and time.';
      else if (returnProblem(tripEndAt)) errs.return = returnProblem(tripEndAt);
    }
    setFieldError(errs);
    const first = Object.values(errs).find(Boolean);
    if (!online) {
      setProblem('You are offline. Check your connection and try again.');
      return;
    }
    setProblem(first ? 'Please check the highlighted details.' : '');
    if (!first) navigation.navigate('ChooseRide');
  };

  const planRoute = (dest: GeoPlace) => {
    setService('outstation');
    update({ pickup: CHENNAI, drop: dest });
    clearErrors();
    scroller.current?.scrollTo({ y: 0, animated: true });
  };

  const locationHint = locError ? LOCATION_ERROR_TEXT[locError.kind] : permission === 'prompt' && !position ? 'Allow location access to fill your pickup automatically.' : '';
  const title = service === 'outstation' ? tripType : SERVICE_TITLE[service];

  // ── Field rendering ─────────────────────────────────────────────────────────
  const fieldLabel = (f: Field) => (airportField === f ? 'Airport' : f === 'pickup' ? 'Pickup location' : 'Drop location');
  const fieldPlaceholder = (f: Field) => (airportField === f ? 'Choose airport' : f === 'pickup' ? (locating ? 'Finding your location…' : 'Enter pickup location') : 'Enter drop location');

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
<KeyboardAvoid>
      <PlaceSearchModal
        visible={picker !== null}
        title={picker ? fieldLabel(picker) : ''}
        subtitle={picker && airportField === picker ? 'Choose an airport or search by name.' : undefined}
        onClose={() => setPicker(null)}
        onSelect={(p) => {
          if (picker === 'pickup') {
            pickupFromGps.current = true;
            update({ pickup: p });
          } else {
            update({ drop: p });
          }
          clearErrors();
        }}
        savedPlaces={picker && airportField === picker ? [] : savedPlaces}
        recentPlaces={picker && airportField === picker ? recentPlaces.filter((p) => p.type === 'airport') : recentPlaces.filter((p) => p.type !== 'airport')}
        suggestions={picker && airportField === picker ? POPULAR_AIRPORTS : []}
        suggestionsLabel="Airports"
        near={picker === 'drop' ? (pickup ?? position) : position}
        onUseCurrentLocation={picker === 'pickup' && airportField !== 'pickup' ? () => void locateMe() : undefined}
      />
      {timeTarget ? (
        <TimePickerSheet
          visible
          title={timeTarget === 'return' ? 'Return time' : 'Pickup time'}
          day={(timeTarget === 'return' ? returnDay : pickupDay) ?? dayStart(new Date())}
          value={timeTarget === 'return' ? tripEndAt : scheduledAt}
          problemOf={timeTarget === 'return' ? returnProblem : (at) => scheduleProblem(at)}
          onClose={() => setTimeTarget(null)}
          onConfirm={(at) => {
            if (timeTarget === 'return') {
              update({ tripEndAt: at });
              setPendingReturnDay(null);
            } else {
              update((d) => ({ scheduledAt: at, tripEndAt: d.tripEndAt && d.tripEndAt <= at ? null : d.tripEndAt }));
              setPendingPickupDay(null);
            }
            setFieldError((e) => ({ ...e, time: '', return: '' }));
            setTimeTarget(null);
          }}
        />
      ) : null}

      <AppHeader title={title} />

      <ScrollView ref={scroller} kind="narrow" contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {liveRide ? (
          <PressableScale
            activeScale={0.96}
            style={styles.live}
            onPress={() => {
              undismiss(liveRide.id);
              navigation.navigate('ActiveRide', { bookingId: liveRide.id });
            }}
            accessibilityRole="button"
            accessibilityLabel={`Open your current trip, ${liveRide.pickup.name} to ${liveRide.drop.name}`}
          >
            <View style={styles.liveDot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.liveTitle}>{liveRide.status === 'Ongoing' ? 'Trip in progress' : 'Your trip is coming up'}</Text>
              <Text style={styles.liveRoute} numberOfLines={1}>
                {liveRide.pickup.name} → {liveRide.drop.name}
              </Text>
            </View>
            <Icon name="chevron-right" size={18} color={colors.success} strokeWidth={2.2} />
          </PressableScale>
        ) : null}

        {service === 'outstation' ? (
          <View style={{ marginBottom: 16 }}>
            <Tabs<TripType>
              options={[
                { value: 'One Way', label: 'One Way' },
                { value: 'Round Trip', label: 'Round Trip' },
              ]}
              value={tripType === 'Round Trip' ? 'Round Trip' : 'One Way'}
              onChange={switchOutstation}
            />
          </View>
        ) : null}

        <View style={styles.widget}>
          {isMulti ? (
            <MulticityNotice onOneWay={() => setService('outstation')} />
          ) : (
            <>
              {isAirport ? (
                <Segmented
                  style={{ marginTop: 15 }}
                  options={[
                    { value: 'to', label: 'To airport' },
                    { value: 'from', label: 'From airport' },
                  ]}
                  value={airportDirection}
                  onChange={setDirection}
                />
              ) : null}

              <View>
                <RouteField
                  pin="start"
                  label={fieldLabel('pickup')}
                  value={pickup?.name}
                  placeholder={fieldPlaceholder('pickup')}
                  error={fieldError.pickup}
                  onPress={() => setPicker('pickup')}
                  roomForSwap={service === 'outstation'}
                />
                {isRental ? null : (
                  <RouteField
                    pin="end"
                    label={fieldLabel('drop')}
                    value={drop?.name}
                    placeholder={fieldPlaceholder('drop')}
                    error={fieldError.drop}
                    onPress={() => setPicker('drop')}
                    divider
                    roomForSwap={service === 'outstation'}
                  />
                )}
                {service === 'outstation' ? (
                  <PressableScale
                    onPress={() => {
                      update({ pickup: drop, drop: pickup });
                      clearErrors();
                    }}
                    activeScale={0.86}
                    disabled={!pickup && !drop}
                    style={styles.swap}
                    accessibilityRole="button"
                    accessibilityLabel="Swap pickup and drop"
                    hitSlop={6}
                  >
                    <Icon name="arrow-up-down" size={17} color="#657184" strokeWidth={2.0} />
                  </PressableScale>
                ) : null}
              </View>

              <View style={styles.formRow}>
                <PickerBox
                  label="Pickup date"
                  value={pickupDay ? formatDay(pickupDay) : ''}
                  placeholder="Select date"
                  icon="calendar-days"
                  error={fieldError.date}
                  onPress={() => openDate('pickup')}
                />
                <PickerBox
                  label="Pickup time"
                  value={scheduledAt ? formatTime(scheduledAt).replace(/^0/, '') : ''}
                  placeholder="Select time"
                  icon="chevron-down"
                  error={fieldError.time}
                  onPress={() => openTime('pickup')}
                />
              </View>

              {isRound ? (
                <View style={styles.formRow}>
                  <PickerBox
                    label="Return date"
                    value={returnDay ? formatDay(returnDay) : ''}
                    placeholder="Select date"
                    icon="calendar-days"
                    error={fieldError.return && !returnDay ? fieldError.return : ''}
                    onPress={() => openDate('return')}
                  />
                  <PickerBox
                    label="Return time"
                    value={tripEndAt ? formatTime(tripEndAt).replace(/^0/, '') : ''}
                    placeholder="Select time"
                    icon="chevron-down"
                    error={fieldError.return && returnDay ? fieldError.return : ''}
                    onPress={() => openTime('return')}
                  />
                </View>
              ) : null}

              {isRental ? (
                <View style={styles.packageNote}>
                  <Text style={styles.formLabel}>Rental package</Text>
                  <View style={styles.packageBox}>
                    <Icon name="clock-3" size={16} color="#7E8896" strokeWidth={2.0} />
                    <Text style={styles.packageText}>Hourly, within the city. Each car shows its package hours, included km and extra-hour rate.</Text>
                  </View>
                  <Segmented
                    style={{ marginTop: 10 }}
                    options={[{ value: 'auto', label: 'Shortest' }, ...[4, 6, 8, 10, 12].map((h) => ({ value: String(h), label: `${h}h` }))]}
                    value={draft.rentalHours ? String(draft.rentalHours) : 'auto'}
                    onChange={(v) => update({ rentalHours: v === 'auto' ? null : Number(v) })}
                  />
                </View>
              ) : null}

              {isAirport ? (
                <View style={styles.flight}>
                  <Disclosure title="Flight details (optional)" initiallyOpen={!!draft.flightNumber}>
                    <Text style={styles.formLabel}>Flight number</Text>
                    <TextInput
                      value={draft.flightNumber}
                      onChangeText={(v) => update({ flightNumber: v.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 10) })}
                      placeholder="e.g. 6E 562"
                      placeholderTextColor={colors.faint}
                      autoCapitalize="characters"
                      style={styles.flightInput}
                      accessibilityLabel="Flight number (optional)"
                    />
                    <Text style={styles.flightHint}>Shared with NESAM in your booking notes to help plan the pickup.</Text>
                  </Disclosure>
                </View>
              ) : null}

              <Button title="Search Cabs" iconRight="arrow-right" onPress={findCab} style={{ marginTop: 14 }} />
              <View style={styles.trust}>
                <Icon name="shield-check" size={13} color="#8994A4" strokeWidth={2.0} />
                <Text style={styles.trustText}>Clear fares. Dedicated support.</Text>
              </View>
            </>
          )}
        </View>

        {problem ? <Notice message={problem} tone={online ? 'warning' : 'error'} style={{ marginTop: space.md }} /> : null}
        {locationHint && !pickup && !isMulti ? <Notice tone="info" message={locationHint} style={{ marginTop: space.md }} /> : null}

        {/* Popular routes */}
        <View style={styles.popular}>
          <Text style={styles.popularTitle} accessibilityRole="header">
            Popular routes
          </Text>
          <Text style={styles.caption}>A few favourites from Chennai.</Text>
        </View>
        <RNScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail} style={styles.railWrap}>
          {POPULAR.map((r) => (
            <PressableScale
              key={r.city}
              activeScale={0.94}
              onPress={() => planRoute(r.place)}
              style={styles.routeCard}
              accessibilityRole="button"
              accessibilityLabel={`Plan trip: Chennai to ${r.city}`}
            >
              <View style={styles.routeArt}>
                <Image source={ROUTE_ART[r.art]} style={styles.routeImg} resizeMode="contain" accessible={false} />
              </View>
              <View style={styles.routeBody}>
                <View style={styles.routeName}>
                  <Text style={styles.routeFrom}>Chennai</Text>
                  <Icon name="arrow-right" size={14} color="#9199A5" strokeWidth={2.0} />
                  <Text style={styles.routeTo}>{r.city}</Text>
                </View>
                <View style={styles.planTrip}>
                  <Text style={styles.planText}>Plan trip</Text>
                  <Icon name="arrow-right" size={13} color={colors.primary} strokeWidth={2.0} />
                </View>
              </View>
            </PressableScale>
          ))}
        </RNScrollView>
      </ScrollView>
    </KeyboardAvoid>
</SafeAreaView>
  );
}

function RouteField({
  pin,
  label,
  value,
  placeholder,
  error,
  onPress,
  divider,
  roomForSwap,
}: {
  pin: 'start' | 'end';
  label: string;
  value?: string;
  placeholder: string;
  error?: string;
  onPress: () => void;
  divider?: boolean;
  roomForSwap?: boolean;
}) {
  return (
    <PressableScale
      onPress={onPress}
      activeScale={0.98}
      style={[styles.field, divider && styles.fieldDivider]}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? 'not set'}`}
      accessibilityHint={error || 'Opens location search'}
    >
      <View style={[styles.pin, pin === 'end' ? styles.pinEnd : styles.pinStart, !!error && { borderColor: colors.primary }]} />
      <View style={{ flex: 1, minWidth: 0, marginRight: roomForSwap ? 30 : 0 }}>
        <Text style={styles.formLabelTight}>{label}</Text>
        <Text style={[styles.fieldValue, !value && styles.fieldPlaceholder]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      </View>
      <View style={[styles.chev, roomForSwap && { marginRight: 32 }]}>
        <Icon name="chevron-right" size={17} color="#90939A" strokeWidth={2.2} />
      </View>
    </PressableScale>
  );
}

function PickerBox({
  label,
  value,
  placeholder,
  icon,
  error,
  onPress,
}: {
  label: string;
  value: string;
  placeholder: string;
  icon: IconName;
  error?: string;
  onPress: () => void;
}) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={styles.formLabel}>{label}</Text>
      <PressableScale
        onPress={onPress}
        activeScale={0.96}
        style={[styles.pickerBox, !!error && styles.pickerError]}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || 'not set'}`}
        accessibilityHint={error || undefined}
      >
        <Text style={[styles.pickerValue, !value && styles.fieldPlaceholder]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <Icon name={icon} size={15} color="#858B95" strokeWidth={2.0} />
      </PressableScale>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

/** Multicity has no booking contract on the server yet, so it is booked through the office. */
function MulticityNotice({ onOneWay }: { onOneWay: () => void }) {
  return (
    <View style={{ paddingTop: 16 }}>
      <View style={styles.multiSteps} accessible accessibilityLabel="Pickup, up to four stops and a final drop">
        {['Pickup location', 'Stops along the way', 'Final drop'].map((t, i) => (
          <View key={t} style={[styles.multiStep, i > 0 && styles.fieldDivider]}>
            <View style={[styles.pin, i === 2 ? styles.pinEnd : styles.pinStart]} />
            <Text style={styles.multiStepText}>{t}</Text>
          </View>
        ))}
      </View>
      <Notice
        tone="info"
        message="Multicity trips with several stops are arranged by our office for now. Call us with your stops and dates, or book each leg as a one-way trip."
        style={{ marginTop: 14 }}
      />
      <Button title={`Call NESAM · ${SUPPORT_PHONE_DISPLAY}`} icon="phone" onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} />
      <Button title="Book a one-way trip" variant="secondary" onPress={onOneWay} style={{ marginTop: 10 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  page: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: 40 },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.successSoft,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: space.md,
  },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.successStrong },
  liveTitle: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.success },
  liveRoute: { fontFamily: fonts.regular, fontSize: 12, color: '#3E5A4C', marginTop: 2 },
  widget: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 16, paddingBottom: 14, backgroundColor: colors.white },
  field: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, minHeight: 67, gap: 13 },
  fieldDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  pin: { width: 8, height: 8, borderWidth: 1 },
  pinStart: { borderRadius: 4, borderColor: '#7D838D' },
  pinEnd: { borderRadius: 3, borderColor: colors.primary },
  formLabelTight: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15.4, color: '#7E8691' },
  formLabel: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16.5, color: '#697587', marginBottom: 5 },
  fieldValue: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 24.8, color: colors.value, letterSpacing: -0.3, marginTop: 3 },
  fieldPlaceholder: { color: '#99A1AD', fontFamily: fonts.regular },
  fieldError: { fontFamily: fonts.medium, fontSize: 11.5, color: colors.primaryDark, marginTop: 3 },
  chev: { paddingHorizontal: 3, paddingVertical: 8 },
  swap: {
    position: 'absolute',
    right: 0,
    top: 50,
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E4E8EE',
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  formRow: { flexDirection: 'row', gap: 11, marginTop: 14 },
  pickerBox: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.white,
  },
  pickerError: { borderColor: colors.primary, backgroundColor: '#FFFBFB' },
  pickerValue: { flex: 1, fontFamily: fonts.medium, fontSize: 13.5, color: colors.text, letterSpacing: -0.2 },
  packageNote: { marginTop: 14 },
  packageBox: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: '#FAFBFC' },
  packageText: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: '#55606F' },
  flight: { marginTop: 14, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 2 },
  flightInput: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 11, fontFamily: fonts.medium, fontSize: 15, color: colors.value },
  flightHint: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted, marginTop: 5 },
  trust: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 11 },
  trustText: { fontFamily: fonts.regular, fontSize: 9.5, color: '#7F8998' },
  multiSteps: { borderWidth: 1, borderColor: colors.divider, borderRadius: 8, paddingHorizontal: 12 },
  multiStep: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46 },
  multiStepText: { fontFamily: fonts.medium, fontSize: 13.5, color: '#8A929E' },
  popular: { marginTop: 24 },
  popularTitle: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 28, letterSpacing: -0.5, color: colors.text },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: '#74808F', marginTop: 3 },
  railWrap: { marginHorizontal: -space.xl, marginTop: 12 },
  rail: { paddingHorizontal: space.xl, paddingBottom: 8, gap: 12 },
  routeCard: { width: 249, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, backgroundColor: colors.white, overflow: 'hidden' },
  routeArt: { height: 110, margin: 5, marginBottom: 0, borderRadius: 6, backgroundColor: '#FFF5F2', overflow: 'hidden' },
  routeImg: { width: '100%', height: '100%' },
  routeBody: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 },
  routeName: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  routeFrom: { fontFamily: fonts.regular, fontSize: 14, color: '#3D4653', letterSpacing: -0.3 },
  routeTo: { fontFamily: fonts.semiBold, fontSize: 14, color: '#252D38', letterSpacing: -0.3, flexShrink: 1 },
  planTrip: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  planText: { fontFamily: fonts.medium, fontSize: 11, color: colors.primary },
});
