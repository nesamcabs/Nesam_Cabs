/**
 * Three clearly different notification tones, synthesised in the browser (no
 * audio files to ship or block):
 *   new_booking — bright rising two-note chime
 *   approval    — soft major arpeggio (confirmation)
 *   general     — single short mellow ping
 * Browsers only allow sound after the user has interacted with the page, so the
 * first click or key press unlocks it; `soundState()` says whether it is ready.
 */
export type Tone = "new_booking" | "approval" | "general";

const KEY = "nesam_notification_sound";
let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* private mode: the choice just isn't remembered */
  }
}

/** "ready" once the browser has allowed audio; "locked" until the user interacts; "unsupported" without Web Audio. */
export function soundState(): "ready" | "locked" | "unsupported" {
  const c = context();
  if (!c) return "unsupported";
  return c.state === "running" ? "ready" : "locked";
}

/** Call from any user gesture handler (the app does this on the first click / key press). */
export function unlockSound(): void {
  const c = context();
  if (c && c.state !== "running") void c.resume().catch(() => undefined);
}

function note(c: AudioContext, freq: number, start: number, dur: number, type: OscillatorType, gain: number) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

const PATTERNS: Record<Tone, (c: AudioContext, t: number) => void> = {
  new_booking: (c, t) => {
    note(c, 784, t, 0.18, "triangle", 0.28); // G5
    note(c, 1175, t + 0.16, 0.18, "triangle", 0.28); // D6
    note(c, 1568, t + 0.32, 0.34, "triangle", 0.26); // G6
  },
  approval: (c, t) => {
    [523, 659, 784, 1047].forEach((f, i) => note(c, f, t + i * 0.11, 0.3, "sine", 0.22)); // C5 E5 G5 C6
  },
  general: (c, t) => {
    note(c, 880, t, 0.28, "sine", 0.2); // A5
  },
};

/** Plays a tone if sound is on and unlocked. Never throws. */
export function playTone(tone: Tone, times = 1): void {
  if (!soundEnabled()) return;
  const c = context();
  if (!c || c.state !== "running") return;
  activeSoundPreview?.stop();
  try {
    for (let i = 0; i < times; i++) PATTERNS[tone](c, c.currentTime + 0.02 + i * 0.9);
  } catch {
    /* audio failures must never break the app */
  }
}

// ── Office alert sounds (Master Admin "Notification sounds") ──────────────
// Each alert has its own preset tone, volume, on/off and repeat; the choice is saved per device.

export const PRESET_TONES = ["Clean Bell", "Double Bell", "Classic Ring", "Quick Ring", "Soft Chime"] as const;
export type PresetTone = (typeof PRESET_TONES)[number];
export const ALERT_KINDS = ["New booking", "Urgent booking", "Unassigned booking", "Follow-up reminder"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const ALERT_SECONDS: Record<AlertKind, number> = { "New booking": 5, "Urgent booking": 10, "Unassigned booking": 5, "Follow-up reminder": 2 };
export const REPEATS = ["Once only", "Every 30 sec", "Every 1 min", "Every 2 min", "Every 5 min", "Every 10 min"] as const;

export interface AlertSound {
  /** A preset name, or "custom:<id>" for an uploaded sound. */
  tone: string;
  volume: number;
  on: boolean;
  repeat: (typeof REPEATS)[number];
}
export type SoundConfig = Record<AlertKind, AlertSound>;

export const DEFAULT_SOUNDS: SoundConfig = {
  "New booking": { tone: "Clean Bell", volume: 80, on: true, repeat: "Once only" },
  "Urgent booking": { tone: "Classic Ring", volume: 80, on: true, repeat: "Every 1 min" },
  "Unassigned booking": { tone: "Double Bell", volume: 80, on: true, repeat: "Every 5 min" },
  "Follow-up reminder": { tone: "Soft Chime", volume: 80, on: true, repeat: "Once only" },
};

const REPEAT_MS: Record<(typeof REPEATS)[number], number | null> = {
  "Once only": null, "Every 30 sec": 30_000, "Every 1 min": 60_000, "Every 2 min": 120_000, "Every 5 min": 300_000, "Every 10 min": 600_000,
};
/** Milliseconds between repeats of a real alert, or null for "Once only". */
export function repeatIntervalMs(repeat: string): number | null {
  return (REPEATS as readonly string[]).includes(repeat) ? REPEAT_MS[repeat as (typeof REPEATS)[number]] : null;
}

/** One saved alert merged over its default, field by field, so a missing or damaged field never loses the others. */
function mergeAlert(kind: AlertKind, saved: unknown): AlertSound {
  const d = DEFAULT_SOUNDS[kind];
  if (!saved || typeof saved !== "object") return d;
  const v = saved as Partial<AlertSound>;
  return {
    tone: typeof v.tone === "string" && v.tone ? v.tone : d.tone,
    volume: typeof v.volume === "number" && Number.isFinite(v.volume) ? Math.max(0, Math.min(100, v.volume)) : d.volume,
    on: typeof v.on === "boolean" ? v.on : d.on,
    repeat: typeof v.repeat === "string" && (REPEATS as readonly string[]).includes(v.repeat) ? v.repeat : d.repeat,
  };
}

const CFG_KEY = "nesam_alert_sounds";

export function loadSoundConfig(): SoundConfig {
  try {
    const v = JSON.parse(localStorage.getItem(CFG_KEY) || "null") as Record<string, unknown> | null;
    if (!v || typeof v !== "object") return DEFAULT_SOUNDS;
    // Configurations saved before a category existed (e.g. only the first three) gain its default; others are kept.
    return Object.fromEntries(ALERT_KINDS.map((k) => [k, mergeAlert(k, v[k])])) as SoundConfig;
  } catch {
    return DEFAULT_SOUNDS;
  }
}

export function saveSoundConfig(c: SoundConfig): void {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
  } catch {
    /* not remembered in private mode */
  }
}

