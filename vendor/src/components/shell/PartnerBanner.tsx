// The one-line NESAM PARTNER logo for the app header and sidebar (assets/brand/partner-header.webp).
import React from 'react';
import { Image, View } from 'react-native';

/** Width ÷ height of the artwork. */
export const BANNER_RATIO = 1200 / 169;

/** `height` high, scaling down when space is tight. */
export function PartnerBanner({ height = 29 }: { height?: number }) {
  const width = Math.round(height * BANNER_RATIO);
  return (
    <View style={{ width, maxWidth: '100%', aspectRatio: BANNER_RATIO, flexShrink: 1 }}>
      <Image
        source={require('../../../assets/brand/partner-header.webp')}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="NESAM Partner"
      />
    </View>
  );
}
