import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DEFAULT_CENTER, MAP_ATTRIBUTION, MAP_TILE_URL, inIndia, placeDetail, placeLabel, reverseGeocode, searchPlaces, type LatLng, type PlaceResult } from "../services/geoService";

declare global { interface Window { google?: any; __nesamGoogleMapsPromise?: Promise<any>; } }
const googleMapsKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ?? "";
const loadGoogleMaps = () => {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (window.__nesamGoogleMapsPromise) return window.__nesamGoogleMapsPromise;
  window.__nesamGoogleMapsPromise = new Promise((resolve, reject) => {
    const callback = `__nesamAdminMaps_${Date.now()}`;
    (window as any)[callback] = () => { delete (window as any)[callback]; resolve(window.google.maps); };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleMapsKey)}&v=weekly&callback=${callback}`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  });
  return window.__nesamGoogleMapsPromise;
};

/** A point on the map the admin has chosen. `confirmed` is true once they press "Confirm location". */
export interface PickedPoint extends LatLng {
  name: string;
  address: string;
  type: "airport" | "other";
  confirmed: boolean;
  /** Id of the chosen search suggestion, when the point came from one. */
  placeId?: string;
}

interface Props {
  label: string;
  value: PickedPoint | null;
  onChange: (p: PickedPoint | null) => void;
  /** Colour of the pin: pickup is green, drop is red. */
  tone?: "pickup" | "drop";
  error?: string | null;
  /** Where the map opens when nothing is chosen (e.g. the pickup, when picking the drop). */
  startNear?: LatLng | null;
  disabled?: boolean;
}

const pinIcon = (tone: "pickup" | "drop") =>
  L.divIcon({ className: "", html: `<div class="nt-pin nt-pin-${tone}"><span></span></div>`, iconSize: [26, 26], iconAnchor: [13, 13] });

const fmtCoord = (n: number) => n.toFixed(6);

/**
 * Pick a point visually: search an address (autocomplete), click the map or drag
 * the marker to fine-tune, see the reverse-geocoded address and coordinates, then
 * confirm the pinpoint. Saves address + latitude + longitude with the booking.
 */
export default function MapLocationPicker({ label, value, onChange, tone = "pickup", error, startNear, disabled }: Props) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const googleMapRef = useRef<any>(null);
  const googleMarkerRef = useRef<any>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const disabledRef = useRef(!!disabled);
  disabledRef.current = !!disabled;
  const geoAbort = useRef<AbortController | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [open, setOpen] = useState(false);
  const [googleFailed, setGoogleFailed] = useState(false);

  /** Move the marker, then look up the address for where it landed. */
  const place = useCallback(async (p: LatLng, known?: { name: string; address: string; type: "airport" | "other" }, pan = false) => {
    if (!inIndia(p)) {
      setSearchError("Choose a point inside India.");
      return;
    }
    setSearchError(null);
    markerRef.current?.setLatLng([p.lat, p.lng]);
    if (pan && mapRef.current) mapRef.current.setView([p.lat, p.lng], Math.max(mapRef.current.getZoom(), 16));
    if (googleMarkerRef.current) { googleMarkerRef.current.setPosition(p); googleMarkerRef.current.setVisible(true); }
    if (pan && googleMapRef.current) { googleMapRef.current.setCenter(p); googleMapRef.current.setZoom(Math.max(googleMapRef.current.getZoom() ?? 0, 16)); }
    if (known) {
      onChangeRef.current({ ...p, ...known, confirmed: false });
      return;
    }
    // Keep the pin and show the coordinates straight away; the address follows.
    onChangeRef.current({ ...p, name: valueRef.current?.name ?? "Pinned location", address: valueRef.current?.address ?? "", type: "other", confirmed: false });
    geoAbort.current?.abort();
    const ctl = new AbortController();
    geoAbort.current = ctl;
    setResolving(true);
    try {
      const r = await reverseGeocode(p, ctl.signal);
      onChangeRef.current({ ...p, name: r.name, address: r.address, type: "other", confirmed: false });
    } catch {
      /* superseded by a newer move */
    } finally {
      if (geoAbort.current === ctl) setResolving(false);
    }
  }, []);

  // Create the map once.
  useEffect(() => {
    if (!mapEl.current || mapRef.current || googleMapRef.current) return;
    const start = valueRef.current ?? startNear ?? DEFAULT_CENTER;
    if (googleMapsKey && !googleFailed) {
      let alive = true;
      loadGoogleMaps().then((maps) => {
        if (!alive || !mapEl.current) return;
        const map = new maps.Map(mapEl.current, { center: start, zoom: valueRef.current ? 16 : startNear ? 12 : 7, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false });
        const marker = new maps.Marker({ map, position: start, draggable: !disabledRef.current, visible: Boolean(valueRef.current), icon: { path: maps.SymbolPath.CIRCLE, fillColor: tone === "pickup" ? "#16a34a" : "#e8344c", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3, scale: 10 } });
        marker.addListener("dragend", () => { if (disabledRef.current) return; const p = marker.getPosition(); void place({ lat: p.lat(), lng: p.lng() }); });
        map.addListener("click", (e: any) => { if (disabledRef.current || !e.latLng) return; marker.setVisible(true); void place({ lat: e.latLng.lat(), lng: e.latLng.lng() }); });
        googleMapRef.current = map;
        googleMarkerRef.current = marker;
      }).catch(() => { if (alive) { setSearchError("Google Maps could not load. Using the fallback map."); setGoogleFailed(true); } });
      return () => { alive = false; googleMarkerRef.current?.setMap(null); googleMarkerRef.current = null; googleMapRef.current = null; geoAbort.current?.abort(); };
    }
    const map = L.map(mapEl.current, { zoomControl: true, attributionControl: true, maxBounds: [[5, 66], [37, 99]], minZoom: 4 }).setView([start.lat, start.lng], valueRef.current ? 16 : startNear ? 12 : 7);
    L.tileLayer(MAP_TILE_URL, { attribution: MAP_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    const marker = L.marker([start.lat, start.lng], { draggable: true, icon: pinIcon(tone), opacity: valueRef.current ? 1 : 0 }).addTo(map);
    marker.on("dragend", () => {
      if (disabledRef.current) return;
      const ll = marker.getLatLng();
      void place({ lat: ll.lat, lng: ll.lng });
    });
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (disabledRef.current) return;
      marker.setOpacity(1);
      void place({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    mapRef.current = map;
    markerRef.current = marker;
    // The map is rendered inside a modal that may still be laying out.
    setTimeout(() => map.invalidateSize(), 120);
    return () => {
      geoAbort.current?.abort();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleFailed]);

  // Reflect a value set from outside (a saved location was chosen, or the form was reset).
  useEffect(() => {
    const m = markerRef.current;
    const map = mapRef.current;
    const gm = googleMarkerRef.current;
    const gmap = googleMapRef.current;
    if (gm && gmap) {
      if (value) { gm.setPosition(value); gm.setVisible(true); gmap.setCenter(value); gmap.setZoom(Math.max(gmap.getZoom() ?? 0, 16)); }
      else gm.setVisible(false);
      return;
    }
    if (!m || !map) return;
    if (value) {
      const cur = m.getLatLng();
      if (Math.abs(cur.lat - value.lat) > 1e-9 || Math.abs(cur.lng - value.lng) > 1e-9) {
        m.setLatLng([value.lat, value.lng]);
        map.setView([value.lat, value.lng], Math.max(map.getZoom(), 16));
      }
      m.setOpacity(1);
    } else {
      m.setOpacity(0);
    }
  }, [value]);

  // Debounced autocomplete.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    const ctl = new AbortController();
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        setResults(await searchPlaces(q, value ?? startNear ?? null, ctl.signal));
        setSearchError(null);
      } catch {
        if (!ctl.signal.aborted) setSearchError("Address search is unavailable. Click the map to place the pin instead.");
      } finally {
        if (!ctl.signal.aborted) setSearching(false);
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query, value, startNear]);

  const choose = (r: PlaceResult) => {
    setQuery("");
    setResults([]);
    setOpen(false);
    markerRef.current?.setOpacity(1);
    googleMarkerRef.current?.setVisible(true);
    void place({ lat: r.lat, lng: r.lng }, { name: r.name, address: r.address, type: r.type }, true);
  };

  const setCoord = (axis: "lat" | "lng", raw: string) => {
    const n = Number(raw);
    if (!value || !Number.isFinite(n)) return;
    void place({ lat: axis === "lat" ? n : value.lat, lng: axis === "lng" ? n : value.lng }, undefined, true);
  };

  const inputCls =
    "w-full px-3 py-2.5 border border-line-strong rounded-lg text-sm bg-white text-ink placeholder-[#767676] focus:border-brand focus:outline-none disabled:bg-gray-100 disabled:text-muted";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-body">{label} *</span>
        {value && (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${value.confirmed ? "bg-green-50 text-green-700 border-green-200" : "bg-amber-50 text-amber-800 border-amber-200"}`}>
            {value.confirmed ? "✓ Location confirmed" : "Not confirmed yet"}
          </span>
        )}
      </div>

      <div className="relative">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          disabled={disabled}
          placeholder="Search address, landmark or place…"
          aria-label={`${label} search`}
          autoComplete="off"
          className={inputCls}
        />
        {searching && <span className="absolute right-3 top-3 text-[11px] text-muted">Searching…</span>}
        {open && results.length > 0 && (
          <ul role="listbox" className="absolute z-[1000] left-0 right-0 mt-1 max-h-60 overflow-auto rounded-lg border border-line-strong bg-white shadow-lg">
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" role="option" aria-selected="false" onClick={() => choose(r)} title={r.address} className="w-full min-w-0 text-left px-3 py-2 hover:bg-brand-soft focus:bg-brand-soft focus:outline-none">
                  <div className="text-sm font-semibold text-ink truncate">{placeLabel(r)}</div>
                  {placeDetail(r) && <div className="text-xs text-muted truncate">{placeDetail(r)}</div>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {searchError && <p className="text-xs text-amber-800">{searchError}</p>}

      <div ref={mapEl} className="h-64 w-full rounded-xl border border-line-strong overflow-hidden z-0" role="application" aria-label={`${label} map. Click to place the pin, drag the pin to adjust.`} />
      {!value && <p className="text-xs text-muted">Search above, or click the map to drop the pin. You can drag the pin to fine-tune it.</p>}

      {value && (
        <div className="space-y-2">
          <label className="block">
            <span className="block text-xs font-semibold text-body mb-1">Address {resolving && <em className="font-normal text-muted">(finding address…)</em>}</span>
            <textarea
              value={value.address}
              onChange={(e) => onChange({ ...value, address: e.target.value, confirmed: false })}
              disabled={disabled}
              rows={2}
              maxLength={300}
              className={inputCls}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-xs font-semibold text-body mb-1">Latitude</span>
              <input defaultValue={fmtCoord(value.lat)} key={`lat-${fmtCoord(value.lat)}`} onBlur={(e) => setCoord("lat", e.target.value)} inputMode="decimal" disabled={disabled} className={`${inputCls} font-mono`} />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-body mb-1">Longitude</span>
              <input defaultValue={fmtCoord(value.lng)} key={`lng-${fmtCoord(value.lng)}`} onBlur={(e) => setCoord("lng", e.target.value)} inputMode="decimal" disabled={disabled} className={`${inputCls} font-mono`} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled || resolving || value.address.trim().length < 3 || value.confirmed}
              onClick={() => onChange({ ...value, confirmed: true })}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-[#16A34A] disabled:opacity-50"
            >
              {value.confirmed ? "Confirmed" : "Confirm location"}
            </button>
            <button type="button" disabled={disabled} onClick={() => onChange(null)} className="px-4 py-2 rounded-lg text-sm font-semibold border border-line-strong text-body hover:bg-gray-50 disabled:opacity-50">
              Clear
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs font-semibold text-red-700" role="alert">{error}</p>}
    </div>
  );
}
