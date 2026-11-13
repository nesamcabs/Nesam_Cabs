// NESAM Partner design tokens. The Partner panel shares the NESAM Driver palette, type scale and radii, so the two apps
// feel like one product: white cards with a hairline border on a light grey page, NESAM red for actions, near-black ink.
import { Platform } from 'react-native';

export const colors = {
  primary: '#D82035',
  primaryDark: '#B81C2A',
  primarySoft: '#FFF0F2',
  primaryBorder: '#F7CDD3',
  ink: '#171B24',
  text: '#424B5A',
  muted: '#6F7785',
  faint: '#8B919C',
  border: '#E7EAF0',
  divider: '#F1F2F5',
  bg: '#F6F7F9',
  card: '#FFFFFF',
  subtle: '#F6F7F9',
  success: '#167A50',
  successSoft: '#E9F7EF',
  successBorder: '#DDEFE4',
  warning: '#946000',
  warningSoft: '#FFF5DE',
  warningBorder: '#F3DFAE',
  danger: '#D82035',
  info: '#2F5BD3',
  infoSoft: '#EEF3FF',
  infoBorder: '#C5D3F6',
  white: '#FFFFFF',
  overlay: 'rgba(25,27,40,0.37)',
  /** Field outline, as in the driver's inputs. */
  field: '#D8DFE9',
} as const;

export const radius = { sm: 8, md: 10, lg: 16, xl: 18, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/**
 * Left undefined on purpose: components/kit/Text renders every Text and TextInput in Poppins (loaded in App.tsx), picking the
 * weight from the style's fontWeight. A fontFamily set in a style would opt that text out of Poppins.
 */
export const fontFamily: string | undefined = Platform.select({ web: undefined, default: undefined });
export const brandFont: string | undefined = undefined;

export const type = {
  h1: { fontSize: 26, fontWeight: '700' as const, color: colors.ink, letterSpacing: -0.8, fontFamily },
  h2: { fontSize: 17, fontWeight: '700' as const, color: colors.ink, letterSpacing: -0.4, fontFamily },
  h3: { fontSize: 14, fontWeight: '600' as const, color: colors.ink, fontFamily },
  body: { fontSize: 13.5, color: colors.text, fontFamily },
  small: { fontSize: 12, color: colors.muted, lineHeight: 18, fontFamily },
  tiny: { fontSize: 11, color: colors.faint, fontFamily },
  label: { fontSize: 12, fontWeight: '600' as const, color: colors.ink, fontFamily },
} as const;

/** Layout breakpoints, the same ones as the driver app: ≤ 700 phone (bottom bar), 701–900 icon rail, 901+ sidebar. */
export const breakpoints = { phone: 380, wide: 701, rail: 900, compactSidebar: 1130, desktop: 1200, xl: 1700 } as const;
