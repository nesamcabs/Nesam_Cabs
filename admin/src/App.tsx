import { useState, useEffect, useRef } from "react";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import {
  subscribeToAdminSession,
  signOutAdmin,
  type AdminSession,
} from "./services/authService";

// Pages — Existing
import Dashboard from "./pages/Dashboard";
import Bookings from "./pages/Bookings";
import BookingDetails from "./pages/BookingDetails";
import Customers from "./pages/Customers";
import Drivers from "./pages/Drivers";
import Vehicles from "./pages/Vehicles";
import Payments from "./pages/Payments";
import Invoices from "./pages/Invoices";
import Services from "./pages/Services";
import TourPackages from "./pages/TourPackages";
import Locations from "./pages/Locations";
import LocalTaxi from "./pages/LocalTaxi";
import Pricing, { CATEGORIES_VIEW, MORE_SETTINGS_VIEW, type PricingView } from "./pages/Pricing";
import Support from "./pages/Support";
import Offers from "./pages/Offers";
import Reviews from "./pages/Reviews";
import Settings from "./pages/Settings";

// Pages — New (Enterprise Multi-Vendor)
import Vendors from "./pages/Vendors";
import PartnerLinks from "./pages/PartnerLinks";
import PartnerRequests from "./pages/PartnerRequests";
import Marketplace from "./pages/Marketplace";
import Trips from "./pages/Trips";
import Penalties from "./pages/Penalties";
import DriverEarnings from "./pages/DriverEarnings";
import VendorFinance from "./pages/VendorFinance";
import CommissionPolicy from "./pages/CommissionPolicy";
import ReportsGst from "./pages/ReportsGst";
import Communication from "./pages/Communication";
import StaffRoles from "./pages/StaffRoles";
import SecurityEvents from "./pages/SecurityEvents";
import LegalDocuments from "./pages/LegalDocuments";
import LegalGate from "./components/LegalGate";
import B2BIntegrations from "./pages/B2BIntegrations";
import NewBooking, { type NewBookingDraft } from "./pages/NewBooking";
import QuickFare from "./pages/QuickFare";
import { emptyTrip } from "./components/booking/QuickFare";
import BusinessAccounts from "./pages/BusinessAccounts";
import VendorDrivers from "./pages/VendorDrivers";
import Verification from "./pages/Verification";
import Accounts from "./pages/Accounts";
import FullFinal from "./pages/FullFinal";
import type { Enquiry } from "./services/enquiryService";
import { AccessProvider } from "./components/AccessContext";
import { endStaffSession, logActivity, startStaffSession } from "./services/staffSessionService";
import { NotificationProvider } from "./components/NotificationHost";
import { Toast, useToast } from "./components/Feedback";
import { canAccessPage, canExportFrom, landingPage, needsRedactedBookings } from "./config/permissions";
import { setRedactedBookingReads } from "./services/adminFirestoreService";
import { setExportGuard } from "./utils/exportData";
import { useNavBadges } from "./hooks/useNavBadges";
import { NAV_GROUPS, groupOfPage } from "./components/shell/navConfig";
import { resolveAdminDestination } from "./config/adminNavigation";
import { canLeaveFareWorkspace } from "./services/fareWorkspaceGuard";
import { PermissionDenied } from "./components/ui";

