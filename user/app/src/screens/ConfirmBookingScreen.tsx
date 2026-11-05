// Review & book — step 3 of 3, in the customer reference layout. Real rules stay in charge:
// the booking server's fare, cash/UPI payment, WhatsApp contact validation, coupon checks,
// the terms gate and duplicate-submit protection.
import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import { useNavigation } from '@react-navigation/native';
import { Button, Disclosure, FlowFooter, Notice, RadioCard, Sheet, Steps, TextButton, TextField } from '../components/ui';
import { Content, ScrollView } from '../components/layout';
import { AppHeader } from '../components/brand';
import { Checkbox } from '../components/Checkbox';
import { FareLines } from '../components/FareLines';
import { useCustomerData } from '../context/CustomerData';
import { useBookingDraft } from '../context/BookingDraft';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { calculateFare, isOutstation, serviceName, validateCoupon } from '../services/pricingService';
import { createRideRequest } from '../services/rideService';
import { buildFareBreakup } from '../utils/fareBreakup';
import { categoryLabel } from '../utils/categoryLabel';
import type { AppliedCoupon, FareBreakdown, PaymentMethod } from '../types';
import { formatINR, formatPhone, formatTime, isValidIndianMobile } from '../utils/format';
import { describeError } from '../utils/retry';
import { colors, fonts, space } from '../theme';
import { NOTES_MAX, composeBookingNotes, scheduleProblem, whatsappProblem } from '../utils/bookingRules';
import {
  CUSTOMER_PAYMENTS_ENABLED,
  SCHEDULED_CANCELLATION_FEE,
  SCHEDULED_FREE_CANCEL_BEFORE_MS,
} from '../config/constants';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FREE_CANCEL_MIN = Math.round(SCHEDULED_FREE_CANCEL_BEFORE_MS / 60000);

/** Only methods the booking server accepts today (createBooking: Cash or UPI). */
const PAYMENT_OPTIONS: { id: PaymentMethod; title: string; subtitle: string }[] = [
  { id: 'Cash', title: 'Book now, pay later', subtitle: 'Pay the fare in cash to your driver' },
  { id: 'UPI', title: 'Book now, pay by UPI', subtitle: 'Pay by UPI after your trip' },
];

const dayText = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short' })}`;

export function ConfirmBookingScreen() {
  const navigation = useNavigation();
  const { profile, trips } = useCustomerData();
  const { draft, update, reset, route, categories, adjustment, coupons, serverQuote: serverQuoteState } = useBookingDraft();
  const { pickup, drop, tripType, scheduledAt, tripEndAt, categoryId, flightNumber, promoCode } = draft;
  const { online } = useNetworkStatus();

  const [payment, setPayment] = useState<PaymentMethod>('Cash');
  const [promoInput, setPromoInput] = useState(promoCode);
  const [notes, setNotes] = useState('');
  const [someoneElse, setSomeoneElse] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestMobile, setGuestMobile] = useState('');
  const [waSame, setWaSame] = useState(true);
  const [waCode, setWaCode] = useState('+91');
  const [waNumber, setWaNumber] = useState('');
  const [email, setEmail] = useState('');
  const [fareOpen, setFareOpen] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [serverQuote, setServerQuote] = useState<{ key: string; fare: FareBreakdown } | null>(null);
  const submittingRef = useRef(false);

  const goHome = () => navigation.navigate('Tabs', { screen: 'Book' });
  const category = categories.find((c) => c.id === categoryId) ?? categories[0] ?? null;
  if (!pickup || !drop || !route || !category) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
<KeyboardAvoid>
        <AppHeader title="Review & Book" onBack={() => navigation.goBack()} />
        <View style={styles.pad}>
          {/* Review & Book header title moved to AppHeader */}
          <Notice message="Your trip details changed. Please go back and choose your cab again." />
          <Button title="Back to Choose your cab" variant="secondary" onPress={() => navigation.goBack()} />
        </View>
      </KeyboardAvoid>
