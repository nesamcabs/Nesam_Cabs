// The large one-line NESAM PARTNER logo with ™ (assets/brand/partner-logo.webp), for the sign-in screens and loaders.
import React from 'react';
import { Image, View } from 'react-native';

/** Width ÷ height of the artwork. */
const LOGO_RATIO = 1600 / 220;

/** Fills the width it is given, up to maxWidth, keeping the artwork's proportions. */
export function PartnerLockup({ maxWidth = 420 }: { maxWidth?: number }) {
  return (
    // The box carries the aspect ratio and the image fills it: on web an in-flow Image would stretch it to the file's height.
    <View style={{ width: '100%', maxWidth, aspectRatio: LOGO_RATIO }}>
      <Image
        source={require('../../../assets/brand/partner-logo.webp')}
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="NESAM Partner"
      />
    </View>
  );
}
