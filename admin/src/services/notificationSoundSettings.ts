/**
 * Notification sounds shared by everyone (business_config/notification_sounds): the office alert sounds every computer
 * plays, and the tone each customer / driver / vendor notification event plays on the phones. Staff read it; only the
 * saveNotificationSounds function writes it (with a reason, a version check, a change history and the audit trail).
 */
import { subscribeToDocument } from "./adminFirestoreService";
import { callFunction } from "./callables";
import type { AppSound, SoundAudience, SoundEvent } from "../domain/notificationSoundEvents";
import type { SoundConfig } from "../utils/notificationSound";

export type AppSoundChoices = Partial<Record<SoundAudience, Partial<Record<SoundEvent, AppSound>>>>;

export interface SoundChangeRow { audience: string; event: string; label: string; field: string; from: string; to: string }
export interface SoundHistoryEntry { at?: { toDate?: () => Date }; byName?: string; byUid?: string; reason?: string; changes?: SoundChangeRow[] }

export interface NotificationSoundsDoc {
  version?: number;
  /** Only the choices that differ from each event's default. */
  apps?: AppSoundChoices;
  office?: unknown;
  history?: SoundHistoryEntry[];
  updatedByName?: string;
  updatedAt?: { toDate?: () => Date };
}

export const NOTIFICATION_SOUNDS_DOC = "business_config/notification_sounds";

export const subscribeNotificationSounds = (cb: (d: NotificationSoundsDoc | null) => void, onError?: (message: string) => void) =>
  subscribeToDocument<NotificationSoundsDoc>(NOTIFICATION_SOUNDS_DOC, cb, onError);

export interface SaveNotificationSoundsInput {
  expectedVersion: number;
  reason: string;
  /** The full choice of each app sent (events left out go back to their default). */
  apps?: AppSoundChoices;
  office?: SoundConfig;
}

export const saveNotificationSounds = (input: SaveNotificationSoundsInput) =>
  callFunction<SaveNotificationSoundsInput, { version: number; changes: number }>("saveNotificationSounds", input);
