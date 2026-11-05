// Responsive layout primitives (same file in all three apps).
//
// `ScrollView` and `FlatList` here are drop-in replacements for the React Native
// ones: on phones nothing changes, on wider windows the content is centred in a
// readable column instead of stretching edge to edge, and card lists can flow
// into several columns. Backgrounds stay full-bleed.
import React, { forwardRef, useMemo } from 'react';
import {
  FlatList as RNFlatList,
  ScrollView as RNScrollView,
  StyleSheet,
  View,
  type FlatListProps,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useResponsive, type ContentKind } from '../theme/responsive';

/** Style that centres a block and caps its width for the current window. */
export function useContentStyle(kind: ContentKind = 'wide'): ViewStyle {
  const r = useResponsive();
  const max = r.maxWidth(kind);
  return useMemo<ViewStyle>(() => (Number.isFinite(max) ? { width: '100%', maxWidth: max, alignSelf: 'center' } : { width: '100%' }), [max]);
}

/** A centred, width-capped block (use inside non-scrolling screens, footers, headers). */
export function Content({ kind = 'wide', style, children }: { kind?: ContentKind; style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  const c = useContentStyle(kind);
  return <View style={[c, style]}>{children}</View>;
}

/**
 * Fills its parent and keeps its children in a centred column on wide windows.
 * Used inside full-screen modals / pages whose header, search box and list are
 * separate blocks (a plain width cap on the list alone would misalign them).
 */
export function Frame({ kind = 'wide', style, children }: { kind?: ContentKind; style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  const c = useContentStyle(kind);
  return <View style={[{ flex: 1 }, c, style]}>{children}</View>;
}

/**
 * Responsive row that splits into side-by-side columns on desktop (>=1024px)
 * and stacks vertically on mobile (<1024px).
 */
export function DesktopRow({
  children,
  gap = 24,
  spacing,
  style,
  alignItems = 'flex-start',
}: {
  children: React.ReactNode;
  gap?: number;
  spacing?: number;
  style?: StyleProp<ViewStyle>;
  alignItems?: ViewStyle['alignItems'];
}) {
  const { isDesktop } = useResponsive();
  const actualGap = spacing !== undefined ? spacing : gap;
  return (
    <View style={[{ flexDirection: isDesktop ? 'row' : 'column', gap: actualGap, alignItems: isDesktop ? alignItems : 'stretch' }, style]}>
      {children}
    </View>
  );
}

/**
 * Responsive column for use inside DesktopRow.
 */
export function DesktopCol({
  children,
  flex = 1,
  style,
  width,
}: {
  children: React.ReactNode;
  flex?: number;
  width?: number | string;
  style?: StyleProp<ViewStyle>;
}) {
  const { isDesktop } = useResponsive();
  return (
    <View style={[isDesktop && (width ? { width: width as any } : { flex }), style]}>
      {children}
    </View>
  );
}

type LayoutProps = { kind?: ContentKind };

export const ScrollView = forwardRef<RNScrollView, ScrollViewProps & LayoutProps>(function ScrollView(
  { kind = 'wide', contentContainerStyle, ...props },
  ref,
) {
  const content = useContentStyle(kind);
  // Horizontal scrollers (chip rows, tab strips) are not page content.
  if (props.horizontal) return <RNScrollView ref={ref} contentContainerStyle={contentContainerStyle} {...props} />;
  return <RNScrollView ref={ref} contentContainerStyle={[content, contentContainerStyle]} {...props} />;
});

type ResponsiveFlatListProps<T> = FlatListProps<T> &
  LayoutProps & {
    /** Flow items into several columns on wide windows. Items must be self-contained cards. */
    multiColumn?: boolean;
    /** Upper bound for `multiColumn` (default 2). */
    maxColumns?: number;
  };

function FlatListInner<T>(
  { kind, multiColumn = false, maxColumns = 2, contentContainerStyle, columnWrapperStyle, renderItem, numColumns, ...props }: ResponsiveFlatListProps<T>,
  ref: React.ForwardedRef<RNFlatList<T>>,
) {
  const r = useResponsive();
  const content = useContentStyle(kind ?? (multiColumn ? 'wide' : 'narrow'));
  const cols = multiColumn ? Math.max(1, Math.min(maxColumns, r.columns)) : (numColumns ?? 1);
  const wrapped = useMemo(() => {
    if (cols < 2 || !renderItem) return renderItem;
    // Each cell shares the row equally; the card inside keeps its own margins.
    const cell: typeof renderItem = (info) => <View style={styles.cell}>{renderItem(info) as React.ReactElement}</View>;
    return cell;
  }, [cols, renderItem]);
  return (
    <RNFlatList<T>
      ref={ref}
      // numColumns cannot change on a mounted list.
      key={`cols-${cols}`}
      {...props}
      numColumns={cols}
      renderItem={wrapped}
      columnWrapperStyle={cols > 1 ? [styles.columns, columnWrapperStyle] : undefined}
      contentContainerStyle={[content, contentContainerStyle]}
    />
  );
}

export const FlatList = forwardRef(FlatListInner) as <T>(
  props: ResponsiveFlatListProps<T> & { ref?: React.Ref<RNFlatList<T>> },
) => React.ReactElement;

/** A wrapping grid that reflows from 1 → 2 → 3 columns; children get equal widths. */
export function Grid({ children, columns, gap = 12, style }: { children: React.ReactNode; columns?: number; gap?: number; style?: StyleProp<ViewStyle> }) {
  const r = useResponsive();
  const cols = Math.max(1, columns ?? r.columns);
  const items = React.Children.toArray(children).filter(Boolean);
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return (
    <View style={[{ gap }, style]}>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap }}>
          {row.map((child, j) => (
            <View key={j} style={{ flex: 1, minWidth: 0 }}>
              {child}
            </View>
          ))}
          {row.length < cols ? Array.from({ length: cols - row.length }, (_, k) => <View key={`pad-${k}`} style={{ flex: 1 }} />) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  cell: { flex: 1, minWidth: 0 },
  columns: { gap: 12 },
});
