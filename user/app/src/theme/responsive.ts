// Responsive layout model shared by every screen (same file in all three apps).
//
// Window size classes follow the Material / Android "window size class" ranges so
// the same rules apply to phones, foldables, tablets and desktop browsers:
//   compact  < 600 dp   phones in portrait      → one column, bottom tabs
//   medium   600–1023   tablets, phones in landscape, small windows
//                                               → centred content, side rail, 2-up lists
//   expanded ≥ 1024     large tablets / desktop → wider content, side rail, 2–3-up lists
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

export type SizeClass = 'compact' | 'medium' | 'expanded';

export const BREAKPOINTS = { medium: 600, expanded: 1024, desktop: 1280, wide: 1536 } as const;

/** Side navigation width when the tab bar moves to the left: icon rail (medium) / labelled sidebar (expanded). */
export const NAV_WIDTH = { medium: 96, expanded: 260 } as const;

/** Widest the content of a single-column form or focused reader gets. */
export const NARROW_MAX = 780;
/** Two-column forms, modals, profile settings. */
export const MEDIUM_MAX = 1080;
/** Widest a dashboard, table, or card grid gets. */
export const WIDE_MAX = 1440;
/** Full-width fluid operational layout (dispatch tables, live maps). */
export const FLUID_MAX = 1680;

/** Target width of one card in a multi-column list. */
const CARD_MIN = 380;

export type ContentKind = 'narrow' | 'medium' | 'wide' | 'fluid' | 'full';

export interface Responsive {
  /** Window size in dp / CSS px. */
  width: number;
  height: number;
  sizeClass: SizeClass;
  isCompact: boolean;
  isMedium: boolean;
  isExpanded: boolean;
  isDesktop: boolean;
  isLandscape: boolean;
  /** A phone held sideways: plenty of width, very little height. */
  isShort: boolean;
  /** Width left for screen content after the side navigation (if shown). */
  available: number;
  /** Width of the side navigation (0 on compact, where tabs are at the bottom). */
  navWidth: number;
  /** Max width for a content kind (Infinity on compact: use the full width). */
  maxWidth: (kind?: ContentKind) => number;
  /** How many equal columns a list of cards should use. */
  columns: number;
  /** Side padding for page content. */
  gutter: number;
}

export function sizeClassFor(width: number): SizeClass {
  if (width >= BREAKPOINTS.expanded) return 'expanded';
  if (width >= BREAKPOINTS.medium) return 'medium';
  return 'compact';
}

export function columnsFor(available: number, maxColumns = 4): number {
  return Math.max(1, Math.min(maxColumns, Math.floor((available - 32) / CARD_MIN)));
}

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();
  return useMemo(() => {
    const sizeClass = sizeClassFor(width);
    const isCompact = sizeClass === 'compact';
    const isDesktop = width >= BREAKPOINTS.expanded;
    const navWidth = isCompact ? 0 : sizeClass === 'medium' ? NAV_WIDTH.medium : NAV_WIDTH.expanded;
    const available = width - navWidth;
    return {
      width,
      height,
      sizeClass,
      isCompact,
      isMedium: sizeClass === 'medium',
      isExpanded: sizeClass === 'expanded',
      isDesktop,
      isLandscape: width > height,
      isShort: height < 480,
      available,
      navWidth,
      maxWidth: (kind: ContentKind = 'wide') => {
        if (isCompact) return Infinity;
        switch (kind) {
          case 'narrow':
            return NARROW_MAX;
          case 'medium':
            return MEDIUM_MAX;
          case 'wide':
            return WIDE_MAX;
          case 'fluid':
            return FLUID_MAX;
          case 'full':
            return Infinity;
          default:
            return WIDE_MAX;
        }
      },
      columns: isCompact ? 1 : columnsFor(available),
      gutter: isCompact ? 16 : isDesktop ? 32 : 24,
    };
  }, [width, height]);
}
