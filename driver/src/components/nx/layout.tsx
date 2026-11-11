import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { nxBreakpoints } from '../../theme/nx';

export type FrameMode = 'phone' | 'rail' | 'sidebar';

/** Width at which pages switch from one column to two (as the reference's `two-columns` grid). */
export const WIDE_BREAKPOINT = nxBreakpoints.phone + 1;

/**
 * The responsive frame for the current window, using the reference's breakpoints:
 *  - phone (≤700): brand top bar + bottom navigation, single column
 *  - rail (701–900): icon-only navigation rail, single-column dashboards, two-column lists
 *  - sidebar (≥901): labelled sidebar, two-column pages (190px wide up to 1130, 226px above)
 */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const mode: FrameMode = width <= nxBreakpoints.phone ? 'phone' : width <= nxBreakpoints.rail ? 'rail' : 'sidebar';
  const sidebarWidth = mode === 'sidebar' ? (width <= nxBreakpoints.compactSidebar ? 190 : 226) : mode === 'rail' ? 80 : 0;
  const contentWidth = width - sidebarWidth;
  return {
    width,
    height,
    mode,
    phone: mode === 'phone',
    sidebarWidth,
    /** Two columns of cards fit beside each other. */
    wide: mode !== 'phone',
    /** Dashboards (next trip + duties) sit side by side. */
    dashboard: mode === 'sidebar',
    /** Very narrow phones (≤360) tighten spacing, as the reference does. */
    narrow: width <= 360,
    short: height < 430,
    /** Horizontal page gutter. */
    gutter: mode === 'phone' ? (width <= 360 ? 13 : 17) : contentWidth >= 1200 ? 48 : contentWidth >= 900 ? 38 : 24,
  };
}

/**
 * Lays its children out in one column on phones and two on wider screens, filling the left column first so reading order
 * stays top-to-bottom. Children keep their natural height; nothing is given a fixed width.
 */
export function NxColumns({ children, gap = 24, force }: { children: React.ReactNode; gap?: number; force?: boolean }) {
  const { wide } = useLayout();
  const items = React.Children.toArray(children).filter(Boolean);
  if (!(force ?? wide) || items.length < 2) return <>{items}</>;
  const split = Math.ceil(items.length / 2);
  return (
    <View style={[styles.row, { gap }]}>
      <View style={styles.col}>{items.slice(0, split)}</View>
      <View style={styles.col}>{items.slice(split)}</View>
    </View>
  );
}

/** A grid of equal cards: `columns` across on wide screens, one per row on phones (or `phoneColumns`). */
export function NxGrid({ children, columns = 2, phoneColumns = 1, gap = 16 }: { children: React.ReactNode; columns?: number; phoneColumns?: number; gap?: number }) {
  const { phone } = useLayout();
  const n = phone ? phoneColumns : columns;
  const items = React.Children.toArray(children).filter(Boolean);
  if (n <= 1) return <View style={{ gap }}>{items}</View>;
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < items.length; i += n) rows.push(items.slice(i, i + n));
  return (
    <View style={{ gap }}>
      {rows.map((row, r) => (
        <View key={r} style={[styles.row, { gap, alignItems: 'stretch' }]}>
          {row.map((item, c) => (
            <View key={c} style={styles.col}>
              {item}
            </View>
          ))}
          {row.length < n ? Array.from({ length: n - row.length }, (_, k) => <View key={`pad${k}`} style={styles.col} />) : null}
        </View>
      ))}
    </View>
  );
}

/** Two panes side by side on wide screens, stacked on phones. */
export function NxTwoPane({ left, right, leftFlex = 1.05, rightFlex = 1, gap = 24, when }: { left: React.ReactNode; right: React.ReactNode; leftFlex?: number; rightFlex?: number; gap?: number; when?: boolean }) {
  const { dashboard } = useLayout();
  if (!(when ?? dashboard)) {
    return (
      <View style={{ gap }}>
        <View>{left}</View>
        <View>{right}</View>
      </View>
    );
  }
  return (
    <View style={[styles.row, { gap }]}>
      <View style={{ flex: leftFlex, minWidth: 0 }}>{left}</View>
      <View style={{ flex: rightFlex, minWidth: 0 }}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  col: { flex: 1, minWidth: 0 },
});
