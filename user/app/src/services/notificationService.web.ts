/**
 * Browser build of notificationService.ts.
 *
 * Push (FCM device tokens, Android channels) is a native feature. In a browser the
 * in-app popups still work — they are driven by Firestore listeners and play the
 * same three tones via playTone — so a signed-in tab is notified while it is open.
 * Background web push would need Firebase Cloud Messaging for Web (a VAPID key and
 * a service worker) and is not set up here.
 */
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import type { NotificationSound } from '../types/notifications';

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

export async function setupNotifications(): Promise<void> {
  /* nothing to create in a browser */
}

export type PushRegistration = 'registered' | 'denied' | 'unavailable';

export async function registerForPush(_uid: string, _role: 'driver' | 'vendor' | 'customer'): Promise<PushRegistration> {
  return 'unavailable';
}

const players: Partial<Record<NotificationSound, AudioPlayer>> = {};

/** Plays one of the three tones while the tab is open. Never throws (autoplay may be blocked until the first tap). */
export function playTone(tone: NotificationSound, times = 1): void {
  try {
    const player = (players[tone] ??= createAudioPlayer(TONE_FILES[tone]));
    for (let i = 0; i < times; i++) {
      setTimeout(() => {
        try {
          void player.seekTo(0);
          void Promise.resolve(player.play()).catch(() => undefined);
        } catch {
          /* a tone must never break the app */
        }
      }, i * 900);
    }
  } catch {
    /* audio unavailable */
  }
}

/** Push taps do not exist in the browser; returns a no-op unsubscribe. */
export function onPushOpened(_cb: (data: { page: string; bookingId: string }) => void): () => void {
  return () => undefined;
}
