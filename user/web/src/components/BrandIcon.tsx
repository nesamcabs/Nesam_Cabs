// The brand's own artwork for header, menu and account icons. The files live in public/icons/ui (one set per site, in the
// site's colour); the bottom bar's service art is in public/icons/nav.
export type BrandIconName =
  | 'about' | 'bell' | 'contact' | 'emergency' | 'menu' | 'support' | 'logout' | 'offers' | 'payments' | 'profile' | 'terms' | 'trips';

export const brandIconSrc = (name: BrandIconName) => `/icons/ui/${name}.webp`;
export const navIconSrc = (name: 'local' | 'rental' | 'outstation' | 'multicity' | 'airport') => `/icons/nav/${name}.webp`;

export function BrandIcon({ name, size = 24, className = '' }: { name: BrandIconName; size?: number; className?: string }) {
  return <img className={`bicon ${className}`.trim()} src={brandIconSrc(name)} width={size} height={size} alt="" aria-hidden="true" draggable={false} decoding="async" />;
}