const pageMeta: Record<string, { title: string; breadcrumb: string[] }> = {
  dashboard: { title: "Dashboard", breadcrumb: ["Operations"] },
  bookings: { title: "All Bookings", breadcrumb: ["Operations", "Bookings"] },
  "new-booking": { title: "Bookings", breadcrumb: ["Operations", "Bookings"] },
  "quick-fare": { title: "Quick fare", breadcrumb: ["Operations", "Quick fare"] },
  business: { title: "Business accounts", breadcrumb: ["People & Fleet", ""] },
  "vendor-drivers": { title: "Vendor Drivers", breadcrumb: ["People & Fleet", ""] },
  verification: { title: "Verification", breadcrumb: ["People & Fleet", ""] },
  accounts: { title: "Accounts", breadcrumb: ["Finance", ""] },
  "full-final": { title: "Full & Final", breadcrumb: ["Finance", ""] },
  "booking-detail": { title: "Bookings", breadcrumb: ["Operations", "Bookings", "Details"] },
  trips: { title: "Live Trips", breadcrumb: ["Operations", "Trips"] },
  marketplace: { title: "Open Trip Marketplace", breadcrumb: ["Operations", "Open Marketplace"] },
  customers: { title: "Customers", breadcrumb: ["People & Fleet", ""] },
  vendors: { title: "Vendor Management", breadcrumb: ["People & Fleet", ""] },
  drivers: { title: "Drivers", breadcrumb: ["People & Fleet", "Driver Partners"] },
  "partner-links": { title: "Partner Links", breadcrumb: ["People & Fleet", ""] },
  "partner-requests": { title: "Partner Requests", breadcrumb: ["Operations", ""] },
  vehicles: { title: "Vehicles", breadcrumb: ["People & Fleet", ""] },
  // Older entry point: opens Service & Fare Settings → Cab types → Vehicle categories.
  categories: { title: "Vehicle Categories", breadcrumb: ["Office", "Service & Fare Settings", "Cab types"] },
  services: { title: "Services", breadcrumb: ["Office", ""] },
  packages: { title: "Tour Packages", breadcrumb: ["Office", ""] },
  locations: { title: "Locations", breadcrumb: ["Office", ""] },
  pricing: { title: "Pricing & Fare Management", breadcrumb: ["Office", "Pricing & Fare"] },
  "local-taxi": { title: "Local Taxi", breadcrumb: ["Operations", "Local Taxi"] },
  "fare-rules": { title: "Service & Fare Settings", breadcrumb: ["Office", "Service & Fare Settings"] },
  "extra-charges": { title: "Service & Fare Settings", breadcrumb: ["Office", "Service & Fare Settings", "Extra charges"] },
  offers: { title: "Offers & Coupons", breadcrumb: ["Office", ""] },
  payments: { title: "Payments", breadcrumb: ["Finance", ""] },
  invoices: { title: "Invoices", breadcrumb: ["Finance", ""] },
  earnings: { title: "Driver Earnings & TDS", breadcrumb: ["Finance", ""] },
  "vendor-finance": { title: "Vendor Finance & GST", breadcrumb: ["Finance", ""] },
  commission: { title: "Commission Policy", breadcrumb: ["Finance", ""] },
  penalties: { title: "Penalties & Disputes", breadcrumb: ["Finance", ""] },
  reports: { title: "Reports & Analytics", breadcrumb: ["Finance", "Reports & Analytics"] },
  b2b: { title: "Corporate & B2B Integrations", breadcrumb: ["Office", ""] },
  notifications: { title: "Notifications", breadcrumb: ["Office", "Communication"] },
  reviews: { title: "Reviews & Ratings", breadcrumb: ["Office", ""] },
  staff: { title: "Staff & Roles", breadcrumb: ["Office", "Staff & Access"] },
  settings: { title: "Settings", breadcrumb: ["Office", ""] },
  security: { title: "Security & Audit", breadcrumb: ["Office", "Staff activity"] },
  legal: { title: "Terms, Privacy & Consent", breadcrumb: ["Office", "Terms & Privacy"] },
  support: { title: "Help & support", breadcrumb: ["Office", "Support"] },
};

/** Every page in sidebar order — the landing page is the first one the signed-in admin may open. */
const NAV_ORDER = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));

/** A "profile:<id>" tab opens that record's profile on the Driver Partners / Vehicles registry. */
const profileOf = (tab?: string) => (tab?.startsWith("profile:") ? tab.slice("profile:".length) : undefined);

