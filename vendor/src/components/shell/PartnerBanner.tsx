// The NESAM PARTNER banner (docs/images/vendor.png, background removed and optimised into assets/brand/partner-banner.png).
import React from 'react';
import { Image } from 'react-native';

/** Width ÷ height of the cropped banner artwork. */
export const BANNER_RATIO = 2.974;

export function PartnerBanner({ height = 48 }: { height?: number }) {
  return (
    <Image
      source={require('../../../assets/brand/partner-banner.png')}
      style={{ height, width: Math.round(height * BANNER_RATIO) }}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="NESAM Partner"
    />
  );
}
