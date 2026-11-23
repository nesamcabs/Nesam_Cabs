import { createContext, useContext } from "react";
import { SOURCE_NAME, SOURCE_ORDER, type SourceScope } from "../../domain/commandDesk";
import { canAccessPage, type AdminAccess } from "../../config/permissions";

/**
 * The Dashboard desk and booking-source selection, shared by the app header (on every page) and the Dashboard.
 * Held by the app shell, so it survives page navigation (and, through sessionStorage, a reload of the tab).
 */
export type DeskId = "command" | "dispatch";

export interface DeskState {
  /** True when this admin's dashboard has the Command / Dispatch desks (the Master dashboard). */
  available: boolean;
  desk: DeskId;
  /** Bumped on every desk choice, so the Dashboard returns to that desk's main view (also from a drill-down). */
  request: number;
  source: SourceScope;
  /** Opens the Dashboard on that desk (navigating there from any page). */
  selectDesk: (desk: DeskId) => void;
  setSource: (source: SourceScope) => void;
}

const DeskContext = createContext<DeskState>({
  available: false,
  desk: "command",
  request: 0,
  source: "ALL",
  selectDesk: () => undefined,
  setSource: () => undefined,
});

export const DeskProvider = DeskContext.Provider;
export const useDesk = () => useContext(DeskContext);

/**
 * The Command / Dispatch desks belong to the Master dashboard: the Master account, and staff holding every area it reads
 * (bookings, people, fleet and finance). The same rule decides which dashboard pages/Dashboard.tsx renders.
 */
export function hasCommandDesk(access: AdminAccess): boolean {
  if (!canAccessPage(access, "dashboard")) return false;
  if (access.isSuper) return true;
  const has = (p: (typeof access.permissions)[number]) => access.permissions.includes(p);
  return has("operations") && has("people") && has("fleet") && has("finance");
}

/** The source filter's choices, in the existing order and names. */
export const SOURCE_CHOICES: { value: SourceScope; name: string }[] = [
  { value: "ALL", name: "All Sources" },
  ...SOURCE_ORDER.map((s) => ({ value: s as SourceScope, name: SOURCE_NAME[s] })),
];

const KEY = "nesam.admin.desk.v1";
const DESKS: DeskId[] = ["command", "dispatch"];

/** The last desk and source of this browser tab; the defaults when nothing (or something unreadable) is stored. */
export function loadDeskPrefs(): { desk: DeskId; source: SourceScope } {
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(KEY) || "null") as { desk?: unknown; source?: unknown } | null;
    const desk = DESKS.includes(raw?.desk as DeskId) ? (raw!.desk as DeskId) : "command";
    const source = SOURCE_CHOICES.some((c) => c.value === raw?.source) ? (raw!.source as SourceScope) : "ALL";
    return { desk, source };
  } catch {
    return { desk: "command", source: "ALL" };
  }
}

export function saveDeskPrefs(p: { desk: DeskId; source: SourceScope }) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage blocked: the selection still holds for this page view.
  }
}
