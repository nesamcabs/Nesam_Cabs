/**
 * Integration boundary for the Quick Fare & Enquiry Desk.
 *
 * This phase is frontend-only: follow-ups, booking drafts and the number-view history live in the browser
 * session (a dedicated, versioned sessionStorage namespace). Nothing here talks to a server.
 *
 * A later phase swaps `sessionDeskPersistence` for a backend adapter with the same shape and wires the
 * existing services, which already exist for this purpose:
 *   - follow-ups        → services/enquiryService.ts  (saveEnquiry, snoozeEnquiry, markEnquiryLost)
 *   - number reveal     → services/enquiryService.ts  (revealEnquiryNumber, server-side audit log)
 *   - booking creation  → services/adminBookingService.ts (createAdminBooking) via the New booking flow
 *   - payment links     → services/enquiryService.ts  (createBookingPaymentLink)
 *   - reminders         → a server job (browser reminders only fire while the desk is open)
 */
import type { DeskBookingDraft, DeskFollowUp, DeskRevealEntry } from "../domain/quickFareDesk";

export interface DeskState {
  followUps: DeskFollowUp[];
  drafts: DeskBookingDraft[];
  reveals: DeskRevealEntry[];
}

export interface DeskPersistence {
  load(): DeskState;
  save(state: DeskState): void;
}

export const emptyDeskState = (): DeskState => ({ followUps: [], drafts: [], reveals: [] });

const NAMESPACE = "nesam.admin.quickFareDesk";
const VERSION = 1;
const KEY = `${NAMESPACE}.v${VERSION}`;

const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

/** Browser-session store. Only records created on this desk are kept; other app storage is never touched. */
export const sessionDeskPersistence: DeskPersistence = {
  load() {
    try {
      const raw = window.sessionStorage.getItem(KEY);
      if (!raw) return emptyDeskState();
      const parsed = JSON.parse(raw) as { version?: number; state?: Partial<DeskState> };
      if (parsed?.version !== VERSION || !parsed.state) return emptyDeskState();
      const s = parsed.state;
      return {
        followUps: isArr(s.followUps) ? (s.followUps as DeskFollowUp[]) : [],
        drafts: isArr(s.drafts) ? (s.drafts as DeskBookingDraft[]) : [],
        reveals: isArr(s.reveals) ? (s.reveals as DeskRevealEntry[]) : [],
      };
    } catch {
      return emptyDeskState();
    }
  },
  save(state) {
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify({ version: VERSION, state }));
    } catch {
      // Storage full or blocked (private mode): the desk keeps working for this page view.
    }
  },
};
