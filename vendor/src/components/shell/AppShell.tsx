// The NESAM Partner workspace frame, laid out like the NESAM Driver app: a labelled sidebar on desktop (brand, workspace
// navigation, support card, profile), an icon rail on tablets and a brand bar + bottom navigation on phones. The page that is
// open sits beside / between them, so the navigation never moves while pages change.
import React, { useEffect, useRef } from 'react';
import { Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useVendorData } from '../../context/VendorData';
import { useInbox } from '../../context/Inbox';
import { goSection, navigationRef, sectionOf, SECTIONS, useCurrentRoute } from '../../navigation/navigationRef';
import type { Section } from '../../navigation/types';
import { colors } from '../../theme';
import { useLayout } from '../../theme/responsive';
import { FlashHost } from '../kit/flash';
import { initials } from '../kit/format';
import { Text } from '../kit/Text';
import { PartnerBanner } from './PartnerBanner';
import type { IconName } from '../kit/core';

const NAV: Record<Section, { on: IconName; off: IconName; label: string }> = {
  Bookings: { on: 'ticket', off: 'ticket-outline', label: 'My Trips' },
  Fleet: { on: 'car-sport', off: 'car-sport-outline', label: 'Fleet' },
  Trips: { on: 'map', off: 'map-outline', label: 'Bookings' },
  Earnings: { on: 'stats-chart', off: 'stats-chart-outline', label: 'Earnings' },
  Wallet: { on: 'wallet', off: 'wallet-outline', label: 'Wallet' },
};

type Hover = { pressed: boolean; hovered?: boolean };

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
      <View ref={frame} style={styles.frame} pointerEvents={locked ? 'none' : 'auto'}
        accessibilityElementsHidden={locked} importantForAccessibility={locked ? 'no-hide-descendants' : 'auto'}>
        {layout.wide ? <Sidebar current={current} width={layout.sidebarWidth} rail={layout.rail} /> : null}
        <View style={styles.workspace}>
          <Topbar current={current} route={route} />
          <View style={styles.main}>
            {children}
            <FlashHost />
          </View>
          {!layout.wide ? <BottomBar current={current} /> : null}
        </View>
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

// ── Top bar ─────────────────────────────────────────────────────────────────

function IconButton({ icon, label, onPress, dot, active, color, size = 40 }: { icon: IconName; label: string; onPress: () => void; dot?: boolean; active?: boolean; color?: string; size?: number }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ hovered }: Hover) => [styles.iconBtn, { width: size, height: size }, active && styles.iconBtnOn, hovered && !active && { backgroundColor: colors.bg }]}>
      <Ionicons name={icon} size={19} color={color ?? (active ? colors.primary : colors.ink)} />
      {dot ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

/**
 * Phones: the brand with the bell, help and profile buttons. Wider screens: just the buttons, right-aligned over the page
 * (the sidebar already carries the brand), lined up with the page content.
 */
function Topbar({ current, route }: { current: string; route: string }) {
  const insets = useSafeAreaInsets();
  const { wide, compact, gutter } = useLayout();
  const { unreadCount, unacknowledged } = useInbox();
  const dot = unreadCount > 0 || unacknowledged.length > 0;
  const size = compact ? 37 : 40;
  const alerts = route === 'Alerts';
  const actions = (
    <View style={[styles.actions, compact && { gap: 5 }]}>
      <IconButton icon="notifications-outline" label={dot ? 'Notifications, unread' : 'Notifications'} onPress={openAlerts} dot={dot} active={alerts} size={size} />
      <IconButton icon="headset-outline" label="24/7 Helpdesk" onPress={() => goSection('Helpdesk')} active={current === 'Helpdesk'} color={colors.primary} size={size} />
      {wide ? null : <IconButton icon="person-circle-outline" label="Profile and My Business" onPress={() => goSection('Account')} active={current === 'Account' && !alerts} size={size} />}
    </View>
  );
  if (!wide) {
    return (
      <View style={[styles.phoneBar, { paddingTop: insets.top + 12, paddingHorizontal: gutter, minHeight: 64 + insets.top }]}>
        <Pressable style={styles.brandLink} onPress={() => goSection('Trips')} accessibilityRole="button" accessibilityLabel="NESAM Partner — Bookings">
          <PartnerBanner height={compact ? 32 : 38} />
        </Pressable>
        {actions}
      </View>
    );
  }
  return (
    <View style={[styles.wideBar, { paddingTop: insets.top }]}>
      <View style={[styles.wideBarInner, { paddingHorizontal: gutter }]}>{actions}</View>
    </View>
  );
}

/** The bell opens Alerts from any page; Back returns to where the vendor was. */
function openAlerts() {
  if (navigationRef.isReady()) navigationRef.navigate('Alerts');
}

// ── Sidebar / rail ──────────────────────────────────────────────────────────

function Avatar({ name, size = 35 }: { name: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]} accessibilityElementsHidden>
      <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.34) }]}>{initials(name)}</Text>
    </View>
  );
}

