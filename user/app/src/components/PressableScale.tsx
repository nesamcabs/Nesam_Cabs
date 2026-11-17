import React, { useState } from 'react';
import { Animated, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { NATIVE_DRIVER } from '../utils/nativeDriver';

/** A responsive pressable that scales down slightly with a spring on touch, giving tactile click feedback. */
export function PressableScale({
  onPress,
  onPressIn,
  onPressOut,
  style,
  children,
  activeScale = 0.93,
  containerStyle,
  disabled,
  ...props
}: PressableProps & {
  activeScale?: number;
  /** Layout of the outer Animated.View (the element a flex row actually sees), e.g. to share a row's width. */
  containerStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
}) {
  const [scale] = useState(() => new Animated.Value(1));

  const handlePressIn = (e: any) => {
    if (disabled) return;
    Animated.spring(scale, {
      toValue: activeScale,
      speed: 55,
      bounciness: 0,
      useNativeDriver: NATIVE_DRIVER,
    }).start();
    onPressIn?.(e);
  };

  const handlePressOut = (e: any) => {
    Animated.spring(scale, {
      toValue: 1,
      speed: 30,
      bounciness: 12,
      useNativeDriver: NATIVE_DRIVER,
    }).start();
    onPressOut?.(e);
  };

  return (
    <Animated.View style={[containerStyle, { transform: [{ scale }] }]}>
      <Pressable
        {...props}
        disabled={disabled}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={style}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
