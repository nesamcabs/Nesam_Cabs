// Trip flow (reference "Trip Details"). The driver's steps are the app's existing server-authoritative ones:
//   photos → Reached Pickup (within the pickup radius) → boarding OTP → Trip Started → Trip End (km, tolls, collections).
// Every step is a server call (advanceTrip / verifyBoarding / recordCollection) that checks the order and ignores a
// repeated tap; this screen only presents them. The reference's slide-to-confirm controls trigger the same calls.
import React, { useEffect, useRef, useState } from 'react';
import { CancellationStatus, HelpCancellationDialog } from '../components/nx/Cancellation';
import { ExtraUsageCard } from '../components/nx/ExtraUsageCard';
import { acknowledgeAssignment } from '../services/partnerRequests';
import { Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../components/nx/Text';
import { useNavigation } from '@react-navigation/native';
import { useNow } from '../hooks/useNow';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useDriverData } from '../context/DriverData';
import { NxScreen, useShell } from '../components/nx/Shell';
import { useLayout } from '../components/nx/layout';
import { NxDialog } from '../components/nx/Dialog';
import { NxIcon, NxIconName } from '../components/nx/Icon';
import { NxBadge, NxButton, NxEmpty, NxField, NxFormError, NxInfo, NxPanel, NxRow, nxText, placeName } from '../components/nx/primitives';
import { NxSwipe, SWIPE_HELP } from '../components/nx/Swipe';
import { arrivalWindow, durationText, kmText, payoutCaption, payoutLabel, tripStageLabel, tripWhen } from '../components/nx/tripFormat';
import { PhotoField } from '../components/forms';
import { DriverActionError, saveTripTolls, tollTotal } from '../services/driverService';
import { ActionError } from '../services/callables';
import { refreshDeviceIntegrity } from '../services/deviceSecurity';
import { getCurrentPosition, LocationError } from '../services/locationService';
import { advanceTrip, newRequestId, recordCollection, revealCustomerContact, verifyBoarding, type Fix, type TripStep } from '../services/tripService';
import { SLOTS } from '../services/verificationService';
import type { TollReceipt, TripDetails } from '../types/driver';
import { formatINR, formatPhone, localMobile } from '../utils/format';
import { describeError } from '../utils/retry';
import { formatTime12 } from '../utils/time';
import { startBlockers } from '../utils/tripFlow';
import { nx } from '../theme/nx';

