// Web build of the Local Rentals map. react-native-maps has no web implementation, so the page falls back to its
// search-only panel (the screen checks MAPS_ENABLED, which is false on web). This module only keeps the types in step.
import React from 'react';

export interface PinMapPin {
  lat: number;
  lng: number;
  name: string;
  kind: 'from' | 'to';
}
export interface PinMapTarget {
  lat: number;
  lng: number;
  delta: number;
  n: number;
}

export function PinMap(_props: { picking: boolean; target: PinMapTarget | null; pins: PinMapPin[]; onPick: (ll: { lat: number; lng: number }) => void }) {
  return null;
}
