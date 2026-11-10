// Multicity: one tour through several cities (pickup, up to ten stops, final drop). The tour becomes a Round Trip
// through those cities that the server prices from the Multicity rates (the website's Multicity form, as a phone form).
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Button, Notice } from './ui';
import { Icon } from './Icon';
import { PressableScale } from './brand';
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

  const useCurrent = async () => {
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
    if (!when) err.date = 'Select the pickup date and time.';
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
        onUseCurrentLocation={target === 'pickup' ? () => void useCurrent() : undefined}
      />
      {timeOpen ? (
        <TimePickerSheet
          visible
          title="Pickup time"
          day={when ? dayStart(when) : dayStart(new Date())}
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

      <View style={styles.routeBox}>
        <Field pin="start" label="Pickup location" value={pickup?.name} sub={pickup?.address} error={errors.pickup} onPress={() => setTarget('pickup')} />
        {filled.map((s, i) => (
          <Field key={s.id} pin="stop" label={`Stop ${i + 1}`} value={s.place?.name} sub={s.place?.address} divider onPress={() => setTarget(s.id)} onRemove={() => setStops((all) => all.filter((x) => x.id !== s.id))} removeLabel={`Remove stop ${i + 1}`} />
        ))}
        {filled.length < MAX_CITIES ? (
          <Pressable onPress={() => setTarget('new')} accessibilityRole="button" accessibilityLabel="Add stop" style={[styles.addStop, !!errors.stops && styles.addStopError]}>
            <Icon name="plus" size={16} color={colors.primary} strokeWidth={2.4} />
            <Text style={styles.addStopText}>Add stop</Text>
          </Pressable>
        ) : null}
        {errors.stops ? <Text style={styles.error}>{errors.stops}</Text> : null}
        <Field pin="end" label="Drop location" value={drop?.name} sub={drop?.address} error={errors.drop} divider onPress={() => setTarget('drop')} />
        {errors.itinerary ? <Text style={styles.error}>{errors.itinerary}</Text> : null}
      </View>

      <View style={styles.pair}>
        <PickerBox label="Pickup date" value={when ? formatDay(when) : ''} placeholder="Select date" icon="calendar-days" error={errors.date} onPress={openDate} />
        <PickerBox
          label="Pickup time"
          value={when && (when.getHours() || when.getMinutes()) ? formatTime(when).replace(/^0/, '') : ''}
          placeholder="Select time"
          icon="clock-3"
          error={errors.time}
          onPress={() => (when ? setTimeOpen(true) : openDate())}
        />
      </View>

      {errors.form ? <Notice tone="error" message={errors.form} style={{ marginTop: space.md }} /> : null}
      <Button title="Let’s Go !" iconRight="arrow-right" onPress={submit} style={{ marginTop: 14 }} />
    </View>
  );
}

function Field({
  pin,
  label,
  value,
  sub,
  error,
  divider,
  onPress,
  onRemove,
  removeLabel,
}: {
  pin: 'start' | 'stop' | 'end';
  label: string;
  value?: string;
  sub?: string;
  error?: string;
  divider?: boolean;
  onPress: () => void;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <View style={[styles.field, divider && styles.divider]}>
      <PressableScale onPress={onPress} activeScale={0.98} style={styles.fieldMain} accessibilityRole="button" accessibilityLabel={`${label}: ${value ?? 'not set'}`} accessibilityHint={error || 'Opens location search'}>
        <View style={[styles.pin, pin === 'end' ? styles.pinEnd : pin === 'stop' ? styles.pinStop : styles.pinStart, !!error && { borderColor: colors.primary }]} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.label}>{label}</Text>
          <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1}>
            {value || (pin === 'start' ? 'Enter pickup location' : pin === 'end' ? 'Enter drop location' : 'Choose a city')}
          </Text>
          {sub && sub !== value ? <Text style={styles.sub} numberOfLines={1}>{sub}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
        {onRemove ? null : <Icon name="chevron-right" size={17} color="#90939A" strokeWidth={2.2} />}
      </PressableScale>
      {onRemove ? (
        <Pressable onPress={onRemove} accessibilityRole="button" accessibilityLabel={removeLabel} hitSlop={8} style={styles.remove}>
          <Icon name="trash-2" size={17} color={colors.primary} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

function PickerBox({ label, value, placeholder, icon, error, onPress }: { label: string; value: string; placeholder: string; icon: 'calendar-days' | 'clock-3'; error?: string; onPress: () => void }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={styles.pickerLabel}>{label}</Text>
      <PressableScale onPress={onPress} activeScale={0.96} style={[styles.pickerBox, !!error && styles.pickerError]} accessibilityRole="button" accessibilityLabel={`${label}: ${value || 'not set'}`} accessibilityHint={error || undefined}>
        <Text style={[styles.pickerValue, !value && styles.placeholder]} numberOfLines={1}>{value || placeholder}</Text>
        <Icon name={icon} size={15} color="#858B95" strokeWidth={2} />
      </PressableScale>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  routeBox: { marginTop: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, backgroundColor: colors.white },
  field: { flexDirection: 'row', alignItems: 'center' },
  fieldMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 10, minHeight: 62 },
  divider: { borderTopWidth: 1, borderTopColor: colors.divider },
  pin: { width: 9, height: 9, borderWidth: 1.5 },
  pinStart: { borderRadius: 5, borderColor: '#7D838D' },
  pinStop: { borderRadius: 5, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  pinEnd: { borderRadius: 3, borderColor: colors.primary },
  label: { fontFamily: fonts.regular, fontSize: 11, color: colors.label },
  value: { fontFamily: fonts.medium, fontSize: 15.5, color: colors.value, marginTop: 2 },
  placeholder: { color: '#99A1AD', fontFamily: fonts.regular },
  sub: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.muted, marginTop: 1 },
  error: { fontFamily: fonts.medium, fontSize: 11.5, color: colors.primaryDark, marginTop: 3 },
  remove: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  addStop: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginVertical: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.primaryBorder, backgroundColor: colors.primarySoft },
  addStopError: { borderColor: colors.primary },
  addStopText: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.primary },
  pair: { flexDirection: 'row', gap: 11, marginTop: 14 },
  pickerLabel: { fontFamily: fonts.regular, fontSize: 11, color: '#697587', marginBottom: 5 },
  pickerBox: { minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.white },
  pickerError: { borderColor: colors.primary, backgroundColor: '#FFFBFB' },
  pickerValue: { flex: 1, fontFamily: fonts.medium, fontSize: 13.5, color: colors.text },
});
