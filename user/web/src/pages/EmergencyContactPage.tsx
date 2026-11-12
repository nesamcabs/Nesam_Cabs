import { useNavigate } from 'react-router-dom';
import { useCustomerData } from '@core/context/CustomerData';
import { Button, EmptyState, PageHead } from '@/components/ui';
import { EmergencyContactForm } from '@/components/ProfileForms';
import { useAuth } from '@/state/Auth';
import { useSeo } from '@/lib/seo';

/** Emergency contact on its own page (the profile drawer shows the same form in place). */
export function EmergencyContactPage() {
  useSeo({ title: 'Emergency contact', noindex: true });
  const navigate = useNavigate();
  const { profile } = useCustomerData();
  const { openLoginModal } = useAuth();
  const leave = () => ((window.history.state as { idx?: number } | null)?.idx ? navigate(-1) : navigate('/', { replace: true }));

  if (!profile) {
    return (
      <div className="page">
        <div className="card card--center">
          <EmptyState
            art="welcome"
            title="Sign in to add an emergency contact"
            action={
              <Button variant="primary" onClick={() => openLoginModal({ title: 'Sign in' })}>
                Sign in
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHead title="Emergency contact" />
      <div className="page">
        <div className="card simple-form-wrap">
          <EmergencyContactForm onDone={leave} onCancel={leave} />
        </div>
      </div>
    </>
  );
}