const PRESET: Record<PresetTone, (c: AudioContext, t: number, g: number) => number> = {
  "Clean Bell": (c, t, g) => { note(c, 1318, t, 0.9, "sine", 0.3 * g); note(c, 2637, t, 0.5, "sine", 0.08 * g); return 1.2; },
  "Double Bell": (c, t, g) => { note(c, 1318, t, 0.5, "sine", 0.3 * g); note(c, 1568, t + 0.35, 0.7, "sine", 0.3 * g); return 1.3; },
  "Classic Ring": (c, t, g) => { for (let i = 0; i < 8; i++) note(c, i % 2 ? 660 : 880, t + i * 0.06, 0.06, "square", 0.08 * g); return 1.0; },
  "Quick Ring": (c, t, g) => { for (let i = 0; i < 4; i++) note(c, 988, t + i * 0.12, 0.08, "triangle", 0.25 * g); return 0.8; },
  "Soft Chime": (c, t, g) => { [784, 988, 1175].forEach((f, i) => note(c, f, t + i * 0.18, 0.6, "sine", 0.18 * g)); return 1.3; },
};

/** A local, cancellable preview. It never saves settings or creates a notification. */
export interface SoundPreview {
  stop: () => void;
  finished: Promise<void>;
}

let activeSoundPreview: SoundPreview | null = null;

/** Uses the existing preset patterns and uploaded assets; Stop closes only this preview's context. */
export function startSoundPreview(tone: string, volume: number, seconds: number): SoundPreview {
  activeSoundPreview?.stop();
  let resolveFinished!: () => void;
  let rejectFinished!: (error: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  let done = false;
  let previewContext: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const finish = (error?: unknown) => {
    if (done) return;
    done = true;
    if (timer !== null) clearTimeout(timer);
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect();
    }
    const closing = previewContext;
    previewContext = null;
    if (closing && closing.state !== "closed") {
      void closing.close().catch(() => undefined);
    }
    if (activeSoundPreview === playback) activeSoundPreview = null;
    if (error !== undefined) rejectFinished(error);
    else resolveFinished();
  };

  const playback: SoundPreview = { stop: () => finish(), finished };
  activeSoundPreview = playback;

  const play = async () => {
    if (!Number.isFinite(volume) || volume <= 0) throw new Error("Increase the volume above 0 to test this sound.");
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60) throw new Error("The preview duration is not valid.");
    if (typeof window === "undefined") throw new Error("Sound preview is available in the browser.");
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error("This browser does not support sound preview.");
    // A real alert that is sounding right now keeps priority over a preview.
    if (Date.now() < alertBusyUntil) throw new Error("A live alert is playing. Try Live Test again in a few seconds.");

    // Created/resumed directly from the button's user gesture, before awaiting an uploaded asset.
    const c = new Ctor();
    previewContext = c;
    if (c.state !== "running") await c.resume();
    if (done) return;
    if (c.state !== "running") throw new Error("Audio is blocked. Allow sound for this site, then click Live Test again.");
    const gain = Math.min(1, volume / 100);

    if (tone.startsWith("custom:")) {
      // Read the saved Blob straight from IndexedDB and decode it: no object URL and no fetch
      // (the site's CSP connect-src does not allow blob:, which is what made Live Test fail).
      const buffer = await loadCustomSoundBuffer(tone.slice(7), c, () => done);
      if (done || !buffer) return;
      if (c.state !== "running") throw new Error("Audio was suspended. Click Live Test again.");
      const level = c.createGain();
      level.gain.value = gain;
      source = c.createBufferSource();
      source.buffer = buffer;
      source.connect(level).connect(c.destination);
      source.onended = () => finish();
      timer = setTimeout(() => finish(), seconds * 1000);
      source.start();
      return;
    }

    if (!(PRESET_TONES as readonly string[]).includes(tone)) throw new Error("Select an available preset tone or uploaded sound.");
    const pattern = PRESET[tone as PresetTone];
    let at = c.currentTime + 0.02;
    const end = at + seconds;
    while (at < end) at += pattern(c, at, gain);
    // Closing the context also cuts off the tail of the last scheduled note at the duration limit.
    timer = setTimeout(() => finish(), (seconds + 0.02) * 1000);
  };

  void play().catch((error: unknown) => finish(error instanceof Error ? error : new Error("Sound preview failed. Try another sound.")));
  return playback;
}


