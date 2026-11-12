import { useNavigate } from 'react-router-dom';
import { useCustomerData } from '@core/context/CustomerData';
import { Button, EmptyState, PageHead } from '@/components/ui';
import { PersonalDetailsForm } from '@/components/ProfileForms';
import { useAuth } from '@/state/Auth';
import { useSeo } from '@/lib/seo';

/** Personal details on their own page (the profile drawer shows the same form in place). */
export function EditProfilePage() {
  useSeo({ title: 'Personal details', noindex: true });
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
            title="Sign in to edit your details"
            action={
              <Button variant="primary" onClick={() => openLoginModal({ title: 'Sign in to edit profile' })}>
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
      <PageHead title="Personal details" />
      <div className="page">
        <div className="card simple-form-wrap">
          <PersonalDetailsForm onDone={leave} onCancel={leave} />
        </div>
      </div>
    </>
  );
}
