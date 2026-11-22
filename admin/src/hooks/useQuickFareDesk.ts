import { useCallback, useEffect, useRef, useState } from "react";
import {
  deskEnquiryKey,
  newLocalDraftRef,
  type DeskBookingDraft,
  type DeskFollowUp,
  type DeskQuoteLine,
  type DeskRevealEntry,
  type DeskTripSnapshot,
  type DeskPayChoice,
} from "../domain/quickFareDesk";
import { sessionDeskPersistence, type DeskPersistence, type DeskState } from "../services/quickFareDeskBackend";

export interface FollowUpInput {
  customerId: string | null;
  mobile: string;
  name: string;
  trip: DeskTripSnapshot;
  quote: DeskQuoteLine;
  reminderAtMs: number;
  note: string;
}

export interface DraftInput {
  customerId: string | null;
  mobile: string;
  name: string;
  trip: DeskTripSnapshot;
  quote: DeskQuoteLine;
  payment: DeskPayChoice;
  partPercent: number | null;
  amountNow: number | null;
  followUpId: string | null;
}

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * The desk's one source of truth: follow-ups, booking drafts and the number-view history.
 * Records persist through `persistence` (this phase: the browser session only).
 */
export function useQuickFareDesk(persistence: DeskPersistence = sessionDeskPersistence) {
  const [state, setState] = useState<DeskState>(() => persistence.load());
  const ref = useRef(state);
  ref.current = state;

  useEffect(() => {
    persistence.save(state);
  }, [state, persistence]);

  const commit = (next: DeskState) => {
    ref.current = next;
    setState(next);
  };

  /** Creates a follow-up, or updates the active one for the same customer, source, itinerary, pickup time and vehicle. */
  const saveFollowUp = useCallback((input: FollowUpInput): { kind: "created" | "updated"; item: DeskFollowUp } => {
    const now = Date.now();
    const key = deskEnquiryKey({ customerId: input.customerId, mobile: input.mobile, trip: input.trip, categoryId: input.quote.categoryId });
    const cur = ref.current;
    const existing = cur.followUps.find((f) => f.key === key && f.state === "open");
    if (existing) {
      const item: DeskFollowUp = {
        ...existing,
        name: input.name || existing.name,
        customerId: input.customerId ?? existing.customerId,
        quote: input.quote,
        trip: input.trip,
        reminderAtMs: input.reminderAtMs,
        note: input.note || existing.note,
        updatedAtMs: now,
      };
      commit({ ...cur, followUps: cur.followUps.map((f) => (f.id === existing.id ? item : f)) });
      return { kind: "updated", item };
    }
    const item: DeskFollowUp = { id: newId("fu"), key, state: "open", ...input, createdAtMs: now, updatedAtMs: now };
    commit({ ...cur, followUps: [item, ...cur.followUps] });
    return { kind: "created", item };
  }, []);

  const snooze = useCallback((id: string, minutes = 15): number | null => {
    const cur = ref.current;
    const target = cur.followUps.find((f) => f.id === id && f.state === "open");
    if (!target) return null;
    const at = Date.now() + minutes * 60000;
    commit({ ...cur, followUps: cur.followUps.map((f) => (f.id === id ? { ...f, reminderAtMs: at, updatedAtMs: Date.now() } : f)) });
    return at;
  }, []);

  const markLost = useCallback((id: string, reason: string): boolean => {
    const cur = ref.current;
    if (!cur.followUps.some((f) => f.id === id && f.state === "open")) return false;
    commit({ ...cur, followUps: cur.followUps.map((f) => (f.id === id ? { ...f, state: "lost", lostReason: reason, updatedAtMs: Date.now() } : f)) });
    return true;
  }, []);

  /** Saves a local booking draft once; the same enquiry + vehicle returns the draft already saved. */
  const createDraft = useCallback((input: DraftInput): { kind: "created" | "existing"; draft: DeskBookingDraft } => {
    const cur = ref.current;
    const key = deskEnquiryKey({ customerId: input.customerId, mobile: input.mobile, trip: input.trip, categoryId: input.quote.categoryId });
    const existing = cur.drafts.find((d) => d.key === key);
    if (existing) return { kind: "existing", draft: existing };
    const draft: DeskBookingDraft = { ref: newLocalDraftRef(), key, ...input, createdAtMs: Date.now() };
    const followUps = input.followUpId
      ? cur.followUps.map((f) => (f.id === input.followUpId ? { ...f, state: "draft" as const, draftRef: draft.ref, updatedAtMs: Date.now() } : f))
      : cur.followUps;
    commit({ ...cur, drafts: [draft, ...cur.drafts], followUps });
    return { kind: "created", draft };
  }, []);

  const addReveal = useCallback((entry: Omit<DeskRevealEntry, "id" | "atMs">): DeskRevealEntry => {
    const cur = ref.current;
    const row: DeskRevealEntry = { id: newId("rv"), atMs: Date.now(), ...entry };
    commit({ ...cur, reveals: [row, ...cur.reveals] });
    return row;
  }, []);

  return { ...state, saveFollowUp, snooze, markLost, createDraft, addReveal };
}

export type QuickFareDesk = ReturnType<typeof useQuickFareDesk>;
