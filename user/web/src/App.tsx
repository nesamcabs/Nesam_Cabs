import { lazy, useEffect, useRef, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { CustomerDataProvider, useCustomerData } from '@/state/CustomerData';
import { Shell } from '@/components/Shell';
import { EmptyState, LinkButton, PageLoader } from '@/components/ui';
import { AuthProvider, useAuth } from '@/state/Auth';
import { BookingProvider } from '@/state/Booking';
import { InboxProvider } from '@/state/Inbox';
import { ToastProvider } from '@/state/Toasts';
import { isRideDismissed } from '@/state/rideFocus';
import { useVisualViewportHeight, useOnline } from '@/lib/hooks';
import { AccountHold, AuthFlow, LoadError, ProfileSetup } from '@/pages/auth/AuthFlow';
import { LegalGate } from '@/pages/auth/LegalGate';
import { LoginModal } from '@/components/LoginModal';

// Pages load on demand: the booking map (Leaflet) and the other screens stay out of the first download.
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType<never>>>, name: K) =>
  lazy(async () => ({ default: (await load())[name] as React.ComponentType }));
const BookPage = lazy(() => import('@/pages/book/BookPage').then((m) => ({ default: m.BookPage })));
const DonePage = page(() => import('@/pages/book/DonePage'), 'DonePage');
const AboutPage = page(() => import('@/pages/AboutPage'), 'AboutPage');
const RidePage = page(() => import('@/pages/ride/RidePage'), 'RidePage');
const TripsPage = page(() => import('@/pages/TripsPage'), 'TripsPage');
const NotificationsPage = page(() => import('@/pages/NotificationsPage'), 'NotificationsPage');
const AccountPage = page(() => import('@/pages/AccountPage'), 'AccountPage');
const EditProfilePage = page(() => import('@/pages/EditProfilePage'), 'EditProfilePage');
const SavedPlacesPage = page(() => import('@/pages/SavedPlacesPage'), 'SavedPlacesPage');
const PaymentsPage = page(() => import('@/pages/PaymentsPage'), 'PaymentsPage');
const OffersPage = page(() => import('@/pages/OffersPage'), 'OffersPage');
const SupportPage = page(() => import('@/pages/SupportPage'), 'SupportPage');
const LegalPage = page(() => import('@/pages/LegalPage'), 'LegalPage');
const RouteLandingPage = page(() => import('@/pages/routes/RouteLandingPage'), 'RouteLandingPage');
const ServiceLandingPage = page(() => import('@/pages/services/ServiceLandingPage'), 'ServiceLandingPage');

/** State restoration: open the live ride (or a just-finished, unrated one) when the site opens. */
function RideAutoFocus() {
  const { liveRide, unratedTrip } = useCustomerData();
  const navigate = useNavigate();
  const location = useLocation();
  const id = (liveRide ?? unratedTrip)?.id ?? null;
  const opened = useRef(false);

  useEffect(() => {
    if (!id || opened.current || isRideDismissed(id)) return;
    // Only from the booking home, and once per visit.
    if (location.pathname !== '/book' && location.pathname !== '/') return;
    opened.current = true;
    navigate(`/ride/${id}`, { replace: true });
  }, [id, location.pathname, navigate, opened]);
  return null;
}


function AppShellProvider({ children }: { children: ReactNode }) {
  const { state, retry, signOut, isLoginModalOpen } = useAuth();
  // After the first render, signing in keeps the current page mounted (a guest's half-finished booking,
  // ticked boxes and scroll position survive) while the account loads.
  const rendered = useRef(false);
  if (state.status === 'loading' && !rendered.current)
    return (
      <main id="main">
        <PageLoader label={state.label} />
      </main>
    );
  if (state.status === 'error') return <LoadError message={state.message} onRetry={retry} onSignOut={() => void signOut()} />;
  if (state.status === 'needs-profile' && !isLoginModalOpen) return <ProfileSetup phone={state.user.phoneNumber ?? ''} />;
  if (state.status === 'on-hold') return <AccountHold status={state.profile.status} onSignOut={() => void signOut()} />;

  rendered.current = true;
  const profile = state.status === 'ready' ? state.profile : null;
  const content = (
    <ToastProvider>
      <InboxProvider userId={profile?.uid}>
        <CustomerDataProvider profile={profile}>
          <BookingProvider>
            {profile ? <RideAutoFocus /> : null}
            {children}
            <LoginModal />
          </BookingProvider>
        </CustomerDataProvider>
      </InboxProvider>
    </ToastProvider>
  );

  return <LegalGate enabled={!!profile}>{content}</LegalGate>;
}

function NotFound() {
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
        <Route index element={<Navigate to="/book" replace />} />
        <Route path="/book" element={<BookPage step="plan" />} />
        <Route path="/book/ride" element={<BookPage step="choose" />} />
        <Route path="/book/confirm" element={<BookPage step="review" />} />
        <Route path="/book/done/:id" element={<DonePage />} />
        <Route path="/ride/:id" element={<RidePage />} />
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
