// Home / booking step 1, in the modern mobile layout:
// Header displays the logo with the dynamic page heading right to it (Airport Transfers, Round Trip, One Way, etc.),
// One Way / Round Trip tabs, route + schedule form, and popular routes from Chennai.
// All click interactions have modern tactile micro-animations.
// Website footers, marketing copy, and FAQs are cleanly omitted from the mobile application.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, type ImageSourcePropType, Pressable, ScrollView as RNScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Notice } from '../components/ui';
import { DESKTOP_NAV_MIN, DesktopTopBar, MenuButton, NotificationsAction, PressableScale, SupportMenuAction } from '../components/brand';
import { SiteFooter } from '../components/SiteFooter';
import { GoButton, LocationField, PillTabs, RouteRail, ScheduleCell } from '../components/BookForm';
import { Icon } from '../components/Icon';
import { serviceSlogan } from '../utils/serviceSlogan';
import { useDockPad } from '../context/Dock';
import { setResumeFares, useAuthGate } from '../context/AuthGate';
import { PlaceSearchModal } from '../components/PlaceSearchModal';
import { MulticityForm } from '../components/MulticityForm';
import { TimePickerSheet } from '../components/TimePickerSheet';
import { useCustomerData } from '../context/CustomerData';
import { useBookingDraft, type HomeService } from '../context/BookingDraft';
import { useDeviceLocation } from '../hooks/useDeviceLocation';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { LOCATION_ERROR_TEXT, reverseGeocode } from '../services/geoService';
import {
  SCHEDULE_MAX_DAYS,
} from '../config/constants';
import { scheduleProblem } from '../utils/bookingRules';
import { POPULAR_AIRPORTS } from '../services/pricingService';
import { QUICK_CITIES } from '../data/localRentals';
import type { GeoPlace, TripType } from '../types';
import { formatTime } from '../utils/format';
import { haversineKm, isValidLatLng } from '../utils/geo';
import { colors, fonts, space } from '../theme';
import { HEROES, NESAM } from '../assets/images';
import { useRideFocus } from '../navigation/MainNavigator';

/** The service switcher inside the booking card on wide windows (phones use the floating bottom bar). */
const DESKTOP_SERVICES: { key: HomeService; label: string; image: ImageSourcePropType }[] = [
  { key: 'outstation', label: 'Outstation', image: NESAM.navOutstation },
  { key: 'multicity', label: 'Multicity', image: NESAM.navMulticity },
  { key: 'rental', label: 'Local', image: NESAM.navLocal },
  { key: 'airport', label: 'Airport', image: NESAM.navAirport },
];

type Field = 'pickup' | 'drop';
type Picker = Field | { stop: number | 'new' };
type TimeTarget = 'pickup' | null;

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const formatDay = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
/** "Today", "Tomorrow" or the weekday, so the chosen day is clear at a glance. */
const dayHint = (d: Date): string => {
  const diff = Math.round((dayStart(d).getTime() - dayStart(new Date()).getTime()) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'long' });
};
/** Round trips are booked for up to this many days (the server's roundTrip.maxDays). */
const RT_MAX_DAYS = SCHEDULE_MAX_DAYS;
/** A round trip ends on the last of its days, at the pickup time (the server counts calendar days). */
const tripEndFor = (pickup: Date, days: number): Date => {
  const end = new Date(pickup);
  end.setDate(end.getDate() + days - 1);
  return end;
};

