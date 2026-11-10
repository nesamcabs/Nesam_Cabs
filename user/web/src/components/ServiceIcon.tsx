import airportIcon from '@/assets/nav/airport-taxi.webp';
import multicityIcon from '@/assets/nav/multicity.webp';
import outstationIcon from '@/assets/nav/outstation.webp';
import localIcon from '@/assets/nav/local-rentals.webp';

const SRC: Record<string, string> = { airport: airportIcon, multicity: multicityIcon, outstation: outstationIcon, rental: localIcon, pickup: localIcon };

/** A service's picture: the same icons as the bottom bar, on desktop and phone alike. */
export function ServiceIcon({ id, size = 30 }: { id: string; size?: number }) {
  const src = SRC[id];
  if (!src) return null;
  return <img src={src} alt="" width={size} height={size} draggable={false} style={{ display: 'block', objectFit: 'contain' }} />;
}
