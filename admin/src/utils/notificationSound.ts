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
export const ALERT_KINDS = ["New booking", "Urgent booking", "Unassigned booking"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const ALERT_SECONDS: Record<AlertKind, number> = { "New booking": 5, "Urgent booking": 10, "Unassigned booking": 5 };
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
};

const CFG_KEY = "nesam_alert_sounds";

export function loadSoundConfig(): SoundConfig {
  try {
    const v = JSON.parse(localStorage.getItem(CFG_KEY) || "null");
    return v ? { ...DEFAULT_SOUNDS, ...v } : DEFAULT_SOUNDS;
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

/** Plays a preset (or an uploaded sound) for `seconds`, regardless of the global on/off switch. */
export async function previewTone(tone: string, volume: number, seconds: number): Promise<void> {
  const c = context();
  if (!c) return;
  if (c.state !== "running") await c.resume().catch(() => undefined);
  const g = Math.max(0, Math.min(1, volume / 100));
  if (tone.startsWith("custom:")) {
    const url = await customSoundUrl(tone.slice(7));
    if (!url) return;
    const a = new Audio(url);
    a.volume = g;
    void a.play().catch(() => undefined);
    setTimeout(() => a.pause(), seconds * 1000);
    return;
  }
  const play = PRESET[(PRESET_TONES as readonly string[]).includes(tone) ? (tone as PresetTone) : "Clean Bell"];
  let t = c.currentTime + 0.02;
  const end = t + seconds;
  while (t < end) t += play(c, t, g);
}

/** Alert sound for a kind of alert, following the saved configuration. */
export function playAlert(kind: AlertKind): void {
  if (!soundEnabled()) return;
  const cfg = loadSoundConfig()[kind];
  if (!cfg?.on) return;
  const c = context();
  if (!c || c.state !== "running") return;
  void previewTone(cfg.tone, cfg.volume, ALERT_SECONDS[kind]).catch(() => undefined);
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
async function customSoundUrl(id: string): Promise<string | null> {
  try {
    const d = await idb();
    const v = await new Promise<{ blob: Blob } | undefined>((resolve) => {
      const r = d.transaction("sounds").objectStore("sounds").get(id);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    });
    return v ? URL.createObjectURL(v.blob) : null;
  } catch {
    return null;
  }
}
