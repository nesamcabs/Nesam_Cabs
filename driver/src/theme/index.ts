// Shared tokens for the sign-in, registration and legal screens. They are the reference palette (theme/nx.ts) under the
// names those screens already use, so the whole app — onboarding included — reads as one product.
import { nx } from './nx';

export const colors = {
  primary: nx.red,
  primaryDark: nx.redDark,
  primarySoft: nx.redSoft,
  primaryBorder: '#F7CDD3',
  ink: nx.ink,
  text: nx.text,
  muted: nx.muted,
  faint: nx.faint,
  border: nx.line,
  divider: nx.lineSoft,
  bg: nx.page,
  card: nx.white,
  success: nx.green,
  successSoft: nx.greenSoft,
  successBorder: nx.greenLine,
  warning: nx.amber,
  warningSoft: nx.amberSoft,
  warningBorder: '#F3DFAE',
  danger: nx.red,
  info: '#2F5BD3',
  infoSoft: '#EEF3FF',
  white: nx.white,
  overlay: nx.backdrop,
} as const;

export const radius = { sm: 8, md: 10, lg: 16, xl: 18, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const type = {
  h1: { fontSize: 23, fontWeight: '700' as const, letterSpacing: -0.6, color: colors.ink },
  h2: { fontSize: 18, fontWeight: '700' as const, letterSpacing: -0.4, color: colors.ink },
  h3: { fontSize: 15, fontWeight: '700' as const, letterSpacing: -0.2, color: colors.ink },
  body: { fontSize: 13, lineHeight: 20, color: colors.text },
  small: { fontSize: 12, lineHeight: 18, color: colors.muted },
  tiny: { fontSize: 11, lineHeight: 16, color: colors.faint },
  label: { fontSize: 12, fontWeight: '600' as const, color: colors.ink },
} as const;
