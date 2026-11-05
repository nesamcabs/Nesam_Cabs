import React, { useState } from 'react';
import type { BankDetails, DriverAccount } from '../types';
import { describeFirestoreError } from '../services/driverFirestoreService';
import { setSoundEnabled, soundEnabled, soundState, unlockSound, playTone } from '../utils/notificationSound';
import { Dialog } from '../components/nx/Dialog';
import { Icon } from '../components/nx/Icon';
import { InfoNote } from '../components/nx/parts';
import { initials } from '../components/nx/format';

export type ContactFields = {
  email: string;
  address: string;
  city: string;
  pincode: string;
  emergencyContactName: string;
  emergencyContact: string;
  bank: BankDetails;
};

interface ProfileScreenProps {
  account: DriverAccount;
  completedTrips: number;
  onEditDocuments: () => void;
  onSaveContact: (fields: ContactFields) => Promise<void>;
  onSignOut: () => void;
  onSupport: () => void;
  onViewPolicy?: () => void;
}

const expiryBadge = (date: string) => {
  if (!date) return null;
  const days = Math.floor((new Date(date).getTime() - Date.now()) / 86400000);
  if (Number.isNaN(days)) return null;
  if (days < 0) return <span className="badge red">Expired</span>;
  if (days <= 30) return <span className="badge amber">Expires in {days}d</span>;
  return null;
};

const DocRow: React.FC<{ label: string; url: string; expiry?: string }> = ({ label, url, expiry }) => (
  <div className="document-row">
    <Icon name="document" />
    <span>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
          {label}
        </a>
      ) : (
        label
      )}
    </span>
    {expiry ? expiryBadge(expiry) : null}
    {url ? (
      <span className="badge green">
        <Icon name="check" />
        Uploaded
      </span>
    ) : (
      <span className="badge neutral">Not uploaded</span>
    )}
  </div>
);

