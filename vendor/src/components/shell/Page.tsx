// One page of the workspace: the heading (title, subtitle, action; a back arrow on detail pages) and a centred, padded scroll body
// that follows the reference's breakpoints. DetailGrid puts the summary panel beside the main stack on wide screens.
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Text } from '../kit/Text';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import { KeyboardAvoid } from '../KeyboardAvoid';
import { goBack } from '../../navigation/navigationRef';
import { colors, fontFamily } from '../../theme';
import { useLayout } from '../../theme/responsive';
import { COMPANY_LEGAL_NAME } from '../../config/constants';

// Pages that show no back arrow: the five sections plus the pages opened from the header and menus. Only record detail pages keep one.
const SECTION_PAGES = ['Trips', 'Bookings', 'Fleet', 'Earnings', 'Wallet', 'Helpdesk', 'Account', 'Alerts', 'Business', 'Agreements', 'Documents', 'MyBids', 'FleetAdd', 'Duty'];

export function Page({
  title,
  subtitle,
  action,
  controls = true,
  children,
  maxWidth,
  onRefresh,
  refreshing,
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  /** A small back arrow beside the title on detail pages (never on the main sections). */
  controls?: boolean;
  children: React.ReactNode;
  /** Narrow forms (the reference's w-narrow) use 700. */
  maxWidth?: number;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { gutter, wide } = useLayout();
  const route = useRoute();
  return (
    <KeyboardAvoid>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 36 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} /> : undefined}
      >
        <View style={[styles.inner, { paddingHorizontal: gutter, paddingTop: wide ? 6 : 16 }]}>
          {title ? <PageHeading title={title} subtitle={subtitle} action={action} back={controls && !SECTION_PAGES.includes(route.name)} /> : null}
          <View style={maxWidth ? { maxWidth, width: '100%' } : undefined}>{children}</View>
          <View style={[styles.footer, !wide && { justifyContent: 'center' }]}>
            <View style={styles.footerLeft}>
              <Ionicons name="shield-checkmark-outline" size={12} color="#989DA6" />
              <Text style={styles.footerText}>{COMPANY_LEGAL_NAME.toUpperCase()}</Text>
            </View>
            {wide ? <Text style={styles.footerText}>Made for every mile.</Text> : null}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoid>
  );
}

/**
 * No page shows a title or subtitle any more (the bottom bar and the content already say where you are). What is left is the small
 * back arrow on detail pages and the page's action button, if it has one; a section page with neither shows nothing here.
 */
export function PageHeading({ action, back }: { title?: string; subtitle?: string; action?: React.ReactNode; back?: boolean }) {
  if (!back && !action) return null;
  return (
    <View style={styles.heading}>
      {back ? (
        <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.back, (pressed || hovered) && { backgroundColor: '#EEF2F7' }]}>
          <Ionicons name="arrow-back" size={19} color="#52657B" />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }} />
      {action ? <View style={{ flexShrink: 0 }}>{action}</View> : null}
    </View>
  );
}

/** Main stack + summary side panel (300 px) on wide screens; one column, summary last, on narrow ones. */
export function DetailGrid({ main, side, sideWidth = 300 }: { main: React.ReactNode; side: React.ReactNode; sideWidth?: number }) {
  const { sideBySide } = useLayout();
  if (!sideBySide) return <View style={{ gap: 16 }}>{main}{side}</View>;
  return (
    <View style={{ flexDirection: 'row', gap: 22, alignItems: 'flex-start' }}>
      <View style={{ flex: 1, minWidth: 0, gap: 16 }}>{main}</View>
      <View style={{ width: sideWidth, gap: 16 }}>{side}</View>
    </View>
  );
}

export const Gap = ({ h = 16, style }: { h?: number; style?: StyleProp<ViewStyle> }) => <View style={[{ height: h }, style]} />;

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  inner: { width: '100%', maxWidth: 1360, alignSelf: 'center' },
  back: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: -1, marginLeft: -6 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginBottom: 14 },
  h1: { fontFamily, fontSize: 27, fontWeight: '700', letterSpacing: -0.9, color: colors.ink, lineHeight: 34 },
  sub: { fontFamily, fontSize: 12.5, color: colors.muted, marginTop: 3, lineHeight: 19 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 28, marginBottom: 4 },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  footerText: { fontSize: 10, color: '#989DA6', letterSpacing: 0.2 },
});
