/** Client side of the trusted Customers Directory functions (functions/src/customerDirectory.ts). */
import type { Customer } from "../types";
import { callFunction } from "./callables";

export interface DirectoryViewer {
  kind: string; isSuper: boolean; name: string;
  canView: boolean; canCreate: boolean; canEdit: boolean; canReveal: boolean; canExport: boolean;
}
export interface DirectoryResult { customers: Customer[]; viewer: DirectoryViewer; truncated: boolean }
export interface NumberView { id: string; viewedBy: string; viewedByRole: string; customer: string; customerCode: string; reason: string; kind: "reveal" | "export"; atMs: number }
export interface NumberViews { entries: NumberView[]; total: number; scope: "all" | "own" }

export const REVEAL_CATEGORIES = [
  "New booking confirmation call",
  "Pickup landmark / address clarification",
  "GST invoice / payment receipt follow-up",
  "Customer support / lost item check",
] as const;
export const NOTE_MIN = 10;

export const fetchDirectory = () => callFunction<{ directory: true }, DirectoryResult>("getCustomerDirectory", { directory: true });
export const fetchSavedPlaces = (customerId: string) => callFunction<{ customerId: string }, { places: { id: string; name: string; address: string }[] }>("getCustomerSavedPlaces", { customerId });
export const findCustomersByMobile = (phone: string) => callFunction<{ phone: string }, { ids: string[] }>("findCustomerByMobile", { phone });
export const revealCustomerNumber = (customerId: string, category: string, note: string) =>
  callFunction<{ customerId: string; category: string; note: string; platform: string }, { phone: string; logId: string; revealSeconds: number }>("revealCustomerNumber", { customerId, category, note, platform: "admin" });
export const fetchNumberViews = (limit = 20) => callFunction<{ limit: number }, NumberViews>("getCustomerNumberViews", { limit });
/** Master only. Authorises (and logs) a directory export; with `includeNumbers` it also returns the full numbers, which needs a reason. */
export const exportCustomerNumbers = (customerIds: string[], includeNumbers: boolean, reason = "") =>
  callFunction<{ customerIds: string[]; includeNumbers: boolean; reason: string }, { numbers: Record<string, string>; authorized: boolean }>("exportCustomerNumbers", { customerIds, includeNumbers, reason });

export interface CustomerInput {
  customerId?: string;
  name?: string; phone?: string; email?: string; city?: string; gender?: string; notes?: string;
  leadSource?: string; isVip?: boolean; isCorporate?: boolean; company?: string; gstin?: string;
  preferredCab?: string; preferredDriver?: string; status?: "Active" | "Blocked";
}
export const saveCustomerProfile = (i: CustomerInput) => callFunction<CustomerInput, { id: string; created: boolean }>("saveCustomerProfile", i);

/** The one clipboard helper (utils/clipboard), re-exported for this service's existing importers. */
export { copyText } from "../utils/clipboard";
