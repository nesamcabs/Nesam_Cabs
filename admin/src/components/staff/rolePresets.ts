import { presetAccess, type StaffModule, type StaffPreset } from "../../config/permissions";

/** Display data for the built-in Staff ID presets. What each preset may do comes from presetAccess (config/permissions). */
export interface RolePresetMeta {
  id: string;
  name: string;
  shortName: string;
  prefix: string;
  badgeClass: string;
  desc: string;
  isBuiltIn: boolean;
  preset: StaffPreset;
}

export const ROLE_PRESETS_META: RolePresetMeta[] = [
  {
    id: "booking_exec",
    name: "Booking & Enquiry Executive",
    shortName: "Booking Staff",
    prefix: "booking",
    badgeClass: "bg-red-50 text-red-700 border-red-200",
    desc: "Instant fare quotes, caller follow-ups & booking creation",
    isBuiltIn: true,
    preset: "Booking & Enquiry Executive",
  },
  {
    id: "dispatch_ctrl",
    name: "Dispatch & Trip Controller",
    shortName: "Dispatch",
    prefix: "dispatch",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
    desc: "Live cab allocation, driver/vehicle swaps & airport tracking",
    isBuiltIn: true,
    preset: "Dispatch & Trip Controller",
  },
  {
    id: "night_desk",
    name: "Night Shift / After-Hours Desk",
    shortName: "Night Shift",
    prefix: "night",
    badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
    desc: "Combined night booking, urgent cab swap & emergency support",
    isBuiltIn: true,
    preset: "Night Shift / After-Hours Desk",
  },
  {
    id: "fleet_officer",
    name: "Fleet & Driver Onboarding Officer",
    shortName: "Fleet KYC",
    prefix: "fleet",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
    desc: "Driver KYC, RC/FC/Permit verification & vehicle onboarding",
    isBuiltIn: true,
    preset: "Fleet & Driver Onboarding Officer",
  },
  {
    id: "vendor_coord",
    name: "Vendor & B2B Partner Coordinator",
    shortName: "Vendor Desk",
    prefix: "vendor",
    badgeClass: "bg-purple-50 text-purple-700 border-purple-200",
    desc: "Attached vendor fleet trips & corporate/B2B bookings",
    isBuiltIn: true,
    preset: "Vendor & B2B Partner Coordinator",
  },
  {
    id: "accounts_gst",
    name: "Accounts, GST & Payout Officer",
    shortName: "Accounts & GST",
    prefix: "accounts",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    desc: "Invoices, GST reports, Razorpay verification & driver payouts",
    isBuiltIn: true,
    preset: "Accounts, GST & Payout Officer",
  },
  {
    id: "support_desk",
    name: "Customer Support & Escalation Desk",
    shortName: "Support Desk",
    prefix: "support",
    badgeClass: "bg-teal-50 text-teal-700 border-teal-200",
    desc: "Trip complaints, refund tickets & promo coupon compensation",
    isBuiltIn: true,
    preset: "Customer Support & Escalation Desk",
  },
];

export const MODULE_GROUPS: { title: string; items: StaffModule[] }[] = [
  {
    title: "Core Operations",
    items: ["Dashboard", "Bookings", "Customers", "Communication", "Support"],
  },
  {
    title: "Fleet & Partners",
    items: ["Partners & Fleet", "Driver Partners", "Vendors", "Vendor Drivers", "Vehicles"],
  },
  {
    title: "Finance & Billing",
    items: ["Accounts", "Invoices", "Reports & GST", "Business accounts", "Penalties"],
  },
  {
    title: "System & Security",
    items: ["Settings", "Staff & Access"],
  },
];


/** What a preset's template actually grants for customer numbers and exports (never a hard-coded claim). */
export function presetPolicy(preset: StaffPreset): { reveal: "none" | "temporary" | "on approval"; exports: boolean } {
  const { matrix } = presetAccess(preset);
  const reveal = matrix.privacy.temporaryReveal ? "temporary" : matrix.privacy.requestApproval ? "on approval" : "none";
  return { reveal, exports: Object.values(matrix.modules).some((a) => a?.includes("export")) };
}
