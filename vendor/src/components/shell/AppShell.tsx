// The NESAM Partner workspace frame (docs/NESAM_Vendor.html): a full-width header (brand, notifications, 24/7 Helpdesk,
// Profile), then a sidebar on screens ≥ 801 px or a bottom bar on phones, around the page that is open.
import React, { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useVendorData } from '../../context/VendorData';
import { useInbox } from '../../context/Inbox';
import { goSection, navigationRef, sectionOf, SECTIONS, useCurrentRoute } from '../../navigation/navigationRef';
import type { Section } from '../../navigation/types';
import { colors, fontFamily } from '../../theme';
import { useLayout } from '../../theme/responsive';
import { FlashHost } from '../kit/flash';
import { PartnerBanner } from './PartnerBanner';
import type { IconName } from '../kit/core';

const NAV: Record<Section, { on: IconName; off: IconName; label: string }> = {
  Bookings: { on: 'ticket', off: 'ticket-outline', label: 'Bookings' },
  Fleet: { on: 'car-sport', off: 'car-sport-outline', label: 'Fleet' },
  Trips: { on: 'map', off: 'map-outline', label: 'Trips' },
  Earnings: { on: 'stats-chart', off: 'stats-chart-outline', label: 'Earnings' },
  Wallet: { on: 'wallet', off: 'wallet-outline', label: 'Wallet' },
};

function useBadges(): Partial<Record<Section, number>> {
  const { awaitingDispatch, actionLinks } = useVendorData();
  const { unacknowledged } = useInbox();
  return { Bookings: awaitingDispatch.length, Fleet: actionLinks.length, Wallet: unacknowledged.length };
}

/**
 * `lock` (verification pending): the whole panel stays visible but cannot be used — touches, clicks, keyboard focus and
 * screen readers are all blocked — and only the lock card on top can be used.
 */
export function AppShell({ children, lock = null }: { children: React.ReactNode; lock?: React.ReactNode }) {
  const layout = useLayout();
  const route = useCurrentRoute() ?? 'Trips';
  const current = sectionOf(route);
  const frame = useRef<View>(null);
  const locked = !!lock;
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = frame.current as unknown as HTMLElement | null;
    if (!el) return;
    if (locked) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [locked]);
  return (
    <View style={styles.root}>
      <View ref={frame} style={{ flex: 1 }} pointerEvents={locked ? 'none' : 'auto'}
        accessibilityElementsHidden={locked} importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}>
        <Header current={current} route={route} />
        <View style={styles.body}>
          {layout.wide ? <Sidebar current={current} width={layout.sidebarWidth} /> : null}
          <View style={styles.main}>
            {children}
            <FlashHost />
          </View>
        </View>
        {!layout.wide ? <BottomBar current={current} /> : null}
      </View>
      {locked ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={[StyleSheet.absoluteFill, styles.veil]} pointerEvents="auto" />
          {lock}
        </View>
      ) : null}
    </View>
  );
}

