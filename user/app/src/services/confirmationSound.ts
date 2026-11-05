// Optional chime after a new booking. On by default, switchable in Settings; the choice is
// kept on the device. Never throws: a missing audio device must not affect booking.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { playTone } from './notificationService';

const KEY = 'nesam.customer.confirmationSound';

export async function isConfirmationSoundOn(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) !== 'off';
  } catch {
    return true;
  }
}

export async function setConfirmationSound(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* not persisted; the switch still reflects this session */
  }
}

/** Plays the approval tone once when sound is on. */
export async function playConfirmationSound(force = false): Promise<void> {
  if (force || (await isConfirmationSoundOn())) playTone('approval', 1);
}
