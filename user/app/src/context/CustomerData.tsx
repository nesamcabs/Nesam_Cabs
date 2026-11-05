// Live data for the signed-in customer (notifications live in context/Inbox), subscribed once for the whole session
// (mirrors RiderApp in user/web/src/App.tsx). Every screen reads from here, so
// there is exactly one listener per query and all of them are torn down on
// sign-out.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { LocationItem, TripRecord, UserProfile } from '../types';
import { isLiveRide, subscribeToUserBookings } from '../services/rideService';
import { subscribeToSavedPlaces } from '../services/userService';
import { describeError } from '../utils/retry';

/** Completed trips younger than this still prompt for a rating. */
const RATING_PROMPT_WINDOW_MS = 3 * 60 * 60 * 1000;

interface CustomerDataValue {
  profile: UserProfile;
  trips: TripRecord[];
  tripsLoading: boolean;
  tripsError: string;
  retryTrips: () => void;
  savedPlaces: LocationItem[];
  liveRide: TripRecord | null;
  /** A recently completed, unrated trip to prompt for feedback. */
  unratedTrip: TripRecord | null;
}

const Ctx = createContext<CustomerDataValue | null>(null);

export function useCustomerData(): CustomerDataValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('CustomerDataProvider is missing');
  return v;
}

export function CustomerDataProvider({ profile = null, children }: { profile?: UserProfile | null; children: React.ReactNode }) {
  return <SessionDataProvider key={profile?.uid ?? 'guest'} profile={profile}>{children}</SessionDataProvider>;
}

// Changing accounts remounts the subscriptions and clears the previous account's data immediately.
function SessionDataProvider({ profile, children }: { profile: UserProfile | null; children: React.ReactNode }) {
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [tripsLoading, setTripsLoading] = useState(!!profile);
  const [tripsError, setTripsError] = useState('');
  const [tripsKey, setTripsKey] = useState(0);
  const [savedPlaces, setSavedPlaces] = useState<LocationItem[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const uid = profile?.uid;

  // The provider is keyed by uid, so only an explicit retry needs a reset —
  // done in retryTrips, not here.
  useEffect(() => {
    if (!uid) return undefined;
    return subscribeToUserBookings(
      uid,
      (t) => {
        setTrips(t);
        setTripsLoading(false);
        setTripsError('');
      },
      (e) => {
        setTripsLoading(false);
        setTripsError(describeError(e, 'We couldn’t load your trips.'));
      },
    );
  }, [uid, tripsKey]);

  useEffect(() => {
    if (!uid) return undefined;
    return subscribeToSavedPlaces(uid, setSavedPlaces);
  }, [uid]);

  // Scheduled rides become "live" an hour before pickup without any write.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const retryTrips = useCallback(() => {
    setTripsError('');
    setTripsLoading(true);
    setTripsKey((k) => k + 1);
  }, []);

  const value = useMemo<CustomerDataValue>(() => {
    const liveRide = trips.find((t) => isLiveRide(t, now)) ?? null;
    const unratedTrip =
      trips.find(
        (t) => t.status === 'Completed' && t.rating == null && !!t.completedAt && now - t.completedAt.getTime() < RATING_PROMPT_WINDOW_MS,
      ) ?? null;
    return {
      profile: profile as UserProfile,
      trips,
      tripsLoading,
      tripsError,
      retryTrips,
      savedPlaces,
      liveRide,
      unratedTrip,
    };
  }, [profile, trips, tripsLoading, tripsError, retryTrips, savedPlaces, now]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