export function mapsDirections(loc: TripDetails['pickup']): string {
  return loc.lat != null && loc.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(loc.address)}`;
}

const reason = (err: unknown, fallback: string) =>
  err instanceof ActionError || err instanceof DriverActionError || err instanceof LocationError ? err.message : describeError(err, fallback);

const REVEAL_WINDOW_MS = 8 * 3600000;
const TREATMENT: Record<string, string> = { included: 'Included', extra: 'Extra · customer pays separately', not_applicable: 'Not applicable' };
const METHODS = ['Cash', 'UPI', 'Bank Transfer'] as const;
type Closing = 'trip' | 'form' | 'review';
const SLOT_ICON: Record<string, NxIconName> = { selfie: 'user', front: 'car', rear: 'car', interior: 'car' };

type Props = NativeStackScreenProps<RootStackParamList, 'TripFlow'>;

export function TripFlowScreen({ route }: Props) {
  const navigation = useNavigation();
  const { bookings } = useDriverData();
  const trip = bookings.find((b) => b.id === route.params.bookingId) ?? null;
  if (!trip) {
    return (
      <NxScreen tabs={false}>
        <BackRow />
        <NxEmpty icon="trip" title="This trip is no longer available" message="It may have been cancelled or reassigned." action={<NxButton title="Go to My Trips" onPress={() => navigation.navigate('Tabs', { screen: 'Trip' })} />} />
      </NxScreen>
    );
  }
  // Keyed so per-trip form state (OTP, kilometres, tolls) never leaks between trips.
  return <TripFlow key={trip.id} trip={trip} />;
}

function BackRow({ right }: { right?: React.ReactNode }) {
  const navigation = useNavigation();
  return (
    <View style={styles.toolbar}>
      <Pressable
        style={styles.back}
        onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Tabs', { screen: 'Trip' }))}
        accessibilityRole="button"
        accessibilityLabel="Back to My Trips"
      >
        <NxIcon name="back" size={16} color={nx.muted} />
        <Text style={styles.backText}>My Trips</Text>
      </Pressable>
      {right}
    </View>
  );
}

function TripFlow({ trip }: { trip: TripDetails }) {
  const navigation = useNavigation();
  const { notify, openSupport } = useShell();
  const { rules, cancellations, cancelPolicy } = useDriverData();
  const cancellation = cancellations.find((c) => c.bookingId === trip.id) ?? null;
  const pendingCancel = cancellation?.status === 'Pending';
  const [helpOpen, setHelpOpen] = useState(false);
  // The vendor sees "Viewed" once the assigned driver opens the duty.
  const needsView = !trip.driverResponse?.viewedAt && !['Completed', 'Cancelled', 'Rejected'].includes(trip.status);
  useEffect(() => { if (needsView) acknowledgeAssignment(trip.id, 'viewed'); }, [needsView, trip.id]);
  const { wide } = useLayout();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [otp, setOtp] = useState('');
  const [closing, setClosing] = useState<Closing>('trip');
  const [totalKm, setTotalKm] = useState('');
  const [tolls, setTolls] = useState<TollReceipt[]>(trip.tolls);
  const [tollOpen, setTollOpen] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<(typeof METHODS)[number]>('Cash');
  const [payRef, setPayRef] = useState('');
  const [revealedPhone, setRevealedPhone] = useState('');
  const [calling, setCalling] = useState(false);
  const now = useNow();
  // One request id per action attempt, kept until it succeeds, so a retry is recognised by the server.
  const ids = useRef<Record<string, string>>({});
  const requestId = (key: string) => (ids.current[key] ??= newRequestId());

  const sub = trip.subStatus;
  const finished = trip.status === 'Completed' || sub === 'Trip Ended';
  const cancelled = trip.status === 'Cancelled' || trip.status === 'Rejected';
  const when = tripWhen(trip);
  const arrival = arrivalWindow(trip, rules, now);
  const opensText = arrival.opensAt ? `${arrival.opensAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })}, ${formatTime12(arrival.opensAt)} IST` : '';
  const arrivalNote = !arrival.open && rules ? `Marking arrival opens ${opensText} — ${durationText(rules.startWindowMs)} before the pickup time. You can take the vehicle photos now.` : '';
  const phone = localMobile(revealedPhone || trip.customerPhone);
  const blockers = startBlockers(trip);
  const km = Number(totalKm);
  const totalTolls = tollTotal(tolls);

  /** Runs one action: one at a time, with the error shown on the screen. Resolves true when it succeeded. */
  const act = async (fn: () => Promise<void>, fallback: string): Promise<boolean> => {
    if (busy) return false;
    setError('');
    setBusy(true);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(reason(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Position for the step, or null when the phone can't give one (the server notes that). */
  const hereOrNull = (): Promise<Fix | null> => getCurrentPosition(8000).catch(() => null);

  /** Runs a trip step; if the server says this phone needs a fresh integrity check, does it and retries once. */
  const step = async (to: TripStep, extra: { location?: Fix | null; totalKm?: number; tolls?: TollReceipt[] } = {}) => {
    const call = () => advanceTrip({ bookingId: trip.id, to, requestId: requestId(to), ...extra });
    try {
      await call();
    } catch (err) {
      const needs = err instanceof ActionError && (err.details as { integrity?: string } | undefined)?.integrity === 'required';
      if (!needs) throw err;
      await refreshDeviceIntegrity();
      await call();
    }
    delete ids.current[to];
  };

  const reachedPickup = () =>
    act(async () => {
      await step('Reached Pickup');
    }, 'Could not update the trip.');

  const startTrip = () => act(async () => step('Trip Started', { location: await hereOrNull() }), 'Could not start the trip.');

  const checkOtp = () =>
    act(async () => {
      await verifyBoarding(trip.id, otp);
      setOtp('');
      notify('ok', trip.verificationSubmitted ? 'Boarding OTP verified. Slide to start the trip when the customer is on board.' : 'Boarding OTP verified. Complete the vehicle photos, then start the trip.');
    }, 'Could not verify the OTP.');

  const endTrip = () => act(async () => step('Trip Ended', { location: await hereOrNull(), totalKm: km, tolls }), 'Could not end the trip. Please try again.');

  const removeToll = (id: string) =>
    act(async () => {
      const next = tolls.filter((t) => t.id !== id);
      await saveTripTolls(trip.id, next);
      setTolls(next);
    }, 'Could not remove the receipt.');

  const collect = () => {
    const amount = Number(payAmount);
    if (!(amount > 0)) return setError('Enter the amount you collected.');
    if (payMethod !== 'Cash' && payRef.trim().length < 3) return setError('Enter the payment reference for UPI / bank transfers.');
    return act(async () => {
      await recordCollection({ bookingId: trip.id, amount, method: payMethod, reference: payRef.trim(), requestId: requestId('collect') });
      delete ids.current.collect;
      setPayAmount('');
      setPayRef('');
      notify('ok', `Recorded ${formatINR(amount)} (${payMethod}).`);
    }, 'Could not record the payment.');
  };

  const goReview = () => {
    if (!(km > 0)) return setError('Enter the total kilometres driven for the whole trip.');
    if (km > 6000) return setError('That distance looks wrong — please check it.');
    setError('');
    setClosing('review');
    return undefined;
  };

  const callCustomer = async () => {
    setCalling(true);
    setError('');
    try {
      const known = revealedPhone || (await revealCustomerContact(trip.id)).phone;
      setRevealedPhone(known);
      const digits = localMobile(known);
      if (digits) await Linking.openURL(`tel:+91${digits}`);
    } catch (err) {
      setError(reason(err, 'The customer’s number is not available yet.'));
    } finally {
      setCalling(false);
    }
  };

  // ── Progress ──────────────────────────────────────────────────────────────
  const phase = finished ? 4 : closing !== 'trip' ? 3 : sub === 'Trip Started' ? 2 : sub === 'Reached Pickup' || trip.verificationSubmitted ? 1 : 0;
  const labels = ['Start', 'Pickup', 'On trip', 'Close'];

  // ── Customer card ─────────────────────────────────────────────────────────
  const unlockAt = trip.pickupAt ? trip.pickupAt.getTime() - REVEAL_WINDOW_MS : NaN;
  // The server enforces the 8-hour window; an unknown pickup time or a number already held never blocks the call.
  const contactOpen = !!(revealedPhone || trip.customerPhone) || !Number.isFinite(unlockAt) || now >= unlockAt;
  const unlockText = Number.isFinite(unlockAt) ? `${new Date(unlockAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })} · ${formatTime12(new Date(unlockAt))} IST` : '8 hours before pickup';

  const customerCard =
    !finished && !cancelled ? (
      <NxPanel>
        <View style={styles.spread}>
          <Text style={styles.cardTitle}>Customer details</Text>
          <NxBadge label={contactOpen ? 'Available' : 'Private'} tone={contactOpen ? 'green' : 'neutral'} icon={contactOpen ? 'check' : 'shield'} />
        </View>
        <View style={styles.custRow}>
          <View style={styles.custIcon}>
            <NxIcon name="user" size={17} color={nx.muted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.custLabel}>Customer name</Text>
            <Text style={styles.custValue}>{trip.customerName || 'Customer'}</Text>
          </View>
        </View>
        <View style={[styles.custRow, { borderBottomWidth: 0 }]}>
          <View style={styles.custIcon}>
            <NxIcon name="phone" size={17} color={nx.muted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.custLabel}>Mobile number</Text>
            <Text style={[styles.custValue, !phone && { letterSpacing: 2, color: nx.faint }]}>{phone ? formatPhone(phone) : trip.customerPhoneMasked || '••••••••••'}</Text>
          </View>
          <Pressable
            style={[styles.call, (!contactOpen || calling) && { opacity: 0.45 }]}
            disabled={!contactOpen || calling}
            onPress={() => void callCustomer()}
            accessibilityRole="button"
            accessibilityLabel={contactOpen ? 'Call customer' : 'Customer calling opens 8 hours before pickup'}
          >
            <NxIcon name="phone" size={14} color={nx.tripRed} />
            <Text style={styles.callText}>{calling ? '…' : 'Call'}</Text>
          </Pressable>
        </View>
        {contactOpen ? (
          <Text style={[nxText.small, { marginTop: 8 }]}>Tap Call to reach the customer. NESAM reveals the number only for your assigned trip and keeps a record of it.</Text>
        ) : (
          <View style={styles.unlock}>
            <NxIcon name="clock" size={15} color={nx.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.unlockTitle}>Opens 8 hours before pickup</Text>
              <Text style={nxText.small}>{unlockText}</Text>
            </View>
          </View>
        )}
        {trip.notes ? <NxInfo style={{ marginTop: 12 }}>Customer note: {trip.notes}</NxInfo> : null}
      </NxPanel>
    ) : null;

  // ── Fare card ─────────────────────────────────────────────────────────────
  const extras = (trip.fareLines ?? []).filter((l) => l.treatment === 'extra');
  const toCollect = trip.balanceDue ?? Math.max(0, trip.fareAmount - (trip.totalPaid ?? 0));
  const fareCard =
    !finished && !cancelled ? <FareCard trip={trip} extras={extras} toCollect={toCollect} /> : null;

  // ── Stage panels ──────────────────────────────────────────────────────────
  const photoChecks = (heading: string) => (
    <NxPanel>
      <NxBadge label="Confirmed duty" tone="green" icon="check" />
      <Text style={[nxText.heading, { marginTop: 15 }]}>{heading}</Text>
      <Text style={[nxText.copy, { marginTop: 7 }]}>Take your live selfie and the three vehicle photos, then enter the starting odometer reading. They are needed before the trip can start.</Text>
      <View style={styles.pickupSummary}>
        <NxIcon name="pin" size={17} color={nx.red} />
        <View style={{ flex: 1 }}>
          <Text style={nxText.small}>Pickup</Text>
          <Text style={styles.pickupAddr}>{trip.pickup.address || '—'}</Text>
        </View>
      </View>
      {SLOTS.map((s, i) => (
        <View style={styles.check} key={s.slot}>
          <View style={styles.thumb}>
            <NxIcon name={SLOT_ICON[s.slot] ?? 'camera'} size={20} color={nx.muted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.checkStep}>STEP {i + 1}</Text>
            <Text style={styles.checkTitle}>{s.label}</Text>
            <Text style={nxText.small}>{s.hint}</Text>
          </View>
        </View>
      ))}
      <View style={styles.check}>
        <View style={styles.thumb}>
          <NxIcon name="distance" size={20} color={nx.muted} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.checkStep}>STEP {SLOTS.length + 1}</Text>
          <Text style={styles.checkTitle}>Starting odometer</Text>
          <Text style={nxText.small}>Enter the reading shown on the dashboard.</Text>
        </View>
      </View>
      <View style={styles.cameraOnly}>
        <NxIcon name="shield" size={13} color={nx.muted} />
        <Text style={nxText.small}>Live camera only · Gallery upload unavailable</Text>
      </View>
      {arrivalNote ? <Text style={nxText.note}>{arrivalNote}</Text> : null}
      <NxButton title="Start photo check" icon="camera" onPress={() => { acknowledgeAssignment(trip.id, 'acknowledged'); navigation.navigate('PreTrip', { bookingId: trip.id }); }} style={{ marginTop: 16 }} />
    </NxPanel>
  );

  const navigationPanel = (loc: TripDetails['pickup'], eyebrow: string, label: string, caption: string) => (
    <NxPanel>
      <Text style={nxText.eyebrow}>{eyebrow.toUpperCase()}</Text>
      <View style={styles.location}>
        <View style={styles.pin}>
          <NxIcon name="pin" size={19} color={nx.red} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.locationAddr}>{loc.address || '—'}</Text>
          <Text style={nxText.small}>{caption}</Text>
        </View>
      </View>
      <NxButton title={label} icon="pin" onPress={() => void Linking.openURL(mapsDirections(loc))} />
      <Text style={nxText.note}>Opens directions in Google Maps.</Text>
    </NxPanel>
  );

  let content: React.ReactNode;
  if (cancelled) {
    content = (
      <NxPanel>
        <NxBadge label="Cancelled by NESAM" tone="neutral" />
        <Text style={[nxText.heading, { marginTop: 16 }]}>Duty cancelled</Text>
        <Text style={[nxText.copy, { marginTop: 7 }]}>This duty is no longer assigned to you. Call the NESAM office if you have a question about it.</Text>
      </NxPanel>
    );
  } else if (finished) {
    const balance = trip.balanceDue;
    const paid = balance != null && balance <= 0;
    content = (
      <NxPanel>
        <View style={styles.successIcon}>
          <NxIcon name="check" size={26} color={nx.green} />
        </View>
        <Text style={nxText.heading}>Trip completed</Text>
        <Text style={[nxText.copy, { marginTop: 7 }]}>
          {placeName(trip.pickup.address)} → {placeName(trip.drop.address)}
        </Text>
        <View style={[styles.collection, paid && { backgroundColor: nx.greenSoft }]}>
          <Text style={[styles.collectionLabel, paid && { color: nx.green }]}>{paid ? 'Trip payment' : 'Balance with the customer'}</Text>
          <Text style={[styles.collectionValue, paid && { color: nx.green }]}>{balance == null ? 'Pending' : paid ? formatINR(0) : formatINR(balance)}</Text>
          <Text style={[nxText.small, paid && { color: nx.green }]}>
            {balance == null ? 'Payment details are being confirmed' : paid ? 'No additional trip payment due' : 'Collect from the customer and record it'}
          </Text>
        </View>
        {(trip.totalPaid ?? 0) > 0 ? <NxInfo style={{ marginTop: 4 }}>{formatINR(trip.totalPaid ?? 0)} paid so far</NxInfo> : null}
        <View style={{ marginTop: 10 }}>
          <NxRow label="Booked route" value={trip.distanceKm > 0 ? kmText(trip.distanceKm) : '—'} />
          {totalTolls > 0 || trip.tollCharges > 0 ? <NxRow label="Toll & parking receipts" value={formatINR(Math.max(totalTolls, trip.tollCharges))} /> : null}
          {!trip.fleetTrip ? <NxRow label="Your payout" value={payoutLabel(trip)} /> : null}
        </View>
        <NxInfo>Toll, parking & state tax are extra. The customer pays these separately against actual receipts.</NxInfo>
        <Text style={[nxText.small, { marginTop: 12 }]}>
          {trip.fleetTrip ? 'Your fleet operator settles your pay for this trip.' : 'Your earning is added to your wallet once NESAM verifies the fare.'}
        </Text>
      </NxPanel>
    );
  } else if (closing === 'form') {
    content = (
      <>
        <NxPanel>
          <SectionHead icon="distance" eyebrow="TRIP CLOSING" title="Enter trip distance" />
          <Text style={[nxText.copy, { marginTop: 9 }]}>Enter the total kilometres driven for the whole trip, add any toll receipts and record the payments you collected.</Text>
          <NxField
            label="Total running KM"
            value={totalKm}
            onChangeText={(t) => {
              setTotalKm(t.replace(/[^\d.]/g, '').slice(0, 7));
              setError('');
            }}
            keyboardType="decimal-pad"
            placeholder={trip.distanceKm ? String(Math.round(trip.distanceKm)) : ''}
            suffix="km"
            hint={`${trip.distanceKm > 0 ? `Booked route about ${Math.round(trip.distanceKm)} km. ` : ''}NESAM works out the fare from the rates booked.`}
          />
          <NxInfo>Toll, parking & state tax are extra. Record each toll with its receipt below; the customer pays them separately.</NxInfo>
        </NxPanel>

        <NxPanel>
          <SectionHead icon="document" eyebrow="RECEIPTS" title="Toll & parking" />
          {tolls.length === 0 ? <Text style={[nxText.copy, { marginTop: 9 }]}>No tolls added.</Text> : null}
          {tolls.map((t) => (
            <View key={t.id} style={styles.toll}>
              {t.receiptPhotoUrl ? <Image source={{ uri: t.receiptPhotoUrl }} style={styles.tollImg} accessibilityIgnoresInvertColors /> : null}
              <Text style={styles.tollName} numberOfLines={1}>
                {t.name}
              </Text>
              <Text style={styles.tollAmt}>{formatINR(t.amount)}</Text>
              <Pressable onPress={() => void removeToll(t.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${t.name}`}>
                <NxIcon name="trash" size={17} color={nx.muted} />
              </Pressable>
            </View>
          ))}
          {tolls.length ? <NxRow label="Total tolls" value={formatINR(totalTolls)} /> : null}
          <NxButton title="Add toll receipt" icon="plus" variant="secondary" onPress={() => setTollOpen(true)} style={{ marginTop: 14 }} />
          <Text style={nxText.note}>
            {trip.paymentMode === 'Cash'
              ? 'Cash trip: collect tolls with the fare from the customer. NESAM reimburses tolls only on non-cash trips.'
              : 'Reimbursed to your wallet once NESAM approves the receipts.'}
          </Text>
        </NxPanel>

        <NxPanel>
          <SectionHead icon="wallet" eyebrow="COLLECTIONS" title="Payment from the customer" />
          <Text style={[nxText.copy, { marginTop: 9 }]}>
            Balance still to be paid: <Text style={{ fontWeight: '800', color: nx.tripInk }}>{formatINR(toCollect)}</Text>. Record cash or other payments you receive; each one is kept with your name.
          </Text>
          <View style={styles.methods}>
            {METHODS.map((m) => (
              <Pressable key={m} style={[styles.method, payMethod === m && styles.methodOn]} onPress={() => setPayMethod(m)} accessibilityRole="radio" accessibilityState={{ selected: payMethod === m }}>
                <Text style={[styles.methodText, payMethod === m && { color: nx.white }]}>{m}</Text>
              </Pressable>
            ))}
          </View>
          <NxField label="Amount collected (₹)" value={payAmount} onChangeText={(t) => setPayAmount(t.replace(/[^\d.]/g, '').slice(0, 8))} keyboardType="decimal-pad" placeholder="0" />
          {payMethod !== 'Cash' ? <NxField label={payMethod === 'UPI' ? 'UPI transaction ID' : 'Transfer reference'} value={payRef} onChangeText={setPayRef} autoCapitalize="characters" /> : null}
          <NxButton title={busy ? 'Saving…' : 'Record payment'} variant="secondary" disabled={busy || toCollect <= 0} onPress={() => void collect()} style={{ marginTop: 16 }} />
        </NxPanel>

        <NxPanel>
          <NxFormError message={error} />
          <NxButton title="Review & Close" trailingIcon="arrow" onPress={goReview} />
          <NxButton title="Back to trip" variant="ghost" onPress={() => { setClosing('trip'); setError(''); }} style={{ marginTop: 6 }} />
        </NxPanel>
      </>
    );
  } else if (closing === 'review') {
    content = (
      <NxPanel>
        <NxBadge label="Distance confirmed" tone="green" icon="check" />
        <Text style={[nxText.heading, { marginTop: 15 }]}>Close this trip?</Text>
        <Text style={[nxText.copy, { marginTop: 7 }]}>Check the distance before closing your duty.</Text>
        <View style={{ marginTop: 14 }}>
          <NxRow label="Total running KM" value={`${km} km`} />
          {trip.distanceKm > 0 ? <NxRow label="Booked route" value={`about ${Math.round(trip.distanceKm)} km`} /> : null}
          {tolls.length ? <NxRow label="Toll & parking receipts" value={`${tolls.length} · ${formatINR(totalTolls)}`} /> : null}
          {!trip.fleetTrip ? <NxRow label="Your payout" value={payoutLabel(trip)} /> : null}
        </View>
        <NxInfo tone={toCollect > 0 ? 'amber' : 'neutral'}>{toCollect > 0 ? `${formatINR(toCollect)} still to be collected from the customer` : (trip.totalPaid ?? 0) > 0 ? 'Booking paid in full' : 'No balance due'}</NxInfo>
        <Text style={[nxText.small, { marginTop: 12 }]}>{trip.fleetTrip ? 'Your fleet operator settles your pay.' : 'Your payout is credited once NESAM verifies the fare.'}</Text>
        <NxFormError message={error} />
        <NxButton title={busy ? 'Closing…' : 'Confirm & Close'} trailingIcon="check" loading={busy} onPress={() => void endTrip()} style={{ marginTop: 16 }} />
        <NxButton title="Edit kilometres" variant="ghost" disabled={busy} onPress={() => setClosing('form')} style={{ marginTop: 6 }} />
      </NxPanel>
    );
  } else if (sub === 'Trip Started') {
    content = (
      <NxPanel>
        <View style={styles.statusLine}>
          <NxIcon name="check" size={15} color={nx.statusGreen} />
          <Text style={styles.statusText}>Customer on board · trip started</Text>
        </View>
        <Text style={[nxText.heading, { marginTop: 18 }]}>Trip in progress</Text>
        <Text style={[nxText.copy, { marginTop: 7 }]}>Have a safe journey to {placeName(trip.drop.address)}.</Text>
        <View style={styles.location}>
          <View style={styles.pin}>
            <NxIcon name="pin" size={19} color={nx.red} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.locationAddr}>{trip.drop.address || '—'}</Text>
            <Text style={nxText.small}>Customer’s drop location</Text>
          </View>
        </View>
        <NxButton title="Navigate to Drop" icon="pin" onPress={() => void Linking.openURL(mapsDirections(trip.drop))} />
        {trip.distanceKm > 0 ? <NxRow label="Trip estimate" value={kmText(trip.distanceKm)} /> : null}
        <NxSwipe
          key="end-trip"
          label="Slide to End Trip"
          onCommit={async () => {
            setError('');
            setClosing('form');
            return true;
          }}
        />
      </NxPanel>
    );
  } else if (sub === 'Reached Pickup') {
    const ready = trip.boardingVerified && trip.verificationSubmitted;
    content = (
      <>
        {!trip.boardingVerified ? (
          <NxPanel>
            <View style={styles.otpIcon}>
              <NxIcon name="shield" size={22} color={nx.tripRed} />
            </View>
            <Text style={nxText.heading}>Boarding OTP</Text>
            <Text style={[nxText.copy, { marginTop: 7 }]}>
              Ask {trip.customerName || 'the customer'} for the 4-digit OTP from their app or message after they board. Five wrong tries lock the check for 10 minutes.
            </Text>
            <Text style={styles.otpLabel}>Enter the 4-digit boarding OTP</Text>
            <View style={styles.otpWrap}>
              <NxOtpInput value={otp} onChange={(t) => { setOtp(t); setError(''); }} />
            </View>
            <NxFormError message={error} />
            <NxButton title={busy ? 'Verifying…' : 'Verify & Continue'} trailingIcon="arrow" loading={busy} disabled={otp.length !== 4} onPress={() => void checkOtp()} style={{ marginTop: 14 }} />
            <Text style={nxText.note}>The trip itself starts when you slide to start, after the OTP and vehicle photos are done.</Text>
          </NxPanel>
        ) : null}
        {!trip.verificationSubmitted ? photoChecks('Vehicle photos needed') : null}
        <NxPanel>
          {trip.boardingVerified ? (
            <View style={styles.statusLine}>
              <NxIcon name="check" size={15} color={nx.statusGreen} />
              <Text style={styles.statusText}>Customer on board · OTP verified</Text>
            </View>
          ) : null}
          <Text style={[nxText.heading, { marginTop: trip.boardingVerified ? 18 : 0 }]}>Start the trip</Text>
          <Text style={[nxText.copy, { marginTop: 7 }]}>Sliding to start records the real start of the customer’s journey.</Text>
          <View style={{ marginTop: 12 }}>
            <NxRow label="Boarding OTP" value={trip.boardingVerified ? 'Verified' : 'Needed'} />
            <NxRow label="Selfie & vehicle photos" value={trip.verificationSubmitted ? 'Submitted' : 'Needed'} />
          </View>
          {trip.boardingVerified ? <NxFormError message={error} /> : null}
          <NxSwipe key="start-trip" label="Slide to Start Trip" disabled={!ready} busy={busy} onCommit={startTrip} />
          {!ready ? <Text style={nxText.note}>Still needed: {blockers.join(' and ')}.</Text> : null}
        </NxPanel>
      </>
    );
  } else if (!trip.verificationSubmitted) {
    content = photoChecks('Before you start');
  } else {
    content = (
      <>
        <NxPanel>
          <NxBadge label="On the way to pickup" tone="green" icon="car" />
          <Text style={[nxText.heading, { marginTop: 15 }]}>Reached the location?</Text>
          <Text style={[nxText.copy, { marginTop: 7 }]}>Confirm when you arrive. GPS verification is disabled.</Text>
          <NxFormError message={error} />
          <NxSwipe key="mark-reached" label="Slide to Mark Reached" disabled={!arrival.open} busy={busy} onCommit={() => { acknowledgeAssignment(trip.id, 'acknowledged'); return reachedPickup(); }} />
          <Text style={nxText.note}>{arrivalNote || `Vehicle photos submitted · pickup ${placeName(trip.pickup.address)}`}</Text>
        </NxPanel>
        {navigationPanel(trip.pickup, 'Navigate to pickup', 'Navigate to Pickup', 'Customer’s pickup location')}
      </>
    );
  }

  const statusCard = cancellation && cancellation.status !== 'Approved' ? <CancellationStatus request={cancellation} /> : null;
  return (
    <NxScreen tabs={false}>
      <BackRow
        right={
          !finished && !cancelled ? (
            <Pressable
              style={styles.help}
              onPress={() => (sub === 'Not Started' ? setHelpOpen(true) : openSupport({ tripCode: trip.bookingId, started: true }))}
              accessibilityRole="button"
              accessibilityLabel={sub === 'Not Started' ? 'Help and call the NESAM office about this duty' : 'Trip help and call the NESAM office'}
            >
              <NxIcon name="help" size={16} color={nx.tripRed} />
              <Text style={styles.helpText}>{pendingCancel ? 'Request help' : sub === 'Not Started' ? (trip.fleetTrip ? 'Help / Call office' : 'Help / Request Cancellation') : 'Trip help / Call office'}</Text>
            </Pressable>
          ) : null
        }
      />
      <Text style={styles.meta}>
        {trip.bookingId}
        {trip.serviceType ? ` · ${trip.serviceType.toUpperCase()}` : ''}
      </Text>
      <Text style={nxText.routeTitle}>
        {placeName(trip.pickup.address)} → {placeName(trip.drop.address)}
      </Text>
      <View style={styles.dateRow}>
        <NxIcon name="calendar" size={13} color={nx.tripMuted} />
        <Text style={styles.dateText}>
          {when.date}
          {when.time ? ` · ${when.time} IST` : ''} · {tripStageLabel(trip)}
          {trip.paymentMode ? ` · ${trip.paymentMode}` : ''}
        </Text>
      </View>
      {trip.reachedPickupAt ? (
        <View style={[styles.dateRow, { marginTop: 3 }]}>
          <NxIcon name="clock" size={13} color={nx.tripMuted} />
          <Text style={styles.dateText}>Reached pickup {formatTime12(trip.reachedPickupAt)}</Text>
        </View>
      ) : null}
      {!cancelled ? (
        <View style={styles.progress} accessibilityRole="progressbar" accessibilityLabel="Trip progress" accessibilityValue={{ min: 0, max: 4, now: Math.min(phase, 4) }} accessibilityHint={SWIPE_HELP}>
          {labels.map((label, i) => {
            const state = phase >= 4 || i < phase ? 'done' : i === phase ? 'active' : 'waiting';
            return (
              <View key={label} style={[styles.progressItem, { borderTopColor: state === 'done' ? nx.green : state === 'active' ? nx.tripRed : '#E3E6EC' }]}>
                <Text style={[styles.progressText, state === 'done' && { color: nx.green }, state === 'active' && { color: nx.tripRed, fontWeight: '700' }]}>{label}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {wide && (customerCard || (closing === 'trip' && fareCard)) ? (
        // Wide screens: the working panels beside the customer and fare panels.
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 24 }}>
          <View style={{ flex: 1.45, minWidth: 0 }}>{statusCard}{pendingCancel ? null : content}</View>
          <View style={{ flex: 1, minWidth: 0 }}>
            {customerCard}
            {closing === 'trip' ? fareCard : null}
          </View>
        </View>
      ) : (
        <>
          {customerCard}
          {statusCard}
          {pendingCancel ? null : content}
          {closing === 'trip' ? fareCard : null}
        </>
      )}
      {error && closing === 'trip' && !(sub === 'Reached Pickup' || (sub === 'Not Started' && trip.verificationSubmitted)) ? <NxInfo tone="red" style={{ marginTop: 0 }}>{error}</NxInfo> : null}
      {/* Waiting / hill / roof carrier: once the trip is under way, until the office has approved it. */}
      {!cancelled && (trip.status === 'Ongoing' || trip.status === 'Completed') ? <ExtraUsageCard trip={trip} onDone={(m) => notify('ok', m)} /> : null}
      {finished ? (
        <NxButton title="Back to My Trips" trailingIcon="arrow" onPress={() => navigation.navigate('Tabs', { screen: 'Trip' })} />
      ) : null}

      <HelpCancellationDialog visible={helpOpen} onClose={() => setHelpOpen(false)} trip={trip} request={cancellation} policy={cancelPolicy} onDone={(m) => notify('ok', m)} />
      <TollDialog
        key={tollOpen ? 'open' : 'closed'}
        visible={tollOpen}
        trip={trip}
        onClose={() => setTollOpen(false)}
        onSaved={async (toll) => {
          const next = [...tolls, toll];
          await saveTripTolls(trip.id, next);
          setTolls(next);
          setTollOpen(false);
        }}
      />
    </NxScreen>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function SectionHead({ icon, eyebrow, title }: { icon: NxIconName; eyebrow: string; title: string }) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.pin}>
        <NxIcon name={icon} size={19} color={nx.red} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={nxText.eyebrow}>{eyebrow}</Text>
        <Text style={nxText.heading}>{title}</Text>
      </View>
    </View>
  );
}

/** Four-digit boarding code: one wide field, like the reference's big OTP box. */
function NxOtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 4))}
      keyboardType="number-pad"
      maxLength={4}
      placeholder="••••"
      placeholderTextColor="#B4BAC4"
      style={styles.otpInput}
      accessibilityLabel="Boarding OTP"
      autoComplete="one-time-code"
      textContentType="oneTimeCode"
    />
  );
}

