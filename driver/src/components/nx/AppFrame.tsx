// The workspace frame (reference `.app`): a labelled sidebar on desktop, an icon rail on tablets and a bottom bar on phones.
// It wraps the whole stack, so the navigation never re-renders or jumps while pages change.
import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from './Text';
import { useDriverData } from '../../context/DriverData';
import { goTab, navItemsFor, navOwner, type NavItem } from '../../navigation/navItems';
import { nx } from '../../theme/nx';
import { initials } from '../../utils/format';
import { NxBrand } from './Brand';
import { NxIcon } from './Icon';
import { isHovered } from './primitives';
import { useFrame, useShell } from './Shell';

export function AppFrame({ children }: { children: React.ReactNode }) {
  const frame = useFrame();
  return (
    <View style={styles.app}>
      {frame.sideNav ? <Sidebar rail={frame.mode === 'rail'} width={frame.sidebarWidth} route={frame.route} /> : null}
      <View style={styles.workspace}>
        <View style={{ flex: 1 }}>{children}</View>
        {frame.bottomNav ? <BottomNav route={frame.route} /> : null}
      </View>
    </View>
  );
}

// ── Sidebar / rail ──────────────────────────────────────────────────────────

function Sidebar({ rail, width, route }: { rail: boolean; width: number; route: string }) {
  const { account, upcomingTrips } = useDriverData();
  const { openSupport } = useShell();
  const { driver } = account;
  const items = navItemsFor(!!driver.vendorId);
  const owner = navOwner(route);
  const compact = width < 200;
  return (
    <SafeAreaView edges={['top', 'left', 'bottom']} style={[styles.sidebar, { width }]}>
      <ScrollView
        contentContainerStyle={[styles.sidebarScroll, { paddingHorizontal: rail ? 12 : compact ? 14 : 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={rail ? styles.brandRail : [styles.brand, compact && { marginLeft: 4 }]}>
          <NxBrand iconOnly={rail} height={rail ? 44 : compact ? 44 : 52} />
        </View>
        {rail ? null : <Text style={styles.caption}>YOUR WORKSPACE</Text>}
        <View style={styles.nav} accessibilityRole="tablist" accessibilityLabel="Main navigation">
          {items.map((item) => (
            <SideButton key={item.id} item={item} active={owner === item.id} rail={rail} count={item.id === 'Trip' ? upcomingTrips.length : undefined} />
          ))}
        </View>
        <View style={{ flex: 1, minHeight: 24 }} />
        {rail ? null : (
          <View style={styles.supportBox}>
            <NxIcon name="help" size={20} color={nx.red} />
            <Text style={styles.supportTitle}>We’re here for you.</Text>
            <Text style={styles.supportText}>Get help with your duties or payments.</Text>
            <Pressable onPress={() => openSupport()} style={(s) => [styles.supportLink, isHovered(s) && { opacity: 0.75 }]} accessibilityRole="button" accessibilityLabel="Contact NESAM support">
              <Text style={styles.supportLinkText}>Contact NESAM</Text>
              <NxIcon name="arrow" size={14} color={nx.red} />
            </Pressable>
          </View>
        )}
        {rail ? (
          <Pressable onPress={() => openSupport()} style={(s) => [styles.railHelp, isHovered(s) && { backgroundColor: nx.page }]} accessibilityRole="button" accessibilityLabel="Contact NESAM support">
            <NxIcon name="help" size={20} color={nx.red} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => goTab('Profile')}
          style={(s) => [styles.profile, rail && { justifyContent: 'center', paddingHorizontal: 0 }, isHovered(s) && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={`${driver.name}, open profile`}
        >
          <Avatar name={driver.name} photoUrl={driver.photoUrl} size={35} />
          {rail ? null : (
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.profileName} numberOfLines={1}>
                {driver.name}
              </Text>
              <Text style={styles.profileRole} numberOfLines={1}>
                {driver.vendorName ? `Fleet · ${driver.vendorName}` : 'Verified driver'}
              </Text>
            </View>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function SideButton({ item, active, rail, count }: { item: NavItem; active: boolean; rail: boolean; count?: number }) {
  const color = active ? nx.red : nx.muted;
  return (
    <Pressable
      onPress={() => goTab(item.id)}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={count !== undefined ? `${item.label}, ${count}` : item.label}
      style={(s) => [styles.navButton, rail && styles.navButtonRail, active ? styles.navButtonActive : isHovered(s) && styles.navButtonHover]}
    >
      <NxIcon name={item.icon} size={20} color={color} strokeWidth={active ? 2 : 1.8} />
      {rail ? null : (
        <Text style={[styles.navLabel, { color: active ? nx.red : nx.muted }]} numberOfLines={1}>
          {item.label}
        </Text>
      )}
      {!rail && count !== undefined ? (
        <View style={[styles.count, active && { backgroundColor: nx.white }]}>
          <Text style={[styles.countText, active && { color: nx.red }]}>{count}</Text>
        </View>
      ) : null}
      {rail && count ? <View style={styles.railDot} /> : null}
    </Pressable>
  );
}

export function Avatar({ name, photoUrl, size = 53 }: { name: string; photoUrl?: string; size?: number }) {
  const ring = size >= 50 ? 3 : 2;
  if (photoUrl) {
    return (
      <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, borderWidth: ring }]}>
        <Image source={{ uri: photoUrl }} style={{ width: '100%', height: '100%', borderRadius: size / 2 }} accessibilityIgnoresInvertColors />
      </View>
    );
  }
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, borderWidth: ring }]} accessibilityElementsHidden>
      <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.32) }]}>{initials(name)}</Text>
    </View>
  );
}

