/**
 * Decides when a due follow-up should sound, independent of React renders:
 *  - a follow-up that becomes due alerts once ("fresh");
 *  - it then repeats every `repeatMs` (null = "Once only") while it stays due;
 *  - a snooze moves its due time, so it drops out (upcoming) and alerts afresh at the new due time;
 *  - booked / lost (closed, cancelled, expired) follow-ups are no longer due, so they stop repeating.
 * The state lives in a ref; calling this again with the same inputs never repeats a sound (no duplicates on re-render).
 */
export interface DueFollowUp {
  id: string;
  /** The follow-up's current due time; a snooze changes it. */
  dueAtMs: number | null;
}

export interface ReminderEntry {
  dueAtMs: number | null;
  lastSoundMs: number;
}

export interface ReminderStep<T extends DueFollowUp> {
  /** Next state to keep (only follow-ups that are still due). */
  state: Map<string, ReminderEntry>;
  /** Follow-ups that just became due (for the on-screen notice). */
  fresh: T[];
  /** Whether to play the follow-up sound once now (at most one sound per step). */
  sound: boolean;
  /** Whether a still-due follow-up reached its repeat interval in this step. */
  repeated: boolean;
}

/**
 * `prev` null means the first look at the queue: follow-ups already due when the desk opens are recorded without an
 * alert (as before), but still repeat after the interval if repeats are on.
 */
export function stepFollowUpReminders<T extends DueFollowUp>(prev: Map<string, ReminderEntry> | null, due: readonly T[], nowMs: number, repeatMs: number | null): ReminderStep<T> {
  const state = new Map<string, ReminderEntry>();
  const fresh: T[] = [];
  let sound = false;
  let repeated = false;
  for (const r of due) {
    const was = prev?.get(r.id);
    if (prev === null) {
      state.set(r.id, { dueAtMs: r.dueAtMs, lastSoundMs: nowMs });
    } else if (!was || was.dueAtMs !== r.dueAtMs) {
      fresh.push(r);
      sound = true;
      state.set(r.id, { dueAtMs: r.dueAtMs, lastSoundMs: nowMs });
    } else if (repeatMs !== null && repeatMs > 0 && nowMs - was.lastSoundMs >= repeatMs) {
      sound = true;
      repeated = true;
      state.set(r.id, { dueAtMs: r.dueAtMs, lastSoundMs: nowMs });
    } else {
      state.set(r.id, was);
    }
  }
  // When one sound covers several follow-ups, they all count as reminded now, so they do not ring again next tick.
  if (sound) for (const [id, e] of state) if (e.lastSoundMs !== nowMs) state.set(id, { ...e, lastSoundMs: nowMs });
  return { state, fresh, sound, repeated };
}