// ── Real alerts (shared AudioContext — never closed by previews) ──────────
/** Wall-clock end (ms) of the real alert currently sounding; previews wait for it. */
let alertBusyUntil = 0;
/** Each real alert takes a new token; a slower uploaded-sound load that is no longer current never plays. */
let alertToken = 0;
let alertSource: { source: AudioBufferSourceNode; gain: GainNode } | null = null;

function stopAlertSource() {
  const a = alertSource;
  alertSource = null;
  if (!a) return;
  a.source.onended = null;
  try { a.source.stop(); } catch { /* Already ended. */ }
  a.source.disconnect();
  a.gain.disconnect();
}

function playPresetOn(c: AudioContext, tone: string, gain: number, seconds: number) {
  const play = PRESET[(PRESET_TONES as readonly string[]).includes(tone) ? (tone as PresetTone) : "Clean Bell"];
  let t = c.currentTime + 0.02;
  const end = t + seconds;
  while (t < end) t += play(c, t, gain);
}

/**
 * Plays a preset (or an uploaded sound) for `seconds` on the shared alert context, regardless of the global on/off
 * switch. Rejects with a clear message when an uploaded sound is missing or cannot be decoded.
 */
export async function previewTone(tone: string, volume: number, seconds: number): Promise<void> {
  const c = context();
  if (!c) return;
  if (c.state !== "running") await c.resume().catch(() => undefined);
  const g = Math.max(0, Math.min(1, volume / 100));
  const token = ++alertToken;
  stopAlertSource();
  alertBusyUntil = Date.now() + seconds * 1000;
  if (tone.startsWith("custom:")) {
    const buffer = await loadCustomSoundBuffer(tone.slice(7), c, () => token !== alertToken);
    if (!buffer || token !== alertToken) return;
    const gain = c.createGain();
    gain.gain.value = g;
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.connect(gain).connect(c.destination);
    const entry = { source, gain };
    source.onended = () => { if (alertSource === entry) stopAlertSource(); };
    alertSource = entry;
    alertBusyUntil = Date.now() + Math.min(seconds, buffer.duration) * 1000;
    source.start();
    source.stop(c.currentTime + seconds);
    return;
  }
  playPresetOn(c, tone, g, seconds);
}

/** Alert sound for a kind of alert, following the saved configuration. */
let followUpRetry: ReturnType<typeof setTimeout> | null = null;

