// Native replacement for the Leaflet RideMap in user/web. Uses Google Maps via
// react-native-maps when an Android Maps key was supplied at build time; the
// Google Maps SDK aborts without a key, so otherwise a route card with
// "Open in Google Maps" actions is shown instead.
import React, { useEffect, useMemo, useRef } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import type { LatLng } from '../types';
import { googleMapsLink, isValidLatLng } from '../utils/geo';
import { Button } from './ui';
import { colors, radius, space, type } from '../theme';

export const MAPS_ENABLED = Constants.expoConfig?.extra?.mapsEnabled === true;

interface RideMapProps {
  pickup?: (LatLng & { name?: string }) | null;
  drop?: (LatLng & { name?: string }) | null;
  driver?: (LatLng & { label?: string; stale?: boolean }) | null;
  userLocation?: LatLng | null;
  route?: [number, number][] | null;
  height?: number;
}

export function RideMap({ pickup, drop, driver, userLocation, route, height = 260 }: RideMapProps) {
  const mapRef = useRef<MapView>(null);
  const points = useMemo(
    () =>
      [pickup, drop, driver, userLocation]
        .filter((p): p is LatLng => isValidLatLng(p ?? null))
        .map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [pickup?.lat, pickup?.lng, drop?.lat, drop?.lng, driver?.lat, driver?.lng, userLocation?.lat, userLocation?.lng], // eslint-disable-line react-hooks/exhaustive-deps -- coordinates are the real inputs
  );

  useEffect(() => {
    if (!MAPS_ENABLED || !points.length) return;
    const t = setTimeout(
      () => mapRef.current?.fitToCoordinates(points, { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true }),
      250,
    );
    return () => clearTimeout(t);
  }, [points]);

  if (!MAPS_ENABLED) {
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

  const first = points[0] ?? { latitude: 10.0104, longitude: 77.4768 };
  return (
    <View style={[styles.mapWrap, { height }]}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={{ ...first, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        showsUserLocation={!!userLocation}
        toolbarEnabled={false}
      >
        {isValidLatLng(pickup ?? null) ? (
          <Marker coordinate={{ latitude: pickup!.lat, longitude: pickup!.lng }} title="Pickup" description={pickup?.name} pinColor="green" />
        ) : null}
        {isValidLatLng(drop ?? null) ? (
          <Marker coordinate={{ latitude: drop!.lat, longitude: drop!.lng }} title="Destination" description={drop?.name} pinColor="red" />
        ) : null}
        {isValidLatLng(driver ?? null) ? (
          <Marker
            coordinate={{ latitude: driver!.lat, longitude: driver!.lng }}
            title={driver?.label ?? 'Your driver'}
            description={driver?.stale ? 'Last known position' : 'Live'}
            pinColor={driver?.stale ? 'orange' : 'black'}
          />
        ) : null}
        {route && route.length > 1 ? (
          <Polyline coordinates={route.map(([lat, lng]) => ({ latitude: lat, longitude: lng }))} strokeColor={colors.primary} strokeWidth={4} />
        ) : null}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: { borderRadius: radius.lg, overflow: 'hidden', marginBottom: space.md, backgroundColor: colors.border },
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
