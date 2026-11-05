import { useState, useEffect, useMemo } from "react";
import { CATEGORIES, CATEGORY_LABEL, categoryOf } from "../services/notificationModel";
import DeliveryLog from "../components/DeliveryLog";
import { NotificationRecord } from "../types";
import {
  subscribeAdminNotifications,
  subscribeOutboundNotifications,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  dismissAdminNotification,
  sendAdminNotification,
  subscribeCustomers,
  subscribeDrivers,
  subscribeVendors,
} from "../services/adminFirestoreService";

interface NotificationsPageProps {
  onNavigate?: (page: string) => void;
}

const typeIcon: Record<string, { label: string; color: string; bg: string }> = {
  booking: { label: "Booking", color: "#059669", bg: "#ECFDF5" },
  payment: { label: "Finance", color: "#16A34A", bg: "#F0FDF4" },
  payout: { label: "Payout", color: "#16A34A", bg: "#F0FDF4" },
  trip: { label: "Trip", color: "#c1232c", bg: "#FEF2F2" },
  alert: { label: "Alert", color: "#DC2626", bg: "#FEF2F2" },
  vendor: { label: "Vendor", color: "#7C3AED", bg: "#F5F3FF" },
  driver: { label: "Driver", color: "#2563EB", bg: "#EFF6FF" },
  penalty: { label: "Penalty", color: "#D97706", bg: "#FFFBEB" },
  marketplace: { label: "Marketplace", color: "#D97706", bg: "#FFFBEB" },
  system: { label: "System", color: "#4B5563", bg: "#F3F4F6" },
};

const TEMPLATES = [
  {
    name: "KYC Reminder",
    target: "all_drivers" as const,
    channel: "In-App" as const,
    type: "driver",
    title: "Document Verification Required",
    message: "Please ensure your Driving License, RC, and Insurance documents are up to date to maintain online trip dispatch.",
  },
  {
    name: "Surge / Holiday Alert",
    target: "all_drivers" as const,
    channel: "Push Notification" as const,
    type: "alert",
    title: "High Demand Expected This Weekend!",
    message: "Festive season demand is active across Chennai, Coimbatore & Madurai routes. Go online to maximize your trip earnings.",
  },
  {
    name: "Customer Booking Offer",
    target: "all_customers" as const,
    channel: "WhatsApp" as const,
    type: "booking",
    title: "Flat ₹200 OFF on Outstation Cabs",
    message: "Planning a weekend getaway? Use promo code NESAM200 on your next outstation booking. Valid till Sunday midnight.",
  },
  {
    name: "System Maintenance Notice",
    target: "admin" as const,
    channel: "In-App" as const,
    type: "system",
    title: "Scheduled Maintenance Window",
    message: "Server maintenance scheduled for tonight from 02:00 AM to 03:00 AM IST. Offline dispatch procedures will be in effect.",
  },
];

