// Notification sounds the office chooses in the admin panel (header → Notification sounds), kept in
// business_config/notification_sounds. Pure: no Firestore, no imports, so the rules are unit-tested and the admin
// panel keeps an exact copy of the catalogue (admin/src/domain/notificationSoundEvents.ts; a test fails when they differ).
//
//   Customer / Driver / Vendor tabs — which of the three app tones a notification event plays. The customer, driver and
//   vendor apps have one Android channel per tone and bundle the three .wav files, so the server picks a tone by
//   sending that channel (and that file for iOS). An event the office never changed keeps the sound it always had: the
//   call site's own `sound`. Only choices that differ from the default are stored.
//   Office tab — the admin panel's own alert sounds (tone, volume, on / off, repeat), shared by every computer.

export type AppSound = 'new_booking' | 'approval' | 'general';
export const APP_SOUNDS: readonly AppSound[] = ['new_booking', 'approval', 'general'];
export const APP_SOUND_LABEL: Readonly<Record<AppSound, string>> = { new_booking: 'New booking', approval: 'Approval', general: 'General' };
export const isAppSound = (v: unknown): v is AppSound => typeof v === 'string' && (APP_SOUNDS as readonly string[]).includes(v);

export type SoundAudience = 'customer' | 'driver' | 'vendor';
export const SOUND_AUDIENCES: readonly SoundAudience[] = ['customer', 'driver', 'vendor'];

/** The event a notification is, set on the call site (NotifyInput.event). The same key can be listed for several audiences. */
export type SoundEvent =
  | 'booking_received' | 'booking_approved' | 'driver_assigned' | 'trip_started' | 'trip_completed' | 'cancelled' | 'payment' | 'offers'
  | 'new_duty' | 'bid_selected' | 'reassigned' | 'penalty' | 'documents_approved' | 'driver_request';

export interface SoundEventInfo {
  key: SoundEvent;
  label: string;
  /** The sound the server has always used for it (every call site of the event uses this one). */
  defaultSound: AppSound;
  /** false: the server sends no such notification yet, so there is nothing to set. */
  sent: boolean;
  /** Which notifications it covers, in the office's words. */
  covers: string;
}

export const SOUND_EVENTS: Readonly<Record<SoundAudience, readonly SoundEventInfo[]>> = {
  customer: [
    { key: 'booking_received', label: 'Booking received', defaultSound: 'approval', sent: true, covers: '"Booking confirmed" when the customer books, or once their online payment is received' },
    { key: 'booking_approved', label: 'Booking approved', defaultSound: 'approval', sent: true, covers: '"Booking approved" by the office' },
    { key: 'driver_assigned', label: 'Driver assigned', defaultSound: 'approval', sent: true, covers: '"Driver assigned", "Your driver has changed" and "Your booking is with a NESAM partner"' },
    { key: 'trip_started', label: 'Trip started', defaultSound: 'general', sent: true, covers: '"Your trip has started"' },
    { key: 'trip_completed', label: 'Trip completed', defaultSound: 'general', sent: true, covers: '"Trip completed" by the driver or closed by the office' },
    { key: 'cancelled', label: 'Cancelled', defaultSound: 'general', sent: true, covers: '"Booking cancelled" by the office' },
    { key: 'payment', label: 'Payment', defaultSound: 'general', sent: true, covers: 'Refund updates ("Refund processing", "Refund completed" …)' },
    { key: 'offers', label: 'Offers', defaultSound: 'general', sent: true, covers: 'Notices sent to customers from Communication → Send notification' },
  ],
  driver: [
    { key: 'new_duty', label: 'New duty', defaultSound: 'new_booking', sent: true, covers: '"Trip assigned to you", "New trip available" and "Round trip request approved"' },
    { key: 'bid_selected', label: 'Bid selected', defaultSound: 'approval', sent: true, covers: '"Your bid was accepted"' },
    { key: 'cancelled', label: 'Trip cancelled', defaultSound: 'general', sent: true, covers: '"Trip cancelled" by NESAM' },
    { key: 'reassigned', label: 'Trip reassigned', defaultSound: 'general', sent: true, covers: '"Trip reassigned" and "Trip removed from you"' },
    { key: 'penalty', label: 'Penalty', defaultSound: 'general', sent: true, covers: '"Penalty issued" and later penalty decisions' },
    { key: 'payment', label: 'Payment / payout', defaultSound: 'general', sent: false, covers: 'No payment or payout notification is sent to drivers yet' },
    { key: 'documents_approved', label: 'Documents approved', defaultSound: 'approval', sent: true, covers: 'Staff approvals ("Account approved", "Account reactivated")' },
  ],
  vendor: [
    { key: 'new_duty', label: 'New duty', defaultSound: 'new_booking', sent: true, covers: '"Trip assigned to your fleet", "Trip assigned to <driver>" and "New trip available"' },
    { key: 'bid_selected', label: 'Bid selected', defaultSound: 'approval', sent: true, covers: '"Your bid was accepted"' },
    { key: 'driver_request', label: 'Driver request', defaultSound: 'general', sent: true, covers: '"Driver requests a round trip"' },
    { key: 'cancelled', label: 'Cancelled', defaultSound: 'general', sent: true, covers: '"Trip cancelled" by NESAM' },
    { key: 'penalty', label: 'Penalty', defaultSound: 'general', sent: true, covers: '"Penalty issued" and later penalty decisions' },
    { key: 'payment', label: 'Payment', defaultSound: 'general', sent: false, covers: 'No payment or payout notification is sent to vendors yet' },
    { key: 'documents_approved', label: 'Documents approved', defaultSound: 'approval', sent: true, covers: 'Staff approvals ("Account approved", "Account reactivated")' },
  ],
};