// ── Phone bottom bar ────────────────────────────────────────────────────────

function BottomNav({ route }: { route: string }) {
  const { account } = useDriverData();
  const insets = useSafeAreaInsets();
  const items = navItemsFor(!!account.driver.vendorId).filter((i) => i.phone);
  // Duties has no slot of its own on phones; it is reached from Home, so Home stays highlighted.
  const owner = navOwner(route) === 'Marketplace' ? 'Home' : navOwner(route);
  return (
    <View style={[styles.bottom, { paddingBottom: 8 + insets.bottom, paddingLeft: 8 + insets.left, paddingRight: 8 + insets.right }]} accessibilityRole="tablist" accessibilityLabel="Mobile pages">
      {items.map((item) => {
        const active = owner === item.id;
        const color = active ? nx.red : nx.muted;
        return (
          <Pressable
            key={item.id}
            onPress={() => goTab(item.id)}
            style={styles.bottomItem}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
          >
            {active ? <View style={styles.bottomIndicator} /> : null}
            <NxIcon name={item.icon} size={21} color={color} strokeWidth={active ? 2 : 1.8} />
            <Text style={[styles.bottomLabel, { color }]} numberOfLines={1} maxFontSizeMultiplier={1.15}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, flexDirection: 'row', backgroundColor: nx.page },
  workspace: { flex: 1, minWidth: 0 },
  sidebar: { backgroundColor: nx.white, borderRightWidth: 1, borderRightColor: nx.line },
  sidebarScroll: { flexGrow: 1, paddingTop: 30, paddingBottom: 22 },
  brand: { marginLeft: 2, marginBottom: 34 },
  brandRail: { alignItems: 'center', marginBottom: 34 },
  caption: { fontSize: 10, fontWeight: '700', letterSpacing: 1.8, color: nx.caption, paddingHorizontal: 15, marginBottom: 14 },
  nav: { gap: 7 },
  navButton: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 48, paddingVertical: 13, paddingHorizontal: 15, borderRadius: 11 },
  navButtonRail: { justifyContent: 'center', paddingHorizontal: 0 },
  navButtonActive: { backgroundColor: nx.redSoft },
  navButtonHover: { backgroundColor: nx.page },
  navLabel: { flex: 1, fontSize: 13, fontWeight: '600' },
  count: { minWidth: 22, height: 20, paddingHorizontal: 6, borderRadius: 6, backgroundColor: nx.line, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 10.5, fontWeight: '700', color: nx.muted },
  railDot: { position: 'absolute', top: 10, right: 16, width: 7, height: 7, borderRadius: 4, backgroundColor: nx.red },
  supportBox: { backgroundColor: nx.page, borderRadius: 13, paddingVertical: 18, paddingHorizontal: 15, marginBottom: 22 },
  supportTitle: { fontSize: 13, fontWeight: '700', color: nx.ink, marginTop: 9, marginBottom: 4 },
  supportText: { fontSize: 11.5, lineHeight: 17, color: nx.muted, marginBottom: 10 },
  supportLink: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 30 },
  supportLinkText: { fontSize: 12, fontWeight: '700', color: nx.red },
  railHelp: { alignSelf: 'center', width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderTopColor: nx.line, paddingTop: 20, paddingHorizontal: 6 },
  profileName: { fontSize: 12.5, fontWeight: '700', color: nx.ink },
  profileRole: { fontSize: 11, color: nx.muted, marginTop: 1 },
  avatar: { backgroundColor: '#F6E9E6', borderColor: nx.white, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', shadowColor: '#F0E3DE', shadowOpacity: 1, shadowRadius: 0, shadowOffset: { width: 0, height: 0 } },
  avatarText: { fontWeight: '700', color: '#824B3F' },
  bottom: { flexDirection: 'row', backgroundColor: nx.white, borderTopWidth: 1, borderTopColor: nx.line, paddingTop: 8 },
  bottomItem: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4, paddingTop: 6, paddingBottom: 4, minHeight: 50 },
  bottomIndicator: { position: 'absolute', top: -9, width: 24, height: 3, borderBottomLeftRadius: 4, borderBottomRightRadius: 4, backgroundColor: nx.red },
  bottomLabel: { fontSize: 11, fontWeight: '600' },
});
