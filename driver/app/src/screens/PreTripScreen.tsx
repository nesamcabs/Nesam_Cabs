// Mandatory evidence before the driver heads to the pickup: a live selfie of the driver plus the vehicle front, rear and
// dashboard/interior, all taken with the in-app camera. There is no gallery picker. For every photo the server issues a
// random instruction and code; the photo is uploaded to the path it names and checked there. A retake is a new
// instruction and a new upload. (Reference "Trip checks" / camera pages; the server session flow is unchanged.)
import React, { useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/nx/Text';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useDriverData } from '../context/DriverData';
import { NxScreen } from '../components/nx/Shell';
import { NxIcon, NxIconName } from '../components/nx/Icon';
import { NxButton, NxEmpty, NxField, NxFormError, NxInfo, NxPanel, nxText } from '../components/nx/primitives';
import { ActionError } from '../services/callables';
import { getCurrentPosition } from '../services/locationService';
import {
  SLOTS,
  createCaptureSession,
  finalizeVehicleVerification,
  getSlotChallenge,
  submitCapturePhoto,
  uploadCapture,
  type CaptureSession,
  type Challenge,
  type Slot,
} from '../services/verificationService';
import { describeError } from '../utils/retry';
import { nx } from '../theme/nx';

type Props = NativeStackScreenProps<RootStackParamList, 'PreTrip'>;

const message = (e: unknown, fallback: string) => (e instanceof ActionError ? e.message : describeError(e, fallback));
const SLOT_ICON: Record<Slot, NxIconName> = { selfie: 'user', front: 'car', rear: 'car', interior: 'car' };
const SUBJECT: Record<Slot, string> = { selfie: 'selfie', front: 'vehicle front', rear: 'vehicle rear', interior: 'dashboard' };

function BackToTrip({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={styles.back} onPress={onPress} accessibilityRole="button" accessibilityLabel="Back to the trip">
      <NxIcon name="back" size={16} color={nx.muted} />
      <Text style={styles.backText}>Trip</Text>
    </Pressable>
  );
}

export function PreTripScreen({ route, navigation }: Props) {
  const { bookings } = useDriverData();
  const found = bookings.find((b) => b.id === route.params.bookingId);
  const trip = found && (found.status === 'Assigned' || found.status === 'Ongoing') ? found : null;
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [photos, setPhotos] = useState<Partial<Record<Slot, string>>>({});
  const [reading, setReading] = useState('');
  const [capturing, setCapturing] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toTrip = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Tabs', { screen: 'Trip' }));

  // The evidence is taken first; the trip can only move on to Navigate / Reached Pickup once it is accepted.
  if (!trip || (trip.subStatus !== 'Not Started' && trip.subStatus !== 'Reached Pickup')) {
    return (
      <NxScreen tabs={false}>
        <BackToTrip onPress={toTrip} />
        <NxEmpty
          icon="trip"
          title={trip ? 'Trip already started' : 'This trip is no longer assigned to you'}
          message={trip ? 'Continue the trip from My Trips.' : 'It may have been cancelled or reassigned.'}
          action={<NxButton title="Go to trip" onPress={() => (trip ? navigation.navigate('TripFlow', { bookingId: trip.id }) : navigation.navigate('Tabs', { screen: 'Home' }))} />}
        />
      </NxScreen>
    );
  }
  if (trip.verificationSubmitted) {
    return (
      <NxScreen tabs={false}>
        <BackToTrip onPress={toTrip} />
        <NxEmpty
          icon="check"
          title="Vehicle verification submitted"
          message="Your photos were sent to NESAM. Continue the trip from My Trips."
          action={<NxButton title="Go to trip" onPress={() => navigation.navigate('TripFlow', { bookingId: trip.id })} />}
        />
      </NxScreen>
    );
  }

  const allTaken = SLOTS.every((s) => photos[s.slot]);
  const readingNum = Number(reading);

  const start = async () => {
    setError('');
    setBusy(true);
    try {
      setSession(await createCaptureSession(trip.id));
      setPhotos({});
    } catch (e) {
      setError(message(e, 'Could not start the verification.'));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!session) return;
    if (!allTaken) return setError('Take all four photos first.');
    if (!(readingNum > 0)) return setError('Enter the starting odometer reading.');
    setError('');
    setBusy(true);
    try {
      await finalizeVehicleVerification(session.sessionId, readingNum);
      navigation.navigate('TripFlow', { bookingId: trip.id });
    } catch (e) {
      setError(message(e, 'Could not submit the verification.'));
      setBusy(false);
    }
    return undefined;
  };

  const capturingIndex = capturing ? SLOTS.findIndex((s) => s.slot === capturing) : -1;

  return (
    <NxScreen tabs={false}>
      <BackToTrip onPress={toTrip} />
      <Text style={styles.meta}>{trip.bookingId}</Text>
      <Text style={nxText.routeTitle}>Vehicle photo check</Text>
      <Text style={[nxText.copy, { marginTop: 8 }]}>
        Take your live selfie and the vehicle photos, one at a time, then enter the starting odometer reading. This safety check is required before the trip can start.
      </Text>
      <NxInfo tone="amber">Take each photo now with the camera, following the instruction shown. Photos from the gallery or screenshots are not accepted, and every photo is checked by NESAM.</NxInfo>

      <NxPanel style={{ marginTop: 18 }}>
        {SLOTS.map((s, i) => (
          <View style={styles.check} key={s.slot}>
            <View style={styles.thumb}>
              {photos[s.slot] ? <Image source={{ uri: photos[s.slot] }} style={styles.thumbImg} accessibilityLabel={`${s.label} photo`} /> : <NxIcon name={SLOT_ICON[s.slot]} size={20} color={nx.muted} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.step}>STEP {i + 1}</Text>
              <Text style={styles.title}>{s.label}</Text>
              <Text style={[nxText.small, photos[s.slot] && { color: nx.green }]}>{photos[s.slot] ? 'Captured live' : s.hint}</Text>
            </View>
            {session ? (
              <Pressable
                style={[styles.action, busy && { opacity: 0.4 }]}
                disabled={busy}
                onPress={() => {
                  setError('');
                  setCapturing(s.slot);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${photos[s.slot] ? 'Retake' : 'Take'} ${s.label} photo`}
              >
                <Text style={styles.actionText}>{photos[s.slot] ? 'Retake' : 'Take photo'}</Text>
                <NxIcon name={photos[s.slot] ? 'refresh' : 'camera'} size={14} color={nx.red} />
              </Pressable>
            ) : null}
          </View>
        ))}

        {!session ? (
          <>
            <Text style={[nxText.copy, { marginTop: 16 }]}>
              For each photo the app shows a short instruction and a 4-digit code that expire after a few minutes. Take the photo straight away.
            </Text>
            <NxFormError message={error} />
            <NxButton title={busy ? 'Starting…' : 'Start photo check'} icon="camera" loading={busy} onPress={() => void start()} style={{ marginTop: 16 }} />
          </>
        ) : (
          <>
            <NxField
              label="Starting odometer reading"
              value={reading}
              onChangeText={(t) => setReading(t.replace(/\D/g, '').slice(0, 7))}
              keyboardType="number-pad"
              placeholder="e.g. 48210"
              suffix="km"
              hint="Read it from the dashboard photo you just took."
            />
            <Text style={[nxText.small, { marginTop: 10 }]}>
              Photos captured: {Object.keys(photos).length} of {SLOTS.length}
            </Text>
            <NxFormError message={error} />
            <NxButton title={busy ? 'Submitting…' : 'Submit verification'} trailingIcon="check" loading={busy} disabled={!allTaken || !(readingNum > 0)} onPress={() => void finish()} style={{ marginTop: 14 }} />
          </>
        )}
        <View style={styles.cameraOnly}>
          <NxIcon name="shield" size={13} color={nx.muted} />
          <Text style={nxText.small}>Camera only · No gallery upload</Text>
        </View>
      </NxPanel>

      {session && capturing ? (
        <CaptureModal
          key={capturing}
          session={session}
          slot={capturing}
          index={capturingIndex}
          onClose={() => setCapturing(null)}
          onDone={(slot, uri) => {
            setPhotos((p) => ({ ...p, [slot]: uri }));
            setCapturing(null);
          }}
        />
      ) : null}
    </NxScreen>
  );
}

function CaptureModal({ session, slot, index, onClose, onDone }: { session: CaptureSession; slot: Slot; index: number; onClose: () => void; onDone: (slot: Slot, uri: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const selfie = slot === 'selfie';
  const label = SLOTS.find((s) => s.slot === slot)!;

  const loadChallenge = async () => {
    setError('');
    try {
      const c = await getSlotChallenge(session.sessionId, slot);
      setChallenge(c);
    } catch (e) {
      setError(message(e, 'Could not get the instruction for this photo.'));
    }
  };

  useEffect(() => {
    if (!permission?.granted) return undefined;
    let alive = true;
    getSlotChallenge(session.sessionId, slot)
      .then((c) => alive && setChallenge(c))
      .catch((e) => alive && setError(message(e, 'Could not get the instruction for this photo.')));
    return () => {
      alive = false;
    };
  }, [permission?.granted, session.sessionId, slot]);

  useEffect(() => {
    if (!challenge) return undefined;
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((challenge.expiresAtMs - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [challenge]);

  const expired = !!challenge && secondsLeft === 0;

  const shoot = async () => {
    if (!challenge || !camera.current || busy || expired) return;
    setError('');
    setBusy(true);
    try {
      setStatus('Taking photo…');
      const pic = await camera.current.takePictureAsync({ quality: 0.7, skipProcessing: false, shutterSound: false });
      const capturedAt = Date.now();
      setStatus('Uploading…');
      await uploadCapture(challenge, session.sessionId, pic.uri);
      setStatus('Checking…');
      const here = await getCurrentPosition(6000).catch(() => null);
      await submitCapturePhoto({
        sessionId: session.sessionId,
        slot,
        storagePath: challenge.storagePath,
        capturedAt,
        gps: here ? { lat: here.lat, lng: here.lng, accuracy: here.accuracy } : null,
      });
      onDone(slot, pic.uri);
    } catch (e) {
      setError(message(e, 'That photo could not be sent. Please take it again.'));
      // The instruction is single-use: a retry needs a fresh one.
      setChallenge(null);
      void loadChallenge();
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={() => !busy && onClose()}>
      <SafeAreaView style={styles.modal}>
        <View style={styles.modalBody}>
          <Pressable style={styles.back} onPress={onClose} disabled={busy} accessibilityRole="button" accessibilityLabel="Close camera">
            <NxIcon name="back" size={16} color={nx.muted} />
            <Text style={styles.backText}>Trip checks</Text>
          </Pressable>
          <View style={styles.top}>
            <Text style={nxText.eyebrow}>
              STEP {index + 1} OF {SLOTS.length}
            </Text>
            <View style={styles.live}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>Live camera</Text>
            </View>
          </View>
          <Text style={nxText.routeTitle}>{selfie ? 'Take a live selfie' : `Capture ${SUBJECT[slot]}`}</Text>
          <Text style={[nxText.copy, { marginTop: 8 }]}>{label.hint}</Text>

          {!permission ? null : !permission.granted ? (
            <View style={styles.permission}>
              <NxIcon name="camera" size={34} color={nx.muted} />
              <Text style={[nxText.copy, { textAlign: 'center' }]}>NESAM Driver needs the camera to take your selfie and the vehicle photos.</Text>
              <NxButton title={permission.canAskAgain ? 'Allow camera' : 'Camera is blocked in Settings'} disabled={!permission.canAskAgain} onPress={() => void requestPermission()} />
            </View>
          ) : (
            <>
              <View style={[styles.frame, selfie ? styles.frameSelfie : styles.frameCar]}>
                <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={selfie ? 'front' : 'back'} mode="picture" onCameraReady={() => setReady(true)} />
                <View style={[styles.guide, selfie ? styles.guideSelfie : styles.guideCar]} pointerEvents="none" />
                {challenge ? (
                  <View style={styles.codeBox} pointerEvents="none">
                    <Text style={styles.code}>{challenge.code}</Text>
                  </View>
                ) : null}
              </View>
              {challenge ? (
                <Text style={styles.instruction}>
                  {challenge.instruction} · {expired ? 'Instruction expired' : `${secondsLeft}s left`}
                </Text>
              ) : (
                <Text style={styles.instruction}>Getting your instruction…</Text>
              )}
              <NxFormError message={error} />
              {status ? <Text style={[nxText.small, { textAlign: 'center' }]}>{status}</Text> : null}
              {expired || (!challenge && error) ? (
                <NxButton title="Get a new instruction" variant="secondary" onPress={() => void loadChallenge()} style={{ marginTop: 14 }} />
              ) : (
                <NxButton title={busy ? status || 'Working…' : `Capture ${SUBJECT[slot]}`} icon="camera" disabled={!ready || !challenge} loading={busy} onPress={() => void shoot()} style={{ marginTop: 14 }} />
              )}
            </>
          )}
          <View style={styles.cameraOnly}>
            <NxIcon name="shield" size={13} color={nx.muted} />
            <Text style={nxText.small}>Camera only · No gallery upload</Text>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, alignSelf: 'flex-start' },
  backText: { fontSize: 14, color: nx.muted },
  meta: { fontSize: 11, letterSpacing: 0.3, color: nx.tripMuted, marginBottom: 5 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  thumb: { width: 48, height: 52, borderRadius: 10, backgroundColor: nx.page, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImg: { width: '100%', height: '100%' },
  step: { fontSize: 9.5, letterSpacing: 0.8, color: nx.tripMuted },
  title: { fontSize: 12.5, fontWeight: '700', color: nx.tripInk, marginVertical: 2 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingLeft: 5 },
  actionText: { fontSize: 11, fontWeight: '700', color: nx.red },
  cameraOnly: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18 },
  modal: { flex: 1, backgroundColor: nx.page },
  modalBody: { flex: 1, paddingHorizontal: 17, paddingTop: 8, paddingBottom: 16 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, marginTop: 4 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: nx.statusBg, borderRadius: 14, paddingVertical: 5, paddingHorizontal: 10 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: nx.statusGreen },
  liveText: { fontSize: 10.5, fontWeight: '700', color: nx.statusGreen },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 20 },
  frame: { width: '100%', backgroundColor: '#192025', borderRadius: 18, overflow: 'hidden', marginTop: 19, marginBottom: 12 },
  frameSelfie: { aspectRatio: 4 / 5, maxHeight: '58%' },
  frameCar: { aspectRatio: 4 / 3 },
  guide: { position: 'absolute', borderWidth: 2, borderColor: 'rgba(246,247,249,0.66)' },
  guideSelfie: { top: '12%', bottom: '12%', left: '18%', right: '18%', borderRadius: 200 },
  guideCar: { top: '19%', bottom: '19%', left: '8%', right: '8%', borderRadius: 12 },
  codeBox: { position: 'absolute', top: 12, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 10 },
  code: { color: '#FDE047', fontSize: 26, fontWeight: '900', letterSpacing: 4 },
  instruction: { fontSize: 12, lineHeight: 19, color: nx.tripInk, textAlign: 'center', fontWeight: '600' },
});
