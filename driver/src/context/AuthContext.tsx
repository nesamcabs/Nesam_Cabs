import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { User } from 'firebase/auth';
import type { DriverAccount } from '../types/driver';
import { subscribeToAuthUser, signOutUser } from '../services/authService';
import { subscribeToDriverAccount } from '../services/driverFirestoreService';

interface AuthContextType {
  user: User | null;
  account: DriverAccount | null;
  authLoading: boolean;
  accountLoading: boolean;
  accountError: boolean;
  retryAccount: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [account, setAccount] = useState<DriverAccount | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const retryAccount = () => setRetryKey((k) => k + 1);

  useEffect(() => {
    return subscribeToAuthUser((u) => {
      setUser(u);
      setAuthLoading(false);
      if (!u) {
        setAccount(null);
        setAccountLoading(false);
        setAccountError(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    setAccountLoading(true);
    setAccountError(false);

    return subscribeToDriverAccount(
      user.uid,
      (acc) => {
        setAccount(acc);
        setAccountLoading(false);
        setAccountError(false);
      },
      (err) => {
        console.error('[Driver AuthContext] account error:', err);
        setAccountError(true);
        setAccountLoading(false);
      },
    );
  }, [user, retryKey]);

  return (
    <AuthContext.Provider
      value={{
        user,
        account,
        authLoading,
        accountLoading,
        accountError,
        retryAccount,
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