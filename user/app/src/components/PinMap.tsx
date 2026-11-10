// The Local Rentals map (native): a draggable Google map with a fixed pin in the middle. While a place is being
// chosen the place is whatever sits under the pin when the rider stops moving the map; afterwards the map just
// shows the trip. Needs the Maps key (MAPS_ENABLED); the screen shows a search-only panel without it.
import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { colors } from '../theme';
import { STATE_VIEW } from '../data/localRentals';

export interface PinMapPin {
  lat: number;
  lng: number;
  name: string;
  kind: 'from' | 'to';
}
export interface PinMapTarget {
  lat: number;
  lng: number;
  /** Visible span of the map in degrees (smaller = closer). */
  delta: number;
  /** Changes on every request, so asking for the same place twice still moves the map. */
  n: number;
}

interface Props {
  picking: boolean;
  target: PinMapTarget | null;
  pins: PinMapPin[];
  onPick: (ll: { lat: number; lng: number }) => void;
}

export function PinMap({ picking, target, pins, onPick }: Props) {
  const ref = useRef<MapView>(null);
  const live = useRef({ picking, onPick });
  live.current = { picking, onPick };
  const programmatic = useRef(false);

  // Move to a place (a search result, the device location, a city chip).
  useEffect(() => {
    if (!target || !ref.current) return;
    programmatic.current = true;
    ref.current.animateToRegion({ latitude: target.lat, longitude: target.lng, latitudeDelta: target.delta, longitudeDelta: target.delta }, 250);
    const t = setTimeout(() => {
      programmatic.current = false;
    }, 600);
    return () => clearTimeout(t);
  }, [target?.n]); // eslint-disable-line react-hooks/exhaustive-deps -- `n` is the request id

  const coords = useMemo(() => pins.map((p) => ({ latitude: p.lat, longitude: p.lng })), [pins]);

  // Once the places are chosen, fit the trip into view.
  useEffect(() => {
    if (picking || !coords.length || !ref.current) return;
    programmatic.current = true;
    const t = setTimeout(() => {
      if (coords.length === 1) ref.current?.animateToRegion({ latitude: coords[0]!.latitude, longitude: coords[0]!.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 250);
      else ref.current?.fitToCoordinates(coords, { edgePadding: { top: 70, right: 50, bottom: 50, left: 50 }, animated: true });
    }, 150);
    const done = setTimeout(() => {
      programmatic.current = false;
    }, 700);
    return () => {
      clearTimeout(t);
      clearTimeout(done);
    };
  }, [picking, coords]);

  const onRegionChangeComplete = (region: Region, details?: { isGesture?: boolean }) => {
    // Only a drag or pinch by the rider counts: a programmatic move or a resize must never change the place.
    if (programmatic.current || !live.current.picking || !details?.isGesture) return;
    live.current.onPick({ lat: region.latitude, lng: region.longitude });
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapView
        ref={ref}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: STATE_VIEW.lat, longitude: STATE_VIEW.lng, latitudeDelta: STATE_VIEW.latDelta, longitudeDelta: STATE_VIEW.lngDelta }}
        onRegionChangeComplete={onRegionChangeComplete}
        toolbarEnabled={false}
        showsCompass={false}
        showsMyLocationButton={false}
        rotateEnabled={false}
        pitchEnabled={false}
        moveOnMarkerPress={false}
      >
        {pins.length === 2 ? <Polyline coordinates={coords} strokeColor={colors.ink} strokeWidth={4} lineDashPattern={[2, 9]} lineCap="round" /> : null}
        {pins.map((p) => (
          <Marker key={`${p.kind}-${p.lat}-${p.lng}`} coordinate={{ latitude: p.lat, longitude: p.lng }} title={p.kind === 'from' ? 'Pickup' : 'Drop'} description={p.name} pinColor={p.kind === 'from' ? 'green' : 'red'} />
        ))}
      </MapView>
    </View>
  );
}
