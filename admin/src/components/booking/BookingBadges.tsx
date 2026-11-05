import { FULFILMENT_LABEL, fulfilmentOf, type AlertSeverity, type Fulfilment } from "../../domain/bookingFlow";

const STATUS: Record<string, string> = {
  Pending: "bg-yellow-50 text-yellow-800 border-yellow-300",
  Approved: "bg-sky-50 text-sky-800 border-sky-300",
  Confirmed: "bg-blue-50 text-blue-800 border-blue-300",
  Assigned: "bg-indigo-50 text-indigo-800 border-indigo-300",
  Ongoing: "bg-orange-50 text-orange-800 border-orange-300",
  Completed: "bg-green-50 text-green-800 border-green-300",
  Cancelled: "bg-red-50 text-red-800 border-red-300",
  Rejected: "bg-red-50 text-red-800 border-red-300",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS[status] || "bg-gray-50 text-gray-700 border-gray-300"}`}>{status}</span>
  );
}

const PAYMENT: Record<string, string> = {
  Paid: "text-green-800 bg-green-50 border-green-300",
  "Partially Paid": "text-amber-900 bg-amber-50 border-amber-300",
  Unpaid: "text-red-800 bg-red-50 border-red-300",
  "Refund Pending": "text-purple-800 bg-purple-50 border-purple-300",
  Refunded: "text-gray-700 bg-gray-100 border-gray-300",
};

export function PaymentBadge({ status }: { status: string }) {
  return <span className={`inline-flex px-2 py-0.5 rounded border text-xs font-semibold ${PAYMENT[status] || "bg-gray-50 text-gray-700 border-gray-300"}`}>{status}</span>;
}

export function AlertBadge({ severity, label }: { severity: AlertSeverity; label?: string }) {
  if (severity === "none" || severity === "normal") return null;
  const cls = severity === "critical" ? "bg-red-600 text-white border-red-700" : "bg-amber-100 text-amber-900 border-amber-400";
  return (
    <span role="status" className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold ${cls}`}>
      {severity === "critical" ? "⚠ URGENT" : "⚠ No driver"}
      {label ? ` · ${label}` : ""}
    </span>
  );
}

const FULFILMENT_STYLE: Partial<Record<Fulfilment, string>> = {
  awaiting_review: "bg-yellow-50 text-yellow-800 border-yellow-300",
  awaiting_fulfilment: "bg-orange-50 text-orange-800 border-orange-300",
  published: "bg-emerald-50 text-emerald-800 border-emerald-300",
  vendor_assigned: "bg-blue-50 text-blue-800 border-blue-300",
  driver_assigned: "bg-indigo-50 text-indigo-800 border-indigo-300",
};

/** Where an open booking is in fulfilment: awaiting a route, published, vendor-held or fully assigned. */
export function FulfilmentBadge({ booking }: { booking: { status?: unknown; assignedVendorId?: unknown; assignedDriverId?: unknown; fulfilmentRoute?: unknown } }) {
  const f = fulfilmentOf(booking);
  const cls = FULFILMENT_STYLE[f];
  if (!cls) return null;
  return <span className={`inline-flex px-2 py-0.5 rounded border text-xs font-semibold ${cls}`}>{FULFILMENT_LABEL[f]}</span>;
}

export type BookingSourceType = "nesam" | "onewaycarrentals" | "people_taxi";

export function getBookingSource(b: { source?: string; bookingSource?: string; brand?: string; website?: string; notes?: string } | null | undefined): BookingSourceType {
  if (!b) return "nesam";
  const raw = `${b.bookingSource || ""} ${b.source || ""} ${b.brand || ""} ${b.website || ""}`.toLowerCase();
  if (raw.includes("oneway") || raw.includes("one_way") || raw.includes("one-way")) return "onewaycarrentals";
  if (raw.includes("people") || raw.includes("peopletaxi")) return "people_taxi";
  const notes = (b.notes || "").toLowerCase();
  if (notes.includes("onewaycarrental") || notes.includes("one way car rental")) return "onewaycarrentals";
  if (notes.includes("people taxi") || notes.includes("peopletaxi")) return "people_taxi";
  return "nesam";
}

export function bookingSourceRowCls(b: { source?: string; bookingSource?: string; brand?: string; website?: string; notes?: string } | null | undefined): string {
  const s = getBookingSource(b);
  if (s === "onewaycarrentals") return "border-l-4 border-l-emerald-500 bg-emerald-50/20";
  if (s === "people_taxi") return "border-l-4 border-l-blue-500 bg-blue-50/20";
  return "";
}

