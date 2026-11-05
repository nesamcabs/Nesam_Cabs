// NESAM Cabs icon renderer: lightweight SVG line icons and travel pictograms.
// Friendly round caps and corners (1.8 stroke, currentColor).
import type { CSSProperties } from 'react';
import { ICONS, TRAVEL_ICONS } from './iconData';

const files = import.meta.glob('../assets/icons/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const SVG_OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';

const ALIASES: Record<string, string> = {
  check: 'check',
  tick: 'check',
  'check-circle': 'circle-check',
  success: 'circle-check',
  'shield-check': 'shield-check',
  shield: 'shield',
  close: 'close',
  cross: 'cross',
  x: 'cross',
  xmark: 'cross',
  cancel: 'circle-xmark',
  'circle-x': 'circle-xmark',
  'circle-xmark': 'circle-xmark',
  alert: 'warning',
  warning: 'warning',
  info: 'info',
  help: 'help',
  question: 'help',
  car: 'car',
  cab: 'car',
  clock: 'clock',
  time: 'clock',
  calendar: 'calendar',
  date: 'calendar',
  map: 'map',
  pin: 'pin',
  'map-pin': 'map-pin',
  location: 'pin',
  'current-location': 'navigation',
  navigation: 'navigation',
  navigate: 'navigation',
  'chevron-down': 'chevron-down',
  'chevron-up': 'chevron-up',
  'chevron-right': 'chevron-right',
  'chevron-left': 'chevron-left',
  'arrow-right': 'arrow-right',
  'arrow-left': 'arrow-left',
  swap: 'swap',
  user: 'user',
  profile: 'user',
  phone: 'phone',
  call: 'phone',
  whatsapp: 'whatsapp',
  search: 'search',
  sparkles: 'sparkles',
  snowflake: 'snowflake',
  ac: 'snowflake',
  star: 'star',
  wallet: 'wallet',
  cash: 'wallet',
  trash: 'trash',
  delete: 'trash',
  bell: 'bell',
  notifications: 'bell',
  tag: 'tag',
  coupon: 'tag',
  offer: 'tag',
  offers: 'tag',
  home: 'home',
  plane: 'plane',
  flight: 'flight',
  briefcase: 'briefcase',
  luggage: 'luggage',
  suitcase: 'luggage',
  route: 'route',
  trip: 'route',
  trips: 'route',
  'trip-history': 'route',
  'saved-place': 'pin',
  document: 'briefcase',
  logout: 'arrow-left',
};

const diskCache: Record<string, string> = {};
for (const [path, raw] of Object.entries(files)) {
  const name = path.split('/').pop()!.replace(/\.svg$/, '');
  diskCache[name] = raw.replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
}

export function Icon({
  name,
  size = 20,
  className = '',
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const key = ALIASES[name] ?? name;
  let svg = '';

  if (ICONS[key]) {
    svg = `${SVG_OPEN}${ICONS[key]}</svg>`;
  } else if (TRAVEL_ICONS[key]) {
    svg = `${SVG_OPEN}${TRAVEL_ICONS[key]}</svg>`;
  } else if (diskCache[key]) {
    svg = diskCache[key];
  } else if (diskCache[name]) {
    svg = diskCache[name];
  } else {
    svg = `${SVG_OPEN}${ICONS.info}</svg>`;
  }

  return (
    <span
      className={`icon ${className}`}
      style={{ '--icon': `${size}px`, width: size, height: size, display: 'inline-grid', placeItems: 'center', ...style } as CSSProperties}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
export default Icon;
