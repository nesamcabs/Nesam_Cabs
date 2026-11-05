import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { VendorProfile, VendorRecord } from './types';
import { subscribeToAuthUser, signOutUser, setAuthIntent, resetRecaptchaVerifier } from './services/authService';
import { subscribeToVendor, type VendorSnapshot } from './services/onboardingService';
import { describeDataError } from './utils/retry';
import { OnboardingWizard } from './screens/onboarding/OnboardingWizard';
import { RegistrationGate, captureInviteFromUrl } from './screens/onboarding/RegistrationGate';
import { AccountStatusScreen } from './screens/AccountStatusScreen';
import { VendorLoginScreen } from './screens/VendorLoginScreen';
import { FullScreenLoader } from './components/onboarding/ui';
import { LegalGate } from './components/LegalGate';
import { PartnerProvider } from './state/Partner';
import { Button } from './ui/kit';
import { IconSprite } from './ui/Icon';
import { PartnerWorkspace } from './partner/Workspace';

async function handleSignOut() {
  setAuthIntent(null);
  resetRecaptchaVerifier();
  try {
    await signOutUser();
  } catch (error) {
    console.warn('Sign out failed:', error);
  }
}

/**
 * Gatekeeper. Routing is driven entirely by two live listeners:
 *   Firebase Auth user  →  vendors/{uid} snapshot  →  screen for its status.
 * When an admin approves the vendor, the snapshot fires and the workspace mounts immediately — no refresh needed.
 */
export function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  // undefined = still loading, null = no vendors/{uid} doc yet
  const [vendor, setVendor] = useState<VendorSnapshot | null | undefined>(undefined);
  const [vendorError, setVendorError] = useState('');
  const [listenerKey, setListenerKey] = useState(0);
  const [reapplying, setReapplying] = useState(false);

  useEffect(() => { captureInviteFromUrl(); }, []);

  useEffect(() => subscribeToAuthUser((fbUser) => { setUser(fbUser); setAuthLoading(false); }), []);

  useEffect(() => {
    setVendor(undefined);
    setVendorError('');
    setReapplying(false);
    if (!user) return undefined;
    return subscribeToVendor(
      user.uid,
      (snap) => { setVendor(snap); setVendorError(''); },
      (error) => setVendorError(describeDataError(error)),
    );
  }, [user?.uid, listenerKey]);

  const status = vendor?.record.status;
  // Leave "reapply" mode once the vendor resubmits or the admin acts.
  useEffect(() => { if (status !== 'REJECTED') setReapplying(false); }, [status]);

  if (authLoading) return <FullScreenLoader />;
  if (!user) return <VendorLoginScreen />;

  if (vendorError) {
    return (
      <div className="vx">
        <IconSprite />
        <div className="vx-auth">
          <div className="vx-auth__col">
            <div className="vx-card" style={{ textAlign: 'center' }}>
              <h1 style={{ fontSize: 19, fontWeight: 700, marginBottom: 6 }}>Couldn’t load your account</h1>
              <p className="vx-muted" style={{ marginBottom: 16 }}>{vendorError}</p>
              <div className="vx-actions" style={{ justifyContent: 'center', marginTop: 0 }}>
                <Button onClick={handleSignOut}>Sign out</Button>
                <Button variant="primary" onClick={() => setListenerKey((k) => k + 1)}>Try again</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (vendor === undefined) return <FullScreenLoader label="Loading your account…" />;

  const phone = user.phoneNumber || vendor?.record.phone || '';

  // No vendor account yet: sign up with a vehicle number.
  if (!vendor) return <RegistrationGate key={user.uid} phone={phone} onSignOut={handleSignOut} />;

  if (status === 'INCOMPLETE' || status === 'CHANGES_REQUESTED' || (status === 'REJECTED' && reapplying)) {
    return <OnboardingWizard key={user.uid} record={vendor.record} phone={phone} onSignOut={handleSignOut} />;
  }

  if (status !== 'APPROVED') {
    return <AccountStatusScreen record={vendor.record} onSignOut={handleSignOut} onReapply={status === 'REJECTED' ? () => setReapplying(true) : undefined} />;
  }

  return (
    <LegalGate role="vendor">
      <VendorWorkspace profile={vendor.profile} record={vendor.record} />
    </LegalGate>
  );
}

function VendorWorkspace({ profile, record }: { profile: VendorProfile; record: VendorRecord }) {
  return (
    <PartnerProvider profile={profile} record={record}>
      <PartnerWorkspace />
    </PartnerProvider>
  );
}

export default App;