export function BookScreen() {
  const navigation = useNavigation();
  const { trips, liveRide, savedPlaces } = useCustomerData();
  const { draft, update, service, setService } = useBookingDraft();
  const { undismiss } = useRideFocus();
  const { pickup, drop, tripType, scheduledAt, tripEndAt, airportDirection } = draft;
  const { position, error: locError, permission, locate } = useDeviceLocation(true);
  const { online } = useNetworkStatus();
  const [picker, setPicker] = useState<Picker | null>(null);
  const [timeTarget, setTimeTarget] = useState<TimeTarget>(null);
  // A date picked before its time is kept here; once a time is chosen the draft's instant is the truth.
  // Like the website, the date starts on today.
  const [pendingPickupDay, setPendingPickupDay] = useState<Date | null>(null);
  const pickupDay = scheduledAt ? dayStart(scheduledAt) : (pendingPickupDay ?? dayStart(new Date()));
  // Round trip: how many days the trip lasts. It ends on the last day, at the pickup time.
  const [days, setDays] = useState<number>(() => {
    if (!tripEndAt || !scheduledAt) return 1;
    const n = Math.round((dayStart(tripEndAt).getTime() - dayStart(scheduledAt).getTime()) / 86400000) + 1;
    return n >= 1 && n <= RT_MAX_DAYS ? n : 1;
  });
  const [problem, setProblem] = useState('');
  const [fieldError, setFieldError] = useState<Partial<Record<'pickup' | 'drop' | 'date' | 'time' | 'return', string>>>({});
  const scroller = useRef<RNScrollView>(null);

  // Local Rentals has its own map flow (the Rentals tab); coming back to this form means a different service.
  useFocusEffect(
    React.useCallback(() => {
      if (service === 'rental') setService('outstation');
    }, [service, setService]),
  );

  const isAirport = service === 'airport';
  const isMulti = service === 'multicity';
  const isRound = service === 'outstation' && tripType === 'Round Trip';

  useEffect(() => {
    if (!isRound || !scheduledAt) {
      if (tripEndAt) update({ tripEndAt: null });
      return;
    }
    const end = tripEndFor(scheduledAt, days);
    if (!tripEndAt || tripEndAt.getTime() !== end.getTime()) update({ tripEndAt: end });
  }, [scheduledAt, days, isRound]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Which end is the airport on an airport transfer; null for every other service.
  const airportField: Field | null = isAirport ? (airportDirection === 'to' ? 'drop' : 'pickup') : null;

  // ── Scheduling ──────────────────────────────────────────────────────────────
  const openDate = () => {
    const current = pickupDay ?? dayStart(new Date());
    const min = dayStart(new Date());
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
          setPendingPickupDay(chosen);
          if (scheduledAt) {
            const adjusted = new Date(chosen);
            adjusted.setHours(scheduledAt.getHours(), scheduledAt.getMinutes(), 0, 0);
            update({ scheduledAt: adjusted });
          }
          setFieldError((e) => ({ ...e, date: '' }));
          // Move directly to time selection.
          setTimeTarget('pickup');
        },
      });
    } catch {
      setProblem('Date selection is not available on this device. Please call NESAM to book.');
    }
  };

  const openTime = () => {
    if (!pickupDay) return openDate();
    setTimeTarget('pickup');
  };

  // ── Search ──────────────────────────────────────────────────────────────────
  const findCab = () => {
    const targetDrop = drop;
    const errs: typeof fieldError = {};
    if (!pickup) errs.pickup = airportField === 'pickup' ? 'Choose the airport.' : 'Choose your pickup location.';
    if (!targetDrop) errs.drop = airportField === 'drop' ? 'Choose the airport.' : 'Choose your drop location.';
    if (isAirport && airportField === 'drop' && drop && drop.type !== 'airport') errs.drop = 'Choose an airport for an airport drop.';
    if (isAirport && airportField === 'pickup' && pickup && pickup.type !== 'airport') errs.pickup = 'Choose the airport you are arriving at.';
    if (pickup && targetDrop && !isRound && haversineKm(pickup, targetDrop) < 0.2) errs.drop = 'Pickup and drop cannot be the same place.';
    const sched = scheduleProblem(scheduledAt);
    if (sched) errs.time = sched;
    if (isRound && (days < 1 || days > RT_MAX_DAYS)) errs.return = `Choose 1 to ${RT_MAX_DAYS} days.`;
    setFieldError(errs);
    const first = Object.values(errs).find(Boolean);
    if (!online) {
      setProblem('You are offline. Check your connection and try again.');
      return;
    }
    setProblem('');
    if (first) return;
    if (guest) {
      // Fares need an account: sign in, then carry on with this trip (the draft is kept).
      setResumeFares(true);
      requestSignIn({ title: 'Sign in to compare fares', subtitle: 'Verify your mobile number to continue with your saved trip.' });
      return;
    }
    navigation.navigate('ChooseRide');
  };

  const locationHint = locError ? LOCATION_ERROR_TEXT[locError.kind] : permission === 'prompt' && !position ? 'Allow location access to fill your pickup automatically.' : '';
  const [headline, subline] = serviceSlogan(service, tripType === 'Round Trip' ? 'Round Trip' : 'One Way');
  const dockPad = useDockPad();
  const { guest, requestSignIn } = useAuthGate();
  const { width: screenW, height: screenH } = useWindowDimensions();
  // Wide windows get the website's desktop header, footer and two-column hero; phones keep the floating bar.
  const desktop = screenW >= DESKTOP_NAV_MIN;
  const wide = screenW >= 1000;
  // The hero logo scales down on short phones so the whole form stays in one view.
  const logoW = desktop ? 300 : Math.min(304, Math.round(screenW * 0.78), Math.round((screenH - dockPad) * 0.4));
  const fieldLabel = (f: Field) => (airportField === f ? (f === 'drop' ? 'Drop airport' : 'Pickup airport') : f === 'pickup' ? 'Pickup location' : 'Drop location');
  const pickerTitle = picker === null ? '' : typeof picker === 'object' ? (picker.stop === 'new' ? 'Add itinerary stop' : `Edit stop ${picker.stop + 1}`) : fieldLabel(picker);

  // ── Field rendering ─────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <Image source={HEROES.desktop} style={styles.heroImg} resizeMode="cover" accessible={false} />
      <View style={styles.heroWash} pointerEvents="none" />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <KeyboardAvoid>
          <PlaceSearchModal
            visible={picker !== null}
            title={pickerTitle}
            subtitle={picker === 'pickup' || picker === 'drop' ? (airportField === picker ? 'Choose an airport or search by name.' : undefined) : 'Add a stop on your route.'}
            onClose={() => setPicker(null)}
            onSelect={(p) => {
              if (picker === 'pickup') {
                pickupFromGps.current = true;
                update({ pickup: p });
              } else if (picker === 'drop') {
                update({ drop: p });
              } else if (picker && typeof picker === 'object') {
                update((d) => ({ stops: picker.stop === 'new' ? [...d.stops, p] : d.stops.map((s, i) => (i === picker.stop ? p : s)) }));
              }
              clearErrors();
            }}
            savedPlaces={picker && airportField === picker ? [] : savedPlaces}
            recentPlaces={picker && airportField === picker ? recentPlaces.filter((p) => p.type === 'airport') : recentPlaces.filter((p) => p.type !== 'airport')}
            suggestions={picker && airportField === picker ? POPULAR_AIRPORTS : QUICK_CITIES}
            suggestionsLabel={picker && airportField === picker ? 'Airports' : 'Popular locations'}
            near={picker === 'drop' ? (pickup ?? position) : position}
            onUseCurrentLocation={picker === 'pickup' && airportField !== 'pickup' ? () => void locateMe() : undefined}
          />
          {timeTarget ? (
            <TimePickerSheet
              visible
              title="Pickup time"
              day={pickupDay}
              value={scheduledAt}
              problemOf={(at) => scheduleProblem(at)}
              onClose={() => setTimeTarget(null)}
              onConfirm={(at) => {
                update({ scheduledAt: at });
                setPendingPickupDay(null);
                setFieldError((e) => ({ ...e, time: '' }));
                setTimeTarget(null);
              }}
            />
          ) : null}

          {desktop ? <DesktopTopBar /> : null}
          <RNScrollView
            ref={scroller}
            contentContainerStyle={[styles.page, desktop && styles.pageDesktop, { paddingBottom: 12 + dockPad }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
            overScrollMode="never"
          >
            {desktop ? null : (
            <View style={styles.topRow}>
              <MenuButton glass />
              <View style={{ flex: 1 }} />
              <SupportMenuAction glass />
              {/* A guest has no notifications; signing in happens from "Let's Go !" or the Profile tab. */}
              {guest ? null : (
                <View style={styles.glass}>
                  <NotificationsAction />
                </View>
              )}
            </View>
            )}

            <View style={[desktop && styles.main, wide && styles.mainWide]}>
              <View style={wide ? styles.leftCol : undefined}>
            <View style={styles.hero}>
              <Image source={NESAM.logo} style={{ width: logoW, height: logoW / 3.05 }} resizeMode="contain" accessibilityLabel="NESAM Cabs" />
              {headline || subline ? (
                <Text style={[styles.slogan, isMulti && styles.sloganBig]} accessibilityRole="header" accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.15}>
                  {headline}
                  {'\n'}
                  <Text style={[styles.sloganAccent, isMulti && styles.sloganAccentMulti]}>{subline}</Text>
                </Text>
              ) : null}
            </View>

            {liveRide ? (
              <PressableScale
                activeScale={0.97}
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
              </View>
              <View style={wide ? styles.rightCol : desktop ? styles.midCol : undefined}>
            <View style={styles.card}>
              {desktop ? (
                <View style={styles.services} accessibilityRole="tablist" accessibilityLabel="Services">
                  {DESKTOP_SERVICES.map((sv) => {
                    const on = service === sv.key;
                    return (
                      <Pressable
                        key={sv.key}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: on }}
                        onPress={() => {
                          setService(sv.key);
                          navigation.navigate('Tabs', { screen: sv.key === 'rental' ? 'Rentals' : 'Book' });
                        }}
                        style={({ hovered }: { hovered?: boolean }) => [styles.serviceTab, (on || hovered) && styles.serviceTabOn, on && styles.serviceTabActive]}
                      >
                        <Image source={sv.image} style={styles.serviceImg} resizeMode="contain" accessible={false} />
                        <Text style={[styles.serviceText, on && { color: colors.primary }]} numberOfLines={1}>
                          {sv.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              {service === 'outstation' ? (
                <PillTabs<TripType>
                  options={[
                    { value: 'One Way', label: 'One Way' },
                    { value: 'Round Trip', label: 'Round Trip' },
                  ]}
                  value={tripType === 'Round Trip' ? 'Round Trip' : 'One Way'}
                  onChange={switchOutstation}
                />
              ) : isAirport ? (
                <PillTabs<'to' | 'from'>
                  options={[
                    { value: 'to', label: 'To airport' },
                    { value: 'from', label: 'From airport' },
                  ]}
                  value={airportDirection}
                  onChange={setDirection}
                />
              ) : null}

              {isMulti ? (
                <MulticityForm />
              ) : (
                <View style={styles.form}>
                  <RouteRail
                    pickup={<LocationField label={fieldLabel('pickup')} value={pickup?.name} address={pickup?.address} error={fieldError.pickup} onPress={() => setPicker('pickup')} />}
                    drop={<LocationField label={fieldLabel('drop')} value={drop?.name} address={drop?.address} error={fieldError.drop} onPress={() => setPicker('drop')} />}
                    middle={
                      isRound ? (
                        <View style={{ gap: 10 }}>
                          {draft.stops.map((stop, i) => (
                            <View key={`${stop.id}-${i}`} style={{ marginLeft: 9 }}>
                              <LocationField
                                label={`Stop ${i + 1}`}
                                value={stop.name}
                                address={stop.address}
                                onPress={() => setPicker({ stop: i })}
                                trailing={
                                  <Pressable accessibilityRole="button" accessibilityLabel={`Delete stop ${i + 1}`} hitSlop={10} onPress={() => update((d) => ({ stops: d.stops.filter((_, n) => n !== i) }))}>
                                    <Icon name="trash-2" size={17} color={colors.primary} strokeWidth={2} />
                                  </Pressable>
                                }
                              />
                            </View>
                          ))}
                          {draft.stops.length < 8 ? (
                            <PressableScale activeScale={0.96} onPress={() => setPicker({ stop: 'new' })} accessibilityRole="button" accessibilityLabel="Add stop" style={styles.addStop} containerStyle={{ alignSelf: 'center' }}>
                              <Icon name="plus" size={16} color={colors.primary} strokeWidth={2.2} />
                              <Text style={styles.addStopText}>Add stop</Text>
                            </PressableScale>
                          ) : null}
                        </View>
                      ) : null
                    }
                    swapDisabled={!pickup && !drop}
                    onSwap={
                      isAirport
                        ? undefined
                        : () => {
                            update((d) => ({ pickup: d.drop, drop: d.pickup, stops: d.tripType === 'Round Trip' ? [...d.stops].reverse() : d.stops }));
                            clearErrors();
                          }
                    }
                  />

                  <View style={styles.formRow}>
                    <ScheduleCell label="Pickup date" value={formatDay(pickupDay)} icon="calendar-days" chip={dayHint(pickupDay)} error={fieldError.date} onPress={() => openDate()} />
                    <ScheduleCell label="Pickup time" value={scheduledAt ? formatTime(scheduledAt).replace(/^0/, '') : ''} icon="clock" error={fieldError.time} onPress={() => openTime()} />
                  </View>

                  {isRound ? (
                    <View>
                      <View style={styles.daysCell}>
                        <Text style={styles.cellLabel}>Days</Text>
                        <View style={styles.stepper}>
                          <Pressable accessibilityRole="button" accessibilityLabel="One day fewer" disabled={days <= 1} onPress={() => setDays((n) => Math.max(1, n - 1))} style={[styles.stepBtn, days <= 1 && styles.stepBtnOff]}>
                            <Text style={styles.stepText}>−</Text>
                          </Pressable>
                          <Text style={styles.stepValue}>
                            {days} {days === 1 ? 'day' : 'days'}
                          </Text>
                          <Pressable accessibilityRole="button" accessibilityLabel="One day more" disabled={days >= RT_MAX_DAYS} onPress={() => setDays((n) => Math.min(RT_MAX_DAYS, n + 1))} style={[styles.stepBtn, days >= RT_MAX_DAYS && styles.stepBtnOff]}>
                            <Text style={styles.stepText}>+</Text>
                          </Pressable>
                        </View>
                        <Text style={styles.daysEnd}>Ends {dayHint(tripEndFor(pickupDay, days))}</Text>
                      </View>
                      {fieldError.return ? <Text style={styles.errorText}>{fieldError.return}</Text> : null}
                    </View>
                  ) : null}

                  {isAirport ? (
                    <View style={styles.flight}>
                      <Text style={styles.cellLabelDark}>Flight number (optional)</Text>
                      <TextInput
                        value={draft.flightNumber}
                        onChangeText={(v) => update({ flightNumber: v.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 10) })}
                        placeholder="e.g. 6E 562"
                        placeholderTextColor={colors.faint}
                        autoCapitalize="characters"
                        style={styles.flightInput}
                        accessibilityLabel="Flight number (optional)"
                      />
                    </View>
                  ) : null}

                  {problem ? <Text style={styles.errorText}>{problem}</Text> : null}
                  <GoButton title="Let’s Go !" onPress={findCab} />
                </View>
              )}
            </View>

            {locError && !pickup && !isMulti ? <Notice tone="info" message={locationHint} style={{ marginTop: space.md }} /> : null}
              </View>
            </View>
            {desktop ? <SiteFooter /> : null}
          </RNScrollView>
        </KeyboardAvoid>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  heroImg: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  heroWash: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(244,249,255,0.84)' },
  page: { flexGrow: 1, paddingHorizontal: 14, paddingBottom: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6, minHeight: 50 },
  glass: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', gap: 6, paddingTop: 2, paddingBottom: 14 },
  pageDesktop: { paddingHorizontal: 0 },
  services: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  serviceTab: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, paddingHorizontal: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  serviceTabOn: { backgroundColor: colors.primarySoft },
  serviceTabActive: { borderColor: colors.primary },
  serviceImg: { width: 28, height: 28 },
  serviceText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  main: { width: '100%', maxWidth: 1216, alignSelf: 'center', paddingHorizontal: 32, paddingTop: 28, paddingBottom: 12 },
  mainWide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 64, minHeight: 560 },
  leftCol: { flex: 1, minWidth: 0 },
  rightCol: { width: 540, flexShrink: 0 },
  midCol: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  slogan: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 23, letterSpacing: -0.1, textAlign: 'center', color: colors.primary },
  sloganAccent: { color: '#0B1D46' },
  sloganBig: { fontSize: 25, lineHeight: 31 },
  sloganAccentMulti: { color: '#000000' },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.successBorder,
    backgroundColor: colors.successSoft,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
  },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.successStrong },
  liveTitle: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.success },
  liveRoute: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  card: { padding: 12, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 6, backgroundColor: colors.white },
  form: { gap: 14, marginTop: 16 },
  formRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  addStop: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 38, paddingHorizontal: 18, borderWidth: 1, borderColor: '#DAC0C9', borderRadius: 6, backgroundColor: colors.white },
  addStopText: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  daysCell: { paddingHorizontal: 12, paddingTop: 22, paddingBottom: 10, borderWidth: 1, borderColor: '#DAC0C9', borderRadius: 6, backgroundColor: colors.white },
  cellLabel: { position: 'absolute', top: 8, left: 14, fontFamily: fonts.extraBold, fontSize: 10.4, letterSpacing: 0.42, textTransform: 'uppercase', color: colors.muted },
  cellLabelDark: { fontFamily: fonts.extraBold, fontSize: 10.4, letterSpacing: 0.42, textTransform: 'uppercase', color: colors.muted, marginBottom: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepBtn: { width: 38, height: 38, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  stepBtnOff: { opacity: 0.35 },
  stepText: { fontFamily: fonts.medium, fontSize: 22, lineHeight: 26, color: '#FFFFFF' },
  stepValue: { fontFamily: fonts.semiBold, fontSize: 16, color: colors.ink },
  daysEnd: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 6, textAlign: 'center' },
  errorText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, color: colors.danger },
  flight: { },
  flightInput: { minHeight: 48, borderWidth: 1, borderColor: '#DAC0C9', borderRadius: 6, paddingHorizontal: 12, fontFamily: fonts.semiBold, fontSize: 15, color: colors.ink, backgroundColor: colors.white },
});
