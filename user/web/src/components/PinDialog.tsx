// "Choose on map": a fixed pin over a moving map, with the address under it.
import { useEffect, useRef, useState } from 'react';
import type { GeoPlace, LatLng } from '@core/types';
import { reverseGeocode } from '@core/services/geoService';
import { Button, Dialog } from './ui';
import { Icon } from './Icon';
import { RouteMap } from './RouteMap';
import { useDeviceLocation } from '@/lib/hooks';
import { LOCATION_HELP } from '@/lib/schedule';

export function PinDialog({ title, mode, onBack, onConfirm }: { title: string; mode: 'pickup' | 'drop'; onBack: () => void; onConfirm: (p: GeoPlace) => void }) {
  // Starts on the rider's real location (asks once); the map's locate button finds it again after panning away.
  const { position, locate, locating, error: locError, permission } = useDeviceLocation(false, true);
  const [center, setCenter] = useState<LatLng | null>(null);
  const [place, setPlace] = useState<GeoPlace | null>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  // Slides down before it is removed, mirroring the slide up when it opens.
  const close = () => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(onBack, 240);
  };

  useEffect(() => {
    if (!center) return undefined;
    setBusy(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      reverseGeocode(center, controller.signal)
        .then((p) => {
          if (controller.signal.aborted) return;
          setPlace(p);
          setBusy(false);
        })
        .catch(() => undefined);
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [center?.lat, center?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const locNote = locError ? LOCATION_HELP[locError.kind] : permission === 'denied' || permission === 'blocked' ? LOCATION_HELP.blocked : '';

  return (
    <Dialog
      variant="page"
      className={`pin-sheet ${closing ? 'is-closing' : ''}`}
      title={title}
      subtitle="Move the map so the pin sits on the exact spot."
      onClose={close}
      footer={
        <>
          <Button variant="secondary" icon="arrow-left" onClick={close}>
            Back
          </Button>
          <Button disabled={!place || busy} onClick={() => place && onConfirm(place)}>
            Confirm location
          </Button>
        </>
      }
    >
      <RouteMap className="pinmap" label="Choose a place on the map" pinMode={mode} userLocation={position} onCenterChange={setCenter} onLocate={locate} />
      {locating ? (
        <p className="pin-note muted" role="status">
          Finding your location…
        </p>
      ) : locNote ? (
        <p className="pin-note muted" role="status">
          {locNote}
        </p>
      ) : null}
      <div className="pin-card" aria-live="polite">
        <Icon name="map-pin" size={20} />
        <div>
          <strong>{place?.name ?? 'Move the map…'}</strong>
          <small className="muted">{busy ? 'Finding address…' : place && place.address !== place.name ? place.address : ''}</small>
        </div>
      </div>
    </Dialog>
  );
}
