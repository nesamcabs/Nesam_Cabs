// One booking, live. Right after booking it shows the confirmation ticket; afterwards the full
// booking: journey, driver, fare, payment, the five-step trip progress, boarding OTP, rating,
// receipt, help and cancellation. Status comes from the real booking document.
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useRideFocus } from '../navigation/MainNavigator';
import { useCustomerData } from '../context/CustomerData';
import { Avatar, Badge, Button, Disclosure, FlowFooter, Notice, Screen, type BadgeTone } from '../components/ui';
import { Content, ScrollView } from '../components/layout';
import { AppHeader } from '../components/brand';
import { Icon, type IconName } from '../components/Icon';
import { ConfirmationArt } from '../components/ConfirmationArt';
import { CancelRideSheet } from '../components/CancelRideSheet';
import { RatingCard } from '../components/RatingCard';
import { TripReceipt } from '../components/TripReceipt';
import { FareLines, tripFareLines } from '../components/FareLines';
import { SafetySheet, shareTrip } from '../components/SafetySheet';
import { subscribeToBoardingOtp, subscribeToBooking } from '../services/rideService';
import { playConfirmationSound, isConfirmationSoundOn, setConfirmationSound } from '../services/confirmationSound';
import { customerStatus, milestones, tripStatusChip } from '../utils/tripView';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY, SUPPORT_WHATSAPP } from '../config/constants';
import type { TripRecord } from '../types';
import { formatDateTime, formatDistance, formatINR, formatPhone, formatTime } from '../utils/format';
import { describeError } from '../utils/retry';
import { colors, fonts, space } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ActiveRide'>;

const dayText = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short' })} ${d.getFullYear()}`;
const CHIP_TONE = (bg: string): BadgeTone => (bg === '#DCFCE7' ? 'success' : bg === '#FEF3C7' ? 'warning' : bg === '#FEE2E2' ? 'danger' : 'info');