/** The customer invoice the driver collects against: fare, what is already paid, what is left to collect. */
function FareCard({ trip, extras, toCollect }: { trip: TripDetails; extras: NonNullable<TripDetails['fareLines']>; toCollect: number }) {
  const [open, setOpen] = useState(false);
  return (
    <NxPanel>
      {trip.fleetTrip ? null : <NxRow label={`Your payout · ${payoutCaption(trip)}`} value={payoutLabel(trip)} />}
      <NxRow label="Customer fare" value={formatINR(trip.fareAmount)} />
      <NxRow label="Paid so far" value={formatINR(trip.totalPaid ?? 0)} />
      <NxRow label="Balance to collect" value={formatINR(toCollect)} valueStyle={toCollect > 0 ? { color: nx.red } : undefined} />
      {extras.length ? (
        <Text style={nxText.note}>Paid separately by the customer at actual cost: {extras.map((l) => `${l.label}${l.amount ? ` ${formatINR(l.amount)}` : ''}`).join(', ')}.</Text>
      ) : null}
      {trip.fareLines?.length ? (
        <>
          <Pressable style={styles.disclosure} onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
            <Text style={styles.disclosureText}>{open ? '▾ Hide fare breakup' : '▸ Fare breakup'}</Text>
          </Pressable>
          {open ? trip.fareLines.map((l) => <NxRow key={l.key} label={`${l.label}${l.detail ? ` — ${l.detail}` : ''} · ${TREATMENT[l.treatment] ?? ''}`} value={l.amount === null ? 'At actuals' : formatINR(l.amount)} />) : null}
        </>
      ) : null}
    </NxPanel>
  );
}

