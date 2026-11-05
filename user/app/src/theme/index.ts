// NESAM customer design tokens, taken from the final effective styles of the
// customer reference (Nesam_Customer_App_Outstation_UX.html): Inter text,
// Manrope/“Nesam UI” section headings, brand red #C62828, slate text, pale borders.
export const colors = {
  primary: '#C62828',
  primaryDark: '#A71F1F',
  /** Pressed / active nav red. */
  primaryActive: '#BC2428',
  primarySoft: '#FFF5F2',
  primaryBorder: '#F0CFCB',
  /** Eyebrow labels and inline links. */
  eyebrow: '#A1272B',
  link: '#B92329',
  ink: '#222B36',
  text: '#20252D',
  /** Field values and card titles. */
  value: '#28313E',
  muted: '#697587',
  label: '#7E8691',
  faint: '#99A1AD',
  border: '#E2E6EC',
  divider: '#ECEFF3',
  bg: '#FFFFFF',
  surface: '#F6F8FB',
  subtle: '#F5F6F8',
  card: '#FFFFFF',
  success: '#2A7555',
  successSoft: '#EEF7F2',
  successBorder: '#D7EBDD',
  successStrong: '#278050',
  warning: '#A8650E',
  warningSoft: '#FFF6E7',
  warningBorder: '#F3DFB8',
  danger: '#C62828',
  info: '#0969B9',
  infoSoft: '#EAF5FF',
  white: '#FFFFFF',
  page: '#FFFFFF',
  slate: '#697587',
  /** Footer / dark surfaces. */
  navy: '#19212C',
  overlay: 'rgba(25,33,44,0.52)',
} as const;

export const radius = { xs: 5, sm: 6, md: 7, lg: 10, xl: 13, pill: 999, full: 9999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 32 } as const;

export const shadows = {
  sm: {
    shadowColor: '#28364B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 5,
    elevation: 0,
  },
  md: {
    shadowColor: '#28364B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 2,
  },
  lg: {
    shadowColor: '#19212C',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 8,
  },
} as const;

/** Inter for all UI text; Manrope ExtraBold for section headings and the header wordmark. */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extraBold: 'Inter_800ExtraBold',
  black: 'Inter_800ExtraBold',
  heading: 'Manrope_800ExtraBold',
  /** The reference's embedded wordmark face (footer “NESAM”). */
  brand: 'NesamBrand',
} as const;

export const type = {
  display: { fontFamily: fonts.semiBold, fontSize: 23, color: colors.ink, letterSpacing: -0.6, lineHeight: 30 },
  h1: { fontFamily: fonts.semiBold, fontSize: 23, color: colors.ink, letterSpacing: -0.6, lineHeight: 30 },
  h2: { fontFamily: fonts.heading, fontSize: 21, color: colors.ink, letterSpacing: -0.6, lineHeight: 29 },
  h3: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.ink, letterSpacing: -0.3, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 14, color: colors.text, lineHeight: 21 },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 14, color: colors.text, lineHeight: 21 },
  small: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, lineHeight: 19 },
  tiny: { fontFamily: fonts.medium, fontSize: 11, color: colors.muted, lineHeight: 16 },
  label: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted, lineHeight: 16 },
  eyebrow: { fontFamily: fonts.semiBold, fontSize: 10, color: colors.eyebrow, letterSpacing: 1.4, lineHeight: 15, textTransform: 'uppercase' as const },
} as const;
