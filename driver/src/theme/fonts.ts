// Poppins, bundled with the app (assets/fonts, SIL Open Font License 1.1). No network font loading, so it works offline.
// Custom fonts on Android and iOS are chosen by family name, not by fontWeight, so each weight is its own family.
export const POPPINS_FILES = {
  Poppins_400Regular: require('../../assets/fonts/Poppins_400Regular.ttf'),
  Poppins_500Medium: require('../../assets/fonts/Poppins_500Medium.ttf'),
  Poppins_600SemiBold: require('../../assets/fonts/Poppins_600SemiBold.ttf'),
  Poppins_700Bold: require('../../assets/fonts/Poppins_700Bold.ttf'),
};

export const POPPINS = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
} as const;

// App.tsx sets this once the fonts have loaded. If they fail to load the app carries on with the system font
// (readable, just not branded) rather than showing a blank screen or crashing on an unknown family.
let ready = false;
export const setPoppinsReady = (value: boolean) => {
  ready = value;
};
export const poppinsReady = () => ready;

/** The Poppins family for a CSS-style weight: 100–400 regular, 500 medium, 600 semibold, 700 and up bold. */
export function poppinsFor(weight: string | number | undefined): string {
  const w = weight === 'bold' ? 700 : weight === 'normal' || weight === undefined ? 400 : Number(weight);
  if (!Number.isFinite(w) || w <= 400) return POPPINS.regular;
  if (w <= 500) return POPPINS.medium;
  if (w <= 600) return POPPINS.semibold;
  return POPPINS.bold;
}
