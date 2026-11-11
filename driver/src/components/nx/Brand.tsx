import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

// Artwork from docs/images/driver.png, cut out onto a transparent background (assets/brand). The banner's
// "DRIVER" line is black, so it is only placed on light surfaces (white cards, the light top bar and sidebar).
const BANNER = require('../../../assets/brand/nesam-driver-banner.webp');
const EMBLEM = require('../../../assets/brand/nesam-driver-emblem.webp');
const BANNER_RATIO = 1200 / 386;

/** The round NESAM emblem (tablet rail, loaders, small badges). */
export function NxEmblem({ size = 44 }: { size?: number }) {
  return <Image source={EMBLEM} accessible={false} resizeMode="contain" style={[styles.shrink, { width: size, height: size }]} />;
}

const HEIGHTS = { small: 34, regular: 44, large: 62, hero: 84 } as const;

/**
 * The NESAM DRIVER banner (emblem + wordmark + "DRIVER"). `iconOnly` shows just the emblem (tablet rail);
 * `size` sets the banner height, `height` overrides it.
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
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="NESAM Driver" style={styles.shrink}>
      <Image source={BANNER} accessible={false} resizeMode="contain" style={{ height: h, width: Math.round(h * BANNER_RATIO), maxWidth: '100%' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 0 },
});