export const eventInfo = (audience: string, event: string): SoundEventInfo | undefined =>
  (SOUND_EVENTS as Record<string, readonly SoundEventInfo[] | undefined>)[audience]?.find((e) => e.key === event);

/** The office's choices that differ from the defaults, by audience then event. */
export type SoundOverrides = Partial<Record<SoundAudience, Partial<Record<SoundEvent, AppSound>>>>;

/** The stored choices, keeping only real events of each audience that the server sends, with a known sound that is not the default. */
export function cleanOverrides(raw: unknown): SoundOverrides {
  const out: SoundOverrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const audience of SOUND_AUDIENCES) {
    const row = (raw as Record<string, unknown>)[audience];
    if (!row || typeof row !== 'object') continue;
    const kept: Partial<Record<SoundEvent, AppSound>> = {};
    for (const info of SOUND_EVENTS[audience]) {
      const v = (row as Record<string, unknown>)[info.key];
      if (info.sent && isAppSound(v) && v !== info.defaultSound) kept[info.key] = v;
    }
    if (Object.keys(kept).length) out[audience] = kept;
  }
  return out;
}

/**
 * The sound a notification plays: the office's choice for its audience and event, else the call site's own sound
 * (exactly what it played before the setting existed). The office inbox and notifications without an event never change.
 */
export function resolveSound(n: { recipientType: string; event?: string; sound?: AppSound }, overrides: SoundOverrides | null | undefined): AppSound {
  const fallback: AppSound = isAppSound(n.sound) ? n.sound : 'general';
  if (!n.event || !overrides) return fallback;
  const info = eventInfo(n.recipientType, n.event);
  if (!info?.sent) return fallback;
  const chosen = overrides[n.recipientType as SoundAudience]?.[info.key];
  return isAppSound(chosen) ? chosen : fallback;
}

// ── Office alert sounds (the admin panel's own alerts; same values as admin/src/utils/notificationSound.ts) ──

export const OFFICE_ALERTS = ['New booking', 'Urgent booking', 'Unassigned booking', 'Follow-up reminder'] as const;
export type OfficeAlertKind = (typeof OFFICE_ALERTS)[number];
export const OFFICE_TONES = ['Clean Bell', 'Double Bell', 'Classic Ring', 'Quick Ring', 'Soft Chime'] as const;
export const OFFICE_REPEATS = ['Once only', 'Every 30 sec', 'Every 1 min', 'Every 2 min', 'Every 5 min', 'Every 10 min'] as const;
export interface OfficeAlert { tone: string; volume: number; on: boolean; repeat: string }
export type OfficeSounds = Record<OfficeAlertKind, OfficeAlert>;
export const OFFICE_DEFAULTS: Readonly<OfficeSounds> = {
  'New booking': { tone: 'Clean Bell', volume: 80, on: true, repeat: 'Once only' },
  'Urgent booking': { tone: 'Classic Ring', volume: 80, on: true, repeat: 'Every 1 min' },
  'Unassigned booking': { tone: 'Double Bell', volume: 80, on: true, repeat: 'Every 5 min' },
  'Follow-up reminder': { tone: 'Soft Chime', volume: 80, on: true, repeat: 'Once only' },
};
/** An uploaded sound lives in one browser only ("custom:<id>"); other computers play the alert's default tone. */
const CUSTOM_TONE = /^custom:[A-Za-z0-9_-]{1,40}$/;

export class SoundSettingsError extends Error {}

function officeAlert(kind: OfficeAlertKind, raw: unknown): OfficeAlert {
  if (!raw || typeof raw !== 'object') throw new SoundSettingsError(`Set the ${kind} alert sound.`);
  const v = raw as Record<string, unknown>;
  const tone = typeof v.tone === 'string' ? v.tone.trim() : '';
  if (!(OFFICE_TONES as readonly string[]).includes(tone) && !CUSTOM_TONE.test(tone)) throw new SoundSettingsError(`${kind}: choose one of the preset tones or an uploaded sound.`);
  const volume = v.volume;
  if (typeof volume !== 'number' || !Number.isInteger(volume) || volume < 0 || volume > 100) throw new SoundSettingsError(`${kind}: the volume must be a whole number from 0 to 100.`);
  if (typeof v.on !== 'boolean') throw new SoundSettingsError(`${kind}: choose whether the alert is on or off.`);
  const repeat = typeof v.repeat === 'string' ? v.repeat : '';
  if (!(OFFICE_REPEATS as readonly string[]).includes(repeat)) throw new SoundSettingsError(`${kind}: choose how often the alert repeats.`);
  return { tone, volume, on: v.on, repeat };
}