function AdminShell({ session }: { session: AdminSession }) {
  const home = landingPage(session.access, NAV_ORDER) ?? "dashboard";
  const [activePage, setActivePage] = useState(home);
  const [collapsed, setCollapsed] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(
    null,
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const badges = useNavBadges(session.access);
  const [draft, setDraft] = useState<NewBookingDraft | null>(null);
  const [bookingsTab, setBookingsTab] = useState<string | undefined>(undefined);
  const { toast, show: showToast } = useToast(9000);
  const canCreateBooking = canAccessPage(session.access, "new-booking");

  const currentPage = selectedBookingId ? "booking-detail" : activePage;
  const openNewBooking = (d: NewBookingDraft | null = null) => {
    if (!canLeaveFareWorkspace()) return;
    setDraft(d);
    setSelectedBookingId(null);
    setActivePage("new-booking");
    setMobileNavOpen(false);
  };
  const baseMeta = pageMeta[currentPage] || pageMeta["dashboard"];
  // The top bar names the page the way the sidebar does; detail screens keep their own title.
  const navLabel = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === currentPage)?.label;
  // The breadcrumb names the same group the sidebar shows the page in.
  const group = groupOfPage(currentPage);
  const meta = { ...baseMeta, title: navLabel ?? baseMeta.title, breadcrumb: group ? [group, ...baseMeta.breadcrumb.slice(1)] : baseMeta.breadcrumb };

  // Access reduced while signed in (the Master changed this Staff ID): leave a page that is no
  // longer allowed. Direct opens of a forbidden page still show the no-access screen below.
  const accessKey = JSON.stringify([session.access.permissions, session.access.matrix, session.access.duty, session.access.accessVersion ?? 0]);
  const lastAccessKey = useRef(accessKey);
  useEffect(() => {
    if (lastAccessKey.current === accessKey) return;
    lastAccessKey.current = accessKey;
    if (!canAccessPage(session.access, currentPage)) {
      setSelectedBookingId(null);
      setActivePage(home);
      showToast("Your access was changed by the Master account. This page is no longer available to you.", "error");
    }
  }, [accessKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Exports and prints follow the Export right of the page that is open.
  useEffect(() => {
    setExportGuard(() => (canExportFrom(session.access, currentPage) ? null : "Your Staff ID does not include Export for this page. Ask the Master account."));
  }, [session.access, currentPage]);

  // Staff activity: this tab's session (heartbeat, revocation) and a page-view log.
  useEffect(() => startStaffSession(session.access.staffCode ?? ""), [session.user.uid, session.access.staffCode]);
  useEffect(() => { logActivity("View page", meta.title, currentPage === "booking-detail" ? selectedBookingId ?? "" : meta.title); }, [currentPage, selectedBookingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Service & Fare Settings as it was left when Fixed route fares opened (fareReturn), and what it restores on mount (pricingView).
  const fareReturn = useRef<PricingView | null>(null);
  const pricingView = useRef<PricingView | null>(null);

  const navigate = (page: string, tab?: string) => {
    if (!canLeaveFareWorkspace()) return;
    ({ page, tab } = resolveAdminDestination(page, tab));
    if (page !== "fare-rules" && page !== "extra-charges") fareReturn.current = null;
    setBookingsTab(tab);
    setActivePage(page);
    setSelectedBookingId(null);
    setMobileNavOpen(false);
  };

  /** Notification / shortcut targets: a booking opens its details, anything else is a page. */
  const openTarget = (page: string, bookingId?: string) => {
    if (page === "booking-detail" && bookingId) {
      if (!canLeaveFareWorkspace()) return;
      setActivePage("bookings");
      setSelectedBookingId(bookingId);
      setMobileNavOpen(false);
      return;
    }
    // Aliases (older or server-side names) resolve before the existence check, so they never fall back to the home page.
    const dest = resolveAdminDestination(page);
    navigate(pageMeta[dest.page] ? dest.page : home, dest.tab);
  };

  const dashboard = (
    <Dashboard
      onNavigate={navigate}
      onSelectBooking={(id) => setSelectedBookingId(id)}
      onNewBooking={() => openNewBooking()}
      badges={badges}
    />
  );

  const renderPage = () => {
    if (!canAccessPage(session.access, currentPage)) {
      return <PermissionDenied area={meta.title} roleName={session.access.roleName} />;
    }
    if (selectedBookingId) {
      return (
        <BookingDetails
          bookingId={selectedBookingId}
          onBack={() => setSelectedBookingId(null)}
          onNavigate={navigate}
        />
      );
    }

    switch (activePage) {
      // Overview
      case "dashboard":
        return dashboard;
      case "trips":
        return <Trips key={bookingsTab ?? "trips"} initialTab={bookingsTab} onOpenBooking={(id) => openTarget("booking-detail", id)} />;

      // Bookings
      case "bookings":
        return (
          <Bookings
            key={bookingsTab ?? "default"}
            initialTab={bookingsTab}
            onSelectBooking={(id) => setSelectedBookingId(id)}
            onNewBooking={() => openNewBooking()}
            onConvertEnquiry={(e: Enquiry) => openNewBooking({ trip: undefined as never, categoryId: e.categoryId || "", estimates: undefined as never, enquiry: e })}
          />
        );
      case "quick-fare":
        return (
          <QuickFare
            onProceed={(trip, categoryId, estimates) => openNewBooking({ trip, categoryId, estimates })}
            onSaved={() => { showToast("Enquiry saved. The fare and terms are retained."); navigate("bookings", "Enquiries"); }}
          />
        );
      case "new-booking":
        return (
          <NewBooking
            key={draft?.enquiry?.id ?? draft?.categoryId ?? "new"}
            draft={draft}
            onCancel={() => navigate("bookings")}
            onEnquirySaved={() => { showToast("Enquiry saved. The fare and terms are retained."); navigate("bookings", "Enquiries"); }}
            onCreated={(b) => {
              showToast(`Booking ${b.bookingId} created and waiting for approval.`);
              openTarget("booking-detail", b.id);
            }}
          />
        );
      case "marketplace":
        return <Marketplace onSelectBooking={(id) => setSelectedBookingId(id)} />;

      // People
      case "customers":
        return <Customers onNavigate={navigate} />;
      case "business":
        return <BusinessAccounts onQuote={(businessId) => openNewBooking({ trip: { ...emptyTrip(), businessId }, categoryId: "" })} />;
      case "vendor-drivers":
        return <VendorDrivers onOpenBooking={(id) => openTarget("booking-detail", id)} onNavigate={navigate} />;
      case "verification":
        return <Verification onBack={() => navigate("dashboard")} />;
      case "accounts":
        return <Accounts key={bookingsTab ?? "accounts"} initialTab={bookingsTab} onNavigate={navigate} />;
      case "full-final":
        return <FullFinal key={bookingsTab ?? "ff"} initialTab={bookingsTab} onOpenBooking={(id) => openTarget("booking-detail", id)} />;
      case "vendors":
        return <Vendors onOpenBooking={(id) => openTarget("booking-detail", id)} onNavigate={navigate} />;
      case "drivers":
        return <Drivers key={bookingsTab ?? "drivers"} initialProfile={profileOf(bookingsTab)} onOpenBooking={(id) => openTarget("booking-detail", id)} onNavigate={navigate} />;
      case "partner-links":
        return <PartnerLinks />;
      case "partner-requests":
        return <PartnerRequests onOpenBooking={(id) => openTarget("booking-detail", id)} />;

      // Fleet
      case "vehicles":
        return <Vehicles key={bookingsTab ?? "vehicles"} initialProfile={profileOf(bookingsTab)} onOpenBooking={(id) => openTarget("booking-detail", id)} onNavigate={navigate} />;
      case "categories":
        // Vehicle Categories now lives under Service & Fare Settings → Cab types; this keeps older links and the sidebar shortcut working
        // (same pricing access). Re-keyed so arriving from the Pricing page itself still opens the right section.
        return (
          <Pricing
            key="categories-alias"
            onNavigate={navigate}
            restore={pricingView.current ?? CATEGORIES_VIEW}
            onRestored={() => { pricingView.current = null; }}
            onOpenFareRules={(view) => { fareReturn.current = view; navigate("fare-rules"); }}
            onOpenExtraCharges={(view) => { fareReturn.current = view; navigate("extra-charges"); }}
          />
        );

      // Finance
      case "payments":
        return <Payments onSelectBooking={(id) => setSelectedBookingId(id)} />;
      case "invoices":
        return <Invoices />;
      case "earnings":
        return <DriverEarnings />;
      case "vendor-finance":
        return <VendorFinance />;
      case "commission":
        return <CommissionPolicy />;

      // Compliance
      case "penalties":
        return <Penalties onOpenBooking={(id) => openTarget("booking-detail", id)} onNavigate={navigate} />;
      case "reports":
        return <ReportsGst key={bookingsTab ?? "reports"} initialTab={bookingsTab} onNavigate={navigate} />;

      // System
      case "b2b":
        return <B2BIntegrations />;
      case "notifications":
        return <Communication onNavigate={setActivePage} initialTab={bookingsTab} />;
      case "staff":
        return <StaffRoles />;
      case "services":
        return <Services />;
      case "packages":
        return <TourPackages />;
      case "locations":
        return <Locations />;
      case "fare-rules":
      case "extra-charges":
      case "pricing":
        return (
          <Pricing
            onNavigate={navigate}
            restore={pricingView.current}
            onRestored={() => { pricingView.current = null; }}
            onOpenFareRules={(view) => { fareReturn.current = view; navigate("fare-rules"); }}
            onOpenExtraCharges={(view) => { fareReturn.current = view; navigate("extra-charges"); }}
          />
        );
      case "local-taxi":
        return <LocalTaxi />;
      case "offers":
        return <Offers />;
      case "reviews":
        return <Reviews />;
      case "settings":
        return <Settings />;
      case "security":
        return <SecurityEvents onOpenBooking={(id) => openTarget("booking-detail", id)} />;
      case "legal":
        return <LegalDocuments />;
      case "support":
        return <Support onOpenBooking={(id) => openTarget("booking-detail", id)} onNavigate={navigate} />;

      default:
        return canAccessPage(session.access, "dashboard") ? dashboard : <PermissionDenied area={meta.title} roleName={session.access.roleName} />;
    }
  };

  // Escape closes the mobile navigation drawer.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileNavOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  return (
    <AccessProvider value={session.access}>
    <NotificationProvider onOpen={openTarget}>
    <div className="ds-workspace" data-collapsed={collapsed}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:bg-white focus:px-3 focus:py-2 focus:rounded-md focus:shadow-md">
        Skip to content
      </a>
      <Sidebar
        activePage={activePage}
        onNavigate={navigate}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        userName={session.user.displayName}
        userEmail={session.user.email}
        access={session.access}
        badges={badges}
        homePage={home}
      />

      <div className="ds-main-wrap">
        <Header
          title={meta.title}
          breadcrumb={meta.breadcrumb}
          onNavigate={navigate}
          onOpen={openTarget}
          onCreateBooking={canCreateBooking ? () => openNewBooking() : undefined}
          onQuickFare={canCreateBooking ? () => navigate("quick-fare") : undefined}
          onOpenMenu={() => setMobileNavOpen(true)}
          userName={session.user.displayName}
          userEmail={session.user.email}
          userRole={session.access.roleName}
          onSignOut={endStaffSession}
          badges={badges}
        />

        <main id="main" tabIndex={-1} className="ds-main">
          <div className="ds-page">{renderPage()}</div>
        </main>
        <footer className="ds-footer">
          <span>NESAM CABS · {session.access.isSuper ? "Master Admin" : session.access.roleName}</span>
          <span>Signed in as {session.user.email}</span>
        </footer>
      </div>
      <Toast toast={toast} />
    </div>
    </NotificationProvider>
    </AccessProvider>
  );
}

export default function App() {
  const [session, setSession] = useState<AdminSession | null | undefined>(
    undefined,
  );
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");

  useEffect(() => {
    return subscribeToAdminSession(setSession);
  }, []);

  if (session === undefined) {
    return (
      <div
        className="h-screen w-screen flex items-center justify-center"
        style={{ background: "#F5F5F5" }}
      >
        <div className="text-[13px] text-faint">Loading…</div>
      </div>
    );
  }

  if (session === null) {
    if (authMode === "signup") {
      return <Signup onBackToLogin={() => setAuthMode("signin")} />;
    }
    return <Login onSignUp={() => setAuthMode("signup")} />;
  }

  const isActiveAdmin = session.role === "admin" && session.status === "active" && (session.access.accountStatus ?? "Active") === "Active";

  if (!isActiveAdmin) {
    const [title, message] =
      session.role === "pending" && session.status === "rejected"
        ? ["Request declined", `Your request for staff access was declined${session.rejectionReason ? `: ${session.rejectionReason}` : "."}`]
        : session.role === "pending"
          ? ["Awaiting approval", "Your staff access request has been received. A super admin will assign your role from Staff & Roles."]
          : session.role === "admin" && session.access.accountStatus === "Invited"
            ? ["Awaiting activation", "Your Staff ID has been created. The Master account will activate it before you can open the workspace."]
          : session.role === "admin" && session.access.accountStatus === "Suspended"
            ? ["Account suspended", "Your Staff ID is suspended. Contact the Master account (super admin) for details."]
          : session.role === "admin"
            ? ["Account deactivated", "Your staff account is deactivated. Contact a super admin if you need access again."]
            : ["Access not authorized", "This account is not a staff account. Contact the platform team if you believe this is a mistake."];
    return (
      <div
        className="h-screen w-screen flex items-center justify-center px-4"
        style={{ background: "#F5F5F5" }}
      >
        <div className="max-w-sm text-center bg-white rounded-2xl border border-line p-8 shadow-sm">
          <h1 className="text-[16px] font-bold text-ink mb-2">
            {title}
          </h1>
          <p className="text-[13px] text-muted mb-6">
            {message} ({session.user.email})
          </p>
          <button
            onClick={() => signOutAdmin()}
            className="px-4 py-2 text-[13px] font-semibold text-white rounded-lg hover:opacity-90 transition-all"
            style={{ background: "#c1232c" }}
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (!landingPage(session.access, NAV_ORDER)) {
    return (
      <StatusScreen
        title="Access unavailable"
        message={session.access.kind === "none"
          ? "Your admin record has no recognised access. Ask the Master account (super admin) to set it up in Staff & Access."
          : "Your account is active but has no workspace modules yet. Ask the Master account (super admin) to grant access in Staff & Access."}
        email={session.user.email}
      />
    );
  }

  // Set before any screen subscribes; the shell remounts (fresh listeners) when the right changes.
  const redacted = needsRedactedBookings(session.access);
  setRedactedBookingReads(redacted);
  return (
    <LegalGate>
      <AdminShell key={redacted ? "redacted" : "full"} session={session} />
    </LegalGate>
  );
}

function StatusScreen({ title, message, email }: { title: string; message: string; email: string | null }) {
  return (
    <div className="h-screen w-screen flex items-center justify-center px-4" style={{ background: "#F5F5F5" }}>
      <div className="max-w-sm text-center bg-white rounded-2xl border border-line p-8 shadow-sm">
        <h1 className="text-[16px] font-bold text-ink mb-2">{title}</h1>
        <p className="text-[13px] text-muted mb-6">
          {message} ({email})
        </p>
        <button
          onClick={() => void endStaffSession()}
          className="px-4 py-2 text-[13px] font-semibold text-white rounded-lg hover:opacity-90 transition-all"
          style={{ background: "#c1232c" }}
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
