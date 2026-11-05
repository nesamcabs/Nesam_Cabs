import React, { useState } from 'react';
import { registerVendorWithVehicle } from '../../services/onboardingService';
import { displayPlate, isPlate, normalizePlate } from '../../utils/fleet';
import { describeDataError } from '../../utils/retry';
import { Banner, Button, TextInput } from '../../ui/kit';
import { Icon, IconSprite } from '../../ui/Icon';

interface Props {
  phone: string;
  onSignOut: () => void;
}

const SUPPORT_PHONE = import.meta.env.VITE_SUPPORT_PHONE || '+91 90250 99990';

/**
 * Sign-up for a new fleet partner: the verified mobile number plus the vehicle's registration number.
 * Submitting creates the application (already submitted for NESAM's review); the real-time listener on vendors/{uid}
 * in App.tsx then shows the "under review" screen.
 */
export const RegistrationGate: React.FC<Props> = ({ phone, onSignOut }) => {
  const [plate, setPlate] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const invalid = !isPlate(plate);
  const fieldError = touched && invalid ? 'Enter the registration number as printed on the plate, e.g. TN 01 AB 1234.' : '';

  const handleRegister = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setTouched(true);
    if (invalid || busy) return;
    setBusy(true);
    setError('');
    try {
      await registerVendorWithVehicle(phone, plate);
      // The vendors/{uid} listener in App.tsx fires and routes to the account status screen.
    } catch (err) {
      setError(describeDataError(err));
      setBusy(false);
    }
  };

  return (
    <div className="vx">
      <IconSprite />
      <div className="vx-auth">
        <form className="vx-auth__col" onSubmit={handleRegister} noValidate>
          <div className="vx-auth__brand">
            <span className="vx-brand__mark"><img src="/brand/nesam-emblem.jpg" alt="" width={512} height={497} decoding="async" /></span>
            <h1>Become a NESAM Fleet Partner</h1>
            <p>Sign up with your vehicle number. That is all we need to start your application.</p>
          </div>

          <div className="vx-card">
            <TextInput id="registrationNumber" label="Vehicle registration number" required plate value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())}
              error={fieldError} placeholder="TN 01 AB 1234" hint="As printed on the number plate." autoComplete="off" maxLength={14} />
            <Banner>
              <strong>Admin verification:</strong> NESAM reviews your application and verifies the vehicle before duties, drivers, vehicles and payouts become active. We will call <strong>{phone}</strong> if anything else is needed.
            </Banner>
            <p className="vx-hint" style={{ marginBottom: 12 }}>
              Signed in with <strong>{phone}</strong>{!invalid && <> · Vehicle <strong className="vx-plate">{displayPlate(normalizePlate(plate))}</strong></>}
            </p>
            {error && <Banner tone="err" action={{ label: 'Try again', onClick: () => void handleRegister() }}>{error}</Banner>}
            <Button type="submit" variant="primary" block loading={busy}>{busy ? 'Submitting…' : 'Register vehicle'}{!busy && <Icon name="arrow" />}</Button>
          </div>

          <div className="vx-auth__foot">
            <a href={`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`}><Icon name="phone" />Partner support {SUPPORT_PHONE}</a>
            <button type="button" onClick={onSignOut}><Icon name="logout" />Sign out</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export function captureInviteFromUrl(): string {
  return '';
}
