// NESAM brand tokens (match the Web panels: red #E31E24, near-black #111111).
export const colors = {
  primary: '#E31E24',
  primaryDark: '#C41820',
  primarySoft: '#FEF2F2',
  primaryBorder: '#FBD5D5',
  ink: '#111111',
  text: '#1F2937',
  muted: '#6B7280',
  faint: '#9CA3AF',
  border: '#E5E7EB',
  divider: '#F0F0F0',
  bg: '#F7F7F7',
  card: '#FFFFFF',
  success: '#15803D',
  successSoft: '#ECFDF5',
  successBorder: '#A7F3D0',
  warning: '#B45309',
  warningSoft: '#FFFBEB',
  warningBorder: '#FDE68A',
  danger: '#D92D20',
  info: '#1D4ED8',
  infoSoft: '#EFF6FF',
  white: '#FFFFFF',
  overlay: 'rgba(17,17,17,0.55)',
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const type = {
  h1: { fontSize: 22, fontWeight: '800' as const, color: colors.ink },
  h2: { fontSize: 18, fontWeight: '800' as const, color: colors.ink },
  h3: { fontSize: 15, fontWeight: '700' as const, color: colors.ink },
  body: { fontSize: 14, color: colors.text },
  small: { fontSize: 12, color: colors.muted },
  tiny: { fontSize: 11, color: colors.faint },
  label: { fontSize: 12, fontWeight: '700' as const, color: colors.text },
} as const;
