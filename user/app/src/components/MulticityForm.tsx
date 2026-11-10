// Multicity: one tour through several cities (pickup, up to ten stops, final drop). The tour becomes a Round Trip
// through those cities that the server prices from the Multicity rates (the website's Multicity form, as a phone form).
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Notice } from './ui';
import { Icon } from './Icon';
import { PressableScale } from './brand';
import { DropPinIcon, GoButton, LocationField, ScheduleCell } from './BookForm';
import { PlaceSearchModal } from './PlaceSearchModal';
import { TimePickerSheet } from './TimePickerSheet';
import { useBookingDraft } from '../context/BookingDraft';
import { useCustomerData } from '../context/CustomerData';
import { useDeviceLocation } from '../hooks/useDeviceLocation';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { reverseGeocode } from '../services/geoService';
import { newId } from '../services/callables';
import { SCHEDULE_MAX_DAYS } from '../config/constants';
import { scheduleProblem } from '../utils/bookingRules';
import { validMulticityPlace } from '../utils/multicityDraft';
import { formatTime } from '../utils/format';
import { QUICK_CITIES } from '../data/localRentals';
import type { GeoPlace } from '../types';
import { colors, fonts, space } from '../theme';

const MAX_CITIES = 10;
interface Stop { id: string; place: GeoPlace | null }
type Target = 'pickup' | 'drop' | 'new' | string;

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const formatDay = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');

