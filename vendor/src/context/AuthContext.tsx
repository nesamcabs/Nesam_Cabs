import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { User } from 'firebase/auth';
import type { VendorRecord } from '../types/vendor';
import { subscribeToAuthUser, signOutUser } from '../services/authService';
import { subscribeToVendor } from '../services/onboardingService';

interface AuthContextType {
  user: User | null;
  vendorRecord: VendorRecord | null;
  authLoading: boolean;
  vendorLoading: boolean;
  vendorError: boolean;
  retryVendor: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [vendorRecord, setVendorRecord] = useState<VendorRecord | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [vendorLoading, setVendorLoading] = useState(false);
  const [vendorError, setVendorError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const retryVendor = () => setRetryKey((k) => k + 1);

  // Subscribe to Firebase Auth
  useEffect(() => {
    return subscribeToAuthUser((u) => {
      setUser(u);
      setAuthLoading(false);
      if (!u) {
        setVendorRecord(null);
        setVendorLoading(false);
        setVendorError(false);
      }
    });
  }, []);

  // Subscribe to vendor record
  useEffect(() => {
    if (!user) return;
    setVendorLoading(true);
    setVendorError(false);

    return subscribeToVendor(
      user.uid,
      (snap) => {
        setVendorRecord(snap ? snap.record : null);
        setVendorLoading(false);
        setVendorError(false);
      },
      (err: unknown) => {
        console.error('[Vendor AuthContext] vendor record error:', err);
        setVendorError(true);
        setVendorLoading(false);
      },
    );
  }, [user, retryKey]);

  return (
    <AuthContext.Provider
      value={{
        user,
        vendorRecord,
        authLoading,
        vendorLoading,
        vendorError,
        retryVendor,
        signOut: signOutUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}