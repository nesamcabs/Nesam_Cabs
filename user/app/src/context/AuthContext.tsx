import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import type { User } from 'firebase/auth';
import type { UserProfile } from '../types';
import { subscribeToAuthUser } from '../services/authService';
import { subscribeToCustomerProfile } from '../services/userFirestoreService';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  authLoading: boolean;
  profileLoading: boolean;
  profileError: boolean;
  retryProfile: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [profileLoading, setProfileLoading] = useState<boolean>(true);
  const [profileError, setProfileError] = useState<boolean>(false);
  const [retryTrigger, setRetryTrigger] = useState<number>(0);

  const retryProfile = useCallback(() => {
    setRetryTrigger((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const unsubscribeAuth = subscribeToAuthUser((authUser) => {
      setUser(authUser);
      if (!authUser) {
        setProfile(null);
        setProfileLoading(false);
        setProfileError(false);
      }
      setAuthLoading(false);
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) {
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);
    setProfileError(false);

    const unsubscribeProfile = subscribeToCustomerProfile(
      user.uid,
      (userProfile, fromCache) => {
        // Handle fromCache case (avoid treating initial cache miss as definitive null)
        if (fromCache && userProfile === null) {
          // Keep loading if it's a cache miss, wait for server
          return;
        }
        setProfile(userProfile);
        setProfileLoading(false);
        setProfileError(false);
      },
      (error) => {
        console.error('Error fetching user profile:', error);
        setProfileError(true);
        setProfileLoading(false);
      }
    );

    return () => unsubscribeProfile();
  }, [user, retryTrigger]);

  const value = {
    user,
    profile,
    authLoading,
    profileLoading,
    profileError,
    retryProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
