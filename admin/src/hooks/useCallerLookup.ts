import { useEffect, useMemo, useState } from "react";
import { findCustomersByMobile } from "../services/customerDirectoryService";
import { normalizeIndianMobile } from "../domain/quickFareDesk";
import type { Customer } from "../types";

export type CallerLookup =
  | { state: "idle" }
  | { state: "looking" }
  | { state: "none" }
  /** `customer` is null when the record exists but is not in the loaded directory. */
  | { state: "found"; id: string; customer: Customer | null }
  | { state: "error"; message: string };

/**
 * The existing customer for a full Indian mobile number. The server's lookup answers for every role (a Staff ID's
 * directory never holds raw numbers); the Master's own list is matched at once while the server answers.
 * A late answer for a number that was changed meanwhile is ignored.
 */
export function useCallerLookup(mobile: string, customers: Customer[], enabled = true): CallerLookup {
  const n = normalizeIndianMobile(mobile);
  const digits = enabled && n.ok ? n.digits : "";
  const [answer, setAnswer] = useState<{ digits: string; ids: string[] } | { digits: string; error: string } | null>(null);

  useEffect(() => {
    if (!digits) return undefined;
    let live = true;
    const t = window.setTimeout(() => {
      findCustomersByMobile(digits)
        .then((r) => { if (live) setAnswer({ digits, ids: r.ids ?? [] }); })
        .catch((e) => { if (live) setAnswer({ digits, error: e instanceof Error ? e.message : "Customer lookup is unavailable." }); });
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [digits]);

  const local = useMemo(() => {
    if (!digits) return null;
    return customers.find((c) => { const m = normalizeIndianMobile(c.phone || ""); return m.ok && m.digits === digits; }) ?? null;
  }, [customers, digits]);

  if (!digits) return { state: "idle" };
  if (local) return { state: "found", id: local.id, customer: local };
  if (!answer || answer.digits !== digits) return { state: "looking" };
  if ("error" in answer) return { state: "error", message: answer.error };
  if (!answer.ids.length) return { state: "none" };
  const row = answer.ids.map((id) => customers.find((c) => c.id === id)).find(Boolean) ?? null;
  return { state: "found", id: row?.id ?? answer.ids[0], customer: row };
}

/** "Existing Caller: Ramesh • 4 completed trips (Pref: SUV)" — only what the customer record holds. */
export function callerBadgeText(l: CallerLookup): string {
  if (l.state !== "found") return "";
  const c = l.customer;
  if (!c) return "Existing Caller: customer record found";
  const trips = typeof c.tripsCompleted === "number" ? ` • ${c.tripsCompleted} completed trip${c.tripsCompleted === 1 ? "" : "s"}` : "";
  const pref = c.preferredCab ? ` (Pref: ${c.preferredCab})` : "";
  return `Existing Caller: ${c.name || "Customer"}${trips}${pref}`;
}
