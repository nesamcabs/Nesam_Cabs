// What a pickup or drop field offers, and a way to open its search page from a button.
import type { GeoPlace, LatLng, LocationItem } from '@core/types';
import { PlaceSearchPage } from './placeSearch/PlaceSearchPage';

export interface PickerConfig {
  title: string;
  allowCurrent?: boolean;
  check?: (p: GeoPlace) => string;
  popular: GeoPlace[];
  popularLabel?: string;
  near?: LatLng | null;
  pinMode?: 'pickup' | 'drop';
  // Airport-only pickers: search shows just the places this accepts (plus matching `popular` entries).
  resultFilter?: (p: GeoPlace) => boolean;
  subtitle?: string;
  placeholder?: string;
  emptyText?: string;
}

export function LocationPicker({
  config,
  saved,
  recent,
  onSelect,
  onClose,
}: {
  config: PickerConfig;
  saved: LocationItem[];
  recent: GeoPlace[];
  onSelect: (p: GeoPlace) => void;
  onClose: () => void;
}) {
  return <PlaceSearchPage config={config} saved={saved} recent={recent} onSelect={onSelect} onClose={onClose} />;
}
export default LocationPicker;
