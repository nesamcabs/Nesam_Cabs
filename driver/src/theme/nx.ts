// Design tokens for the NESAM Driver interface, taken from the supplied reference (docs/Nesam_Driver.html, "complete-ux-v6").
// Every screen — sign-in, registration and the driver workspace — draws from these values, so the Android app and the
// website look identical.
export const nx = {
  red: '#D82035',
  tripRed: '#D92535',
  redDark: '#B81C2A',
  redSoft: '#FFF0F2',
  redFill: '#FFE0E4',
  redBar: '#F6D9DC',
  ink: '#171B24',
  tripInk: '#1C1D24',
  text: '#424B5A',
  muted: '#6F7785',
  tripMuted: '#747C89',
  faint: '#8B919C',
  subtle: '#989DA6',
  caption: '#9599A2',
  line: '#E7EAF0',
  lineSoft: '#F1F2F5',
  fieldLine: '#D8DFE9',
  page: '#F6F7F9',
  white: '#FFFFFF',
  green: '#167A50',
  greenSoft: '#E9F7EF',
  greenLine: '#DDEFE4',
  statusGreen: '#147648',
  statusBg: '#EEF8F2',
  statusBorder: '#D8EEE2',
  amber: '#946000',
  amberSoft: '#FFF5DE',
  orangeSoft: '#FFF5E8',
  orangeInk: '#795115',
  wordmark: '#E43D32',
  label: '#454B54',
  wallet: '#202128',
  walletMuted: '#BBBEC8',
  focus: '#446EE6',
  backdrop: 'rgba(25,27,40,0.37)',
} as const;

export const nxRadius = { panel: 16, card: 15, metric: 14, button: 10, bigButton: 11, badge: 6, field: 12, pill: 24, dialog: 18, nav: 11 } as const;

/** The reference's panel shadow (0 3px 14px rgba(22,32,51,.02)) is barely visible; a hairline border carries the card. */
export const nxShadow = { shadowColor: '#162033', shadowOpacity: 0.03, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 0 } as const;

/**
 * Layout breakpoints, the same ones the reference's CSS uses:
 *   ≤ 700  phone   — brand top bar + bottom navigation
 *   701–900 tablet — 80px icon rail
 *   901–1130        — 190px sidebar
 *   ≥ 1131 desktop — 226px sidebar
 */
export const nxBreakpoints = { phone: 700, rail: 900, compactSidebar: 1130, roomy: 1450 } as const;

/** Wordmark face loaded from assets/brand/nesam-wordmark.ttf (the reference embeds the same font). */
export const WORDMARK_FONT = 'NesamWordmark';
