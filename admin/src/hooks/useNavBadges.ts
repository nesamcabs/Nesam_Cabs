import { useEffect, useState } from "react";
import { subscribeToCollection, subscribeAdminNotifications, COLLECTIONS } from "../services/adminFirestoreService";
import { normalizeVendorStatus } from "../utils/vendorStatus";
import { canAccessPage, type AdminAccess } from "../config/permissions";

export interface NavBadges {
  /** Bookings waiting for office approval (status Pending). */
  newBookings: number;
  /** Approved bookings that are not yet confirmed with a driver or vendor. */
  awaitingAssignment: number;
  trips: number;
  marketplace: number;
  vendors: number;
  drivers: number;
  notifications: number;
  support: number;
}

const EMPTY: NavBadges = { newBookings: 0, awaitingAssignment: 0, trips: 0, marketplace: 0, vendors: 0, drivers: 0, notifications: 0, support: 0 };

/**
 * Live counts for the sidebar badges and the live strip. Subscribes only to the areas the signed-in
 * role can open, so a restricted role never opens a listener Firestore would reject.
 */
export function useNavBadges(access: AdminAccess): NavBadges {
  const [badges, setBadges] = useState<NavBadges>(EMPTY);

  useEffect(() => {
    const allowed = (page: string) => canAccessPage(access, page);
    const set = (patch: Partial<NavBadges>) => setBadges((prev) => ({ ...prev, ...patch }));
    const unsubs: (() => void)[] = [];
    if (allowed("bookings")) {
      unsubs.push(
        subscribeToCollection(COLLECTIONS.BOOKINGS, (data: any[]) => {
          set({
            newBookings: data.filter((b) => b.status === "Pending").length,
            // Accepted by a partner, driver and cab not confirmed yet (reference "assignment pending").
            awaitingAssignment: data.filter((b) => b.assignedVendorId && !b.assignedDriverId && ["Approved", "Confirmed"].includes(b.status)).length,
            trips: data.filter((b) => ["Ongoing", "Assigned", "Trip Started"].includes(b.status)).length,
          });
        }),
      );
    }
    if (allowed("marketplace")) {
      unsubs.push(subscribeToCollection("marketplace_trips", (data: any[]) => set({ marketplace: data.filter((t) => t.status === "Open").length })));
    }
    if (allowed("vendors")) {
      unsubs.push(
        subscribeToCollection(COLLECTIONS.VENDORS, (data: any[]) => {
          const pending = data.filter(
            (v) => v.status === "Pending" || v.status === "PENDING_APPROVAL" || normalizeVendorStatus(v) === "PENDING_APPROVAL",
          ).length;
          set({ vendors: pending });
        }),
      );
    }
    if (allowed("drivers")) {
      unsubs.push(
        subscribeToCollection(COLLECTIONS.DRIVERS, (data: any[]) => {
          // New applications + approved drivers with re-uploaded documents.
          set({ drivers: data.filter((d) => d.status === "Pending" || (d.status === "Approved" && d.docStatus === "Pending")).length });
        }),
      );
    }
    if (allowed("notifications")) {
      unsubs.push(subscribeAdminNotifications((data) => set({ notifications: data.filter((n) => !n.read).length })));
    }
    if (allowed("support")) {
      unsubs.push(subscribeToCollection("support_tickets", (data: any[]) => set({ support: data.filter((t) => t.status === "Open" || !t.status).length })));
    }
    return () => unsubs.forEach((u) => u());
  }, [access]);

  return badges;
}
