// Safety centre (port of user/web SafetyCenterModal.tsx).
// Uses the configured support number (the Web modal had a stale hard-coded one).
import React, { useState } from 'react';
import { Linking, Share, StyleSheet, Text, View } from 'react-native';
import type { LatLng, TripRecord, UserProfile } from '../types';
import { raiseSos } from '../services/rideService';
import { getCurrentPosition } from '../services/geoService';
import { EMERGENCY_NUMBER, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config/constants';
import { googleMapsLink, isValidLatLng } from '../utils/geo';
import { formatPhone, localMobile } from '../utils/format';
import { describeError } from '../utils/retry';
import { Button, Notice, Sheet } from './ui';
import { space, type } from '../theme';

export function buildTripShareText(trip: TripRecord, where: LatLng | null): string {
  const d = trip.driver;
  const lines = [`I'm on a NESAM Cabs ride (booking ${trip.bookingId}).`, `From: ${trip.pickup.name}`, `To: ${trip.drop.name}`];
  if (d) {
    lines.push(`Driver: ${d.name}${d.phone ? ` (${formatPhone(d.phone)})` : ''}`);
    lines.push(`Vehicle: ${[d.vehicleModel, d.vehicleNumber].filter(Boolean).join(' · ') || trip.categoryName}`);
  }
  if (where && isValidLatLng(where)) lines.push(`Current location: ${googleMapsLink(where)}`);
  return lines.join('\n');
}

export async function shareTrip(trip: TripRecord, where: LatLng | null): Promise<void> {
  await Share.share({ title: `NESAM ride ${trip.bookingId}`, message: buildTripShareText(trip, where) });
}

export function SafetySheet({
  visible,
  onClose,
  trip,
  profile,
  location,
}: {
  visible: boolean;
  onClose: () => void;
  trip: TripRecord;
  profile: UserProfile;
  location: LatLng | null;
}) {
  const [alerting, setAlerting] = useState(false);
  const [state, setState] = useState<'idle' | 'sent' | 'failed'>('idle');
  const [error, setError] = useState('');
  const emergencyLocal = localMobile(profile.emergencyContact);

  const sendAlert = async () => {
    setAlerting(true);
    setError('');
    try {
      const where = location ?? (await getCurrentPosition(8000).catch(() => null));
      await raiseSos(trip, profile, where);
      setState('sent');
    } catch (e) {
      setState('failed');
      setError(`${describeError(e, 'The alert could not be sent.')} Call ${EMERGENCY_NUMBER} or NESAM support now.`);
    } finally {
      setAlerting(false);
    }
  };

  const sms = () => {
    const body = encodeURIComponent(`EMERGENCY — I need help.\n${buildTripShareText(trip, location)}`);
    void Linking.openURL(`sms:+91${emergencyLocal}?body=${body}`);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Safety centre">
      <Button title={`Call emergency (${EMERGENCY_NUMBER})`} variant="danger" onPress={() => void Linking.openURL(`tel:${EMERGENCY_NUMBER}`)} />
      <Button title={`Call NESAM support (${SUPPORT_PHONE_DISPLAY})`} variant="secondary" onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} style={styles.gap} />
      {emergencyLocal ? (
        <Button title={`Text emergency contact (${formatPhone(emergencyLocal)})`} variant="secondary" onPress={sms} style={styles.gap} />
      ) : null}
      <Button title="Share trip details" variant="secondary" onPress={() => void shareTrip(trip, location)} style={styles.gap} />
      <View style={styles.alertBox}>
        <Text style={type.h3}>Alert NESAM safety team</Text>
        <Text style={[type.small, { marginVertical: space.sm }]}>Sends your booking, driver, vehicle and location to NESAM operations.</Text>
        {state === 'sent' ? <Notice tone="success" message="Alert sent. The NESAM team has your trip and location." /> : null}
        <Notice message={error} />
        <Button title={alerting ? 'Sending…' : state === 'sent' ? 'Send again' : 'Send SOS alert'} variant="dark" loading={alerting} onPress={() => void sendAlert()} />
      </View>
      {trip.driver ? (
        <Text style={[type.small, styles.gap]}>
          Your ride: {trip.driver.name} · {trip.driver.vehicleNumber || trip.categoryName} · Booking {trip.bookingId}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: space.sm },
  alertBox: { marginTop: space.lg, paddingTop: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E7EB' },
});