export function ActiveRideScreen({ route, navigation }: Props) {
  const { bookingId, unconfirmed, justBooked } = route.params;
  const { profile } = useCustomerData();
  const { dismiss, undismiss } = useRideFocus();
  const [trip, setTrip] = useState<TripRecord | null>(null);
  const [pending, setPending] = useState(!!unconfirmed);
  const [loadError, setLoadError] = useState('');
  const [vanished, setVanished] = useState(false);
  const [subKey, setSubKey] = useState(0);
  const [otp, setOtp] = useState<string | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const { online } = useNetworkStatus();

  // Leaving this screen stops auto re-opening.
  useEffect(() => {
    undismiss(bookingId);
    return navigation.addListener('beforeRemove', () => dismiss(bookingId));
  }, [navigation, bookingId, dismiss, undismiss]);

  // Booking document — the real-time source of truth.
  useEffect(
    () =>
      subscribeToBooking(
        bookingId,
        (s) => {
          setPending(s.pending);
          if (s.trip) {
            setTrip(s.trip);
            setVanished(false);
          } else if (!s.fromCache) {
            setVanished(true);
            setTrip(null);
          }
        },
        (e) => setLoadError(describeError(e, 'Could not load your booking details.')),
      ),
    [bookingId, subKey],
  );
  useEffect(() => subscribeToBoardingOtp(bookingId, setOtp), [bookingId]);

  const toBookings = () => navigation.navigate('Tabs', { screen: 'Trips' });
  const goHome = () => navigation.navigate('Tabs', { screen: 'Book' });

  if (loadError && !trip) {
    return (
      <Screen edges={['top']} header={<AppHeader title="Trip Details" onBack={toBookings} />}>
        <Notice message={loadError} onRetry={() => { setLoadError(''); setSubKey((k) => k + 1); }} />
        <Button title="Back to My Bookings" variant="secondary" onPress={toBookings} />
      </Screen>
    );
  }
  if (vanished) {
    return (
      <Screen edges={['top']} header={<AppHeader title="Trip Details" onBack={toBookings} />}>
        <Notice message="This booking is no longer available. If this was unexpected, please contact support." />
        <Button title="Back to My Bookings" variant="secondary" onPress={toBookings} />
      </Screen>
    );
  }
  if (!trip) {
    return (
      <Screen edges={['top']} header={<AppHeader title="Trip Details" onBack={toBookings} />}>
        <View style={styles.loading}>
          <Text style={styles.loadingTitle}>Loading your booking…</Text>
          <Text style={styles.loadingSub}>Ref: {bookingId}</Text>
        </View>
      </Screen>
    );
  }

  if (justBooked) {
    return (
      <ConfirmedView
        trip={trip}
        pending={pending}
        onHome={goHome}
        onView={() => navigation.setParams({ justBooked: false })}
      />
    );
  }

  const status = customerStatus(trip);
  const chip = tripStatusChip(trip);
  const isCompleted = trip.status === 'Completed';
  const isCancelled = trip.status === 'Cancelled' || trip.status === 'Rejected';
  const hasDriver = !!trip.driver && !!trip.driver.name;
  const driverPhone = trip.driver?.phone;
  const steps = milestones(trip);
  const destination = trip.tripType === 'Local Rental' ? 'Local Rental' : trip.drop.name;
  const ref = trip.bookingId || trip.id.slice(0, 8).toUpperCase();
  const paidTotal = trip.paid?.totalPaid ?? 0;
  const balance = trip.paid ? trip.paid.balanceDue : trip.fare + trip.tollCharges + (trip.extraCharges ?? 0);
  const payTone: BadgeTone = trip.paid?.status === 'Paid' || trip.paymentStatus === 'Paid' ? 'success' : paidTotal > 0 ? 'warning' : 'neutral';
  const payBadge = isCancelled
    ? trip.refund ? `Refund ${trip.refund.status.toLowerCase()}` : trip.cancellationFee > 0 ? 'Fee applies' : 'No charge'
    : payTone === 'success' ? 'Paid' : paidTotal > 0 ? 'Part paid' : trip.paymentMethod === 'UPI' ? 'Pay by UPI' : 'Pay at drop';

  const callDriver = () => driverPhone && void Linking.openURL(`tel:${driverPhone}`);
  const callOffice = () => void Linking.openURL(`tel:${SUPPORT_PHONE}`);
  const whatsApp = () => {
    const text = encodeURIComponent(`Hi NESAM Cabs, I am enquiring about my booking reference #${ref}`);
    void Linking.openURL(`https://wa.me/${SUPPORT_WHATSAPP}?text=${text}`);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
<KeyboardAvoid>
      <CancelRideSheet key={trip.id} trip={showCancel ? trip : null} onClose={() => setShowCancel(false)} />
      <SafetySheet visible={showSafety} trip={trip} profile={profile} location={null} onClose={() => setShowSafety(false)} />
      <AppHeader title="Trip Details" subtitle={`#${ref}`} onBack={toBookings} />

      <ScrollView kind="narrow" contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>


        <View style={styles.badges}>
          <Badge label={trip.tripType === 'Airport Taxi' ? 'Airport' : trip.tripType} tone="success" />
          <Badge label={chip.label} tone={CHIP_TONE(chip.bg)} />
        </View>
        <Text style={styles.route} accessibilityRole="header">
          {trip.pickup.name}
          <Text style={styles.arrow}>{'  →  '}</Text>
          {destination}
        </Text>
        <Text style={styles.when}>{`${trip.scheduledAt ? `${dayText(trip.scheduledAt)} · ${formatTime(trip.scheduledAt).replace(/^0/, '')}` : trip.date} · ${trip.categoryName}`}</Text>

        {pending ? <Notice tone="info" message="Sending your booking to NESAM…" style={{ marginTop: 14 }} /> : null}
        {!online ? <Notice tone="warning" message="You are offline. Details may be out of date." style={{ marginTop: 14 }} /> : null}
        <Notice tone={isCancelled ? 'error' : isCompleted ? 'success' : 'info'} message={`${status.label}. ${status.detail}`} style={{ marginTop: 14 }} />

        {/* Boarding OTP */}
        {hasDriver && !isCompleted && !isCancelled && trip.phase !== 'in_trip' ? (
          <View style={styles.otp} accessible accessibilityLabel={`Boarding code ${otp ? otp.split('').join(' ') : 'not available yet'}`}>
            <View style={styles.otpHead}>
              <Icon name="lock-keyhole" size={18} color={colors.primary} />
              <Text style={styles.otpTitle}>Boarding code</Text>
            </View>
            <Text style={styles.otpCode}>{otp ?? '····'}</Text>
            <Text style={styles.otpHint}>Share this code with your driver only once you are in the car. The trip starts after it is verified.</Text>
          </View>
        ) : null}

        {/* Journey details */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Journey details</Text>
          <Stop pin="start" name={trip.pickup.name} address={trip.pickup.address} />
          {trip.tripType === 'Local Rental' ? null : <Stop pin="end" name={trip.drop.name} address={trip.drop.address} />}
          <View style={styles.rule} />
          <Text style={styles.passenger}>
            <Text style={styles.passengerLabel}>Passenger</Text>
            {` · ${profile.name}`}
          </Text>
          <Text style={styles.passengerPhone}>{formatPhone(profile.phone)}</Text>
          {trip.notes ? (
            <>
              <View style={styles.rule} />
              <Text style={styles.passengerLabel}>Instructions</Text>
              <Text style={styles.notes}>{trip.notes}</Text>
            </>
          ) : null}
          {trip.distanceKm > 0 ? <Text style={[styles.notes, { marginTop: 10 }]}>{`${formatDistance(trip.distanceKm)} route distance`}</Text> : null}
        </View>

        {/* Driver details */}
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <Text style={styles.cardTitleInline}>Driver details</Text>
            <Badge label={hasDriver ? 'Assigned' : 'To be arranged'} tone={hasDriver ? 'success' : 'neutral'} />
          </View>
          {hasDriver ? (
            <>
              <View style={styles.driverRow}>
                <Avatar name={trip.driver!.name} photoUrl={trip.driver?.photoUrl} size={48} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.driverName}>{trip.driver!.name}</Text>
                  <Text style={styles.driverMeta}>{trip.driver?.vehicleModel || trip.categoryName}</Text>
                  {trip.driver?.rating != null ? <Text style={styles.driverMeta}>{`★ ${trip.driver.rating.toFixed(1)}`}</Text> : null}
                </View>
                {trip.driver?.vehicleNumber ? (
                  <View style={styles.plate}>
                    <Text style={styles.plateText}>{trip.driver.vehicleNumber}</Text>
                  </View>
                ) : null}
              </View>
              {driverPhone ? <Button title={`Call ${trip.driver!.name.split(' ')[0]} · ${formatPhone(driverPhone)}`} icon="phone" variant="secondary" onPress={callDriver} style={{ marginTop: 14 }} /> : null}
            </>
          ) : (
            <View style={styles.driverRow}>
              <View style={styles.driverGhost}>
                <Icon name="user-round" size={20} color="#7A8494" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.driverName}>{trip.phase === 'partner_confirmed' ? 'Driver details pending' : 'Driver to be arranged'}</Text>
                <Text style={styles.driverMeta}>Details appear as soon as a driver is assigned.</Text>
              </View>
            </View>
          )}
          {hasDriver ? null : <Button title="Call NESAM" icon="phone" variant="secondary" onPress={callOffice} style={{ marginTop: 14 }} />}
        </View>

        {/* Fare details */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Fare details</Text>
          <FareLines lines={tripFareLines(trip)} total={trip.fareBreakdown?.total ?? trip.fare} tolls={trip.tollCharges} />
          {trip.couponCode ? <Text style={styles.notes}>{`Promo ${trip.couponCode} applied.`}</Text> : null}
        </View>

        {/* Payment */}
        <View style={styles.card}>
          <View style={styles.cardTop}>
            <Text style={styles.cardTitleInline}>Payment</Text>
            <Badge label={payBadge} tone={isCancelled ? 'neutral' : payTone} />
          </View>
          <Money label="Paid" value={formatINR(paidTotal)} />
          {isCancelled ? null : <Money label="Balance" value={formatINR(Math.max(0, balance))} strong />}
          {trip.refund ? <Money label={`Refund ${trip.refund.status.toLowerCase()}`} value={formatINR(trip.refund.amount)} /> : null}
          {trip.cancellationFee > 0 ? <Money label="Cancellation fee" value={formatINR(trip.cancellationFee)} /> : null}
          <View style={styles.note}>
            <Text style={styles.noteText}>
              {isCancelled
                ? 'Any refund shown above is processed by NESAM.'
                : isCompleted
                  ? 'Your receipt is below. Payments are recorded by NESAM.'
                  : `Pay the fare by ${trip.paymentMethod === 'UPI' ? 'UPI' : 'cash'} to your driver. Final charges are reviewed when your trip closes.`}
            </Text>
          </View>
        </View>

        {/* Trip progress: the five customer milestones */}
        {isCancelled ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{trip.status === 'Rejected' ? 'Not accepted' : 'Cancelled'}</Text>
            <Text style={styles.notes}>
              {trip.status === 'Rejected'
                ? 'NESAM could not accept this booking request.'
                : `Cancelled ${trip.cancelledAt ? formatDateTime(trip.cancelledAt) : ''}${trip.cancelledBy ? ` by ${trip.cancelledBy === 'customer' ? 'you' : 'NESAM'}` : ''}.${trip.cancelReason ? ` Reason: ${trip.cancelReason}` : ''}`}
            </Text>
          </View>
        ) : (
          <View style={styles.card} accessibilityRole="list">
            <Text style={styles.cardTitle}>Trip progress</Text>
            {steps.map((m, i) => (
              <View key={m.key} style={styles.mile} accessible accessibilityLabel={`${m.label}, ${m.state === 'done' ? 'done' : m.state === 'current' ? 'in progress' : 'not yet'}${m.detail ? `, ${m.detail}` : ''}`}>
                <View style={styles.mileRail}>
                  <View style={[styles.mileDot, m.state === 'done' && styles.mileDone, m.state === 'current' && styles.mileCurrent]}>
                    <Icon name={m.state === 'done' ? 'check' : 'minus'} size={11} color={m.state === 'done' ? colors.successStrong : m.state === 'current' ? colors.primary : '#A0A7B1'} strokeWidth={2.4} />
                  </View>
                  {i < steps.length - 1 ? <View style={[styles.mileLine, m.state === 'done' && { backgroundColor: '#BFDCCB' }]} /> : null}
                </View>
                <View style={{ flex: 1, paddingBottom: i < steps.length - 1 ? 18 : 0 }}>
                  <Text style={[styles.mileLabel, m.state === 'todo' && { color: '#7A8494' }]}>{m.label}</Text>
                  <Text style={styles.mileSub}>{m.at && m.state === 'done' ? formatDateTime(m.at) : m.detail || '—'}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {isCompleted ? <RatingCard trip={trip} profile={profile} /> : null}
        {isCompleted ? <TripReceipt trip={trip} customerName={profile.name} /> : null}

        {/* Help & actions */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Need help with this trip?</Text>
          <Action icon="phone" label={`Call NESAM · ${SUPPORT_PHONE_DISPLAY}`} accent onPress={callOffice} />
          <Action icon="message-circle" label="WhatsApp NESAM" onPress={whatsApp} />
          <Action icon="share-2" label="Share trip details" onPress={() => void shareTrip(trip, null)} />
          {!isCompleted && !isCancelled ? <Action icon="calendar-clock" label="Request a change" onPress={() => navigation.navigate('Support', { bookingId: trip.id })} /> : null}
          {trip.phase === 'in_trip' || trip.phase === 'driver_arrived' ? <Action icon="triangle-alert" label="Safety & SOS" onPress={() => setShowSafety(true)} /> : null}
          {!isCompleted && !isCancelled && trip.status !== 'Ongoing' ? <Action icon="circle-x" label="Cancel booking" onPress={() => setShowCancel(true)} last /> : null}
        </View>
        <Disclosure title="Cancellation & refunds">
          <Text style={styles.notes}>
            You can cancel from here until the trip starts. The cancellation sheet shows any fee before you confirm. If you paid anything, the refund status appears under Payment.
          </Text>
        </Disclosure>
      </ScrollView>

      <View style={styles.bottom}>
        <Content kind="narrow">
          <FlowFooter onBack={toBookings} onHome={goHome} />
        </Content>
      </View>
    </KeyboardAvoid>
</SafeAreaView>
  );
}

/** The ticket shown right after booking. */
function ConfirmedView({ trip, pending, onHome, onView }: { trip: TripRecord; pending: boolean; onHome: () => void; onView: () => void }) {
  const [soundOn, setSoundOn] = useState(true);
  const played = useRef(false);
  const confirmed = trip.status !== 'Pending';
  useEffect(() => {
    let alive = true;
    void isConfirmationSoundOn().then((v) => {
      if (!alive) return;
      setSoundOn(v);
      if (v && !played.current) {
        played.current = true;
        void playConfirmationSound(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  const when = trip.scheduledAt;
  const ref = trip.bookingId || trip.id.slice(0, 8).toUpperCase();
  const destination = trip.tripType === 'Local Rental' ? 'Local city rental' : trip.drop.name;
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
<KeyboardAvoid>
      <AppHeader title={confirmed ? 'Booking Confirmed' : 'Booking Received'} subtitle={`#${ref}`} onBack={onHome} />
      <ScrollView kind="narrow" contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Pressable
          onPress={() => {
            const next = !soundOn;
            setSoundOn(next);
            void setConfirmationSound(next);
            if (next) void playConfirmationSound(true);
          }}
          style={styles.sound}
          accessibilityRole="switch"
          accessibilityState={{ checked: soundOn }}
          accessibilityLabel="Confirmation sound"
        >
          <Icon name={soundOn ? 'volume-2' : 'volume-x'} size={15} color="#6D7785" />
          <Text style={styles.soundText}>{soundOn ? 'Sound on' : 'Sound off'}</Text>
        </Pressable>

        <ConfirmationArt animate />
        <Text style={styles.confTitle} accessibilityRole="header" accessibilityLiveRegion="polite">
          {confirmed ? 'Booking Confirmed' : 'Booking Received'}
        </Text>
        <Text style={styles.confSub}>
          {pending ? 'Sending your booking to NESAM…' : confirmed ? 'Your trip is confirmed. We will arrange your cab.' : 'NESAM will review your booking and confirm it here.'}
        </Text>

        <View style={styles.ticket}>
          <View style={styles.ticketHead}>
            <Text style={styles.ticketBrand}>NESAM</Text>
            <Text style={styles.ticketLabel}>Trip summary</Text>
          </View>
          <View style={styles.ticketBody}>
            <View style={styles.refRow}>
              <Text style={styles.refLabel}>Booking ID</Text>
              <Text style={styles.refValue} selectable>
                {ref}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
              <View style={styles.pins}>
                <View style={[styles.pinDot, { borderColor: '#8D95A1', borderRadius: 4 }]} />
                <View style={styles.pinLine} />
                <View style={[styles.pinDot, { borderColor: colors.primary, borderRadius: 3 }]} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.stopLabel}>Pickup location</Text>
                <Text style={styles.stopName}>{trip.pickup.name}</Text>
                <View style={{ height: 14 }} />
                <Text style={styles.stopLabel}>Drop location</Text>
                <Text style={styles.stopName}>{destination}</Text>
              </View>
            </View>
          </View>
          <View style={styles.tear}>
            <View style={[styles.notch, { left: -9 }]} />
            <View style={styles.tearLine} />
            <View style={[styles.notch, { right: -9 }]} />
          </View>
          <View style={styles.ticketBody}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Fact icon="calendar-days" label="Pickup date" value={when ? dayText(when) : trip.date} />
              <Fact icon="clock-3" label="Pickup time" value={when ? formatTime(when).replace(/^0/, '') : trip.time} />
            </View>
            <View style={styles.catRow}>
              <Icon name="car-front" size={18} color="#7A8494" />
              <View style={{ flex: 1 }}>
                <Text style={styles.catName}>{trip.categoryName}</Text>
              </View>
              <Badge label={trip.tripType === 'Airport Taxi' ? 'Airport' : trip.tripType} tone="brand" />
            </View>
          </View>
        </View>
        <View style={styles.saved}>
          <Icon name="shield-check" size={13} color="#7A8494" />
          <Text style={styles.savedText}>Your trip is saved in My Bookings.</Text>
        </View>
      </ScrollView>
      <View style={styles.bottom}>
       <Content kind="narrow">
        <Button title="Back to Home" icon="house" onPress={onHome} />
        <View style={{ alignItems: 'center', marginTop: 4 }}>
          <Pressable onPress={onView} accessibilityRole="button" style={styles.viewLink} hitSlop={8}>
            <Icon name="arrow-right" size={14} color={colors.primary} />
            <Text style={styles.viewLinkText}>View Booking</Text>
          </Pressable>
        </View>
       </Content>
      </View>
    </KeyboardAvoid>
</SafeAreaView>
  );
}

function Fact({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={{ flex: 1, flexDirection: 'row', gap: 9 }}>
      <Icon name={icon} size={17} color="#7A8494" />
      <View>
        <Text style={styles.stopLabel}>{label}</Text>
        <Text style={styles.factValue}>{value}</Text>
      </View>
    </View>
  );
}

function Stop({ pin, name, address }: { pin: 'start' | 'end'; name: string; address: string }) {
  return (
    <View style={styles.stop}>
      <Icon name={pin === 'start' ? 'circle-dot' : 'map-pin'} size={17} color="#7E8896" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.stopName}>{name}</Text>
        {address && address !== name ? <Text style={styles.stopAddr}>{address}</Text> : null}
      </View>
    </View>
  );
}

function Money({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.money}>
      <Text style={[styles.moneyLabel, strong && styles.moneyStrong]}>{label}</Text>
      <Text style={[styles.moneyValue, strong && styles.moneyStrong]}>{value}</Text>
    </View>
  );
}

function Action({ icon, label, onPress, accent, last }: { icon: IconName; label: string; onPress: () => void; accent?: boolean; last?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.action, !last && styles.actionLine, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} size={18} color={accent ? colors.primary : '#3A4350'} />
      <Text style={[styles.actionText, accent && { color: colors.primary }]}>{label}</Text>
      {accent ? <Icon name="chevron-right" size={15} color={colors.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  scroll: { paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: 28 },
  bottom: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: '#E5E8ED', paddingHorizontal: space.xl, paddingVertical: 10 },
  loading: { alignItems: 'center', paddingTop: 80 },
  loadingTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.ink },
  loadingSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
  badges: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  route: { fontFamily: fonts.bold, fontSize: 19, lineHeight: 26, color: colors.text, marginTop: 12 },
  arrow: { fontFamily: fonts.regular, color: '#8A929E' },
  when: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: '#6D7785', marginTop: 6, marginBottom: 6 },
  card: { borderWidth: 1, borderColor: '#E3E7EC', borderRadius: 13, padding: 18, marginTop: 14, backgroundColor: colors.white },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  cardTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.ink, marginBottom: 12 },
  cardTitleInline: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.ink },
  rule: { height: 1, backgroundColor: colors.divider, marginVertical: 12 },
  stop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 6 },
  stopName: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.value },
  stopAddr: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: '#8A929E', marginTop: 2 },
  passenger: { fontFamily: fonts.regular, fontSize: 13, color: colors.value },
  passengerLabel: { fontFamily: fonts.semiBold, fontSize: 12.5, color: colors.ink },
  passengerPhone: { fontFamily: fonts.regular, fontSize: 12.5, color: '#6D7785', marginTop: 4 },
  notes: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: '#55606F', marginTop: 4 },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  driverGhost: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F3F4F7', alignItems: 'center', justifyContent: 'center' },
  driverName: { fontFamily: fonts.semiBold, fontSize: 13.5, color: colors.ink },
  driverMeta: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, color: '#6D7785', marginTop: 2 },
  plate: { borderWidth: 1, borderColor: '#D5DAE1', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#F6F7F9' },
  plateText: { fontFamily: fonts.semiBold, fontSize: 11, color: colors.ink, letterSpacing: 0.5 },
  money: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  moneyLabel: { fontFamily: fonts.regular, fontSize: 13, color: '#55606F' },
  moneyValue: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.ink },
  moneyStrong: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.ink },
  note: { marginTop: 10, backgroundColor: '#F6F8FB', borderRadius: 8, padding: 12 },
  noteText: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, color: '#6D7785' },
  otp: { marginTop: 14, borderWidth: 1, borderColor: colors.warningBorder, backgroundColor: colors.warningSoft, borderRadius: 13, padding: 16, alignItems: 'center' },
  otpHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  otpTitle: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.warning },
  otpCode: { fontFamily: fonts.bold, fontSize: 32, letterSpacing: 10, color: colors.primary, marginVertical: 6 },
  otpHint: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, color: '#7A5A1E', textAlign: 'center' },
  mile: { flexDirection: 'row', gap: 12 },
  mileRail: { alignItems: 'center', width: 24 },
  mileDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#F0F1F4', alignItems: 'center', justifyContent: 'center' },
  mileDone: { backgroundColor: '#E6F3EB' },
  mileCurrent: { backgroundColor: '#FFF1F1', borderWidth: 1, borderColor: '#F3C3C3' },
  mileLine: { flex: 1, width: 1.5, backgroundColor: '#E3E6EB', marginTop: 4, marginBottom: -2 },
  mileLabel: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.ink, lineHeight: 20 },
  mileSub: { fontFamily: fonts.regular, fontSize: 11, color: '#7A8494', marginTop: 2 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 52, paddingVertical: 12 },
  actionLine: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  actionText: { flex: 1, fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  sound: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', borderWidth: 1, borderColor: '#E3E7EC', borderRadius: 16, paddingHorizontal: 11, minHeight: 32 },
  soundText: { fontFamily: fonts.regular, fontSize: 11, color: '#6D7785' },
  confTitle: { fontFamily: fonts.semiBold, fontSize: 28, lineHeight: 36, letterSpacing: -0.7, color: colors.ink, textAlign: 'center', marginTop: 14 },
  confSub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: '#55606F', textAlign: 'center', marginTop: 10, marginBottom: 22 },
  ticket: { borderWidth: 1, borderColor: '#E3E7EC', borderRadius: 16, backgroundColor: colors.white, overflow: 'hidden' },
  ticketHead: { backgroundColor: colors.primary, paddingHorizontal: 18, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ticketBrand: { fontFamily: fonts.brand, fontSize: 17, letterSpacing: 2.5, color: colors.white },
  ticketLabel: { fontFamily: fonts.regular, fontSize: 11, color: '#FBD9D9' },
  ticketBody: { paddingHorizontal: 18, paddingVertical: 16 },
  refRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  refLabel: { fontFamily: fonts.regular, fontSize: 11, color: '#7A8494' },
  refValue: { fontFamily: fonts.medium, fontSize: 12, color: '#2A3A52', letterSpacing: 0.5 },
  pins: { alignItems: 'center', paddingTop: 12 },
  pinDot: { width: 9, height: 9, borderWidth: 1.5, backgroundColor: colors.white },
  pinLine: { width: 1, flex: 1, borderLeftWidth: 1, borderStyle: 'dashed', borderColor: '#CBD1D9', marginVertical: 3, minHeight: 24 },
  stopLabel: { fontFamily: fonts.regular, fontSize: 10.5, color: '#7A8494' },
  tear: { height: 18, justifyContent: 'center' },
  tearLine: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#D5DAE1', marginHorizontal: 12 },
  notch: { position: 'absolute', top: 0, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.white, borderWidth: 1, borderColor: '#E3E7EC' },
  factValue: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.ink, marginTop: 2 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#EEF0F4' },
  catName: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.ink },
  saved: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 18 },
  savedText: { fontFamily: fonts.regular, fontSize: 11, color: '#6D7785' },
  viewLink: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 40, paddingHorizontal: 12 },
  viewLinkText: { fontFamily: fonts.medium, fontSize: 13, color: colors.primary },
});
