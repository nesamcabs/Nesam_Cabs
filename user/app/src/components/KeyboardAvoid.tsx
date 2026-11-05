// Keeps a screen's content clear of the Android navigation bar / gesture area and of the on-screen keyboard.
//
// Why not KeyboardAvoidingView on Android? The app draws edge-to-edge, so the OS no longer resizes the window for the keyboard
// (android:windowSoftInputMode=adjustResize is ignored), and KeyboardAvoidingView measures from the wrong origin when a header or
// tab bar sits above the screen. This component measures where it really is on screen and pads by exactly what overlaps.
// iOS keeps the platform KeyboardAvoidingView.
//
// Put it INSIDE the screen's SafeAreaView (top edge) and around the scrolling form:
//   <SafeAreaView edges={['top']}><KeyboardAvoid><ScrollView …/></KeyboardAvoid></SafeAreaView>
// Inside a tab screen it adds nothing at rest (the tab bar already clears the gesture area); on a stack screen it clears the
// navigation bar; with the keyboard open it lifts the content to sit directly above the keyboard.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, StyleProp, View, ViewStyle, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomClearance } from '../utils/keyboardAvoid';

/** Height of the keyboard above the navigation bar; 0 when it is closed. Android only (iOS reports 0). */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(Math.max(0, e.endCoordinates?.height ?? 0)));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

export function KeyboardAvoid({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  if (Platform.OS !== 'android') {
    return (
      <KeyboardAvoidingView style={[{ flex: 1 }, style]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {children}
      </KeyboardAvoidingView>
    );
  }
  return <AndroidAvoid style={style}>{children}</AndroidAvoid>;
}

function AndroidAvoid({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const ref = useRef<View>(null);
  const [viewBottom, setViewBottom] = useState<number | null>(null);

  const measure = useCallback(() => {
    ref.current?.measureInWindow((_x, y, _w, h) => {
      const bottom = y + h;
      if (Number.isFinite(bottom)) setViewBottom((prev) => (prev !== null && Math.abs(prev - bottom) < 0.5 ? prev : bottom));
    });
  }, []);

  // Re-measure when the keyboard opens/closes or the insets change; onLayout covers a tab bar appearing or the window changing.
  useEffect(() => {
    measure();
  }, [measure, keyboardHeight, insets.bottom, windowHeight]);

  const padding = viewBottom === null ? 0 : bottomClearance({ viewBottom, windowHeight, insetBottom: insets.bottom, keyboardHeight });

  return (
    <View ref={ref} collapsable={false} onLayout={measure} style={[{ flex: 1 }, style]}>
      <View style={{ flex: 1, paddingBottom: padding }}>{children}</View>
    </View>
  );
}
