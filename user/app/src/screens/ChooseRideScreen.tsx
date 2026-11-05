// Choose your cab — step 2 of 3, in the customer reference layout. Fares are the booking
// server's quotes (the only amount that can be booked); the local calculation is a labelled
// estimate while they load.
import React, { useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import { useNavigation } from '@react-navigation/native';
import { Badge, Button, FlowFooter, Notice, Sheet, Steps, TextButton } from '../components/ui';
import { Content, ScrollView } from '../components/layout';
import { AppHeader, getVehicleImage } from '../components/brand';
import { Icon } from '../components/Icon';
import { FareLines } from '../components/FareLines';
import { useBookingDraft } from '../context/BookingDraft';
import { getRoute } from '../services/geoService';
import { calculateFare, isOutstation } from '../services/pricingService';
import { buildFareBreakup } from '../utils/fareBreakup';
import { categoryLabel } from '../utils/categoryLabel';
import { GST_RATE, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config/constants';
import type { FareBreakdown, RideCategory } from '../types';
import { formatDistance, formatINR, formatTime } from '../utils/format';
import { colors, fonts, space } from '../theme';

const dayText = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short' })}`;

export function ChooseRideScreen() {
  const navigation = useNavigation();
  const { draft, update, route, setRoute, routeKey, categories, adjustment, serverQuote } = useBookingDraft();
  const { pickup, drop, tripType, scheduledAt, tripEndAt, categoryId } = draft;
  const [fareFor, setFareFor] = useState<string | null>(null);
  const [routeError, setRouteError] = useState('');
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!pickup || !drop || route) return undefined;
    const controller = new AbortController();
    getRoute(pickup, drop, controller.signal)
      .then((r) => !controller.signal.aborted && setRoute(routeKey, r))
      .catch(() => !controller.signal.aborted && setRouteError('Could not calculate the driving distance. Check your connection and try again.'));
    return () => controller.abort();
  }, [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-select a cab when none is chosen yet.
  useEffect(() => {
    if (!categoryId && categories.length > 0) update({ categoryId: categories[0]!.id });
  }, [categoryId, categories, update]);

  const goHome = () => navigation.navigate('Tabs', { screen: 'Book' });

  if (!pickup || !drop) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
<KeyboardAvoid>
        <AppHeader title="Choose a cab" onBack={() => navigation.goBack()} />
        <View style={styles.pad}>
          <Notice message="Please set your pickup and drop locations first." />
          <Button title="Plan a trip" onPress={goHome} />
        </View>
      </KeyboardAvoid>
</SafeAreaView>
    );
  }

  const pickupTime = scheduledAt ?? new Date(now);
  const server = serverQuote.status === 'ready' ? serverQuote.data : null;
  const fuelCng = draft.fuelType === 'cng';
  const quotes = new Map<string, FareBreakdown>();
  if (server) {
    for (const x of server.quotes) if (x.ok && x.fare) quotes.set(x.categoryId, x.categoryId === categoryId && fuelCng && x.cng ? x.cng.fare : x.fare);
  } else if (route) {
    for (const c of categories) quotes.set(c.id, calculateFare({ category: c, route, tripType, pickupTime, adjustment }));
  }

  const selected: RideCategory | null = categories.find((c) => c.id === categoryId) ?? categories[0] ?? null;
  const selectedQuote = selected ? quotes.get(selected.id) ?? null : null;
  const outstation = route ? isOutstation(route.distanceKm) : true;
  const tooFar = route ? route.distanceKm > 1500 : false;
  const entryOf = (id?: string) => server?.quotes.find((x) => x.categoryId === id);
  const selectedEntry = entryOf(selected?.id);
  const canContinue = !!route && !!selectedQuote && !tooFar && !!server && !!entryOf(selected?.id)?.ok;
  const quoteLoading = !!route && !server && serverQuote.status === 'loading';
  const quoteProblem = !route
    ? ''
    : tooFar
      ? `This trip is too long to book online. Please call us on ${SUPPORT_PHONE_DISPLAY} to arrange it.`
      : !scheduledAt
        ? 'Choose a pickup date and time to see confirmed fares.'
        : serverQuote.status === 'error'
          ? serverQuote.error || 'We could not confirm the fare right now.'
          : selectedEntry && !selectedEntry.ok
            ? selectedEntry.error || 'This cab cannot be booked for this trip. Please choose another cab.'
            : '';

  const fareSheet = categories.find((c) => c.id === fareFor) ?? null;
  const fareSheetQuote = fareSheet ? quotes.get(fareSheet.id) ?? null : null;
  const included = route ? Math.round(route.distanceKm * (tripType === 'Round Trip' ? 2 : 1)) : 0;
  const serviceBadge = tripType === 'Airport Taxi' ? 'Airport' : tripType;
  // The GST rate the server applied to this fare (admin GST settings), else the default rate until it answers.
  const gstText = (f?: { gstRate?: number } | null) => `${Math.round((typeof f?.gstRate === 'number' ? f.gstRate : GST_RATE) * 10000) / 100}% GST`;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
