// Partner palette from the client reference (NESAM_Complete_Vendor.html, --v-* tokens).
export const colors = {
  primary: '#C62828',
  primaryDark: '#A61F1F',
  primarySoft: '#FFF1F3',
  primaryBorder: '#F3C6CB',
  ink: '#252C36',
  text: '#3A4350',
  muted: '#7A8593',
  faint: '#9AA3AF',
  border: '#E5E9EF',
  divider: '#EEF1F5',
  bg: '#F7F8FA',
  card: '#FFFFFF',
  success: '#08795C',
  successSoft: '#E8F6F1',
  successBorder: '#BFE5D7',
  warning: '#B26A00',
  warningSoft: '#FFF6E5',
  warningBorder: '#F2DCAE',
  danger: '#C62828',
  info: '#2B5CAD',
  infoSoft: '#EEF3FB',
  white: '#FFFFFF',
  overlay: 'rgba(16,19,28,0.5)',
} as const;

export const radius = { sm: 10, md: 12, lg: 16, xl: 22, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const type = {
  h1: { fontSize: 24, fontWeight: '700' as const, color: colors.ink, letterSpacing: -0.4 },
  h2: { fontSize: 18, fontWeight: '700' as const, color: colors.ink },
  h3: { fontSize: 15, fontWeight: '600' as const, color: colors.ink },
  body: { fontSize: 14, color: colors.text },
  small: { fontSize: 12, color: colors.muted },
  tiny: { fontSize: 11, color: colors.faint },
  label: { fontSize: 12, fontWeight: '700' as const, color: colors.text },
} as const;
