import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

// Flat NESAM DRIVER artwork on a transparent background (assets/brand). "DRIVER" is dark, so these are only placed on light surfaces (white cards, the light top bar and sidebar).
const LOGO = require('../../../assets/brand/nesam-driver-logo.webp');
const LOCKUP = require('../../../assets/brand/nesam-driver-lockup.webp');
const EMBLEM = require('../../../assets/brand/nesam-driver-emblem.webp');
const LOGO_RATIO = 1600 / 242;
const LOCKUP_RATIO = 1200 / 187;

/** The round NESAM emblem (tablet rail, loaders, small badges). */
export function NxEmblem({ size = 44 }: { size?: number }) {
  return <Image source={EMBLEM} accessible={false} resizeMode="contain" style={[styles.shrink, { width: size, height: size }]} />;
}

const HEIGHTS = { small: 26, regular: 30, large: 36, hero: 48 } as const;

/**
 * The one-line NESAM DRIVER logo for headers and sidebars. It scales down when space is tight. `iconOnly` shows just
 * the emblem (tablet rail); `size` sets the logo height, `height` overrides it.
 */
export function NxBrand({ size = 'regular', iconOnly = false, height }: { size?: keyof typeof HEIGHTS; iconOnly?: boolean; height?: number }) {
  const h = height ?? HEIGHTS[size];
  if (iconOnly) {
    return (
      <View accessible accessibilityRole="image" accessibilityLabel="NESAM Driver">
        <NxEmblem size={Math.round(h * 1.05)} />
      </View>
    );
  }
  const width = Math.round(h * LOCKUP_RATIO);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="NESAM Driver" style={[styles.fluid, { width }]}>
      <Image source={LOCKUP} accessible={false} resizeMode="contain" style={[styles.fill, { width, maxWidth: '100%' }]} />
    </View>
  );
}

/** The large one-line logo with ™, for the front page and loaders. Fills its container up to `maxWidth`. */
export function NxLogo({ maxWidth = 420 }: { maxWidth?: number }) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="NESAM Driver" style={[styles.logo, { maxWidth }]}>
      <Image source={LOGO} accessible={false} resizeMode="contain" style={[styles.fill, { width: '100%' }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 0 },
  fluid: { maxWidth: '100%', flexShrink: 1, minWidth: 0, aspectRatio: LOCKUP_RATIO },
  // The boxes carry the aspect ratio and the image fills them: on web an in-flow Image would stretch its box to the file's pixel height.
  logo: { width: '100%', alignSelf: 'center', aspectRatio: LOGO_RATIO },
  fill: { position: 'absolute', top: 0, left: 0, height: '100%' },
});
