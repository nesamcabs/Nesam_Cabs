// The NESAM strip: red running into blue, the line that tops a duty card and closes the app header. Drawn as small even
// steps, so it looks the same on Android and the web without a gradient library.
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

const mix = (a: string, b: string, t: number) =>
  '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
const STEPS = Array.from({ length: 24 }, (_, i) => mix('#D82035', '#2F5BD3', i / 23));

export function NxStrip({ height = 3, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.row, { height }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {STEPS.map((c) => <View key={c} style={[styles.step, { backgroundColor: c }]} />)}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row' }, step: { flex: 1 } });
