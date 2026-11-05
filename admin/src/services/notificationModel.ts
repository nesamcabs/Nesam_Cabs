import type { NotificationRecord } from "../types";
import { toDate } from "../utils/time";

export const CATEGORIES = ["bookings", "approvals", "trips", "payments", "penalties", "general"] as const;
export type NotificationCategory = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  bookings: "Bookings", approvals: "Approvals", trips: "Trips", payments: "Payments", penalties: "Penalties", general: "General",
};

/** Records written before categories existed are classified from their type. */
export function categoryOf(n: Pick<NotificationRecord, "category" | "type">): NotificationCategory {
  if ((CATEGORIES as readonly string[]).includes(String(n.category))) return n.category as NotificationCategory;
  switch (n.type) {
    case "booking": return "bookings";
    case "driver":
    case "vendor":
    case "approval": return "approvals";
    case "trip":
    case "alert": return "trips";
    case "payment":
    case "payout": return "payments";
    case "penalty": return "penalties";
    default: return "general";
  }
}

export type Severity = "info" | "success" | "warning" | "critical";

export function severityOf(n: NotificationRecord): Severity {
  if (n.severity) return n.severity;
  if (n.priority === "urgent") return "critical";
  if (n.priority === "high") return "warning";
  return "info";
}

export type Tone = "blue" | "green" | "orange" | "red" | "purple" | "amber" | "neutral";

/** Colour of the popup / badge. Severity wins for warnings and critical alerts; otherwise the category decides. */
export function toneOf(n: NotificationRecord): Tone {
  const sev = severityOf(n);
  if (sev === "critical") return "red";
  const cat = categoryOf(n);
  if (sev === "warning") return cat === "trips" ? "amber" : cat === "penalties" ? "red" : "orange";
  switch (cat) {
    case "bookings": return "blue";
    case "approvals": return "green";
    case "payments": return sev === "success" ? "green" : "purple";
    case "penalties": return "red";
    case "trips": return "amber";
    default: return "neutral";
  }
}

export const TONE_CLASSES: Record<Tone, { box: string; accent: string; dot: string; chip: string }> = {
  blue: { box: "border-blue-300 bg-blue-50", accent: "bg-blue-600", dot: "#2563EB", chip: "text-blue-800 bg-blue-100" },
  green: { box: "border-green-300 bg-green-50", accent: "bg-green-600", dot: "#16A34A", chip: "text-green-800 bg-green-100" },
  orange: { box: "border-orange-300 bg-orange-50", accent: "bg-orange-500", dot: "#F97316", chip: "text-orange-800 bg-orange-100" },
  red: { box: "border-red-300 bg-red-50", accent: "bg-red-600", dot: "#DC2626", chip: "text-red-800 bg-red-100" },
  purple: { box: "border-purple-300 bg-purple-50", accent: "bg-purple-600", dot: "#9333EA", chip: "text-purple-800 bg-purple-100" },
  amber: { box: "border-amber-300 bg-amber-50", accent: "bg-amber-500", dot: "#F59E0B", chip: "text-amber-900 bg-amber-100" },
  neutral: { box: "border-gray-300 bg-white", accent: "bg-gray-500", dot: "#6B7280", chip: "text-gray-800 bg-gray-100" },
};

export function soundOf(n: NotificationRecord): "new_booking" | "approval" | "general" {
  if (n.sound === "new_booking" || n.sound === "approval" || n.sound === "general") return n.sound;
  const cat = categoryOf(n);
  if (cat === "approvals") return "approval";
  return "general";
}

/** Where a notification's action button goes. */
export function targetOf(n: NotificationRecord): { page: string; bookingId?: string } {
  if (n.cta?.page) return { page: n.cta.page, bookingId: n.cta.bookingId || n.bookingId };
  if (n.actionUrl) return { page: n.actionUrl, bookingId: n.bookingId };
  switch (categoryOf(n)) {
    case "bookings": return { page: n.bookingId ? "booking-detail" : "bookings", bookingId: n.bookingId };
    case "approvals": return { page: n.type === "vendor" ? "vendors" : "drivers" };
    case "trips": return { page: n.bookingId ? "booking-detail" : "trips", bookingId: n.bookingId };
    case "payments": return { page: n.bookingId ? "booking-detail" : "payments", bookingId: n.bookingId };
    case "penalties": return { page: "penalties" };
    default: return { page: "notifications" };
  }
}

export const ctaLabelOf = (n: NotificationRecord): string => {
  if (n.cta?.label) return n.cta.label;
  switch (categoryOf(n)) {
    case "bookings": return n.bookingId ? "View booking" : "Open bookings";
    case "approvals": return "Review";
    case "trips": return "Open trip";
    case "payments": return "View payment";
    case "penalties": return "View penalty";
    default: return "Open";
  }
};

export const createdMs = (n: NotificationRecord): number => toDate(n.createdAt as never)?.getTime() ?? 0;