function Header({ current, route }: { current: string; route: string }) {
  const insets = useSafeAreaInsets();
  const { wide, compact } = useLayout();
  const { unreadCount, unacknowledged } = useInbox();
  const dot = unreadCount > 0 || unacknowledged.length > 0;
  return (
    <View style={[styles.header, { paddingTop: insets.top, height: (wide ? 74 : 68) + insets.top }, !wide && { paddingHorizontal: compact ? 12 : 16 }]}>
      <Pressable style={styles.brand} onPress={() => goSection('Trips')} accessibilityRole="button" accessibilityLabel="NESAM Partner — Trips">
        <PartnerBanner height={wide ? 52 : compact ? 36 : 42} />
      </Pressable>
      <View style={[styles.actions, !wide && { gap: 6 }]}>
        <Pressable onPress={openAlerts} style={[styles.bell, !wide && { width: 40, height: 42 }]} accessibilityRole="button" accessibilityLabel={dot ? 'Notifications, unread' : 'Notifications'}>
          <View style={styles.bellIcon}><Ionicons name="notifications-outline" size={20} color={route === 'Alerts' ? colors.primary : '#4C5664'} /></View>
          {dot ? <View style={styles.dot} /> : null}
        </Pressable>
        <Pressable onPress={() => goSection('Helpdesk')} style={[styles.pill, !wide && styles.mobileBtn, current === 'Helpdesk' && styles.pillOn]} accessibilityRole="button" accessibilityLabel="24/7 Helpdesk">
          <Ionicons name="headset-outline" size={wide ? 18 : 17} color={current === 'Helpdesk' ? colors.primary : '#596777'} />
          <Text style={[styles.pillText, !wide && styles.mobileText, current === 'Helpdesk' && { color: colors.primary }]}>{wide ? '24/7 Helpdesk' : '24/7'}</Text>
        </Pressable>
        <Pressable onPress={() => goSection('Account')} style={[styles.pill, !wide && styles.mobileBtn, current === 'Account' && route !== 'Alerts' && styles.pillOn]} accessibilityRole="button" accessibilityLabel="Profile and My Business">
          <Ionicons name="person-circle-outline" size={wide ? 19 : 17} color={current === 'Account' && route !== 'Alerts' ? colors.primary : '#596777'} />
          <Text style={[styles.pillText, !wide && styles.mobileText, current === 'Account' && route !== 'Alerts' && { color: colors.primary }]}>Profile</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** The bell opens Alerts from any page; Back returns to where the vendor was. */
function openAlerts() {
  if (navigationRef.isReady()) navigationRef.navigate('Alerts');
}

function Sidebar({ current, width }: { current: string; width: number }) {
  const { profile } = useVendorData();
  const badges = useBadges();
  return (
    <View style={[styles.sidebar, { width }]} accessibilityRole="menu" accessibilityLabel="Main navigation">
      <View style={{ gap: 6 }}>
        {SECTIONS.map((sec) => {
          const on = current === sec;
          const n = badges[sec] ?? 0;
          return (
            <Pressable key={sec} onPress={() => goSection(sec)} accessibilityRole="menuitem" accessibilityState={{ selected: on }} accessibilityLabel={NAV[sec].label}
              style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.side, on && styles.sideOn, hovered && !on && { backgroundColor: '#F7F9FB' }]}>
              {on ? <View style={styles.sideBar} /> : null}
              <Ionicons name={on ? NAV[sec].on : NAV[sec].off} size={21} color={on ? '#BA2424' : '#637389'} />
              <Text style={[styles.sideText, on && styles.sideTextOn]} numberOfLines={1}>{NAV[sec].label}</Text>
              {n ? <View style={styles.count}><Text style={styles.countText}>{n > 99 ? '99+' : n}</Text></View> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.sideAccount}>
        <Text style={styles.sideCompany} numberOfLines={2}>{profile.companyName || 'Fleet partner'}</Text>
        <Text style={styles.sideId} numberOfLines={1}>NSM-VN-{profile.id.slice(0, 6).toUpperCase()}</Text>
        <View style={styles.verified}><Ionicons name="shield-checkmark" size={12} color={colors.success} /><Text style={styles.verifiedText}>Verified partner</Text></View>
      </View>
    </View>
  );
}

function BottomBar({ current }: { current: string }) {
  const insets = useSafeAreaInsets();
  const badges = useBadges();
  return (
    <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 6) }]} accessibilityRole="tablist" accessibilityLabel="Mobile navigation">
      {SECTIONS.map((sec) => {
        const on = current === sec;
        const n = badges[sec] ?? 0;
        return (
          <Pressable key={sec} onPress={() => goSection(sec)} style={styles.bottomItem} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={NAV[sec].label}>
            {on ? <View style={styles.bottomBar} /> : null}
            <View>
              <Ionicons name={on ? NAV[sec].on : NAV[sec].off} size={22} color={on ? colors.primary : '#718198'} />
              {n ? <View style={styles.bottomCount}><Text style={styles.countText}>{n > 9 ? '9+' : n}</Text></View> : null}
            </View>
            <Text style={[styles.bottomText, on && { color: colors.primary, fontWeight: '600' }]} numberOfLines={1}>{NAV[sec].label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const shadow = Platform.select({ web: { boxShadow: '0 -6px 18px rgba(38,53,72,0.06)' } as object, default: { elevation: 8 } });

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  veil: { backgroundColor: 'rgba(246,248,251,0.28)' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 30, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border, zIndex: 10 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44, flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  bell: { width: 40, height: 40, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  bellIcon: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: 9, top: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary, borderWidth: 1, borderColor: colors.white },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 40, paddingHorizontal: 11, borderRadius: 11, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  pillOn: { backgroundColor: '#FFF1EE', borderColor: colors.primaryBorder },
  pillText: { fontFamily, fontSize: 12, fontWeight: '500', color: '#596777' },
  mobileBtn: { flexDirection: 'column', gap: 1, height: 42, minHeight: 42, minWidth: 44, width: undefined, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center', borderRadius: 10 },
  mobileText: { fontSize: 8.5 },
  body: { flex: 1, flexDirection: 'row', minHeight: 0 },
  main: { flex: 1, minWidth: 0 },
  sidebar: { backgroundColor: colors.white, borderRightWidth: 1, borderRightColor: colors.border, paddingTop: 26, paddingHorizontal: 12, paddingBottom: 20, justifyContent: 'space-between' },
  side: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 15, borderRadius: 9 },
  sideOn: { backgroundColor: '#FFF0EF' },
  sideBar: { position: 'absolute', left: 0, top: 14, bottom: 14, width: 3, borderRadius: 2, backgroundColor: colors.primary },
  sideText: { flex: 1, fontFamily, fontSize: 13, color: '#637389', fontWeight: '500' },
  sideTextOn: { color: '#BA2424', fontWeight: '600' },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  countText: { color: colors.white, fontSize: 10, fontWeight: '700', fontFamily },
  sideAccount: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 18, paddingHorizontal: 8, gap: 5 },
  sideCompany: { fontFamily, fontSize: 13, fontWeight: '600', color: colors.ink },
  sideId: { fontFamily, fontSize: 10.5, color: colors.muted },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  verifiedText: { fontFamily, fontSize: 10.5, color: colors.success, fontWeight: '500' },
  bottom: { flexDirection: 'row', backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 4, paddingHorizontal: 6, ...shadow },
  bottomItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 60, paddingVertical: 6 },
  bottomBar: { position: 'absolute', top: -4, width: 22, height: 3, borderRadius: 3, backgroundColor: colors.primary },
  bottomText: { fontFamily, fontSize: 10.5, color: '#718198' },
  bottomCount: { position: 'absolute', right: -10, top: -5, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.white },
});