export function BookingSourceBadge({
  booking,
  source,
  size = "sm",
  showNesam = false,
  className = "",
}: {
  booking?: { source?: string; bookingSource?: string; brand?: string; website?: string; notes?: string } | null;
  source?: BookingSourceType;
  size?: "sm" | "md" | "lg";
  showNesam?: boolean;
  className?: string;
}) {
  const s = source ?? getBookingSource(booking);
  if (s === "nesam" && !showNesam) return null;

  if (s === "onewaycarrentals") {
    const iconSize = size === "lg" ? "w-5 h-5" : size === "md" ? "w-4 h-4" : "w-3.5 h-3.5";
    const pad = size === "lg" ? "px-3 py-1 text-xs" : size === "md" ? "px-2.5 py-0.5 text-xs" : "px-2 py-0.5 text-[11px]";
    return (
      <span
        title="Booked from One Way Car Rentals website"
        className={`inline-flex items-center gap-1.5 font-bold rounded-full bg-emerald-50 text-emerald-800 border border-emerald-400 shadow-2xs ${pad} ${className}`}
      >
        <img
          src="/brand/ow-icon-192.png"
          alt=""
          className={`${iconSize} rounded-full object-contain shrink-0 ring-1 ring-emerald-300 bg-black/10`}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = "/brand/logo.svg";
          }}
        />
        <span>One Way Car Rentals</span>
      </span>
    );
  }

  if (s === "people_taxi") {
    const iconSize = size === "lg" ? "w-5 h-5" : size === "md" ? "w-4 h-4" : "w-3.5 h-3.5";
    const pad = size === "lg" ? "px-3 py-1 text-xs" : size === "md" ? "px-2.5 py-0.5 text-xs" : "px-2 py-0.5 text-[11px]";
    return (
      <span
        title="Booked from People Taxi website"
        className={`inline-flex items-center gap-1.5 font-bold rounded-full bg-blue-50 text-blue-800 border border-blue-400 shadow-2xs ${pad} ${className}`}
      >
        <img
          src="/brand/peopletaxi-icon-192.png"
          alt=""
          className={`${iconSize} rounded-full object-contain shrink-0 ring-1 ring-blue-300 bg-white`}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = "/brand/peopletaxi-icon.png";
          }}
        />
        <span>People Taxi</span>
      </span>
    );
  }

  if (s === "nesam" && showNesam) {
    const iconSize = size === "lg" ? "w-5 h-5" : size === "md" ? "w-4 h-4" : "w-3.5 h-3.5";
    const pad = size === "lg" ? "px-3 py-1 text-xs" : size === "md" ? "px-2.5 py-0.5 text-xs" : "px-2 py-0.5 text-[11px]";
    return (
      <span
        title="Booked from Nesam Travels"
        className={`inline-flex items-center gap-1.5 font-bold rounded-full bg-gray-100 text-body border border-gray-300 ${pad} ${className}`}
      >
        <img
          src="/logo.png"
          alt=""
          className={`${iconSize} rounded-full object-contain shrink-0`}
        />
        <span>Nesam Travels</span>
      </span>
    );
  }

  return null;
}

/** Table cell for the Website / Source column: the real source badge, "Nesam" only when explicitly stored, otherwise "Unknown". */
export type BookingSourceDisplay = BookingSourceType | "unknown";

/** Source as shown in the table: "nesam" only when explicitly stored, otherwise "unknown". */
export function getBookingSourceDisplay(b: { source?: string; bookingSource?: string; brand?: string; website?: string; notes?: string } | null | undefined): BookingSourceDisplay {
  const s = getBookingSource(b);
  if (s !== "nesam") return s;
  const raw = `${b?.bookingSource || ""} ${b?.source || ""} ${b?.brand || ""} ${b?.website || ""}`.toLowerCase();
  return raw.includes("nesam") ? "nesam" : "unknown";
}

/** Full-row tint + hover per source for the bookings table. Hover is set on the row, so it needs the `data-source` attribute (see index.css). */
export const BOOKING_SOURCE_TABLE_ROW_CLS: Record<BookingSourceDisplay, string> = {
  onewaycarrentals: "border-l-4 border-l-emerald-500 bg-[#D1FAE5] hover:bg-[#A7F3D0]",
  people_taxi: "border-l-4 border-l-blue-500 bg-[#DBEAFE] hover:bg-[#BFDBFE]",
  nesam: "bg-[#FEE2E2] hover:bg-[#FECACA]",
  unknown: "hover:bg-gray-50",
};

export function BookingSourceCell({ booking }: { booking?: { source?: string; bookingSource?: string; brand?: string; website?: string; notes?: string } | null }) {
  const s = getBookingSourceDisplay(booking);
  if (s === "onewaycarrentals" || s === "people_taxi") return <BookingSourceBadge booking={booking} size="sm" />;
  if (s === "nesam") return <BookingSourceBadge source="nesam" showNesam size="sm" />;
  return <span className="inline-flex px-2 py-0.5 rounded-full border border-gray-300 bg-gray-50 text-[11px] font-semibold text-[#555]">Unknown</span>;
}

export function BookingSourceBanner({
  booking,
  className = "",
}: {
  booking?: { source?: string; bookingSource?: string; brand?: string; website?: string; notes?: string } | null;
  className?: string;
}) {
  const s = getBookingSource(booking);
  if (s === "nesam") return null;

  if (s === "onewaycarrentals") {
    return (
      <div className={`flex items-center gap-3 p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 shadow-xs ${className}`}>
        <img
          src="/brand/ow-icon-192.png"
          alt="One Way Car Rentals"
          className="w-8 h-8 rounded-full object-contain ring-2 ring-emerald-400 bg-black/10 shrink-0"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = "/brand/logo.svg";
          }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm text-emerald-900">Booked from One Way Car Rentals</span>
            <span className="text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-600 text-white">Online Website Booking</span>
          </div>
          <p className="text-xs text-emerald-700 mt-0.5">This customer requested a ride directly through the One Way Car Rentals website portal.</p>
        </div>
      </div>
    );
  }

  if (s === "people_taxi") {
    return (
      <div className={`flex items-center gap-3 p-3.5 rounded-xl bg-blue-50 border border-blue-300 text-blue-900 shadow-xs ${className}`}>
        <img
          src="/brand/peopletaxi-icon-192.png"
          alt="People Taxi"
          className="w-8 h-8 rounded-full object-contain ring-2 ring-blue-400 bg-white shrink-0"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = "/brand/peopletaxi-icon.png";
          }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm text-blue-900">Booked from People Taxi</span>
            <span className="text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-600 text-white">Online Website Booking</span>
          </div>
          <p className="text-xs text-blue-700 mt-0.5">This customer requested a ride directly through the People Taxi website portal.</p>
        </div>
      </div>
    );
  }

  return null;
}
