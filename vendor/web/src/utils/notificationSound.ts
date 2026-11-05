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
