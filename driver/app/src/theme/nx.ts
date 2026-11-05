// Tokens for the NESAM Driver interface, taken from the final computed styles of the supplied reference
// (Nesam_Driver_App_UX_Updated.html, SHA-256 3757dab4…b0a1) at phone width. The older theme in ./index.ts is still
// used by the sign-in, registration and legal screens, which are outside this redesign.
export const nx = {
  red: '#D82035',
  tripRed: '#D92535',
  redDark: '#B81C2A',
  redSoft: '#FFF0F2',
  ink: '#171B24',
  tripInk: '#1C1D24',
  muted: '#6F7785',
  tripMuted: '#747C89',
  faint: '#8B919C',
  line: '#E7EAF0',
  fieldLine: '#D8DFE9',
  page: '#F6F7F9',
  white: '#FFFFFF',
  green: '#167A50',
  greenSoft: '#E9F7EF',
  statusGreen: '#147648',
  statusBg: '#EEF8F2',
  statusBorder: '#D8EEE2',
  amber: '#946000',
  amberSoft: '#FFF5DE',
  wordmark: '#E43D32',
  label: '#454B54',
  backdrop: 'rgba(25,27,40,0.37)',
} as const;

export const nxRadius = { panel: 16, button: 10, bigButton: 11, badge: 6, field: 12, pill: 24, dialog: 18 } as const;

/** The reference's panel shadow (0 3px 14px rgba(22,32,51,.02)) is barely visible; a hairline border carries the card. */
export const nxShadow = { shadowColor: '#162033', shadowOpacity: 0.03, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 0 } as const;

/** Wordmark face loaded from assets/brand/nesam-wordmark.ttf (the reference embeds the same font). */
export const WORDMARK_FONT = 'NesamWordmark';
