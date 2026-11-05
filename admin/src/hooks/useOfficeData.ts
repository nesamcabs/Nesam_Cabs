import { useEffect, useMemo, useState } from "react";
import type { Booking, Customer, Driver, MarketplaceTrip, Vehicle, Vendor } from "../types";
import {
  subscribeBookings, subscribeCustomers, subscribeDrivers, subscribeMarketplace, subscribeVehicles, subscribeVendors,
} from "../services/adminFirestoreService";

type Unsub = () => void;
type Subscribe<T> = (cb: (rows: T[]) => void, onError?: (message: string) => void) => Unsub;

interface Store<T> {
  rows: T[] | null;
  error: string | null;
  listeners: Set<() => void>;
  unsub: Unsub | null;
  users: number;
}

/**
 * One Firestore listener per collection, shared by every screen that needs it (Dashboard, Bookings,
 * Trips and the header alerts all read the same bookings). The listener closes when the last user
 * unmounts.
 */
const stores = new Map<string, Store<unknown>>();

function useShared<T>(key: string, subscribe: Subscribe<T>, enabled = true): { rows: T[] | null; error: string | null } {
  const [, force] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let s = stores.get(key) as Store<T> | undefined;
    if (!s) {
      s = { rows: null, error: null, listeners: new Set(), unsub: null, users: 0 };
      stores.set(key, s as Store<unknown>);
    }
    const store = s;
    const tick = () => force((n) => n + 1);
    store.listeners.add(tick);
    store.users++;
    if (!store.unsub) {
      store.unsub = subscribe(
        (rows) => { store.rows = rows; store.error = null; store.listeners.forEach((l) => l()); },
        (message) => { store.error = message; store.listeners.forEach((l) => l()); },
      );
    }
    tick();
    return () => {
      store.listeners.delete(tick);
      store.users--;
      if (store.users <= 0) {
        store.unsub?.();
        stores.delete(key);
      }
    };
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = stores.get(key) as Store<T> | undefined;
  return { rows: enabled ? s?.rows ?? null : [], error: s?.error ?? null };
}

export const useBookings = (enabled = true) => useShared<Booking>("bookings", subscribeBookings, enabled);
export const useMarketplace = (enabled = true) => useShared<MarketplaceTrip>("marketplace", subscribeMarketplace, enabled);
export const useDrivers = (enabled = true) => useShared<Driver>("drivers", subscribeDrivers, enabled);
export const useVendors = (enabled = true) => useShared<Vendor>("vendors", subscribeVendors, enabled);
export const useVehicles = (enabled = true) => useShared<Vehicle>("vehicles", subscribeVehicles, enabled);
export const useCustomers = (enabled = true) => useShared<Customer>("customers", subscribeCustomers, enabled);

/** Everything the booking screens join: bookings with their marketplace record, partners and cars. */
export function useOfficeData(enabled = true) {
  const bookings = useBookings(enabled);
  const market = useMarketplace(enabled);
  const drivers = useDrivers(enabled);
  const vendors = useVendors(enabled);
  const vehicles = useVehicles(enabled);
  const marketById = useMemo(() => new Map((market.rows ?? []).map((m) => [m.id, m])), [market.rows]);
  const driverById = useMemo(() => new Map((drivers.rows ?? []).map((d) => [d.id, d])), [drivers.rows]);
  const vendorById = useMemo(() => new Map((vendors.rows ?? []).map((v) => [v.id, v])), [vendors.rows]);
  const vehicleById = useMemo(() => new Map((vehicles.rows ?? []).map((v) => [v.id, v])), [vehicles.rows]);
  return {
    bookings: bookings.rows,
    error: bookings.error,
    marketById,
    drivers: drivers.rows ?? [],
    vendors: vendors.rows ?? [],
    vehicles: vehicles.rows ?? [],
    driverById,
    vendorById,
    vehicleById,
  };
}
export type OfficeData = ReturnType<typeof useOfficeData>;
