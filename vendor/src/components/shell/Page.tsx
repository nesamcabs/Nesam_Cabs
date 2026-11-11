// One page of the workspace: the heading (title, subtitle, action; a back arrow on detail pages) and a centred, padded scroll body
// that follows the reference's breakpoints. DetailGrid puts the summary panel beside the main stack on wide screens.
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import { KeyboardAvoid } from '../KeyboardAvoid';
import { goBack } from '../../navigation/navigationRef';
import { colors, fontFamily } from '../../theme';
import { useLayout } from '../../theme/responsive';
import { COMPANY_LEGAL_NAME } from '../../config/constants';

const SECTION_PAGES = ['Trips', 'Bookings', 'Fleet', 'Earnings', 'Wallet', 'Helpdesk', 'Account'];

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
        <View style={[styles.inner, { paddingHorizontal: gutter, paddingTop: wide ? 22 : 16 }]}>
          {title ? <PageHeading title={title} subtitle={subtitle} action={action} back={controls && !SECTION_PAGES.includes(route.name)} /> : null}
          <View style={maxWidth ? { maxWidth, width: '100%' } : undefined}>{children}</View>
          <View style={styles.footer}>
            <Text style={styles.footerText}>NESAM · {COMPANY_LEGAL_NAME}</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoid>
  );
}

export function PageHeading({ title, subtitle, action, back }: { title: string; subtitle?: string; action?: React.ReactNode; back?: boolean }) {
  const { wide, compact } = useLayout();
  return (
    <View style={styles.heading}>
      {back ? (
        <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.back, (pressed || hovered) && { backgroundColor: '#EEF2F7' }]}>
          <Ionicons name="arrow-back" size={19} color="#52657B" />
        </Pressable>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.h1, !wide && { fontSize: compact ? 22 : 24 }]} accessibilityRole="header" numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
      </View>
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
  heading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 18 },
  h1: { fontFamily, fontSize: 27, fontWeight: '700', letterSpacing: -0.8, color: colors.ink, lineHeight: 34 },
  sub: { fontFamily, fontSize: 12.5, color: '#68788C', marginTop: 5, lineHeight: 19 },
  footer: { marginTop: 36, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#E6EBF1', alignItems: 'center' },
  footerText: { fontFamily, fontSize: 11, color: '#9AA5B2', textAlign: 'center' },
});
