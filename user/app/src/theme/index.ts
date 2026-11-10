// NESAM design tokens: the same "executive" identity as the customer website (user/web/src/styles/tokens.css) —
// charcoal and warm ivory surfaces, bright logo red for action, thin gold rules, Poppins type and sharp, precise corners.
export const colors = {
  primary: '#E31E24',
  primaryDark: '#C8171D',
  /** Pressed / active red. */
  primaryActive: '#D71920',
  primarySoft: '#FFF1F1',
  primaryBorder: '#FFC5C7',
  /** Eyebrow labels and inline links (stronger red for text on light surfaces). */
  eyebrow: '#CF171E',
  link: '#CF171E',
  ink: '#14171C',
  text: '#22262D',
  /** Field values and card titles. */
  value: '#22262D',
  muted: '#66615A',
  label: '#7A756C',
  faint: '#9A958C',
  border: '#E8E3DC',
  borderStrong: '#D9D2C8',
  /** Outline of form fields. */
  field: '#B9B1A5',
  divider: '#EFEAE3',
  /** Page background (warm ivory); cards and fields sit on white. */
  bg: '#F7F5F2',
  surface: '#F3F0EC',
  subtle: '#F3F0EC',
  card: '#FFFFFF',
  gold: '#B08D57',
  goldSoft: '#F4ECDC',
  goldLine: '#E3D3B4',
  success: '#2A7555',
  successSoft: '#EEF7F2',
  successBorder: '#CFE6DA',
  successStrong: '#2A7555',
  warning: '#A8650E',
  warningSoft: '#FFF6E7',
  warningBorder: '#F2DCB4',
  danger: '#B42318',
  dangerSoft: '#FEF1F0',
  dangerBorder: '#F2CBC7',
  info: '#2563C9',
  infoSoft: '#EDF3FF',
  white: '#FFFFFF',
  page: '#F7F5F2',
  slate: '#66615A',
  /** Footer / dark surfaces. */
  navy: '#14171C',
  overlay: 'rgba(20,23,28,0.52)',
} as const;

export const radius = { xs: 3, sm: 4, md: 5, lg: 6, xl: 8, pill: 999, full: 9999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 32 } as const;

export const shadows = {
  sm: {
    shadowColor: '#14171C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 0,
  },
  md: {
    shadowColor: '#14171C',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 2,
  },
  lg: {
    shadowColor: '#14171C',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 8,
  },
} as const;

/** Poppins throughout, as on the website. */
export const fonts = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semiBold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
  extraBold: 'Poppins_800ExtraBold',
  black: 'Poppins_800ExtraBold',
  heading: 'Poppins_600SemiBold',
  /** The wordmark face (ticket header). */
  brand: 'Poppins_800ExtraBold',
} as const;

export const type = {
  display: { fontFamily: fonts.semiBold, fontSize: 23, color: colors.ink, letterSpacing: -0.3, lineHeight: 30 },
  h1: { fontFamily: fonts.semiBold, fontSize: 22, color: colors.ink, letterSpacing: -0.2, lineHeight: 29 },
  h2: { fontFamily: fonts.semiBold, fontSize: 19, color: colors.ink, letterSpacing: -0.2, lineHeight: 26 },
  h3: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.ink, letterSpacing: 0, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 14, color: colors.text, lineHeight: 22 },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 14, color: colors.text, lineHeight: 22 },
  small: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, lineHeight: 19 },
  tiny: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted, lineHeight: 16 },
  label: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted, lineHeight: 16 },
  eyebrow: { fontFamily: fonts.semiBold, fontSize: 10, color: colors.eyebrow, letterSpacing: 1.2, lineHeight: 15, textTransform: 'uppercase' as const },
} as const;