</SafeAreaView>
    );
  }

  const pickupTime = scheduledAt ?? new Date();
  const service = serviceName(pickup, drop, route.distanceKm, tripType);
  const history = trips.filter((t) => t.status !== 'Cancelled' && t.status !== 'Rejected');

  const checkCoupon = (code: string) => {
    const base = calculateFare({ category, route, tripType, pickupTime, adjustment });
    return validateCoupon(coupons, code, {
      subtotal: base.subtotal,
      categoryId: category.id,
      service,
      isFirstBooking: history.length === 0,
      customerUses: history.filter((t) => t.couponCode.toUpperCase() === code.trim().toUpperCase()).length,
    });
  };

  // The booking server's own fare for this exact trip, with the promo code checked by the server too.
  const authoritativeEntry = serverQuoteState.status === 'ready' ? serverQuoteState.data?.quotes.find((x) => x.categoryId === category.id && x.ok && x.fare) : undefined;
  const authoritative = !!authoritativeEntry;
  // Until the server answers, the code is checked locally for the estimate only (an estimate is never submittable).
  const localCheck = promoCode && !authoritative ? checkCoupon(promoCode) : null;
  const coupon: AppliedCoupon | null = authoritativeEntry
    ? authoritativeEntry.couponApplied && promoCode ? { code: promoCode, discount: authoritativeEntry.fare!.discount, message: authoritativeEntry.couponMessage ?? '' } : null
    : localCheck?.ok ? localCheck.coupon : null;
  const promoMsg = !promoCode
    ? null
    : authoritativeEntry
      ? authoritativeEntry.couponApplied
        ? { ok: true, text: authoritativeEntry.couponMessage || `${promoCode} applied.` }
        : { ok: false, text: `Promo not applied: ${authoritativeEntry.couponMessage || 'This code does not apply to this trip.'}` }
      : serverQuoteState.status === 'loading'
        ? { ok: true, text: `Checking ${promoCode}…` }
        : localCheck && !localCheck.ok
          ? { ok: false, text: `Promo not applied: ${localCheck.message}` }
          : null;

  const priceKey = JSON.stringify([draft, adjustment?.id, adjustment?.percent]);
  const localQuote = calculateFare({ category, route, tripType, pickupTime, adjustment, discount: coupon?.discount ?? 0 });
  // On the CNG rate card when the rider chose CNG and this vehicle offers it.
  const cngEntry = draft.fuelType === 'cng' ? authoritativeEntry?.cng ?? null : null;
  const quote = serverQuote?.key === priceKey ? serverQuote.fare : cngEntry?.fare ?? authoritativeEntry?.fare ?? localQuote;
  const outstation = isOutstation(route.distanceKm);
  // Display only: a higher struck-out price above the fare.
  const strikeTotal = (cngEntry ? cngEntry.strikeTotal : authoritativeEntry?.strikeTotal) ?? 0;

  const emailError = email.trim() && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address or leave blank.' : '';
  const waError = whatsappProblem(waSame, waCode, waNumber);
  const guestError = someoneElse && (guestName.trim().length < 2 ? 'Enter the passenger’s name.' : !isValidIndianMobile(guestMobile.replace(/\D/g, '').slice(-10)) ? 'Enter the passenger’s 10-digit mobile number.' : '');
  const blocker = !online
    ? 'You are offline. Please reconnect to confirm your booking.'
    : scheduleProblem(scheduledAt)
      || (!authoritative && serverQuote?.key !== priceKey ? (serverQuoteState.status === 'loading' ? 'Confirming your fare with NESAM…' : serverQuoteState.error || 'We need to confirm your fare before you can submit.') : '')
      || (waError || emailError || guestError ? 'Check your contact details.' : '')
      || (!termsAccepted ? 'Accept the fare, extra charges and cancellation policy to book.' : '');

  // The server quote is requested again with the code; its answer decides whether the discount applies.
  const applyPromo = () => update({ promoCode: promoInput.trim().toUpperCase().slice(0, 50) });
  const removePromo = () => {
    update({ promoCode: '' });
    setPromoInput('');
  };

  const submit = async () => {
    if (blocker || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await createRideRequest({
        profile,
        pickup,
        drop,
        category,
        route,
        fare: quote,
        tripType,
        paymentMethod: CUSTOMER_PAYMENTS_ENABLED ? payment : 'Cash',
        // Only a code the server applied to this fare is sent; a rejected code would make the booking fail.
        fuelType: draft.fuelType === 'cng' ? 'cng' : undefined,
        couponCode: authoritativeEntry?.couponApplied ? promoCode : '',
        notes: composeBookingNotes({
          flight: tripType === 'Airport Taxi' ? flightNumber : '',
          passengerName: someoneElse ? guestName : '',
          passengerMobile: someoneElse ? guestMobile : '',
          notes,
        }),
        scheduledAt,
        whatsapp: waSame
          ? { sameAsMobile: true }
          : { sameAsMobile: false, countryCode: waCode.trim(), number: waNumber.replace(/[\s()-]/g, '') },
        email: email.trim(),
        source: 'nesam',
        bookingSource: 'nesam',
        brand: 'nesam',
        tripEndAt: tripType === 'Round Trip' ? draft.tripEndAt : null,
        rentalHours: tripType === 'Local Rental' ? draft.rentalHours : null,
        termsAccepted,
      });
      reset();
      navigation.reset({
        index: 1,
        routes: [{ name: 'Tabs' }, { name: 'ActiveRide', params: { bookingId: res.id, unconfirmed: res.unconfirmed, justBooked: true } }],
      });
    } catch (e) {
      const currentFare = (e as { details?: { fare?: FareBreakdown } }).details?.fare;
      if (currentFare && Number.isFinite(currentFare.total)) {
        setServerQuote({ key: priceKey, fare: currentFare });
      }
      setSubmitError(
        currentFare
          ? `The current fare is ${formatINR(currentFare.total)}. Please review and tap Book & Confirm.`
          : describeError(e, 'Could not complete your booking. Please try again or call NESAM.'),
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const fareBreakup = buildFareBreakup(category, quote, outstation);
  const includedKm = authoritativeEntry?.includedKm ?? (category.fare.baseKm > 0 ? category.fare.baseKm : 0);
  const whenText = scheduledAt ? `${dayText(scheduledAt)} · ${formatTime(scheduledAt).replace(/^0/, '')}` : 'Pickup time not chosen';
  const endText = tripType === 'Round Trip' && tripEndAt ? ` – Return ${dayText(tripEndAt)} · ${formatTime(tripEndAt).replace(/^0/, '')}` : '';

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
<KeyboardAvoid>
      <AppHeader title="Review & Book" onBack={() => navigation.goBack()} />
      <ScrollView kind="narrow" contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Steps step={3} />

        {/* Trip and total */}
        <View style={styles.card}>
          <Text style={styles.route} accessibilityRole="header">
            {pickup.name}
            <Text style={styles.arrow}>{'  →  '}</Text>
            {tripType === 'Local Rental' ? 'Local Rental' : drop.name}
          </Text>
          <Text style={styles.when}>{`${whenText}${endText}`}</Text>
          <View style={styles.catRow}>
            <Text style={styles.cat}>{`${categoryLabel(category)} · ${category.seats} passengers`}</Text>
            {includedKm > 0 ? <Text style={styles.incl}>{`${includedKm} km included`}</Text> : null}
          </View>
          <View style={styles.totalRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.totalLabel}>Total fare</Text>
              <Text style={styles.gstNote}>GST included</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {strikeTotal > 0 ? <Text style={{ fontSize: 14, color: '#697587', opacity: 0.55, textDecorationLine: 'line-through' }}>{formatINR(strikeTotal)}</Text> : null}
              <Text style={styles.total}>{formatINR(quote.total)}</Text>
            </View>
          </View>
          <TextButton title="View fare details" onPress={() => setFareOpen(true)} size={12} style={{ alignSelf: 'flex-start', marginTop: 6 }} />
        </View>

        {/* Booking contact */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Booking contact</Text>
          <Line label="Passenger name" value={profile.name} />
          <Line label="Mobile number" value={formatPhone(profile.phone)} />
          <Line label="WhatsApp number" value={waSame ? formatPhone(profile.phone) : waNumber ? `${waCode} ${waNumber}` : 'Not provided'} />

          <View style={styles.checks}>
            <Checkbox checked={someoneElse} onChange={setSomeoneElse} label="Book for someone else" />
          </View>
          {someoneElse ? (
            <View style={{ marginTop: space.sm }}>
              <TextField label="Passenger name" value={guestName} onChangeText={(v) => setGuestName(v.slice(0, 60))} placeholder="Name of the person travelling" autoComplete="name" />
              <TextField
                label="Passenger mobile number"
                value={guestMobile}
                onChangeText={(v) => setGuestMobile(v.replace(/[^\d+ ]/g, '').slice(0, 14))}
                keyboardType="phone-pad"
                prefix="+91"
                placeholder="10-digit mobile number"
                error={guestName || guestMobile ? guestError || undefined : undefined}
                hint="Shared with NESAM and your driver in the booking notes."
              />
            </View>
          ) : null}
          <Checkbox checked={!waSame} onChange={(v) => setWaSame(!v)} label="Send WhatsApp updates to a different number" />
          {!waSame ? (
            <View style={styles.waRow}>
              <View style={{ width: 84 }}>
                <TextField label="Code" value={waCode} onChangeText={(v) => setWaCode(v.replace(/[^\d+]/g, '').slice(0, 4))} keyboardType="phone-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <TextField label="WhatsApp number" value={waNumber} onChangeText={setWaNumber} keyboardType="phone-pad" placeholder="WhatsApp number" error={waError || undefined} />
              </View>
            </View>
          ) : null}
          <View style={styles.rule} />
          <Disclosure title="Email for receipt (optional)">
            <TextField label="Email address" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="name@example.com" error={emailError || undefined} />
          </Disclosure>
          <Disclosure title="Pickup landmark / instructions" initiallyOpen={!!notes}>
            <TextInput
              style={styles.notes}
              placeholder="Landmark, luggage or accessibility needs"
              placeholderTextColor={colors.faint}
              value={notes}
              onChangeText={(v) => setNotes(v.slice(0, NOTES_MAX - 120))}
              multiline
              maxLength={NOTES_MAX - 120}
              accessibilityLabel="Pickup landmark or instructions"
            />
            <Text style={styles.small}>Special requests are subject to office confirmation.</Text>
          </Disclosure>
        </View>

        {/* Promo code (existing feature) */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Promo code</Text>
          <View style={styles.promoRow}>
            <TextInput
              style={styles.promoInput}
              placeholder="Enter code"
              placeholderTextColor={colors.faint}
              value={promoInput}
              onChangeText={setPromoInput}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Promo code"
            />
            <Button small title="Apply" onPress={applyPromo} disabled={!promoInput.trim() || promoInput.trim().toUpperCase() === promoCode} style={{ minHeight: 46, paddingHorizontal: 18 }} />
          </View>
          {promoMsg ? <Text style={[styles.promoFeedback, { color: promoMsg.ok ? colors.success : colors.primaryDark }]}>{promoMsg.text}</Text> : null}
          {promoCode ? <TextButton title="Remove code" icon="x" size={11} onPress={removePromo} style={{ alignSelf: 'flex-start' }} /> : null}
        </View>

        {/* Payment: hidden while customer payment options are switched off (every booking is pay-later). */}
        {CUSTOMER_PAYMENTS_ENABLED ? (
          <>
            <Text style={styles.heading}>Choose payment</Text>
            <View accessibilityRole="radiogroup">
              {PAYMENT_OPTIONS.map((p) => (
                <RadioCard key={p.id} selected={payment === p.id} onPress={() => setPayment(p.id)} title={p.title} subtitle={p.subtitle} right={<Text style={styles.payNow}>{'₹0\n'}<Text style={styles.payNowSub}>now</Text></Text>} />
              ))}
            </View>
          </>
        ) : null}
        <Text style={styles.small}>
          {CUSTOMER_PAYMENTS_ENABLED ? 'Online advance payment isn’t available yet. ' : 'Nothing is charged now; you pay after the trip. '}Toll, parking and state tax are extra, paid separately against receipts.
        </Text>

        <View style={styles.rule} />
        <Disclosure title="Cancellation policy">
          <Text style={styles.policy}>
            {`Free cancellation while your booking is under review or more than ${FREE_CANCEL_MIN} minutes before pickup. Closer to pickup, once a partner is committed, a ₹${SCHEDULED_CANCELLATION_FEE} cancellation fee applies. The trip cannot be cancelled once it has started. Any refund appears on your booking.`}
          </Text>
        </Disclosure>
        <View style={styles.rule} />

        <Checkbox checked={termsAccepted} onChange={setTermsAccepted} label="I accept the fare, extra charges and cancellation policy, and understand NESAM reviews this booking before arranging a vehicle." />

        {submitError ? <Notice message={submitError} tone="error" style={{ marginTop: space.md }} /> : null}
        {blocker && termsAccepted ? <Notice message={blocker} tone="warning" style={{ marginTop: space.md }} /> : null}
        <Button title="Book & Confirm" loading={submitting} disabled={!!blocker} onPress={() => void submit()} accessibilityLabel={`Book and confirm for ${formatINR(quote.total)}`} style={{ marginTop: space.lg }} />
      </ScrollView>

      <View style={styles.bottom}>
        <Content kind="narrow">
          <FlowFooter onBack={() => navigation.goBack()} onHome={goHome} />
        </Content>
      </View>

      <Sheet visible={fareOpen} onClose={() => setFareOpen(false)} title="Fare details" subtitle="Prices include GST.">
        <FareLines lines={fareBreakup.lines} total={quote.total} estimated={!authoritative} />
        <Text style={[styles.small, { marginTop: space.md }]}>Toll, parking and state tax are paid separately against receipts.</Text>
      </Sheet>
    </KeyboardAvoid>
</SafeAreaView>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  pad: { padding: space.xl },
  scroll: { paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: 28 },
  card: { borderWidth: 1, borderColor: '#E3E7EC', borderRadius: 13, padding: 18, marginBottom: 14, backgroundColor: colors.white },
  route: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 24, color: colors.text },
  arrow: { fontFamily: fonts.regular, color: '#8A929E' },
  when: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: '#6D7785', marginTop: 8 },
  catRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#EEF0F4' },
  cat: { fontFamily: fonts.regular, fontSize: 13.5, color: colors.text, flexShrink: 1 },
  incl: { fontFamily: fonts.regular, fontSize: 11.5, color: '#7A8494' },
  totalRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#EEF0F4' },
  totalLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.ink },
  gstNote: { fontFamily: fonts.regular, fontSize: 10, color: '#7A8494', marginTop: 4 },
  total: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.6, color: colors.ink },
  cardTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.ink, marginBottom: 12 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 8 },
  lineLabel: { fontFamily: fonts.regular, fontSize: 12, color: '#7A8494' },
  lineValue: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.ink, flexShrink: 1, textAlign: 'right' },
  checks: { marginTop: 4 },
  waRow: { flexDirection: 'row', gap: 10 },
  rule: { height: 1, backgroundColor: colors.divider, marginVertical: 8 },
  notes: { minHeight: 76, borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 11, fontFamily: fonts.regular, fontSize: 13, color: colors.value, textAlignVertical: 'top' },
  small: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, color: '#6D7785', marginTop: 8 },
  promoRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  promoInput: { flex: 1, minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 11, fontFamily: fonts.medium, fontSize: 14, color: colors.value },
  promoFeedback: { fontFamily: fonts.medium, fontSize: 12, marginTop: 8 },
  heading: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.ink, marginTop: 10, marginBottom: 12 },
  payNow: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink, textAlign: 'right' },
  payNowSub: { fontFamily: fonts.regular, fontSize: 10, color: '#7A8494' },
  policy: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 19, color: '#55606F' },
  bottom: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: '#E5E8ED', paddingHorizontal: space.xl, paddingVertical: 10 },
});
