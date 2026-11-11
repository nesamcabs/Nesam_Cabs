// NESAM Partner design tokens (docs/NESAM_Vendor.html, "calm, readable vendor UI" layer: --v-* tokens).
import { Platform } from 'react-native';

export const colors = {
  primary: '#C62828',
  primaryDark: '#AD2020',
  primarySoft: '#FFF0EF',
  primaryBorder: '#E9BDB6',
  ink: '#263548',
  text: '#3F536C',
  muted: '#667589',
  faint: '#94A1B0',
  border: '#DFE6EE',
  divider: '#E9EEF4',
  bg: '#F6F8FB',
  card: '#FFFFFF',
  subtle: '#F6F8FC',
  success: '#2F7A59',
  successSoft: '#F0F8F2',
  successBorder: '#D6EADD',
  warning: '#9A6A2D',
  warningSoft: '#FFF8E9',
  warningBorder: '#F0E5CB',
  danger: '#C62828',
  info: '#315D98',
  infoSoft: '#EFF5FF',
  infoBorder: '#B7CBED',
  white: '#FFFFFF',
  overlay: 'rgba(40,55,71,0.42)',
} as const;

export const radius = { sm: 9, md: 11, lg: 14, xl: 18, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Web uses Inter (loaded in webSetup.web.ts); Android / iOS use the system face. */
export const fontFamily = Platform.select({ web: 'Inter, "Segoe UI", system-ui, -apple-system, Roboto, sans-serif', default: undefined });
export const brandFont = Platform.select({ web: 'Manrope, Inter, "Segoe UI", sans-serif', default: undefined });

export const type = {
  h1: { fontSize: 26, fontWeight: '700' as const, color: colors.ink, letterSpacing: -0.6, fontFamily },
  h2: { fontSize: 17, fontWeight: '600' as const, color: colors.ink, fontFamily },
  h3: { fontSize: 14, fontWeight: '600' as const, color: colors.ink, fontFamily },
  body: { fontSize: 14, color: colors.text, fontFamily },
  small: { fontSize: 12, color: colors.muted, lineHeight: 18, fontFamily },
  tiny: { fontSize: 11, color: colors.faint, fontFamily },
  label: { fontSize: 12, fontWeight: '600' as const, color: colors.muted, fontFamily },
} as const;

/** Layout breakpoints from the reference: phones ≤ 800 px use the bottom bar, wider screens the sidebar. */
export const breakpoints = { phone: 380, wide: 801, desktop: 1200, xl: 1700 } as const;
