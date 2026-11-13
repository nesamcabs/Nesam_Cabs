// Makes its children pulse (fade out and back in) while `active`, to draw the eye to something that still needs action.
// It stays still for people who have turned off animations in their device settings.
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, type StyleProp, type ViewStyle } from 'react-native';

export function Blink({ active = true, children, style, duration = 650 }: { active?: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle>; /** Milliseconds for each fade out and each fade in. */ duration?: number }) {
  const [opacity] = useState(() => new Animated.Value(1));
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduceMotion(v); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!active || reduceMotion) { opacity.setValue(1); return undefined; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(opacity, { toValue: 1, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => { loop.stop(); opacity.setValue(1); };
  }, [active, reduceMotion, opacity, duration]);

  return <Animated.View style={[{ opacity }, style]}>{children}</Animated.View>;
}