function TollDialog({ visible, trip, onClose, onSaved }: { visible: boolean; trip: TripDetails; onClose: () => void; onSaved: (t: TollReceipt) => Promise<void> }) {
  const [kind, setKind] = useState<'Toll' | 'Parking'>('Toll');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [photo, setPhoto] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const value = Number(amount);
    if (!name.trim()) return setError(`Enter the ${kind === 'Toll' ? 'toll plaza' : 'parking'} name.`);
    if (!(value > 0) || value > 10000) return setError('Enter a valid amount (up to ₹10,000).');
    if (!photo) return setError('Upload a photo of the receipt.');
    setSaving(true);
    setError('');
    try {
      await onSaved({ id: `TOLL-${Date.now()}`, name: `${kind}: ${name.trim()}`, amount: Math.round(value * 100) / 100, receiptPhotoUrl: photo, uploadedAt: new Date().toISOString() });
    } catch (e) {
      setError(describeError(e, 'Could not save the receipt.'));
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  return (
    <NxDialog visible={visible} onClose={onClose} eyebrow={trip.bookingId} title="Add toll / parking receipt" locked={saving || uploading}>
      <View style={styles.methods}>
        {(['Toll', 'Parking'] as const).map((k) => (
          <Pressable key={k} style={[styles.method, kind === k && styles.methodOn]} onPress={() => setKind(k)} accessibilityRole="radio" accessibilityState={{ selected: kind === k }}>
            <Text style={[styles.methodText, kind === k && { color: nx.white }]}>{k}</Text>
          </Pressable>
        ))}
      </View>
      <NxField label={kind === 'Toll' ? 'Toll plaza name' : 'Parking location'} value={name} onChangeText={setName} />
      <NxField label="Amount (₹)" value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d.]/g, '').slice(0, 7))} keyboardType="decimal-pad" />
      <View style={{ marginTop: 16 }}>
        <PhotoField label="Receipt photo" value={photo} folder={`trips/${trip.id}/tolls`} name={kind.toLowerCase()} required onBusyChange={setUploading} onChange={setPhoto} />
      </View>
      <NxFormError message={error} />
      <NxButton title={saving ? 'Saving…' : 'Save receipt'} trailingIcon="check" loading={saving} disabled={uploading} onPress={() => void save()} style={{ marginTop: 14 }} />
    </NxDialog>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginBottom: 6 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44 },
  backText: { fontSize: 14, color: nx.muted },
  help: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderColor: nx.line, backgroundColor: nx.white },
  helpText: { fontSize: 11, fontWeight: '700', color: nx.tripInk },
  meta: { fontSize: 11, letterSpacing: 0.3, color: nx.tripMuted, marginBottom: 5 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7 },
  dateText: { fontSize: 11, color: nx.tripMuted, flexShrink: 1 },
  progress: { flexDirection: 'row', gap: 7, marginTop: 18, marginBottom: 18 },
  progressItem: { flex: 1, borderTopWidth: 3, paddingTop: 8 },
  progressText: { fontSize: 11, color: nx.tripMuted },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  cardTitle: { fontSize: 13, fontWeight: '700', letterSpacing: -0.1, color: nx.tripInk },
  custRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  custIcon: { width: 28, alignItems: 'center' },
  custLabel: { fontSize: 11, color: nx.tripMuted, marginBottom: 4 },
  custValue: { fontSize: 13, fontWeight: '700', color: nx.tripInk },
  call: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 42, paddingHorizontal: 11, borderRadius: 9, backgroundColor: nx.redSoft },
  callText: { fontSize: 11, fontWeight: '700', color: nx.tripRed },
  unlock: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: nx.page, borderRadius: 11, padding: 12, marginTop: 10 },
  unlockTitle: { fontSize: 11.5, fontWeight: '600', color: nx.tripInk, marginBottom: 2 },
  pickupSummary: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 14, marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: nx.line },
  pickupAddr: { fontSize: 12.5, fontWeight: '600', color: nx.tripInk, marginTop: 2 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  thumb: { width: 48, height: 52, borderRadius: 10, backgroundColor: nx.page, alignItems: 'center', justifyContent: 'center' },
  checkStep: { fontSize: 9.5, letterSpacing: 0.8, color: nx.tripMuted },
  checkTitle: { fontSize: 12.5, fontWeight: '700', color: nx.tripInk, marginVertical: 2 },
  cameraOnly: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18 },
  location: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16 },
  pin: { width: 40, height: 40, borderRadius: 12, backgroundColor: nx.redSoft, alignItems: 'center', justifyContent: 'center' },
  locationAddr: { fontSize: 14, fontWeight: '700', color: nx.tripInk, marginBottom: 3 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: nx.statusBg, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12 },
  statusText: { flex: 1, fontSize: 11.5, fontWeight: '600', color: nx.statusGreen },
  successIcon: { width: 60, height: 60, borderRadius: 18, backgroundColor: nx.greenSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  collection: { alignItems: 'center', backgroundColor: nx.redSoft, borderRadius: 16, padding: 20, marginVertical: 16, gap: 6 },
  collectionLabel: { fontSize: 11.5, color: nx.red },
  collectionValue: { fontSize: 38, fontWeight: '800', letterSpacing: -1, color: nx.red },
  otpIcon: { width: 49, height: 49, borderRadius: 15, backgroundColor: nx.redSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  otpLabel: { fontSize: 12, color: nx.tripMuted, marginTop: 22 },
  otpWrap: { marginTop: 8 },
  otpInput: { minHeight: 69, borderWidth: 1, borderColor: nx.fieldLine, borderRadius: 12, textAlign: 'center', fontSize: 31, fontWeight: '700', letterSpacing: 12, color: nx.tripInk, paddingVertical: 12 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toll: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  tollImg: { width: 36, height: 36, borderRadius: 8 },
  tollName: { flex: 1, fontSize: 12.5, color: nx.tripInk },
  tollAmt: { fontSize: 12.5, fontWeight: '800', color: nx.tripInk },
  methods: { flexDirection: 'row', gap: 8, marginTop: 14 },
  method: { flex: 1, minHeight: 40, borderRadius: 9, borderWidth: 1, borderColor: nx.line, backgroundColor: nx.white, alignItems: 'center', justifyContent: 'center' },
  methodOn: { backgroundColor: nx.ink, borderColor: nx.ink },
  methodText: { fontSize: 11.5, fontWeight: '700', color: nx.muted },
  disclosure: { minHeight: 44, justifyContent: 'center' },
  disclosureText: { fontSize: 12, fontWeight: '700', color: nx.tripInk },
});
