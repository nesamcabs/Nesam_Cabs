/**
 * Vendor lifecycle shared with vendor/web (see firestore.rules):
 *   INCOMPLETE → PENDING_APPROVAL → APPROVED | CHANGES_REQUESTED | REJECTED
 *   APPROVED ⇄ SUSPENDED
 * Older docs may still carry legacy values ('Pending', 'Approved', 'Active', …).
 */
export type VendorStatus =
  | "INCOMPLETE"
  | "PENDING_APPROVAL"
  | "CHANGES_REQUESTED"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED";

export type OnboardingSection = "business" | "documents" | "fleet" | "payout";

export const SECTION_LABELS: Record<OnboardingSection, string> = {
  business: "Business details",
  documents: "Documents (earlier applications)",
  fleet: "Fleet documentation",
  payout: "Account details",
};

export function normalizeVendorStatus(v: {
  status?: unknown;
  submittedAt?: unknown;
}): VendorStatus {
  const raw = String(v?.status ?? "");
  switch (raw) {
    case "INCOMPLETE":
    case "PENDING_APPROVAL":
    case "CHANGES_REQUESTED":
    case "APPROVED":
    case "REJECTED":
    case "SUSPENDED":
      return raw;
    case "Approved":
    case "Active":
      return "APPROVED";
    case "Needs Correction":
      return "CHANGES_REQUESTED";
    case "Rejected":
      return "REJECTED";
    case "Suspended":
    case "Blacklisted":
      return "SUSPENDED";
    case "Pending":
      return "PENDING_APPROVAL";
    default:
      return v?.submittedAt ? "PENDING_APPROVAL" : "INCOMPLETE";
  }
}

export const VENDOR_STATUS_META: Record<
  VendorStatus,
  { label: string; badge: string; dot: string; color: string }
> = {
  PENDING_APPROVAL: {
    label: "Pending Approval",
    badge: "bg-yellow-50 text-yellow-700 border-yellow-200",
    dot: "bg-yellow-500",
    color: "#F59E0B",
  },
  CHANGES_REQUESTED: {
    label: "Changes Requested",
    badge: "bg-orange-50 text-orange-700 border-orange-200",
    dot: "bg-orange-500",
    color: "#F97316",
  },
  APPROVED: {
    label: "Approved",
    badge: "bg-green-50 text-green-700 border-green-200",
    dot: "bg-green-500",
    color: "#10B981",
  },
  REJECTED: {
    label: "Rejected",
    badge: "bg-red-50 text-brand border-red-200",
    dot: "bg-brand",
    color: "#c1232c",
  },
  SUSPENDED: {
    label: "Suspended",
    badge: "bg-gray-100 text-gray-600 border-gray-200",
    dot: "bg-gray-400",
    color: "#999",
  },
  INCOMPLETE: {
    label: "Incomplete",
    badge: "bg-blue-50 text-blue-700 border-blue-200",
    dot: "bg-blue-400",
    color: "#60A5FA",
  },
};

export const vendorStatusLabel = (v: {
  status?: unknown;
  submittedAt?: unknown;
}) => VENDOR_STATUS_META[normalizeVendorStatus(v)].label;
