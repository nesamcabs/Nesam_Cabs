import { useEffect, useMemo, useState } from "react";
import type { Customer } from "../types";
import { rankCustomers } from "../domain/customerSuggestions";
import { fetchDirectory } from "../services/customerDirectoryService";
import { buildCustomerStats } from "../services/customerStats";
import { useBookings } from "./useOfficeData";

/** customer id → the unlinked (phone) bookings the server attributes to them by mobile number. */
let linkedCache: { at: number; map: Promise<Map<string, string[]>> } | null = null;
function linkedBookings(): Promise<Map<string, string[]>> {
  if (!linkedCache || Date.now() - linkedCache.at > 60000) {
    linkedCache = {
      at: Date.now(),
      map: fetchDirectory()
        .then((r) => new Map(((r as { customers?: Customer[] }).customers ?? []).map((c) => [c.id, c.linkedBookingIds ?? []])))
        .catch(() => { linkedCache = null; return new Map<string, string[]>(); }),
    };
  }
  return linkedCache.map;
}

/** Customers ordered by how many bookings they have made, for the booking forms. */
export function useRankedCustomers(customers: Customer[]) {
  const bookings = useBookings().rows;
  const [linked, setLinked] = useState<Map<string, string[]>>(() => new Map());
  useEffect(() => {
    let live = true;
    void linkedBookings().then((m) => { if (live) setLinked(m); });
    return () => { live = false; };
  }, []);
  return useMemo(() => {
    const merged = customers.map((c) => ({ ...c, linkedBookingIds: linked.get(c.id) ?? c.linkedBookingIds }));
    const stats = buildCustomerStats(merged, bookings ?? []);
    return rankCustomers(customers, (id) => { const s = stats.get(id); return s ? s.total - s.cancelled : 0; });
  }, [customers, bookings, linked]);
}
