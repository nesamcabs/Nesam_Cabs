// One distinct pictogram per kind of place, so a state, district, main city, town, bus stand or airport
// is told apart at a glance. Colours come from the [data-kind] rules in placeSearch.css.
import type { NodeKind } from './model';

export type IconKind = NodeKind | 'current' | 'map' | 'search' | 'back' | 'close' | 'chevron';

const ART: Record<IconKind, string> = {
  state: '<path d="M9 4 3.5 6.5v13L9 17l6 2.5 5.5-2.5V4L15 6.5z"/><path d="M9 4v13M15 6.5v13"/>',
  district: '<path d="M12 3.5 3.5 8 12 12.5 20.500 8z"/><path d="m3.5 12.500 8.500 4.5 8.500-4.500"/><path d="m3.500 16.500 8.500 4.500 8.500-4.5"/>',
  main: '<path d="M3 21h18"/><path d="M5 21V9l5-2v14"/><path d="M10 21V4h8v17"/><path d="M13 8h2M13 12h2M13 16h2M7 12h1M7 16h1"/>',
  town: '<path d="M3 21h18"/><path d="M5 21v-9.500L11.500 6 18 11.500V21"/><path d="M10 21v-5h3v5"/>',
  temple: '<path d="M4 21h16"/><path d="M6 21v-6h12v6"/><path d="M8 15v-4h8v4"/><path d="M10 11V8l2-4 2 4v3"/><path d="M11 21v-3h2v3"/>',
  hill: '<path d="m2.500 20 6.500-11 4 6 2.500-3.500 6 8.500z"/><circle cx="17" cy="6" r="2"/>',
  beach: '<circle cx="12" cy="9" r="3.500"/><path d="M12 2.500v1M5.500 9h-1M19.500 9h-1M7.400 4.400l.700.700M16.600 4.400l-.700.700"/><path d="M3 16c2 0 2-1.500 4.500-1.500S10 16 12 16s2-1.500 4.500-1.500S19 16 21 16M3 20c2 0 2-1.500 4.500-1.500S10 20 12 20s2-1.500 4.500-1.500S19 20 21 20"/>',
  area: '<path d="M12 21s6.500-5.800 6.500-11a6.500 6.500 0 0 0-13 0c0 5.200 6.500 11 6.500 11z"/><circle cx="12" cy="10" r="2.300"/>',
  bus: '<rect x="4.500" y="4" width="15" height="13" rx="2.500"/><path d="M4.500 11h15M8 4v7M16 4v7"/><path d="M7.500 17v2.500M16.500 17v2.500M8 14h.010M16 14h.010"/>',
  train: '<rect x="5.500" y="3.500" width="13" height="13.500" rx="3"/><path d="M5.500 11h13M12 3.500V11"/><path d="M9 14h.010M15 14h.010M8.500 17 6 21M15.500 17l2.500 4"/>',
  airport: '<path d="M17.800 19.200 16 11l3.500-3.500C21 6 21.500 4 21 3c-1-.5-3 0-4.500 1.500L13 8 4.800 6.200c-.5-.100-.900.100-1.100.500l-.300.500c-.2.500-.1 1 .3 1.300L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.500 5.300c.3.4.8.5 1.3.3l.5-.2c.4-.3.600-.7.500-1.200z"/>',
  landmark: '<path d="M3 21h18M4 10h16L12 4z"/><path d="M6.500 10v8M10 10v8M14 10v8M17.500 10v8M4.500 18h15"/>',
  place: '<path d="M12 21s6.500-5.800 6.500-11a6.500 6.500 0 0 0-13 0c0 5.200 6.500 11 6.500 11z"/><circle cx="12" cy="10" r="2.300"/>',
  home: '<path d="m3.500 11 8.500-7 8.500 7"/><path d="M5.500 9.500V20h13V9.500"/><path d="M10 20v-5.500h4V20"/>',
  work: '<rect x="3.500" y="8" width="17" height="12" rx="2"/><path d="M9 8V5.500A1.500 1.500 0 0 1 10.500 4h3A1.500 1.500 0 0 1 15 5.500V8M3.500 13h17"/>',
  favorite: '<path d="m12 3.800 2.500 5.100 5.600.8-4.100 4 1 5.600-5-2.700-5 2.700 1-5.600-4.100-4 5.600-.8z"/>',
  recent: '<path d="M4 12a8 8 0 1 0 2.600-5.900L4 8.500"/><path d="M4 4v4.500h4.500M12 8v4.500l3 1.800"/>',
  current: '<circle cx="12" cy="12" r="6.500"/><circle cx="12" cy="12" r="2.200" fill="currentColor"/><path d="M12 2.500v3M12 18.500v3M2.500 12h3M18.500 12h3"/>',
  map: '<path d="m9 18-5.500 2.500v-14L9 4l6 2.500L20.500 4v7"/><path d="M9 4v14M15 6.500V11"/><path d="M17.500 21.500s3.500-2.800 3.500-5.300a3.500 3.500 0 0 0-7 0c0 2.500 3.500 5.300 3.500 5.300z"/>',
  search: '<circle cx="11" cy="11" r="6.500"/><path d="m20 20-4.300-4.300"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
};

export function PlaceIcon({ kind, size = 18 }: { kind: IconKind; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ART[kind] }}
    />
  );
}