export function MulticityForm() {
  const navigation = useNavigation();
  const { update } = useBookingDraft();
  const { savedPlaces, trips } = useCustomerData();
  const { position } = useDeviceLocation(true);
  const { online } = useNetworkStatus();

  const [pickup, setPickup] = useState<GeoPlace | null>(null);
  const [drop, setDrop] = useState<GeoPlace | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [when, setWhen] = useState<Date | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const recentPlaces = useMemo<GeoPlace[]>(() => {
    const out: GeoPlace[] = [];
    const seen = new Set<string>();
    for (const t of trips) {
      for (const p of [t.drop, t.pickup]) {
        if (!p || !p.lat || !p.lng) continue;
        const key = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(p);
        if (out.length >= 6) return out;
      }
    }
    return out;
  }, [trips]);

  const clear = (...keys: string[]) =>
    setErrors((e) => {
      const next = { ...e };
      for (const k of keys) delete next[k];
      return next;
    });

  const onPick = (p: GeoPlace) => {
    if (target === 'pickup') {
      setPickup(p);
      clear('pickup', 'itinerary');
    } else if (target === 'drop') {
      setDrop(p);
      clear('drop', 'itinerary');
    } else if (target === 'new') {
      setStops((s) => [...s, { id: newId('stop'), place: p }]);
      clear('stops', 'itinerary');
    } else if (target) {
      setStops((s) => s.map((st) => (st.id === target ? { ...st, place: p } : st)));
      clear('stops', 'itinerary');
    }
    setTarget(null);
  };

  const fillCurrent = async () => {
    setTarget(null);
    if (!position) return;
    const p = await reverseGeocode(position).catch(() => null);
    if (p) {
      setPickup({ ...p, type: 'current' });
      clear('pickup', 'itinerary');
    }
  };

  const openDate = () => {
    const min = dayStart(new Date());
    const max = new Date(Date.now() + SCHEDULE_MAX_DAYS * 86400000);
    try {
      DateTimePickerAndroid.open({
        value: when ? dayStart(when) : min,
        mode: 'date',
        minimumDate: min,
        maximumDate: max,
        onChange: (event, picked) => {
          if (event.type !== 'set' || !picked) return;
          const next = new Date(picked);
          if (when) next.setHours(when.getHours(), when.getMinutes(), 0, 0);
          else next.setHours(0, 0, 0, 0);
          setWhen(next);
          clear('date', 'time');
          if (!when) setTimeOpen(true); // straight on to the time
        },
      });
    } catch {
      setErrors((e) => ({ ...e, form: 'Date selection is not available on this device. Please call NESAM to book.' }));
    }
  };

  const filled = stops.filter((s) => s.place);
  const validate = (): boolean => {
    const err: Record<string, string> = {};
    if (!validMulticityPlace(pickup)) err.pickup = 'Please select a starting pickup location.';
    if (!validMulticityPlace(drop)) err.drop = 'Please select a final destination drop point.';
    if (filled.length === 0) err.stops = 'Add at least one city between pickup and drop.';
    const all = [pickup, ...filled.map((s) => s.place), drop].filter(Boolean) as GeoPlace[];
    for (let i = 0; i < all.length - 1; i++) {
      if (all[i]!.name.trim().toLowerCase() === all[i + 1]!.name.trim().toLowerCase()) {
        err.itinerary = `Consecutive stop duplicate: "${all[i]!.name}" cannot immediately follow itself.`;
        break;
      }
    }
    if (filled.some((s) => !validMulticityPlace(s.place))) err.stops = 'Choose a valid location for every city.';
    if (!when) err.time = 'Choose a pickup time.';
    else if (when.getHours() === 0 && when.getMinutes() === 0 && scheduleProblem(when)) err.time = 'Select the pickup time.';
    else {
      const problem = scheduleProblem(when);
      if (problem) err.time = problem;
    }
    if (!online) err.form = 'You are currently offline. Please check your internet connection.';
    setErrors(err);
    return Object.keys(err).length === 0;
  };

  const submit = () => {
    if (!validate() || !when || !pickup || !drop) return;
    // The tour becomes the booking draft: a Round Trip through these cities, priced from the Multicity rates.
    update({
      pickup,
      drop,
      stops: filled.map((s) => s.place!),
      tripType: 'Round Trip',
      multicity: true,
      scheduledAt: when,
      // No return date is asked: the tour is quoted from the pickup instant.
      tripEndAt: when,
      promoCode: '',
      rentalHours: null,
    });
    navigation.navigate('ChooseRide');
  };

  const title = target === 'pickup' ? 'Pickup location' : target === 'drop' ? 'Drop location' : target === 'new' ? `Stop ${filled.length + 1}` : 'Change stop';
  const day = when ? dayStart(when) : dayStart(new Date());

  return (
    <View>
      <PlaceSearchModal
        visible={target !== null}
        title={title}
        subtitle="Search a city, area or landmark."
        onClose={() => setTarget(null)}
        onSelect={onPick}
        savedPlaces={savedPlaces}
        recentPlaces={recentPlaces}
        suggestions={QUICK_CITIES}
        suggestionsLabel="Popular cities"
        near={position}
        onUseCurrentLocation={target === 'pickup' ? () => void fillCurrent() : undefined}
      />
      {timeOpen ? (
        <TimePickerSheet
          visible
          title="Pickup time"
          day={day}
          value={when && (when.getHours() || when.getMinutes()) ? when : null}
          problemOf={(at) => scheduleProblem(at)}
          onClose={() => setTimeOpen(false)}
          onConfirm={(at) => {
            setWhen(at);
            clear('time', 'date');
            setTimeOpen(false);
          }}
        />
      ) : null}

      <View style={styles.box}>
        <View style={{ gap: 10 }}>
          <LocationField
            label="Pickup location"
            value={pickup?.name}
            address={pickup?.address}
            error={errors.pickup}
            onPress={() => setTarget('pickup')}
            leading={
              <View style={styles.startHalo}>
                <View style={styles.startDot} />
              </View>
            }
          />
          {filled.map((s, i) => (
            <LocationField
              key={s.id}
              label={`Stop ${i + 1}`}
              value={s.place?.name}
              address={s.place?.address}
              onPress={() => setTarget(s.id)}
              trailing={
                <Pressable onPress={() => setStops((all) => all.filter((x) => x.id !== s.id))} accessibilityRole="button" accessibilityLabel={`Remove stop ${i + 1}`} hitSlop={10}>
                  <Icon name="trash-2" size={17} color={colors.primary} strokeWidth={2} />
                </Pressable>
              }
            />
          ))}
          {filled.length < MAX_CITIES ? (
            <PressableScale onPress={() => setTarget('new')} activeScale={0.96} accessibilityRole="button" accessibilityLabel="Add stop" style={[styles.addStop, !!errors.stops && styles.addStopError]} containerStyle={{ alignSelf: 'center' }}>
              <Icon name="plus" size={16} color={colors.primary} strokeWidth={2.2} />
              <Text style={styles.addStopText}>Add stop</Text>
            </PressableScale>
          ) : null}
          {errors.stops ? <Text style={styles.error}>{errors.stops}</Text> : null}
          <LocationField label="Drop location" value={drop?.name} address={drop?.address} error={errors.drop} onPress={() => setTarget('drop')} leading={<DropPinIcon />} />
          {errors.itinerary ? <Text style={styles.error}>{errors.itinerary}</Text> : null}
        </View>

        <View style={styles.pair}>
          <ScheduleCell label="Pickup date" value={formatDay(day)} icon="calendar-days" chip={dayHint(day)} error={errors.date} onPress={openDate} />
          <ScheduleCell
            label="Pickup time"
            value={when && (when.getHours() || when.getMinutes()) ? formatTime(when).replace(/^0/, '') : ''}
            icon="clock"
            error={errors.time}
            onPress={() => setTimeOpen(true)}
          />
        </View>

        {errors.form ? <Notice tone="error" message={errors.form} style={{ marginTop: space.md }} /> : null}
        <GoButton title="Let’s Go !" onPress={submit} style={{ marginTop: 14 }} />
      </View>
    </View>
  );
}

const dayHint = (d: Date): string => {
  const diff = Math.round((dayStart(d).getTime() - dayStart(new Date()).getTime()) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'long' });
};

const styles = StyleSheet.create({
  box: { marginTop: 16, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 6, backgroundColor: colors.white },
  startHalo: { width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(34,168,90,0.3)', alignItems: 'center', justifyContent: 'center' },
  startDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#22A85A' },
  addStop: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 20, borderRadius: 6, borderWidth: 1, borderColor: '#DAC0C9', backgroundColor: colors.white },
  addStopError: { borderColor: colors.danger },
  addStopText: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  error: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, color: colors.danger },
  pair: { flexDirection: 'row', gap: 10, marginTop: 16 },
});
