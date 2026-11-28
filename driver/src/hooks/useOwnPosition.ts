// The driver's position for "how far is this pickup" on duty cards. It never asks for permission: it reads the position only
// when location access is already allowed, and every card on a screen shares one reading, refreshed at most once a minute.
import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

export interface OwnPosition {
  lat: number;
  lng: number;
}

const FRESH_MS = 60_000;
let shared: { at: number; value: Promise<OwnPosition | null> } | null = null;

async function read(): Promise<OwnPosition | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission?.granted) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }).catch(() => null);
    const position = last ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return position ? { lat: position.coords.latitude, lng: position.coords.longitude } : null;
  } catch {
    return null;
  }
}

export function useOwnPosition(): OwnPosition | null {
  const [position, setPosition] = useState<OwnPosition | null>(null);
  useEffect(() => {
    let alive = true;
    if (!shared || Date.now() - shared.at > FRESH_MS) shared = { at: Date.now(), value: read() };
    void shared.value.then((value) => {
      if (alive && value) setPosition(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return position;
}