export function playAlert(kind: AlertKind): void {
  if (!soundEnabled()) return;
  const cfg = loadSoundConfig()[kind];
  if (!cfg?.on) return;
  const c = context();
  if (!c || c.state !== "running") return;
  // Booking alerts outrank follow-up reminders: a reminder waits for a sounding alert to finish instead of cutting it off.
  if (kind === "Follow-up reminder") {
    const wait = alertBusyUntil - Date.now();
    if (wait > 0) {
      if (followUpRetry === null) followUpRetry = setTimeout(() => { followUpRetry = null; playAlert(kind); }, wait + 100);
      return;
    }
  }
  // Real notifications take priority: any Live Test preview stops (it has its own context, so this one stays open).
  activeSoundPreview?.stop();
  const seconds = ALERT_SECONDS[kind];
  void previewTone(cfg.tone, cfg.volume, seconds).catch((error: unknown) => {
    // A missing / undecodable uploaded sound must not silence a real alert: fall back to this alert's default preset.
    console.warn(`[notification sound] ${kind}: ${error instanceof Error ? error.message : "uploaded sound failed"} Using the default tone.`);
    if (c.state === "running") playPresetOn(c, DEFAULT_SOUNDS[kind].tone, Math.max(0, Math.min(1, cfg.volume / 100)), seconds);
  });
}

// Uploaded sounds (MP3 / WAV, up to 2 MB, at most 5) are kept in this browser's IndexedDB.
const DB = "nesam_sounds";
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("sounds");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function listCustomSounds(): Promise<{ id: string; name: string }[]> {
  try {
    const d = await idb();
    return await new Promise((resolve) => {
      const out: { id: string; name: string }[] = [];
      const cur = d.transaction("sounds").objectStore("sounds").openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve(out);
        out.push({ id: String(c.key), name: (c.value as { name: string }).name });
        c.continue();
      };
      cur.onerror = () => resolve(out);
    });
  } catch {
    return [];
  }
}
export async function addCustomSound(file: File): Promise<string> {
  if (!/audio\/(mpeg|mp3|wav|x-wav|wave)/.test(file.type)) throw new Error("Upload an MP3 or WAV file.");
  if (file.size > 2 * 1024 * 1024) throw new Error("The sound must be 2 MB or smaller.");
  if ((await listCustomSounds()).length >= 5) throw new Error("Up to 5 sounds can be uploaded. Remove one first.");
  const id = `s${Date.now()}`;
  const d = await idb();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction("sounds", "readwrite");
    tx.objectStore("sounds").put({ name: file.name, blob: file }, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return id;
}
export const MISSING_SOUND_MESSAGE = "This uploaded sound is no longer saved in this browser. Upload it again or select a preset.";
export const UNDECODABLE_SOUND_MESSAGE = "This uploaded sound could not be played. The file may be damaged or in an unsupported format — upload it again or select a preset.";

/** Reads an uploaded sound's saved Blob from IndexedDB ("nesam_sounds" → "sounds"); null when the record is gone. */
export async function readCustomSoundBlob(id: string): Promise<Blob | null> {
  let d: IDBDatabase;
  try {
    d = await idb();
  } catch {
    throw new Error("Uploaded sounds could not be read in this browser. Select a preset or reopen these settings.");
  }
  const v = await new Promise<{ blob?: unknown } | undefined>((resolve, reject) => {
    const r = d.transaction("sounds").objectStore("sounds").get(id);
    r.onsuccess = () => resolve(r.result as { blob?: unknown } | undefined);
    r.onerror = () => reject(new Error("Uploaded sounds could not be read in this browser. Select a preset or reopen these settings."));
  });
  return v && v.blob instanceof Blob ? v.blob : null;
}

/** decodeAudioData in its promise form, with the callback form for older Safari. */
function decodeBytes(c: BaseAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const p = c.decodeAudioData(bytes, resolve, reject) as Promise<AudioBuffer> | undefined;
    if (p && typeof p.then === "function") p.then(resolve, reject);
  });
}

/**
 * Loads an uploaded sound directly from its saved Blob: blob.arrayBuffer() → decodeAudioData(). Returns null as soon
 * as `cancelled()` is true after any asynchronous step, so a stopped preview/alert never plays late.
 */
export async function loadCustomSoundBuffer(id: string, c: BaseAudioContext, cancelled: () => boolean = () => false): Promise<AudioBuffer | null> {
  const blob = await readCustomSoundBlob(id);
  if (cancelled()) return null;
  if (!blob) throw new Error(MISSING_SOUND_MESSAGE);
  let bytes: ArrayBuffer;
  try {
    bytes = await blob.arrayBuffer();
  } catch {
    throw new Error(MISSING_SOUND_MESSAGE);
  }
  if (cancelled()) return null;
  let buffer: AudioBuffer;
  try {
    buffer = await decodeBytes(c, bytes);
  } catch {
    if (cancelled()) return null;
    throw new Error(UNDECODABLE_SOUND_MESSAGE);
  }
  return cancelled() ? null : buffer;
}
