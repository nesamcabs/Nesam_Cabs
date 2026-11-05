import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

/** Width at which pages switch from one column to two (large tablets, landscape tablets, foldables). */
export const WIDE_BREAKPOINT = 900;

export function useLayout() {
  const { width, height } = useWindowDimensions();
  return { width, height, wide: width >= WIDE_BREAKPOINT, short: height < 430 };
}

/**
 * Lays its children out in one column on phones and two on wide screens, filling the left column first so reading order
 * stays top-to-bottom. Children keep their natural height; nothing is given a fixed width.
 */
export function NxColumns({ children }: { children: React.ReactNode }) {
  const { wide } = useLayout();
  const items = React.Children.toArray(children).filter(Boolean);
  if (!wide || items.length < 2) return <>{items}</>;
  const split = Math.ceil(items.length / 2);
  return (
    <View style={styles.row}>
      <View style={styles.col}>{items.slice(0, split)}</View>
      <View style={styles.col}>{items.slice(split)}</View>
    </View>
  );
}

/** Two panes side by side on wide screens (left narrower), stacked on phones. */
export function NxTwoPane({ left, right, leftFlex = 0.85, rightFlex = 1.15 }: { left: React.ReactNode; right: React.ReactNode; leftFlex?: number; rightFlex?: number }) {
  const { wide } = useLayout();
  if (!wide) {
    return (
      <>
        {left}
        <View style={{ height: 8 }} />
        {right}
      </>
    );
  }
  return (
    <View style={styles.row}>
      <View style={{ flex: leftFlex, minWidth: 0 }}>{left}</View>
      <View style={{ flex: rightFlex, minWidth: 0 }}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 24 },
  col: { flex: 1, minWidth: 0 },
});