/** A stored office setting as the alerts read it: each alert merged over its default, so a damaged field never loses the others. */
export function cleanOffice(raw: unknown): OfficeSounds | null {
  if (!raw || typeof raw !== 'object') return null;
  const out = {} as OfficeSounds;
  for (const kind of OFFICE_ALERTS) {
    try { out[kind] = officeAlert(kind, (raw as Record<string, unknown>)[kind]); } catch { out[kind] = { ...OFFICE_DEFAULTS[kind] }; }
  }
  return out;
}

export interface SoundChange {
  audience: 'office' | SoundAudience;
  event: string;
  label: string;
  /** Office alerts: which setting changed. App events: always 'sound'. */
  field: 'sound' | 'tone' | 'volume' | 'on' | 'repeat';
  from: string;
  to: string;
}

const officeText = (field: keyof OfficeAlert, v: OfficeAlert[keyof OfficeAlert]) =>
  field === 'on' ? (v ? 'On' : 'Off') : field === 'volume' ? `${v}%` : field === 'tone' && String(v).startsWith('custom:') ? 'Uploaded sound' : String(v);

/**
 * Checks a save and works out what it changes. `input.apps` (optional) is the full choice for each audience it names (an
 * event left out goes back to its default); `input.office` (optional) is the full office setting. Throws SoundSettingsError
 * with the office's wording when anything is not valid.
 */
export function planSoundSave(before: { apps: SoundOverrides; office: OfficeSounds | null }, input: { apps?: unknown; office?: unknown }): { apps: SoundOverrides; office: OfficeSounds | null; changes: SoundChange[] } {
  const changes: SoundChange[] = [];
  let apps = before.apps;
  if (input.apps !== undefined && input.apps !== null) {
    if (typeof input.apps !== 'object' || Array.isArray(input.apps)) throw new SoundSettingsError('The app sounds are not valid.');
    const next: SoundOverrides = { ...before.apps };
    for (const [audience, row] of Object.entries(input.apps as Record<string, unknown>)) {
      if (!(SOUND_AUDIENCES as readonly string[]).includes(audience)) throw new SoundSettingsError(`"${audience}" is not an app with notification sounds.`);
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new SoundSettingsError(`The ${audience} sounds are not valid.`);
      const a = audience as SoundAudience;
      const kept: Partial<Record<SoundEvent, AppSound>> = {};
      for (const [event, sound] of Object.entries(row as Record<string, unknown>)) {
        const info = eventInfo(a, event);
        if (!info) throw new SoundSettingsError(`"${event}" is not a ${a} notification.`);
        if (!isAppSound(sound)) throw new SoundSettingsError(`${info.label}: choose New booking, Approval or General.`);
        if (!info.sent) {
          if (sound !== info.defaultSound) throw new SoundSettingsError(`${info.label}: the server sends no such notification yet, so its sound cannot be changed.`);
          continue;
        }
        if (sound !== info.defaultSound) kept[info.key] = sound;
      }
      if (Object.keys(kept).length) next[a] = kept; else delete next[a];
    }
    apps = next;
    for (const a of SOUND_AUDIENCES) {
      for (const info of SOUND_EVENTS[a]) {
        const from = before.apps[a]?.[info.key] ?? info.defaultSound, to = apps[a]?.[info.key] ?? info.defaultSound;
        if (from !== to) changes.push({ audience: a, event: info.key, label: info.label, field: 'sound', from: APP_SOUND_LABEL[from], to: APP_SOUND_LABEL[to] });
      }
    }
  }
  let office = before.office;
  if (input.office !== undefined && input.office !== null) {
    if (typeof input.office !== 'object' || Array.isArray(input.office)) throw new SoundSettingsError('The office alert sounds are not valid.');
    const next = {} as OfficeSounds;
    for (const kind of OFFICE_ALERTS) next[kind] = officeAlert(kind, (input.office as Record<string, unknown>)[kind]);
    const was = before.office ?? OFFICE_DEFAULTS;
    for (const kind of OFFICE_ALERTS) {
      for (const field of ['tone', 'volume', 'on', 'repeat'] as const) {
        if (was[kind][field] !== next[kind][field]) changes.push({ audience: 'office', event: kind, label: kind, field, from: officeText(field, was[kind][field]), to: officeText(field, next[kind][field]) });
      }
    }
    // The first shared save is recorded even when it matches the defaults: from then on every computer follows it.
    if (!before.office && !changes.some((c) => c.audience === 'office')) changes.push({ audience: 'office', event: 'all', label: 'Office alerts', field: 'tone', from: 'Each computer\'s own', to: 'Shared (defaults)' });
    office = next;
  }
  return { apps, office, changes };
}
