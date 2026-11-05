// One icon family: the reference line icons (24-unit grid, 1.8 stroke, round caps, currentColor)
// plus the NESAM travel pictograms used for services. Older names used around the site map onto it.
import type { CSSProperties } from 'react';
import { LINE_ICONS, TRAVEL_ICONS } from './iconData';

const ALIAS: Record<string, string> = {
  add: 'plus',
  'air-conditioning': 'snowflake',
  booking: 'tickets',
  calendar: 'calendar-days',
  cancellation: 'circle-x',
  chat: 'message-circle',
  clock: 'clock-3',
  close: 'x',
  'current-location': 'locate-fixed',
  destination: 'map-pin',
  document: 'file-text',
  'document-upload': 'upload',
  driver: 'user-round',
  edit: 'pencil',
  email: 'mail',
  emergency: 'siren',
  error: 'circle-alert',
  faq: 'info',
  help: 'headphones',
  home: 'house',
  information: 'info',
  'local-rental': 'clock-3',
  'location-pin': 'map-pin',
  lock: 'lock-keyhole',
  logout: 'log-out',
  luggage: 'briefcase',
  notifications: 'bell',
  offers: 'ticket-percent',
  offline: 'wifi-off',
  'one-way': 'arrow-right',
  'otp-security': 'shield-check',
  outstation: 'route',
  passengers: 'users',
  'payment-card': 'credit-card',
  pickup: 'circle-dot',
  profile: 'user-round',
  rating: 'star',
  refresh: 'refresh-cw',
  remove: 'minus',
  'round-trip': 'repeat-2',
  'saved-place': 'map-pin',
  share: 'share-2',
  sort: 'arrow-up-down',
  success: 'circle-check',
  support: 'headphones',
  swap: 'arrow-up-down',
  trash: 'trash-2',
  'trip-history': 'tickets',
  'trip-tracking': 'navigation',
  verified: 'badge-check',
  'vehicle-seats': 'users',
  warning: 'triangle-alert',
  fleet: 'car',
  favourite: 'star',
  favorite: 'star',
  'tour-package': 'map-pin',
  'arrow-up-right': 'arrow-up-right',
  'external-link': 'arrow-up-right',
};

const LINE_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
const TRAVEL_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';

function svgFor(name: string): string | null {
  if (name.startsWith('travel-')) {
    const glyph = TRAVEL_ICONS[name.slice(7)];
    return glyph ? `${TRAVEL_OPEN}${glyph}</svg>` : null;
  }
  const glyph = LINE_ICONS[ALIAS[name] ?? name];
  return glyph ? `${LINE_OPEN}${glyph}</svg>` : null;
}

export function Icon({ name, size = 20, className = '', style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  const svg = svgFor(name);
  if (!svg && import.meta.env.DEV) console.warn(`[icon] missing "${name}"`);
  return <span className={`icon ${className}`} style={{ '--icon': `${size}px`, ...style } as CSSProperties} dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />;
}
