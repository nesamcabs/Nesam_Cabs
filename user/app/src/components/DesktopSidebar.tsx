import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { colors, fonts, radius, shadows, space, type } from '../theme';
import { useCustomerData } from '../context/CustomerData';
import { useInbox } from '../context/Inbox';
import { signOutUser } from '../services/authService';
import { initials } from '../utils/format';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config/constants';

const LOGO = require('../../assets/logo.png') as number;

interface NavItemDef {
  name: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge?: number | string;
}

export function UserDesktopSidebar({ state, navigation }: BottomTabBarProps) {
  const { profile, liveRide } = useCustomerData();
  const { unreadCount } = useInbox();

  const navItems: NavItemDef[] = [
    { name: 'Book', label: 'Book a Ride', icon: 'car-outline' },
    { name: 'Trips', label: 'My Trips', icon: 'receipt-outline', badge: liveRide ? 'Active' : undefined },
    { name: 'Alerts', label: 'Notifications', icon: 'notifications-outline', badge: unreadCount > 0 ? unreadCount : undefined },
    { name: 'Account', label: 'Account & Profile', icon: 'person-circle-outline' },
  ];

  return (
    <View style={styles.sidebar}>
      {/* Brand Header */}
      <View style={styles.brandContainer}>
        <View style={styles.brandRow}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
          <View style={{ flex: 1 }}>
            <Text style={styles.brandTitle}>
              NESAM <Text style={{ color: colors.primary }}>CABS</Text>
            </Text>
            <Text style={styles.brandSub}>Tours & Outstation Cabs</Text>
          </View>
        </View>
        <View style={styles.roleBadge}>
          <View style={styles.dot} />
          <Text style={styles.roleText}>Customer Portal</Text>
        </View>
      </View>

      {/* Navigation Links */}
      <View style={styles.navSection}>
        <Text style={styles.sectionHeader}>Navigation</Text>
        {navItems.map((item) => {
          const routeIndex = state.routes.findIndex((r) => r.name === item.name);
          const active = state.index === routeIndex;

          return (
            <Pressable
              key={item.name}
              onPress={() => {
                if (routeIndex >= 0) {
                  navigation.navigate(item.name);
                }
              }}
              style={({ pressed, hovered }: any) => [
                styles.navItem,
                active && styles.navItemActive,
                hovered && !active && styles.navItemHovered,
                pressed && { opacity: 0.8 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <Ionicons
                name={active ? (item.icon.replace('-outline', '') as any) : item.icon}
                size={22}
                color={active ? colors.primary : colors.muted}
              />
              <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
              {item.badge !== undefined ? (
                <View style={[styles.badge, active && styles.badgeActive]}>
                  <Text style={[styles.badgeText, active && styles.badgeTextActive]}>{item.badge}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {/* Support Card */}
      <View style={styles.supportCard}>
        <View style={styles.supportIconWrap}>
          <Ionicons name="headset-outline" size={20} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.supportTitle}>Need Help?</Text>
          <Text style={styles.supportPhone}>{SUPPORT_PHONE_DISPLAY}</Text>
        </View>
      </View>

      {/* User Account Footer */}
      <View style={styles.footer}>
        <View style={styles.userRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(profile.name || 'User')}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.userName} numberOfLines={1}>
              {profile.name || 'Customer'}
            </Text>
            <Text style={styles.userPhone} numberOfLines={1}>
              {profile.phone}
            </Text>
          </View>
          <Pressable
            onPress={() => void signOutUser()}
            style={({ pressed, hovered }: any) => [
              styles.signOutBtn,
              hovered && { backgroundColor: '#FEE2E2' },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Ionicons name="log-out-outline" size={20} color={colors.danger} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 260,
    backgroundColor: '#FFFFFF',
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
    flexDirection: 'column',
    height: '100%',
    paddingTop: space.lg,
    paddingBottom: space.md,
    paddingHorizontal: space.md,
  },
  brandContainer: {
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    marginBottom: space.md,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  logo: {
    width: 38,
    height: 38,
  },
  brandTitle: {
    fontFamily: fonts.black,
    fontSize: 16,
    fontWeight: '900',
    color: colors.ink,
    letterSpacing: 0.3,
  },
  brandSub: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: colors.muted,
    fontWeight: '600',
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F8FAFC',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginTop: space.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  roleText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  navSection: {
    flex: 1,
    gap: 4,
  },
  sectionHeader: {
    fontFamily: fonts.extraBold,
    fontSize: 11,
    fontWeight: '800',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
    marginLeft: 10,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    gap: 12,
    cursor: 'pointer' as any,
  },
  navItemHovered: {
    backgroundColor: '#F8FAFC',
  },
  navItemActive: {
    backgroundColor: '#FEF2F2',
  },
  navLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    flex: 1,
  },
  navLabelActive: {
    fontFamily: fonts.extraBold,
    color: colors.primary,
    fontWeight: '800',
  },
  badge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  badgeActive: {
    backgroundColor: colors.primary,
  },
  badgeText: {
    fontFamily: fonts.extraBold,
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  badgeTextActive: {
    fontFamily: fonts.extraBold,
    color: '#FFFFFF',
  },
  supportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: '#F8FAFC',
    borderRadius: radius.md,
    padding: space.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: space.sm,
  },
  supportIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  supportTitle: {
    fontFamily: fonts.bold,
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  supportPhone: {
    fontFamily: fonts.extraBold,
    fontSize: 12,
    fontWeight: '800',
    color: colors.ink,
  },
  footer: {
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  avatarText: {
    fontFamily: fonts.extraBold,
    fontSize: 13,
    fontWeight: '800',
    color: colors.primary,
  },
  userName: {
    fontFamily: fonts.extraBold,
    fontSize: 13,
    fontWeight: '800',
    color: colors.ink,
  },
  userPhone: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.muted,
  },
  signOutBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer' as any,
  },
});
