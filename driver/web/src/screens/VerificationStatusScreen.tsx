import React from 'react';
import { Clock, XCircle, Ban, CheckCircle2, FileText, LogOut, PhoneCall, UserX, Car, CreditCard, Landmark } from 'lucide-react';
import type { DriverAccount } from '../types';

export const SUPPORT_PHONE = '+919025099990';

const Shell: React.FC<{ children: React.ReactNode; onSignOut: () => void }> = ({ children, onSignOut }) => (
  <div className="min-h-screen bg-[#F7F7F7] flex flex-col items-center justify-center p-4 sm:p-6">
    <div className="w-full max-w-lg bg-white border border-gray-200 rounded-2xl shadow-sm p-6 sm:p-8 space-y-6">
      {children}
      <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-gray-100">
        <a
          href={`tel:${SUPPORT_PHONE}`}
          className="flex-1 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 flex items-center justify-center gap-2 hover:bg-gray-50"
        >
          <PhoneCall className="w-4 h-4 text-emerald-600" /> Contact Support
        </a>
        <button
          onClick={onSignOut}
          className="flex-1 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 flex items-center justify-center gap-2 hover:bg-red-50 hover:text-[#E21E26]"
        >
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </div>
    </div>
    <p className="text-[11px] text-gray-400 mt-6">NESAM Tours &amp; Travels • Driver Partner Portal</p>
  </div>
);

const Checklist: React.FC<{ account: DriverAccount }> = ({ account }) => {
  // Spec page 13: selfie, licence and — for an owner-driver — the vehicle documents.
  const items = [
    { icon: FileText, label: 'Selfie', done: !!account.profile.photoUrl },
    { icon: CreditCard, label: `Driving licence ${account.license.number}`, done: !!account.license.frontPhotoUrl },
    ...(account.driver.vendorId
      ? []
      : [{ icon: Car, label: `Vehicle ${account.vehicle.vehicleNumber}`, done: !!account.vehicle.rcDocUrl && !!account.vehicle.insuranceDocUrl && !!account.vehicle.statePermitDocUrl }]),
  ];
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2.5">
      {items.map(({ icon: Icon, label, done }) => (
        <div key={label} className="flex items-center gap-3 text-xs">
          <Icon className="w-4 h-4 text-gray-400 shrink-0" />
          <span className="flex-1 font-semibold text-gray-800 truncate">{label}</span>
          {done ? (
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Submitted
            </span>
          ) : (
            <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded">Missing</span>
          )}
        </div>
      ))}
    </div>
  );
};

interface StatusProps {
  account: DriverAccount;
  onSignOut: () => void;
  onResubmit: () => void;
}

export const VerificationStatusScreen: React.FC<StatusProps> = ({ account, onSignOut, onResubmit }) => {
  const { driver } = account;

  if (driver.approvalStatus === 'Rejected') {
    return (
      <Shell onSignOut={onSignOut}>
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <XCircle className="w-9 h-9 text-[#E21E26]" />
          </div>
          <h1 className="text-xl font-black text-gray-900">Application Not Approved</h1>
          <p className="text-xs text-gray-500">
            Hi {driver.name.split(' ')[0] || 'there'}, our team could not verify your application.
          </p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-800">
          <p className="font-bold mb-1">Reason</p>
          <p>{driver.rejectionReason || 'One or more documents were unclear or invalid. Please re-upload clear photos.'}</p>
        </div>
        <button
          onClick={onResubmit}
          className="w-full bg-[#E21E26] text-white py-3.5 rounded-2xl font-black text-sm hover:bg-[#C9141B] transition-colors"
        >
          Correct Details &amp; Resubmit
        </button>
      </Shell>
    );
  }

  if (driver.approvalStatus === 'Suspended') {
    return (
      <Shell onSignOut={onSignOut}>
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto">
            <Ban className="w-9 h-9 text-gray-600" />
          </div>
          <h1 className="text-xl font-black text-gray-900">Account Suspended</h1>
          <p className="text-xs text-gray-500">
            Your driver account has been temporarily suspended. Please contact NESAM support to resolve this.
          </p>
          {driver.rejectionReason && (
            <p className="text-xs bg-gray-50 border border-gray-200 rounded-xl p-3 text-gray-700">{driver.rejectionReason}</p>
          )}
        </div>
      </Shell>
    );
  }

  // Pending
  return (
    <Shell onSignOut={onSignOut}>
      <div className="text-center space-y-3">
        <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
          <Clock className="w-9 h-9 text-amber-600 animate-pulse" />
        </div>
        <h1 className="text-xl font-black text-gray-900">Verification Pending</h1>
        <p className="text-xs text-gray-500 max-w-sm mx-auto">
          Thanks {driver.name.split(' ')[0] || ''}! Your application has been submitted. The NESAM team is verifying your
          documents — this usually takes 24–48 hours. This page updates automatically once you are approved.
        </p>
      </div>

      <Checklist account={account} />

      <ol className="space-y-2 text-xs">
        {[
          { label: 'Mobile number verified', state: 'done' },
          { label: 'Documents submitted', state: 'done' },
          { label: 'Admin verification', state: 'current' },
          { label: 'Start accepting trips', state: 'todo' },
        ].map((s, i) => (
          <li key={s.label} className="flex items-center gap-3">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                s.state === 'done' ? 'bg-emerald-500 text-white' : s.state === 'current' ? 'bg-amber-500 text-white' : 'bg-gray-200 text-gray-500'
              }`}
            >
              {s.state === 'done' ? '✓' : i + 1}
            </span>
            <span className={`font-semibold ${s.state === 'todo' ? 'text-gray-400' : 'text-gray-800'}`}>{s.label}</span>
          </li>
        ))}
      </ol>
    </Shell>
  );
};

interface NoAccountProps {
  phone: string;
  onRegister: () => void;
  onSignOut: () => void;
}

/** Shown when someone chose "Login" with a number that has no driver account. */
export const NoAccountScreen: React.FC<NoAccountProps> = ({ phone, onRegister, onSignOut }) => (
  <Shell onSignOut={onSignOut}>
    <div className="text-center space-y-3">
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto">
        <UserX className="w-9 h-9 text-gray-500" />
      </div>
      <h1 className="text-xl font-black text-gray-900">No Driver Account Found</h1>
      <p className="text-xs text-gray-500">
        <span className="font-bold text-gray-800">{phone}</span> is not registered as a NESAM driver partner yet.
      </p>
    </div>
    <button
      onClick={onRegister}
      className="w-full bg-[#E21E26] text-white py-3.5 rounded-2xl font-black text-sm hover:bg-[#C9141B] transition-colors"
    >
      Register as a New Driver
    </button>
  </Shell>
);
