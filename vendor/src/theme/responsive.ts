// One source of truth for the responsive shell: sidebar / icon rail vs bottom bar, page padding and card columns.
// The breakpoints are the NESAM Driver app's: ≤ 700 phone, 701–900 icon rail, 901–1130 narrow sidebar, 1131+ full sidebar.
import { useSyncExternalStore } from 'react';
import { Dimensions } from 'react-native';
import { breakpoints } from './index';

export interface Layout {
  width: number;
  /** ≥ 701 px: sidebar (or icon rail) instead of the bottom bar. */
  wide: boolean;
  /** 701–900 px: the sidebar collapses to an icon rail. */
  rail: boolean;
  /** ≥ 1200 px: full desktop sidebar and two-column detail pages. */
  desktop: boolean;
  /** ≤ 380 px: smallest phones. */
  compact: boolean;
  sidebarWidth: number;
  /** Horizontal page padding. */
  gutter: number;
  /** Usable width of the main column. */
  contentWidth: number;
  /** Columns for card grids. */
  columns: 1 | 2;
  /** Detail pages put the summary panel beside the main stack. */
  sideBySide: boolean;
}

const subscribeToSize = (notify: () => void) => {
  const sub = Dimensions.addEventListener('change', notify);
  return () => sub.remove();
};
const currentWidth = () => Math.round(Dimensions.get('window').width);

/**
 * The window width, re-rendering only when the width changes. (useWindowDimensions also reports the height, which changes every
 * time the keyboard opens or closes and would re-render every screen at that moment.)
 */
export function useWindowWidth(): number {
  return useSyncExternalStore(subscribeToSize, currentWidth, currentWidth);
}

export function useLayout(): Layout {
  const width = useWindowWidth();
  const wide = width >= breakpoints.wide;
  const rail = wide && width <= breakpoints.rail;
  const desktop = width >= breakpoints.desktop;
  const compact = width <= breakpoints.phone;
  const sidebarWidth = !wide ? 0 : rail ? 80 : width <= breakpoints.compactSidebar ? 190 : 226;
  const main = width - sidebarWidth;
  const gutter = !wide ? (compact ? 14 : 17) : main >= 1200 ? 44 : main >= 900 ? 36 : 24;
  const contentWidth = Math.min(1360, main) - gutter * 2;
  const columns: 1 | 2 = contentWidth >= 640 && !rail ? 2 : 1;
  return { width, wide, rail, desktop, compact, sidebarWidth, gutter, contentWidth, columns, sideBySide: contentWidth >= 900 };
}