<KeyboardAvoid>
      <AppHeader title="Choose a cab" onBack={() => navigation.goBack()} />
      <ScrollView kind="narrow" contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Steps step={2} />

        <View style={styles.summary}>
          <View style={styles.summaryTop}>
            <Badge label={serviceBadge} tone="success" />
            <TextButton title="Edit" icon="pencil" onPress={() => navigation.goBack()} accessibilityLabel="Edit trip details" />
          </View>
          <Text style={styles.route} accessibilityRole="header">
            {pickup.name}
            <Text style={styles.routeArrow}>{'  →  '}</Text>
            {tripType === 'Local Rental' ? 'Local Rental' : drop.name}
          </Text>
          <Text style={styles.meta}>
            {route ? `${formatDistance(route.distanceKm)} · ` : ''}
            {scheduledAt ? `${dayText(scheduledAt)} · ${formatTime(scheduledAt).replace(/^0/, '')}` : 'Time not set'}
            {tripType === 'Round Trip' && tripEndAt ? ` – Return ${dayText(tripEndAt)} · ${formatTime(tripEndAt).replace(/^0/, '')}` : ''}
          </Text>
        </View>

        <Notice message={routeError} />

        {/* Cab cards */}
        <Content style={{ gap: 12 }}>
          {categories.map((c) => {
            const on = selected?.id === c.id;
            const quote = quotes.get(c.id);
            const entry = entryOf(c.id);
            // CNG is chosen on the card itself, and only cab types the admin enabled it for show the choice.
            const cardCng = on && fuelCng && !!entry?.ok && !!entry.cng;
            const photo = getVehicleImage(c.name);
            const bagText = `${c.luggageCapacity ?? (c.seats >= 6 ? 4 : 2)} bags`;
            const seatText = `${c.seats} seats`;
            const extraRate = entry?.ok && cardCng && entry.cng ? entry.cng.extraKmRate : entry?.ok && entry.extraKmRate ? entry.extraKmRate : c.fare.extras?.extraKmRate ?? (outstation && c.fare.outstationPerKmRate ? c.fare.outstationPerKmRate : c.fare.perKmRate);
            const includedKm = entry?.includedKm ?? (c.fare.baseKm > 0 ? c.fare.baseKm : (route ? included : 0));
            const inclLine = `${entry?.ok && entry.rentalHours ? `${entry.rentalHours} hours · ` : ''}${includedKm > 0 ? `${includedKm} km included · Extra km ₹${extraRate}` : `Extra km ₹${extraRate}`}`;
            const strikeTotal = (cardCng && entry?.ok && entry.cng ? entry.cng.strikeTotal : entry?.ok ? entry.strikeTotal : 0) ?? 0;
            const strike = quote && strikeTotal > 0 ? strikeTotal : 0;
            const unavailReason = !serverQuote.data ? '' : entry && !entry.ok ? entry.error || 'Not available for this trip' : '';

            return (
              <View key={c.id} style={[styles.car, on && styles.carOn]}>
                <Pressable
                  onPress={() => update({ categoryId: c.id, fuelType: fuelCng && entry?.ok && entry.cng ? 'cng' : '' })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, disabled: !!unavailReason }}
                  accessibilityLabel={`${c.name}, ${seatText}, ${quote ? formatINR(quote.total) : 'price loading'}`}
                  style={styles.carPick}
                >
                  <View style={[styles.choice, on && styles.choiceOn]}>
                    <Icon name="check" size={10} color={on ? colors.white : 'transparent'} strokeWidth={3} />
                  </View>
                  <View style={styles.carTop}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.carName}>{categoryLabel(c)}</Text>
                      <View style={styles.facts}>
                        <Fact tint="slate" icon="seat-belt" text={seatText} />
                        <Fact tint="amber" icon="luggage" text={bagText} />
                        <Fact tint="blue" icon="snowflake" text="AC" />
                      </View>
                    </View>
                    <Image source={photo} style={styles.carPhoto} resizeMode="contain" accessible={false} />
                  </View>
                  <Text style={styles.included}>{inclLine}</Text>
                  <View style={styles.rate}>
                    <Text style={styles.rateLabel}>{gstText(quote)} included</Text>
                    <View style={{ alignItems: 'flex-end' }}>
                      {strike > 0 ? <Text style={styles.strike}>{formatINR(strike)}</Text> : null}
                      <Text style={styles.price}>{quote ? formatINR(quote.total) : '—'}</Text>
                    </View>
                  </View>
                </Pressable>
                {entry?.ok && entry.cng ? (
                  <View style={[styles.fuelRow, { paddingHorizontal: 14, paddingBottom: 10 }]} accessibilityRole="radiogroup">
                    {([['', 'Diesel / Petrol'], ['cng', 'CNG']] as const).map(([value, label]) => {
                      const active = on && (value === 'cng') === fuelCng;
                      return (
                        <Pressable
                          key={label}
                          onPress={() => update({ categoryId: c.id, fuelType: value })}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={`${label} for ${c.name}`}
                          style={[styles.fuelBtn, active && (value === 'cng' ? styles.fuelBtnCng : styles.fuelBtnDiesel)]}
                        >
                          <Text style={[styles.fuelText, active && { color: value === 'cng' ? '#11773a' : '#a85a00' }]}>{label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {unavailReason ? <Text style={styles.unavail}>{unavailReason}</Text> : null}
                <View style={styles.carFoot}>
                  <Text style={styles.extra}>Toll, parking and state tax extra</Text>
                  <TextButton title="Fare breakup" icon="receipt-text" size={11} onPress={() => setFareFor(c.id)} accessibilityLabel={`View fare breakup for ${c.name}`} />
                </View>
              </View>
            );
          })}
        </Content>

        <Notice message={quoteProblem} style={{ marginTop: space.md }} />
        {tooFar ? <Button title={`Call NESAM · ${SUPPORT_PHONE_DISPLAY}`} icon="phone" variant="secondary" onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} style={{ marginBottom: 12 }} /> : null}
        {/* The cab list is the last content in this ScrollView, so the gap above Back / Home is set here. */}
        <View style={{ marginTop: space.md }}>
          <FlowFooter onBack={() => navigation.goBack()} onHome={goHome} />
        </View>
      </ScrollView>

      {/* Floating total + CTA */}
      <View style={styles.bottom}>
          <View style={styles.bottomRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.totalLabel}>Total fare ({gstText(selectedQuote)} included)</Text>
              <Text style={styles.totalValue}>{selectedQuote ? formatINR(selectedQuote.total) : '—'}</Text>
            </View>
            <Button
              title="Continue"
              iconRight="arrow-right"
              loading={quoteLoading}
              disabled={!canContinue}
              onPress={() => navigation.navigate('ConfirmBooking')}
              accessibilityLabel={selectedQuote ? `Continue with ${selected?.name}, total ${formatINR(selectedQuote.total)}` : 'Continue'}
              style={{ minWidth: 140 }}
            />
          </View>
        </View>


      {/* Fare breakup bottom sheet */}
      <Sheet visible={!!fareSheet} onClose={() => setFareFor(null)} title={fareSheet ? `${fareSheet.name} fare` : 'Fare'} subtitle="Prices include GST.">
        {fareSheet && fareSheetQuote ? (
          <>
            <FareLines lines={buildFareBreakup(fareSheet, fareSheetQuote, outstation).lines} total={fareSheetQuote.total} estimated={!server} />
            <Text style={styles.note}>Toll, parking and state tax are paid separately against receipts. The cab assigned may differ in model from the photo.</Text>
          </>
        ) : null}
      </Sheet>
    </KeyboardAvoid>
</SafeAreaView>
  );
}

const FACT = {
  slate: { bg: '#F0F3F7', fg: '#465265', ic: '#465265' },
  amber: { bg: '#FFF6E7', fg: '#A8650E', ic: '#DC8A18' },
  blue: { bg: '#EAF5FF', fg: '#0969B9', ic: '#0686DF' },
} as const;

function Fact({ tint, icon, text }: { tint: keyof typeof FACT; icon: 'seat-belt' | 'luggage' | 'snowflake'; text: string }) {
  const t = FACT[tint];
  return (
    <View style={[styles.fact, { backgroundColor: t.bg }]}>
      <Icon name={icon} size={14} color={t.ic} />
      <Text style={[styles.factText, { color: t.fg }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  pad: { padding: space.xl },
  scroll: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: 24 },
  summary: { paddingBottom: 18, marginBottom: 14, borderBottomWidth: 1, borderBottomColor: colors.divider, marginTop: space.sm },
  summaryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  route: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 24, color: colors.text },
  routeArrow: { fontFamily: fonts.regular, color: '#8A929E' },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 19, color: '#6D7785', marginTop: 7 },
  car: { backgroundColor: colors.white, borderWidth: 1, borderColor: '#E3E7EC', borderRadius: 13, overflow: 'hidden' },
  carOn: { borderColor: colors.primary },
  carPick: { paddingHorizontal: 14, paddingTop: 13, paddingBottom: 11 },
  choice: { position: 'absolute', top: 10, right: 10, width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: '#DCE1E8', backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  choiceOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  carTop: { flexDirection: 'row', alignItems: 'center', minHeight: 80 },
  carName: { fontFamily: fonts.semiBold, fontSize: 18, lineHeight: 23, letterSpacing: -0.4, color: colors.ink },
  carModel: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16.5, color: '#626E80', marginTop: 4 },
  carPhoto: { width: 130, height: 80 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 4 },
  factText: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
  included: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 17.6, color: '#626E80', marginTop: 8 },
  rate: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 9, paddingTop: 9, borderTopWidth: 1, borderTopColor: '#EEF0F4' },
  rateLabel: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 15, color: '#6D7785' },
  price: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 29, letterSpacing: -0.6, color: colors.ink },
  carFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, minHeight: 45, borderTopWidth: 1, borderTopColor: '#EEF0F4' },
  extra: { fontFamily: fonts.regular, fontSize: 10, color: '#626E80', flexShrink: 1 },
  strike: { fontFamily: fonts.medium, fontSize: 13, color: '#697587', opacity: 0.55, textDecorationLine: 'line-through' },
  fuelRow: { flexDirection: 'row', gap: 8 },
  fuelBtn: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1.5, borderColor: '#d9dfe9', backgroundColor: colors.white },
  fuelBtnDiesel: { borderColor: '#e07b00', backgroundColor: '#fff4e0' },
  fuelBtnCng: { borderColor: '#16a34a', backgroundColor: '#e8f8ee' },
  fuelText: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  unavail: { fontFamily: fonts.medium, fontSize: 11, color: colors.primaryDark, paddingHorizontal: 14, paddingBottom: 10 },
  bottom: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: '#E5E8ED', paddingHorizontal: space.xl, paddingTop: 10, paddingBottom: 10, gap: 8 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  totalLabel: { fontFamily: fonts.regular, fontSize: 11, color: '#6D7785' },
  totalValue: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, letterSpacing: -0.5, color: colors.ink },
  note: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, color: '#6D7785', marginTop: space.md },
});
