// One source of truth for the responsive shell: sidebar vs bottom bar, page padding and card columns.
import { useWindowDimensions } from 'react-native';
import { breakpoints } from './index';

export interface Layout {
  width: number;
  height: number;
  /** ≥ 801 px: header + sidebar, no bottom bar. */
  wide: boolean;
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

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const wide = width >= breakpoints.wide;
  const desktop = width >= breakpoints.desktop;
  const compact = width <= breakpoints.phone;
  const sidebarWidth = !wide ? 0 : desktop ? 206 : 178;
  const gutter = desktop ? 34 : wide ? 24 : compact ? 14 : 16;
  const contentWidth = Math.min(1360, width - sidebarWidth) - gutter * 2;
  const columns: 1 | 2 = contentWidth >= 640 && !(wide && width < 951) ? 2 : 1;
  return { width, height, wide, desktop, compact, sidebarWidth, gutter, contentWidth, columns, sideBySide: contentWidth >= 900 };
}
