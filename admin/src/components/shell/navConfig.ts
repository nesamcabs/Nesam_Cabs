import type { IconName } from "../ui/Icon";

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Sidebar in the Master Admin order (Operations / People & Fleet / Finance / Office): the reference
 * pages come first with the reference labels and icons; pages the app has beyond the reference
 * follow inside the group they belong to, so nothing that existed before is lost.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    // The day's work: bookings coming in, trips on the road, duties out to partners, partner and customer requests.
    label: "Operations",
    items: [
      { id: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
      { id: "bookings", label: "Bookings", icon: "calendar-check-2" },
      { id: "trips", label: "Trips", icon: "route" },
      { id: "local-taxi", label: "Local Taxi", icon: "map-pinned" },
      { id: "marketplace", label: "Open Marketplace", icon: "radio-tower" },
      { id: "partner-requests", label: "Partner Requests", icon: "inbox" },
      { id: "support", label: "Support", icon: "headset" },
    ],
  },
  {
    label: "People & Fleet",
    items: [
      { id: "customers", label: "Customers", icon: "contact-round" },
      { id: "business", label: "Business accounts", icon: "building-2" },
      { id: "drivers", label: "Driver Partners", icon: "user-round-check" },
      { id: "vendors", label: "Vendors", icon: "building" },
      { id: "vendor-drivers", label: "Vendor Drivers", icon: "users-round" },
      { id: "vehicles", label: "Vehicles", icon: "car-front" },
      { id: "verification", label: "Verification", icon: "file-check-2" },
      { id: "partner-links", label: "Partner Links", icon: "link" },
    ],
  },
  {
    // Money in (payments, invoices), money out (earnings, vendor finance), then the controls and reports.
    label: "Finance",
    items: [
      { id: "payments", label: "Payments", icon: "receipt-indian-rupee" },
      { id: "invoices", label: "Invoices", icon: "files" },
      { id: "accounts", label: "Accounts", icon: "wallet-cards" },
      { id: "earnings", label: "Driver Earnings", icon: "wallet" },
      { id: "vendor-finance", label: "Vendor Finance", icon: "landmark" },
      { id: "penalties", label: "Penalties", icon: "shield-alert" },
      { id: "full-final", label: "Full & Final", icon: "clipboard-check" },
      { id: "security-deposit", label: "Security Deposit", icon: "shield-check" },
      { id: "reports", label: "Reports & GST", icon: "chart-no-axes-combined" },
    ],
  },
  {
    // What customers can book and what it costs.
    label: "Pricing & Catalogue",
    items: [
      { id: "pricing", label: "Service & Fare Settings", icon: "sliders-horizontal" },
      { id: "offers", label: "Offers & Coupons", icon: "ticket-percent" },
      { id: "services", label: "Services", icon: "briefcase" },
      { id: "packages", label: "Tour Packages", icon: "map" },
      { id: "locations", label: "Locations", icon: "map-pin" },
    ],
  },
  {
    label: "Customers & Content",
    items: [
      { id: "notifications", label: "Communication", icon: "megaphone" },
      { id: "reviews", label: "Reviews", icon: "star" },
      { id: "legal", label: "Terms & Privacy", icon: "file-text" },
      { id: "b2b", label: "B2B Integrations", icon: "globe" },
    ],
  },
  {
    label: "Administration",
    items: [
      { id: "staff", label: "Staff & Access", icon: "shield-user" },
      { id: "security", label: "Staff activity", icon: "history" },
      { id: "settings", label: "Settings", icon: "settings" },
    ],
  },
];

/** The sidebar group a page belongs to (used by the top bar breadcrumb so both always agree). */
export const groupOfPage = (id: string): string | undefined => NAV_GROUPS.find((g) => g.items.some((i) => i.id === id))?.label;