function Sidebar({ current, width, rail }: { current: string; width: number; rail: boolean }) {
  const insets = useSafeAreaInsets();
  const { profile } = useVendorData();
  const badges = useBadges();
  const compact = width < 200;
  const name = profile.companyName || 'Fleet partner';
  return (
    <View style={[styles.sidebar, { width, paddingTop: 30 + insets.top, paddingBottom: 22 + insets.bottom, paddingHorizontal: rail ? 12 : compact ? 14 : 20 }]} accessibilityRole="menu" accessibilityLabel="Main navigation">
      <Pressable onPress={() => goSection('Trips')} accessibilityRole="button" accessibilityLabel="NESAM Partner — Bookings" style={rail ? styles.brandRail : [styles.brand, compact && { marginLeft: 4 }]}>
        {rail ? <Image source={require('../../../assets/icon.png')} style={styles.brandIcon} accessibilityIgnoresInvertColors /> : <PartnerBanner height={compact ? 40 : 46} />}
      </Pressable>
      {rail ? null : <Text style={styles.caption}>YOUR WORKSPACE</Text>}
      <View style={styles.nav}>
        {SECTIONS.map((sec) => {
          const on = current === sec;
          const n = badges[sec] ?? 0;
          const tint = on ? colors.primary : colors.muted;
          return (
            <Pressable key={sec} onPress={() => goSection(sec)} accessibilityRole="menuitem" accessibilityState={{ selected: on }}
              accessibilityLabel={n ? `${NAV[sec].label}, ${n}` : NAV[sec].label}
              style={({ hovered }: Hover) => [styles.navBtn, rail && styles.navBtnRail, on ? styles.navBtnOn : hovered && { backgroundColor: colors.bg }]}>
              <Ionicons name={on ? NAV[sec].on : NAV[sec].off} size={20} color={tint} />
              {rail ? null : <Text style={[styles.navLabel, { color: tint }]} numberOfLines={1}>{NAV[sec].label}</Text>}
              {!rail && n ? <View style={[styles.count, on && { backgroundColor: colors.white }]}><Text style={[styles.countText, on && { color: colors.primary }]}>{n > 99 ? '99+' : n}</Text></View> : null}
              {rail && n ? <View style={styles.railDot} /> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={{ flex: 1, minHeight: 24 }} />
      {rail ? (
        <View style={{ alignItems: 'center' }}>
          <IconButton icon="headset-outline" label="Contact NESAM support" onPress={() => goSection('Helpdesk')} color={colors.primary} size={44} />
        </View>
      ) : (
        <View style={styles.supportBox}>
          <Ionicons name="headset-outline" size={20} color={colors.primary} />
          <Text style={styles.supportTitle}>We’re here for you.</Text>
          <Text style={styles.supportText}>Get help with your duties or payments.</Text>
          <Pressable onPress={() => goSection('Helpdesk')} accessibilityRole="button" accessibilityLabel="Contact NESAM support" style={({ hovered }: Hover) => [styles.supportLink, hovered && { opacity: 0.75 }]}>
            <Text style={styles.supportLinkText}>Contact NESAM</Text>
            <Ionicons name="arrow-forward" size={14} color={colors.primary} />
          </Pressable>
        </View>
      )}
      <Pressable onPress={() => goSection('Account')} accessibilityRole="button" accessibilityLabel={`${name}, open profile`}
        style={({ hovered }: Hover) => [styles.profile, rail && { justifyContent: 'center', paddingHorizontal: 0 }, hovered && { opacity: 0.85 }]}>
        <Avatar name={name} />
        {rail ? null : (
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.profileName} numberOfLines={1}>{name}</Text>
            <View style={styles.verified}>
              <Ionicons name="shield-checkmark" size={11} color={colors.success} />
              <Text style={styles.verifiedText} numberOfLines={1}>Verified partner</Text>
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

// ── Phone bottom bar ────────────────────────────────────────────────────────

function BottomBar({ current }: { current: string }) {
  const insets = useSafeAreaInsets();
  const badges = useBadges();
  return (
    <View style={[styles.bottom, { paddingBottom: 8 + insets.bottom, paddingLeft: 8 + insets.left, paddingRight: 8 + insets.right }]} accessibilityRole="tablist" accessibilityLabel="Mobile navigation">
      {SECTIONS.map((sec) => {
        const on = current === sec;
        const n = badges[sec] ?? 0;
        const tint = on ? colors.primary : colors.muted;
        return (
          <Pressable key={sec} onPress={() => goSection(sec)} style={styles.bottomItem} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={n ? `${NAV[sec].label}, ${n}` : NAV[sec].label}>
            {on ? <View style={styles.bottomIndicator} /> : null}
            <View>
              <Ionicons name={on ? NAV[sec].on : NAV[sec].off} size={21} color={tint} />
              {n ? <View style={styles.bottomCount}><Text style={styles.countText}>{n > 9 ? '9+' : n}</Text></View> : null}
            </View>
            <Text style={[styles.bottomText, { color: tint }]} numberOfLines={1} maxFontSizeMultiplier={1.15}>{NAV[sec].label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  frame: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  veil: { backgroundColor: 'rgba(246,247,249,0.28)' },
  workspace: { flex: 1, minWidth: 0 },
  main: { flex: 1, minHeight: 0 },
  // top bar
  phoneBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingBottom: 12, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border, zIndex: 10 },
  brandLink: { flexShrink: 1, minHeight: 40, justifyContent: 'center' },
  wideBar: { backgroundColor: colors.bg, zIndex: 10 },
  wideBarInner: { width: '100%', maxWidth: 1360, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', minHeight: 66, paddingTop: 14, paddingBottom: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 0 },
  iconBtn: { borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  iconBtnOn: { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder },
  dot: { position: 'absolute', top: 9, right: 10, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.white },
  // sidebar
  sidebar: { backgroundColor: colors.white, borderRightWidth: 1, borderRightColor: colors.border },
  brand: { marginLeft: 2, marginBottom: 34, alignSelf: 'flex-start' },
  brandRail: { alignItems: 'center', marginBottom: 34 },
  brandIcon: { width: 44, height: 44, borderRadius: 12 },
  caption: { fontSize: 10, fontWeight: '700', letterSpacing: 1.8, color: '#9599A2', paddingHorizontal: 15, marginBottom: 14 },
  nav: { gap: 7 },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 48, paddingVertical: 13, paddingHorizontal: 15, borderRadius: 11 },
  navBtnRail: { justifyContent: 'center', paddingHorizontal: 0 },
  navBtnOn: { backgroundColor: colors.primarySoft },
  navLabel: { flex: 1, fontSize: 13, fontWeight: '600' },
  count: { minWidth: 22, height: 20, paddingHorizontal: 6, borderRadius: 6, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 10.5, fontWeight: '700', color: colors.muted },
  railDot: { position: 'absolute', top: 10, right: 16, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  supportBox: { backgroundColor: colors.bg, borderRadius: 13, paddingVertical: 18, paddingHorizontal: 15, marginBottom: 22 },
  supportTitle: { fontSize: 13, fontWeight: '700', color: colors.ink, marginTop: 9, marginBottom: 4 },
  supportText: { fontSize: 11.5, lineHeight: 17, color: colors.muted, marginBottom: 10 },
  supportLink: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 30 },
  supportLinkText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 20, paddingHorizontal: 6, marginTop: 14 },
  profileName: { fontSize: 12.5, fontWeight: '700', color: colors.ink },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  verifiedText: { fontSize: 11, color: colors.success, flexShrink: 1 },
  avatar: { backgroundColor: '#F6E9E6', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { fontWeight: '700', color: '#824B3F' },
  // phone bottom bar
  bottom: { flexDirection: 'row', backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  bottomItem: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4, paddingTop: 6, paddingBottom: 4, minHeight: 50 },
  bottomIndicator: { position: 'absolute', top: -9, width: 24, height: 3, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, backgroundColor: colors.primary },
  bottomText: { fontSize: 11, fontWeight: '600' },
  bottomCount: { position: 'absolute', right: -10, top: -5, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.white },
});