const blank = (driver: DriverAccount['driver'], bank: BankDetails): ContactFields => ({
  email: driver.email,
  address: driver.address,
  city: driver.city,
  pincode: driver.pincode,
  emergencyContactName: driver.emergencyContactName,
  emergencyContact: driver.emergencyContact,
  bank,
});

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ account, completedTrips, onEditDocuments, onSaveContact, onSignOut, onSupport, onViewPolicy }) => {
  const { driver, identity, license, vehicle, bank } = account;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ContactFields>(() => blank(driver, bank));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [sound, setSound] = useState(soundEnabled);

  const startEdit = () => {
    setForm(blank(driver, bank));
    setError('');
    setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return setError('Invalid email.');
    if (!/^\d{6}$/.test(form.pincode)) return setError('Enter a 6-digit pincode.');
    if (!/^[6-9]\d{9}$/.test(form.emergencyContact)) return setError('Enter a valid emergency contact number.');
    if (!/^\d{9,18}$/.test(form.bank.accountNumber)) return setError('Enter a valid bank account number.');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.bank.ifsc.toUpperCase())) return setError('Invalid IFSC code.');
    if (form.bank.upiId && !/^[\w.-]{2,}@[a-zA-Z]{2,}$/.test(form.bank.upiId)) return setError('Invalid UPI ID.');
    setSaving(true);
    setError('');
    try {
      await onSaveContact({ ...form, bank: { ...form.bank, ifsc: form.bank.ifsc.toUpperCase() } });
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(describeFirestoreError(err, 'Could not save your changes.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleSound = () => {
    const on = !sound;
    setSoundEnabled(on);
    setSound(on);
    if (on) {
      unlockSound();
      setTimeout(() => playTone('general'), 150);
    }
  };

  const set = (patch: Partial<ContactFields>) => setForm((f) => ({ ...f, ...patch }));
  const setBank = (patch: Partial<BankDetails>) => setForm((f) => ({ ...f, bank: { ...f.bank, ...patch } }));
  const docTone = driver.docStatus === 'Approved' ? 'green' : driver.docStatus === 'Rejected' ? 'red' : 'amber';
  const line = (label: string, value?: string) => (
    <div className="detail-line" key={label}>
      <span>{label}</span>
      <strong className="wrap-value">{value || '—'}</strong>
    </div>
  );

  return (
    <>
      {driver.docStatus === 'Rejected' && driver.rejectionReason ? (
        <div style={{ marginBottom: 18 }}>
          <InfoNote tone="amber" role="alert">
            <strong>Document note from NESAM:</strong> {driver.rejectionReason}
          </InfoNote>
        </div>
      ) : null}
      {saved ? (
        <div style={{ marginBottom: 18 }}>
          <InfoNote role="status">Profile updated.</InfoNote>
        </div>
      ) : null}
      <div className="two-columns">
        <section>
          <div className="panel page-card profile-overview">
            {driver.photoUrl ? <img className="avatar" src={driver.photoUrl} alt={driver.name} style={{ objectFit: 'cover' }} /> : <div className="avatar" aria-hidden="true">{initials(driver.name)}</div>}
            <h2>{driver.name}</h2>
            <p>{driver.vendorName ? `Fleet driver · ${driver.vendorName}` : 'Single vehicle owner / driver'}</p>
            <span className="badge green">
              <Icon name="shield" />
              Account approved
            </span>
            <div className="detail-list">
              {line('Mobile', driver.phone)}
              {line('Rating', driver.rating !== null ? `★ ${driver.rating.toFixed(1)}` : 'No ratings yet')}
              {line('Completed trips', String(completedTrips))}
              {driver.joiningDate ? line('Partner since', driver.joiningDate) : null}
              {line('Vehicle', [vehicle.make, vehicle.model].filter(Boolean).join(' '))}
              {line('Registration', vehicle.vehicleNumber)}
              {line('Category', `${vehicle.vehicleType}${vehicle.capacity ? ` · ${vehicle.capacity} seats` : ''}${vehicle.fuelType ? ` · ${vehicle.fuelType}` : ''}`)}
            </div>
          </div>

          <div className="panel page-card" style={{ marginTop: 18 }}>
            <div className="card-heading" style={{ marginBottom: 0 }}>
              <h2>Contact &amp; payout account</h2>
              <button type="button" className="text-button" onClick={startEdit}>
                <Icon name="edit" className="icon-sm" />
                Edit
              </button>
            </div>
            <div className="detail-list">
              {line('Email', driver.email)}
              {line('Date of birth', driver.dob)}
              {line('Address', [driver.address, driver.city, driver.pincode].filter(Boolean).join(', '))}
              {line('Emergency contact', driver.emergencyContact ? `${driver.emergencyContactName} (${driver.emergencyContact})` : '')}
              {line('Account holder', bank.accountHolder)}
              {line('Account no.', bank.accountNumber ? `••••${bank.accountNumber.slice(-4)}` : '')}
              {line('IFSC', bank.ifsc)}
              {line('UPI', bank.upiId)}
            </div>
          </div>

          <div className="panel page-card" style={{ marginTop: 18 }}>
            <div className="card-heading" style={{ marginBottom: 0 }}>
              <h2>Preferences</h2>
              <Icon name="bell" />
            </div>
            <div className="preference-row">
              <div>
                <strong>Alert sound</strong>
                <p>Play a tone for new duties and updates{sound && soundState() === 'locked' ? ' · tap anywhere once to enable' : ''}</p>
              </div>
              <button type="button" className="switch" role="switch" aria-checked={sound} aria-label="Alert sound preference" onClick={toggleSound} />
            </div>
            <div className="nx-profile-policy" style={{ display: 'grid', gap: 10 }}>
              {onViewPolicy ? (
                <button type="button" className="text-button" onClick={onViewPolicy}>
                  <Icon name="shield" className="icon-sm" />
                  Cancellation policy
                </button>
              ) : null}
              <button type="button" className="text-button" onClick={onSupport}>
                <Icon name="help" className="icon-sm" />
                Help &amp; SOS
              </button>
              <button type="button" className="text-button" onClick={onSignOut}>
                <Icon name="logout" className="icon-sm" />
                Sign out
              </button>
            </div>
          </div>
        </section>

        <section className="panel page-card">
          <div className="card-heading">
            <div>
              <h2>Document verification</h2>
              <p>Your licence and vehicle papers</p>
            </div>
            <span className={`badge ${docTone}`}>{driver.docStatus}</span>
          </div>
          <div className="document-list">
            <DocRow label="Driving licence (front)" url={license.frontPhotoUrl} expiry={license.expiryDate} />
            <DocRow label="Driving licence (back)" url={license.backPhotoUrl} />
            <DocRow label="Aadhaar (front)" url={identity.aadhaarFrontUrl} />
            <DocRow label="Aadhaar (back)" url={identity.aadhaarBackUrl} />
            <DocRow label="PAN" url={identity.panPhotoUrl} />
            <DocRow label="Registration certificate (RC)" url={vehicle.rcDocUrl} />
            <DocRow label="Vehicle insurance" url={vehicle.insuranceDocUrl} expiry={vehicle.insuranceExpiry} />
            <DocRow label="Vehicle permit" url={vehicle.statePermitDocUrl} expiry={vehicle.permitExpiry} />
            <DocRow label="Fitness certificate (FC)" url={vehicle.fitnessDocUrl} expiry={vehicle.fitnessExpiry} />
            <DocRow label="Vehicle photo · front" url={vehicle.frontPhotoUrl} />
            <DocRow label="Vehicle photo · rear" url={vehicle.rearPhotoUrl} />
            <DocRow label="Vehicle photo · side" url={vehicle.sidePhotoUrl} />
            <DocRow label="Vehicle photo · interior" url={vehicle.interiorPhotoUrl} />
          </div>
          <button type="button" className="button primary full" style={{ marginTop: 18 }} onClick={onEditDocuments}>
            Update documents <Icon name="arrow" />
          </button>
        </section>
      </div>

      <Dialog open={editing} onClose={() => setEditing(false)} eyebrow="Profile" title="Edit contact & payout account" locked={saving}>
        <form onSubmit={save} id="profile-form">
          <label className="nx-cancel-field" htmlFor="pf-email">
            Email
            <input id="pf-email" type="email" autoComplete="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </label>
          <label className="nx-cancel-field" htmlFor="pf-address">
            Address
            <textarea id="pf-address" value={form.address} onChange={(e) => set({ address: e.target.value })} />
          </label>
          <div className="nx-form-grid">
            <label className="nx-cancel-field" htmlFor="pf-city">
              City
              <input id="pf-city" value={form.city} onChange={(e) => set({ city: e.target.value })} />
            </label>
            <label className="nx-cancel-field" htmlFor="pf-pin">
              Pincode
              <input id="pf-pin" inputMode="numeric" maxLength={6} value={form.pincode} onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, '') })} />
            </label>
            <label className="nx-cancel-field" htmlFor="pf-ecn">
              Emergency contact name
              <input id="pf-ecn" value={form.emergencyContactName} onChange={(e) => set({ emergencyContactName: e.target.value })} />
            </label>
            <label className="nx-cancel-field" htmlFor="pf-ec">
              Emergency mobile
              <input id="pf-ec" inputMode="numeric" maxLength={10} value={form.emergencyContact} onChange={(e) => set({ emergencyContact: e.target.value.replace(/\D/g, '') })} />
            </label>
          </div>
          <p className="nx-cancel-field" style={{ marginBottom: 0 }}>
            Bank account
          </p>
          <label className="nx-cancel-field" htmlFor="pf-holder">
            Account holder
            <input id="pf-holder" value={form.bank.accountHolder} onChange={(e) => setBank({ accountHolder: e.target.value })} />
          </label>
          <div className="nx-form-grid">
            <label className="nx-cancel-field" htmlFor="pf-acct">
              Account number
              <input id="pf-acct" inputMode="numeric" value={form.bank.accountNumber} onChange={(e) => setBank({ accountNumber: e.target.value.replace(/\D/g, '') })} />
            </label>
            <label className="nx-cancel-field" htmlFor="pf-ifsc">
              IFSC
              <input id="pf-ifsc" maxLength={11} value={form.bank.ifsc} onChange={(e) => setBank({ ifsc: e.target.value.toUpperCase() })} />
            </label>
            <label className="nx-cancel-field" htmlFor="pf-bank">
              Bank name
              <input id="pf-bank" value={form.bank.bankName} onChange={(e) => setBank({ bankName: e.target.value })} />
            </label>
            <label className="nx-cancel-field" htmlFor="pf-upi">
              UPI ID
              <input id="pf-upi" value={form.bank.upiId} onChange={(e) => setBank({ upiId: e.target.value.trim() })} />
            </label>
          </div>
          <div className="nx-cancel-error" role="alert">
            {error}
          </div>
          <button className="button primary full" type="submit" disabled={saving} style={{ marginTop: 14 }}>
            {saving ? 'Saving…' : 'Save changes'} <Icon name="check" />
          </button>
        </form>
      </Dialog>
    </>
  );
};