export default function NotificationsPage({ onNavigate }: NotificationsPageProps) {
  const [activeTab, setActiveTab] = useState<"inbox" | "outbox" | "send" | "delivery">("inbox");
  const [filterType, setFilterType] = useState("All");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Inbound Admin Notifications & Operational Alerts
  const [adminNotifs, setAdminNotifs] = useState<NotificationRecord[]>([]);

  // Outbound Notifications (Sent to drivers, customers, vendors)
  const [outboundNotifs, setOutboundNotifs] = useState<NotificationRecord[]>([]);
  const [outboundFilter, setOutboundFilter] = useState<"all" | "driver" | "customer" | "vendor">("all");

  // User lists for recipient selection
  const [users, setUsers] = useState<{ id: string; name: string; type: "customer" | "driver" | "vendor" }[]>([]);

  // Compose State
  const [sendTarget, setSendTarget] = useState<"admin" | "all_drivers" | "all_customers" | "all_vendors" | "single_user">("admin");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [sendBrand, setSendBrand] = useState<"all" | "nesam" | "people_taxi" | "onewaycarrentals">("all");
  const [sendChannel, setSendChannel] = useState<"In-App" | "SMS" | "WhatsApp" | "Email" | "Push Notification">("In-App");
  const [sendCategory, setSendCategory] = useState("alert");
  const [sendTitle, setSendTitle] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendSuccessMessage, setSendSuccessMessage] = useState("");
  const [sendError, setSendError] = useState("");

  useEffect(() => {
    // 1. Subscribe to Admin notifications & real-time operational alerts
    const unsubAdmin = subscribeAdminNotifications(setAdminNotifs);

    // 2. Subscribe to outbound platform notifications
    const unsubOutbound = subscribeOutboundNotifications(setOutboundNotifs);

    // 3. Subscribe to users (customers, drivers, vendors)
    const unsubCust = subscribeCustomers((custs) =>
      setUsers((prev) => [
        ...prev.filter((u) => u.type !== "customer"),
        ...custs.map((c) => ({
          id: c.id,
          name: `${c.name || "Customer"} (${c.phone || c.email || "No contact"})`,
          type: "customer" as const,
        })),
      ]),
    );

    const unsubDrv = subscribeDrivers((drvs) =>
      setUsers((prev) => [
        ...prev.filter((u) => u.type !== "driver"),
        ...drvs.map((d) => ({
          id: d.id,
          name: `${d.name || "Driver"} (${d.phone || (d as any).vehicle || (d as any).vehicleNumber || "Driver"})`,
          type: "driver" as const,
        })),
      ]),
    );

    const unsubVend = subscribeVendors((vends) =>
      setUsers((prev) => [
        ...prev.filter((u) => u.type !== "vendor"),
        ...vends.map((v) => ({
          id: v.id,
          name: `${v.companyName || v.name || "Vendor"} (${v.phone || "Vendor"})`,
          type: "vendor" as const,
        })),
      ]),
    );

    return () => {
      unsubAdmin();
      unsubOutbound();
      unsubCust();
      unsubDrv();
      unsubVend();
    };
  }, []);

  const displayAdminNotifs = adminNotifs;
  const unreadCount = displayAdminNotifs.filter((n) => !n.read).length;

  // Filtered Admin Inbox Alerts
  const filteredAdminNotifs = useMemo(() => {
    return displayAdminNotifs
      .filter((n) => filterType === "All" || categoryOf(n) === filterType)
      .filter((n) => (!unreadOnly ? true : !n.read))
      .filter((n) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          n.title?.toLowerCase().includes(q) ||
          n.message?.toLowerCase().includes(q) ||
          n.type?.toLowerCase().includes(q)
        );
      });
  }, [displayAdminNotifs, filterType, unreadOnly, searchQuery]);

  // Filtered Outbound Notifications
  const filteredOutboundNotifs = useMemo(() => {
    return outboundNotifs
      .filter((n) => {
        if (outboundFilter === "all") return true;
        return n.recipientType === outboundFilter;
      })
      .filter((n) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          n.title?.toLowerCase().includes(q) ||
          n.message?.toLowerCase().includes(q) ||
          n.recipientName?.toLowerCase().includes(q) ||
          n.recipientType?.toLowerCase().includes(q)
        );
      });
  }, [outboundNotifs, outboundFilter, searchQuery]);

  const handleAction = (n: NotificationRecord) => {
    markAdminNotificationRead(n);
    if (!onNavigate) return;
    if (n.actionUrl) {
      onNavigate(n.actionUrl);
    } else if (n.type === "driver") {
      onNavigate("drivers");
    } else if (n.type === "booking") {
      onNavigate("bookings");
    } else if (n.type === "vendor") {
      onNavigate("vendors");
    } else if (n.type === "alert" || n.type === "trip") {
      onNavigate("trips");
    } else if (n.type === "penalty") {
      onNavigate("penalties");
    }
  };

  const handleSend = async () => {
    setSendError("");
    if (!sendTitle.trim() || !sendMessage.trim()) {
      setSendError("Enter both a title and a message.");
      return;
    }

    setIsSending(true);
    const selectedUser = users.find((u) => u.id === selectedUserId);

    const res = await sendAdminNotification({
      target: sendTarget,
      recipientId: selectedUserId,
      recipientName: selectedUser?.name,
      recipientType: selectedUser?.type,
      channel: sendChannel,
      type: sendCategory,
      title: sendTitle.trim(),
      message: sendMessage.trim(),
      ...(sendTarget === "all_customers" || sendTarget === "single_user" ? { brand: sendBrand } : {}),
    });

    setIsSending(false);
    if (res.success) {
      const detail = Object.entries(res.channels ?? {})
        .filter(([c]) => c !== "in_app")
        .map(([c, t]) => `${c}: ${t.sent} sent${t.failed ? `, ${t.failed} failed` : ""}${t.notConfigured ? `, ${t.notConfigured} not set up on the server` : ""}`)
        .join(" · ");
      setSendSuccessMessage(
        sendTarget === "admin"
          ? "Alert posted to the admin inbox."
          : `Sent to ${res.count} recipient${res.count === 1 ? "" : "s"}.${detail ? ` ${detail}.` : ""}`,
      );
      setSendTitle("");
      setSendMessage("");
      setTimeout(() => setSendSuccessMessage(""), 4000);
    } else {
      setSendError(res.error || "The notification was not sent. Check your connection and permissions, then try again.");
    }
  };

  const applyTemplate = (t: (typeof TEMPLATES)[0]) => {
    setSendTarget(t.target);
    setSendChannel(t.channel);
    setSendCategory(t.type);
    setSendTitle(t.title);
    setSendMessage(t.message);
  };

  const typesList: string[] = ["All", ...CATEGORIES];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Banner / Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-line">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-[22px] font-bold text-ink">
              Notifications &amp; Alert Center
            </h1>
            <span
              className="text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white"
              style={{ background: "#c1232c" }}
            >
              Super Admin Console
            </span>
          </div>
          <p className="text-[13px] text-muted mt-0.5">
            Real-time platform operations, live dispatch alerts, driver KYC updates, and communications.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Tab Controls */}
          <div className="flex items-center bg-hover p-1 rounded-xl border border-line">
            <button
              onClick={() => { setActiveTab("inbox"); setSearchQuery(""); }}
              className={`px-4 py-2 text-[12px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "inbox"
                  ? "bg-white text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              <span>Admin Alerts</span>
              {unreadCount > 0 && (
                <span className="w-4 h-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center" style={{ background: "#c1232c" }}>
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              onClick={() => { setActiveTab("outbox"); setSearchQuery(""); }}
              className={`px-4 py-2 text-[12px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "outbox"
                  ? "bg-white text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              <span>Sent Notices / Outbox</span>
              <span className="text-[11px] text-faint">({outboundNotifs.length})</span>
            </button>

            <button
              onClick={() => { setActiveTab("delivery"); setSearchQuery(""); }}
              className={`px-4 py-2 text-[12px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "delivery"
                  ? "bg-white text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              <span>Delivery log</span>
            </button>

            <button
              onClick={() => { setActiveTab("send"); setSearchQuery(""); }}
              className={`px-4 py-2 text-[12px] font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === "send"
                  ? "bg-white text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              <span>+ Compose &amp; Send</span>
            </button>
          </div>
        </div>
      </div>

      {activeTab === "delivery" && <DeliveryLog />}

      {/* TAB 1: ADMIN ALERTS INBOX */}
      {activeTab === "inbox" && (
        <div className="space-y-5">
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-line p-4 shadow-xs">
              <div className="text-[11px] font-semibold text-faint uppercase tracking-wider">Total Alerts</div>
              <div className="text-[24px] font-extrabold text-ink mt-1">{displayAdminNotifs.length}</div>
            </div>
            <div className="bg-white rounded-xl border border-line p-4 shadow-xs">
              <div className="text-[11px] font-semibold text-faint uppercase tracking-wider">Unread Action Items</div>
              <div className="text-[24px] font-extrabold mt-1" style={{ color: "#c1232c" }}>
                {unreadCount}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-line p-4 shadow-xs">
              <div className="text-[11px] font-semibold text-faint uppercase tracking-wider">Approvals</div>
              <div className="text-[24px] font-extrabold text-blue-600 mt-1">
                {displayAdminNotifs.filter((n) => categoryOf(n) === "approvals").length}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-line p-4 shadow-xs">
              <div className="text-[11px] font-semibold text-faint uppercase tracking-wider">Bookings &amp; trips</div>
              <div className="text-[24px] font-extrabold text-emerald-600 mt-1">
                {displayAdminNotifs.filter((n) => ["bookings", "trips"].includes(categoryOf(n))).length}
              </div>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-xl border border-line p-3 shadow-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              {typesList.map((t) => {
                const isSelected = filterType === t;
                const count = t === "All" ? displayAdminNotifs.length : displayAdminNotifs.filter((n) => categoryOf(n) === t).length;
                return (
                  <button
                    key={t}
                    onClick={() => setFilterType(t)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all capitalize cursor-pointer ${
                      isSelected
                        ? "text-white"
                        : "text-muted bg-hover hover:bg-line hover:text-ink"
                    }`}
                    style={isSelected ? { background: "#c1232c" } : {}}
                  >
                    {t === "All" ? "All" : CATEGORY_LABEL[t as keyof typeof CATEGORY_LABEL]} <span className="opacity-70">({count})</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setUnreadOnly(!unreadOnly)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                  unreadOnly
                    ? "bg-brand-soft text-brand border-brand"
                    : "bg-white text-muted border-line hover:bg-hover"
                }`}
              >
                {unreadOnly ? "Showing: Unread Only" : "Filter: All Status"}
              </button>

              {unreadCount > 0 && (
                <button
                  onClick={() => markAllAdminNotificationsRead(displayAdminNotifs)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white transition-opacity hover:opacity-90 cursor-pointer"
                  style={{ background: "#111" }}
                >
                  Mark All Read
                </button>
              )}
            </div>
          </div>

          {/* Alerts List */}
          <div className="bg-white rounded-xl border border-line shadow-xs overflow-hidden divide-y divide-hover">
            {filteredAdminNotifs.length === 0 ? (
              <div className="py-16 text-center">
                <div className="w-12 h-12 rounded-full bg-hover mx-auto flex items-center justify-center text-green-600 mb-3">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="text-[14px] font-bold text-ink">No notifications to display</div>
                <div className="text-[12px] text-faint mt-1 mb-4">
                  {unreadOnly
                    ? "All notifications have been marked as read."
                    : "No active platform alerts match the selected criteria."}
                </div>
              </div>
            ) : (
              filteredAdminNotifs.map((n) => {
                const badge = typeIcon[n.type] || typeIcon.system;
                return (
                  <div
                    key={n.id}
                    className={`p-4 sm:p-5 flex flex-col sm:flex-row items-start justify-between gap-4 transition-colors ${
                      !n.read ? "bg-brand-soft" : "bg-white hover:bg-surface-2"
                    }`}
                  >
                    <div className="flex items-start gap-3.5 flex-1 min-w-0">
                      <div
                        className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0"
                        style={{ background: !n.read ? "#c1232c" : "#D1D5DB" }}
                      />

                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider"
                            style={{ color: badge.color, backgroundColor: badge.bg }}
                          >
                            {badge.label}
                          </span>
                          {n.priority === "urgent" && (
                            <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-red-600 text-white animate-pulse">
                              URGENT
                            </span>
                          )}
                          {n.isSystemAlert && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                              System Real-time
                            </span>
                          )}
                          <span className="text-[11px] text-faint font-medium ml-auto sm:ml-0">
                            {n.time}
                          </span>
                        </div>

                        <div className="text-[13px] font-bold text-ink leading-snug">
                          {n.title}
                        </div>

                        <div className="text-[12px] text-muted leading-relaxed">
                          {n.message}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      <button
                        onClick={() => handleAction(n)}
                        className="px-3.5 py-1.5 text-[11px] font-bold text-white rounded-lg transition-all hover:opacity-90 cursor-pointer flex items-center gap-1 shadow-xs"
                        style={{ background: "#c1232c" }}
                      >
                        <span>Take Action</span>
                        <span>&rarr;</span>
                      </button>

                      <button
                        onClick={() => markAdminNotificationRead({ ...n, read: !n.read })}
                        title={n.read ? "Mark as unread" : "Mark as read"}
                        className="px-2.5 py-1.5 text-[11px] font-semibold text-muted hover:text-ink border border-line rounded-lg hover:bg-hover transition-colors cursor-pointer"
                      >
                        {n.read ? "Mark Unread" : "Mark Read"}
                      </button>

                      <button
                        onClick={() => dismissAdminNotification(n)}
                        title="Dismiss notification"
                        className="p-1.5 text-faint hover:text-brand rounded-lg hover:bg-brand-soft transition-colors cursor-pointer"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 2: SENT NOTIFICATIONS / OUTBOX AUDIT LOG */}
      {activeTab === "outbox" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-xl border border-line p-3 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-bold text-ink">Recipient Filter:</span>
              {(["all", "driver", "customer", "vendor"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setOutboundFilter(r)}
                  className={`px-3 py-1 rounded-lg text-[11px] font-bold capitalize transition-colors cursor-pointer ${
                    outboundFilter === r
                      ? "text-white"
                      : "text-muted bg-hover hover:bg-line"
                  }`}
                  style={outboundFilter === r ? { background: "#111" } : {}}
                >
                  {r === "all" ? "All Recipients" : `${r}s`}
                </button>
              ))}
            </div>

            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search outbox..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-1.5 text-[12px] bg-hover border border-line rounded-lg w-56 focus:outline-none focus:border-brand"
              />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-line shadow-xs overflow-hidden divide-y divide-hover">
            {filteredOutboundNotifs.length === 0 ? (
              <div className="py-16 text-center text-faint text-[13px]">
                No outbound notifications matching current filter.
              </div>
            ) : (
              filteredOutboundNotifs.map((n) => {
                const isDriver = n.recipientType === "driver";
                const isCustomer = n.recipientType === "customer";
                const isVendor = n.recipientType === "vendor";

                return (
                  <div key={n.id} className="p-4 sm:p-5 flex flex-col sm:flex-row items-start justify-between gap-4">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                            isDriver
                              ? "bg-blue-100 text-blue-700"
                              : isCustomer
                                ? "bg-emerald-100 text-emerald-700"
                                : isVendor
                                  ? "bg-purple-100 text-purple-700"
                                  : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          Target: {n.recipientType || "Broadcast"}
                        </span>

                        {n.channel && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                            Channel: {n.channel}
                          </span>
                        )}

                        <span className="text-[11px] text-faint">
                          Sent {n.time}
                        </span>
                      </div>

                      <div className="text-[13px] font-bold text-ink">
                        {n.title}
                      </div>

                      <div className="text-[12px] text-muted leading-relaxed">
                        {n.message}
                      </div>

                      {n.recipientId && (
                        <div className="text-[10px] text-faint font-mono">
                          Recipient ID: {n.recipientId} {n.recipientName ? `• ${n.recipientName}` : ""}
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 flex items-center gap-2 self-end sm:self-center">
                      <span
                        className={`text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${
                          n.read
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${n.read ? "bg-green-600" : "bg-gray-400"}`} />
                        {n.read ? "Read by recipient" : "Delivered / Unopened"}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 3: COMPOSE & SEND */}
      {activeTab === "send" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-line p-6 shadow-xs space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-hover">
              <h2 className="text-[15px] font-bold text-ink flex items-center gap-2">
                <span className="w-1.5 h-4 rounded-full" style={{ background: "#c1232c" }} />
                Compose Broadcast or Direct Notification
              </h2>
            </div>

            {sendSuccessMessage && (
              <div className="p-3 bg-green-50 border border-green-200 text-green-800 rounded-lg text-[13px] font-semibold flex items-center gap-2">
                <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {sendSuccessMessage}
              </div>
            )}

            {/* Recipient Target */}
            <div>
              <label className="text-[11px] font-bold text-faint uppercase tracking-wider block mb-2">
                Target Audience
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  { id: "admin", label: "Super Admin" },
                  { id: "all_drivers", label: "All Drivers" },
                  { id: "all_customers", label: "All Customers" },
                  { id: "all_vendors", label: "All Vendors" },
                  { id: "single_user", label: "Specific User" },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSendTarget(t.id as any)}
                    className={`py-2 px-2.5 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                      sendTarget === t.id
                        ? "text-white border-transparent shadow-xs"
                        : "text-muted border-line hover:bg-hover"
                    }`}
                    style={sendTarget === t.id ? { background: "#111" } : {}}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {(sendTarget === "all_customers" || sendTarget === "single_user") && (
                <div className="mt-3">
                  <label htmlFor="send-brand" className="text-[11px] font-semibold text-faint block mb-1">
                    Show this to riders of
                  </label>
                  <select
                    id="send-brand"
                    value={sendBrand}
                    onChange={(e) => setSendBrand(e.target.value as typeof sendBrand)}
                    className="w-full px-3 py-2 text-[13px] border border-line rounded-lg focus:outline-none focus:border-brand"
                  >
                    <option value="all">All sites (NESAM, People Taxi, One Way Car Rentals)</option>
                    <option value="nesam">NESAM Cabs only</option>
                    <option value="people_taxi">People Taxi only</option>
                    <option value="onewaycarrentals">One Way Car Rentals only</option>
                  </select>
                </div>
              )}

              {sendTarget === "single_user" && (
                <div className="mt-3">
                  <label className="text-[11px] font-semibold text-faint block mb-1">
                    Select User / Driver / Vendor
                  </label>
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="w-full px-3 py-2 text-[13px] border border-line rounded-lg focus:outline-none focus:border-brand"
                  >
                    <option value="">-- Choose recipient --</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        [{u.type.toUpperCase()}] {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Channel Selection */}
            <div>
              <label className="text-[11px] font-bold text-faint uppercase tracking-wider block mb-2">
                Delivery Channel
              </label>
              <div className="flex flex-wrap gap-2">
                {(["In-App", "SMS", "WhatsApp", "Email", "Push Notification"] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setSendChannel(ch)}
                    className={`px-3.5 py-1.5 rounded-lg text-[12px] font-bold border transition-all cursor-pointer ${
                      sendChannel === ch
                        ? "bg-brand-soft text-brand border-brand"
                        : "text-muted border-line hover:bg-hover"
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>

            {/* Category / Type */}
            <div>
              <label className="text-[11px] font-bold text-faint uppercase tracking-wider block mb-2">
                Alert Category
              </label>
              <select
                value={sendCategory}
                onChange={(e) => setSendCategory(e.target.value)}
                className="w-full px-3 py-2 text-[13px] border border-line rounded-lg focus:outline-none focus:border-brand"
              >
                <option value="alert">General Alert &amp; Warning</option>
                <option value="driver">Driver Compliance / Operation</option>
                <option value="booking">Booking &amp; Trip Notice</option>
                <option value="vendor">Vendor Notification</option>
                <option value="payment">Payment &amp; Wallet</option>
                <option value="system">System Maintenance</option>
              </select>
            </div>

            {/* Title */}
            <div>
              <label className="text-[11px] font-bold text-faint uppercase tracking-wider block mb-2">
                Subject / Title
              </label>
              <input
                type="text"
                value={sendTitle}
                onChange={(e) => setSendTitle(e.target.value)}
                placeholder="e.g. Action Required: Vehicle Inspection"
                className="w-full px-3 py-2 text-[13px] border border-line rounded-lg focus:outline-none focus:border-brand"
              />
            </div>

            {/* Message Body */}
            <div>
              <label className="text-[11px] font-bold text-faint uppercase tracking-wider block mb-2">
                Message Body
              </label>
              <textarea
                rows={4}
                value={sendMessage}
                onChange={(e) => setSendMessage(e.target.value)}
                placeholder="Enter complete notification message..."
                className="w-full px-3 py-2 text-[13px] border border-line rounded-lg focus:outline-none focus:border-brand resize-none"
              />
              <div className="flex justify-between items-center text-[11px] text-faint mt-1">
                <span>Plain text — sent as written to each channel</span>
                <span>{sendMessage.length} chars</span>
              </div>
            </div>

            {sendError && <div role="alert" className="ds-error mb-3">{sendError}</div>}
            {/* Submit Action */}
            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                disabled={isSending}
                onClick={handleSend}
                className="px-6 py-2.5 text-[13px] font-bold text-white rounded-lg transition-all hover:opacity-90 disabled:opacity-50 cursor-pointer flex items-center gap-2"
                style={{ background: "#c1232c" }}
              >
                {isSending ? (
                  <>
                    <svg className="animate-spin w-4 h-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Dispatching...</span>
                  </>
                ) : (
                  <>
                    <span>Dispatch Notification</span>
                    <span>&rarr;</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick Presets & Live Preview */}
          <div className="space-y-4">
            {/* Live Preview Card */}
            <div className="bg-white rounded-xl border border-line p-5 shadow-xs">
              <div className="text-[11px] font-bold text-faint uppercase tracking-wider mb-3">
                Live Preview (Recipient View)
              </div>
              <div className="p-3.5 rounded-lg border border-line bg-surface-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-700 uppercase">
                    {sendCategory}
                  </span>
                  <span className="text-[10px] text-faint">Just now</span>
                </div>
                <div className="text-[13px] font-bold text-ink">
                  {sendTitle.trim() || "Notification Title"}
                </div>
                <div className="text-[12px] text-muted leading-relaxed">
                  {sendMessage.trim() || "Notification body text will render here as recipients see it."}
                </div>
                <div className="pt-1 text-[10px] text-faint flex items-center justify-between border-t border-line">
                  <span>Via {sendChannel}</span>
                  <span className="font-semibold text-brand">Nesam System</span>
                </div>
              </div>
            </div>

            {/* Quick Templates */}
            <div className="bg-white rounded-xl border border-line p-5 shadow-xs space-y-3">
              <div className="text-[11px] font-bold text-faint uppercase tracking-wider">
                Quick Template Presets
              </div>
              <div className="space-y-2">
                {TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.name}
                    type="button"
                    onClick={() => applyTemplate(tmpl)}
                    className="w-full text-left p-2.5 rounded-lg border border-line hover:border-brand hover:bg-brand-soft transition-all cursor-pointer group"
                  >
                    <div className="text-[12px] font-bold text-ink group-hover:text-brand">
                      {tmpl.name}
                    </div>
                    <div className="text-[11px] text-muted line-clamp-1 mt-0.5">
                      {tmpl.title}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
