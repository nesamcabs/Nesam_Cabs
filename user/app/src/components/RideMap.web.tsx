// Web build of RideMap (used only by the browser preview of this app):
// react-native-maps has no web implementation, so the route card with
// "Open in Google Maps" actions is shown, as on phones without a Maps key.
import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import type { LatLng } from '../types';
import { googleMapsLink, isValidLatLng } from '../utils/geo';
import { Button } from './ui';
import { colors, radius, space, type } from '../theme';

export const MAPS_ENABLED = false;

interface RideMapProps {
  pickup?: (LatLng & { name?: string }) | null;
  drop?: (LatLng & { name?: string }) | null;
  driver?: (LatLng & { label?: string; stale?: boolean }) | null;
  userLocation?: LatLng | null;
  route?: [number, number][] | null;
  height?: number;
}

export function RideMap({ pickup, drop, driver, height = 260 }: RideMapProps) {
  const open = (p: LatLng) => void Linking.openURL(googleMapsLink(p));
  return (
    <View style={[styles.fallback, { minHeight: Math.min(height, 170) }]}>
      <Text style={type.h3}>Live map</Text>
      <Text style={[type.small, { marginBottom: space.md }]}>Open locations in Google Maps for turn-by-turn view.</Text>
      <View style={styles.fallbackButtons}>
        {isValidLatLng(pickup ?? null) ? <Button small variant="secondary" title="Pickup" onPress={() => open(pickup as LatLng)} /> : null}
        {isValidLatLng(drop ?? null) ? <Button small variant="secondary" title="Destination" onPress={() => open(drop as LatLng)} /> : null}
        {isValidLatLng(driver ?? null) ? <Button small variant="dark" title="Driver now" onPress={() => open(driver as LatLng)} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: space.lg,
    marginBottom: space.md,
  },
  fallbackButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
