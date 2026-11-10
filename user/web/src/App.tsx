import { lazy, useEffect, useRef, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { CustomerDataProvider } from '@core/context/CustomerData';
import { Shell } from '@/components/Shell';
import { EmptyState, LinkButton, PageLoader } from '@/components/ui';
import { AuthProvider, useAuth } from '@/state/Auth';
import { BookingProvider } from '@/state/Booking';
import { InboxProvider } from '@/state/Inbox';
import { ToastProvider } from '@/state/Toasts';
import { takePendingReturn } from '@/lib/pendingReturn';
import { isHomePath, isPublicPath } from '@/lib/homeNav';
import { useVisualViewportHeight, useOnline } from '@/lib/hooks';
import { useSeo } from '@/lib/seo';
import { AccountHold, AuthFlow, LoadError, ProfileSetup } from '@/pages/auth/AuthFlow';
import { LegalGate } from '@/pages/auth/LegalGate';
import { LoginModal } from '@/components/LoginModal';

// Pages load on demand: the booking map (Leaflet) and the other screens stay out of the first download.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType<never>>>, name: K) =>
  lazy(async () => ({ default: (await load())[name] as React.ComponentType }));
const loadBookPage = () => import('@/pages/book/BookPage');
const BookPage = lazy(() => loadBookPage().then((m) => ({ default: m.BookPage })));
// The site opens on the booking home: fetch it alongside the account check, not after it.
if (typeof window !== 'undefined' && isHomePath(window.location.pathname)) void loadBookPage();
const DonePage = lazy(() => import('@/pages/book/DonePage'));
const RidePage = page(() => import('@/pages/ride/RidePage'), 'RidePage');
const TripsPage = page(() => import('@/pages/TripsPage'), 'TripsPage');
const LocalTaxiPage = page(() => import('@/pages/localTaxi/LocalTaxiPage'), 'LocalTaxiPage');
const LocalRentalsPage = page(() => import('@/pages/localRentals/LocalRentalsPage'), 'LocalRentalsPage');
const LocalTaxiRidePage = page(() => import('@/pages/localTaxi/LocalTaxiRidePage'), 'LocalTaxiRidePage');
const NotificationsPage = page(() => import('@/pages/NotificationsPage'), 'NotificationsPage');
const AccountPage = page(() => import('@/pages/AccountPage'), 'AccountPage');
const EditProfilePage = page(() => import('@/pages/EditProfilePage'), 'EditProfilePage');
const SavedPlacesPage = page(() => import('@/pages/SavedPlacesPage'), 'SavedPlacesPage');
const PaymentsPage = page(() => import('@/pages/PaymentsPage'), 'PaymentsPage');
const OffersPage = page(() => import('@/pages/OffersPage'), 'OffersPage');
const SupportPage = page(() => import('@/pages/SupportPage'), 'SupportPage');
const LegalPage = page(() => import('@/pages/LegalPage'), 'LegalPage');
const AboutPage = page(() => import('@/pages/AboutPage'), 'AboutPage');
const RouteLandingPage = page(() => import('@/pages/routes/RouteLandingPage'), 'RouteLandingPage');
const ServiceLandingPage = page(() => import('@/pages/services/ServiceLandingPage'), 'ServiceLandingPage');

/**
 * After sign-in: resume the search the rider started as a guest. Mounted inside the terms gate, so
 * it only runs once the account is ready and any profile / terms steps are done. The pending
 * destination is read once; it is always a vehicle-selection URL, never a booking submission.
 */
function PendingReturn() {
  const { state } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const here = useRef(location.pathname);
  here.current = location.pathname;

  useEffect(() => {
    if (state.status !== 'ready') return;
    const to = takePendingReturn();
    if (to && to !== here.current) navigate(to, { replace: true });
  }, [state.status, navigate]);
  return null;
}

function AppShellProvider({ children }: { children: ReactNode }) {
  const { state, retry, signOut, isLoginModalOpen } = useAuth();
  const { pathname } = useLocation();
  // The public policies stay readable from the screens below that otherwise replace the app
  // (they render as for a signed-out visitor: no account data).
  const publicPolicies = pathname === '/legal';
  // Public pages show straight away while a returning rider's account loads; it fills in after.
  if (state.status === 'loading' && !isPublicPath(pathname))
    return (
      <main id="main">
        <PageLoader label={state.label} />
      </main>
    );
  if (state.status === 'error' && !publicPolicies) return <LoadError message={state.message} onRetry={retry} onSignOut={() => void signOut()} />;
  if (state.status === 'needs-profile' && !isLoginModalOpen && !publicPolicies) return <ProfileSetup phone={state.user.phoneNumber ?? ''} />;
  if (state.status === 'on-hold' && !publicPolicies) return <AccountHold status={state.profile.status} onSignOut={() => void signOut()} />;

  const profile = state.status === 'ready' ? state.profile : null;
  const content = (
    <ToastProvider>
      <InboxProvider userId={profile?.uid}>
        <CustomerDataProvider profile={profile}>
          <BookingProvider>
            {profile ? <PendingReturn /> : null}
            {children}
            <LoginModal />
          </BookingProvider>
        </CustomerDataProvider>
      </InboxProvider>
    </ToastProvider>
  );

  // Always the same wrapper, so signing in does not rebuild the screen the rider is on.
  return <LegalGate active={!!profile}>{content}</LegalGate>;
}

function NotFound() {
  useSeo({ title: 'Page not found', noindex: true });
  return (
    <div className="page">
      <div className="card card--center">
        <EmptyState
          art="error"
          title="We can’t find that page"
          action={
            <LinkButton variant="primary" to="/book">
              Book a ride
            </LinkButton>
          }
        >
          The link may be old or mistyped.
        </EmptyState>
      </div>
    </div>
  );
}

/** Every signed-in screen, inside the app frame. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        {/* Open the Local Pickup & Drop screen by default when the app starts. */}
        <Route index element={<Navigate to="/local-rentals?mode=pickup" replace />} />
        <Route path="/book" element={<BookPage step="plan" />} />
        <Route path="/book/ride" element={<BookPage step="choose" />} />
        <Route path="/book/confirm" element={<BookPage step="review" />} />
        <Route path="/book/done/:id" element={<DonePage />} />
        <Route path="/ride/:id" element={<RidePage />} />
        <Route path="/local-taxi" element={<LocalTaxiPage />} />
        <Route path="/local-rentals" element={<LocalRentalsPage />} />
        <Route path="/local-taxi/ride/:id" element={<LocalTaxiRidePage />} />
        <Route path="/trips" element={<TripsPage />} />
        <Route path="/trips/:id" element={<RidePage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/account/edit" element={<EditProfilePage />} />
        <Route path="/account/places" element={<SavedPlacesPage />} />
        <Route path="/account/payments" element={<PaymentsPage />} />
        <Route path="/offers" element={<OffersPage />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/legal" element={<LegalPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/routes/:routeId" element={<RouteLandingPage />} />
        <Route path="/services/:serviceId" element={<ServiceLandingPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export function App() {
  useVisualViewportHeight();
  useOnline();
  return (
    <AuthProvider>
      <AppShellProvider>
        <AppRoutes />
      </AppShellProvider>
    </AuthProvider>
  );
}
