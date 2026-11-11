/**
 * Push notifications. Three Android channels, each with its own tone (the same
 * three the web panels play): new booking, approval, general. The channel ids and
 * sound files match what the server sends (functions/src/notify.ts), and the
 * sounds are bundled into the app by the expo-notifications plugin.
 *
 * Registration stores this phone's FCM token in device_tokens (rules: a device may
 * create and delete only its own). While the app is open the in-app popups show
 * the notification and play the tone themselves, so the system banner is suppressed.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import type { NotificationSound } from '../types/driver';

export const CHANNELS: Record<NotificationSound, { id: string; name: string; sound: string; vibration: number[]; light: string }> = {
  new_booking: { id: 'nesam_new_booking', name: 'New bookings', sound: 'new_booking.wav', vibration: [0, 250, 150, 250, 150, 400], light: '#2563EB' },
  approval: { id: 'nesam_approval', name: 'Approvals', sound: 'approval.wav', vibration: [0, 200, 100, 200], light: '#16A34A' },
  general: { id: 'nesam_general', name: 'General', sound: 'general.wav', vibration: [0, 250], light: '#6B7280' },
};

const TONE_FILES: Record<NotificationSound, number> = {
  new_booking: require('../../assets/sounds/new_booking.wav') as number,
  approval: require('../../assets/sounds/approval.wav') as number,
  general: require('../../assets/sounds/general.wav') as number,
};

let handlerSet = false;

/** Creates the channels and installs the foreground handler. Safe to call more than once. */
export async function setupNotifications(): Promise<void> {
  if (!handlerSet) {
    handlerSet = true;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }),
    });
  }
  if (Platform.OS !== 'android') return;
  await Promise.all(
    (Object.keys(CHANNELS) as NotificationSound[]).map((k) =>
      Notifications.setNotificationChannelAsync(CHANNELS[k].id, {
        name: CHANNELS[k].name,
        importance: k === 'general' ? Notifications.AndroidImportance.DEFAULT : Notifications.AndroidImportance.HIGH,
        sound: CHANNELS[k].sound,
        vibrationPattern: CHANNELS[k].vibration,
        lightColor: CHANNELS[k].light,
        enableVibrate: true,
      }),
    ),
  );
}

/** Small stable hash so one device token maps to one document id. */
function tokenKey(token: string): string {
  let h = 5381;
  for (let i = 0; i < token.length; i++) h = ((h << 5) + h + token.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export type PushRegistration = 'registered' | 'denied' | 'unavailable';

/** Asks permission (once) and stores this device's push token for the signed-in user. */
export async function registerForPush(uid: string, role: 'driver' | 'vendor' | 'customer'): Promise<PushRegistration> {
  try {
    await setupNotifications();
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return 'denied';
    const t = await Notifications.getDevicePushTokenAsync();
    const token = typeof t.data === 'string' ? t.data : '';
    if (!token) return 'unavailable';
    try {
      await setDoc(doc(db, 'device_tokens', `${uid}_${tokenKey(token)}`), { ownerId: uid, token, platform: Platform.OS, role, createdAt: serverTimestamp() });
    } catch (err) {
      // Already registered (rules allow create only): nothing to do.
      if ((err as { code?: string }).code !== 'permission-denied') throw err;
    }
    return 'registered';
  } catch {
    return 'unavailable';
  }
}

const players: Partial<Record<NotificationSound, AudioPlayer>> = {};

/** Plays one of the three tones while the app is open. Never throws. */
export function playTone(tone: NotificationSound, times = 1): void {
  try {
    const player = (players[tone] ??= createAudioPlayer(TONE_FILES[tone]));
    for (let i = 0; i < times; i++) {
      setTimeout(() => {
        try {
          void player.seekTo(0);
          player.play();
        } catch {
          /* a tone must never break the app */
        }
      }, i * 900);
    }
  } catch {
    /* audio unavailable */
  }
}

/** Calls back with the page a tapped push points to. Returns an unsubscribe. */
export function onPushOpened(cb: (data: { page: string; bookingId: string }) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    const d = r.notification.request.content.data as Record<string, unknown>;
    cb({ page: typeof d.page === 'string' ? d.page : '', bookingId: typeof d.bookingId === 'string' ? d.bookingId : '' });
  });
  return () => sub.remove();
}
