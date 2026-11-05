import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius, shadows, space, type } from '../theme';
import { useResponsive } from '../theme/responsive';

const LOGO = require('../../assets/logo.png') as number;

interface DesktopWizardShellProps {
  title: string;
  subtitle?: string;
  badge?: string;
  onSignOut?: () => void;
  onCancel?: () => void;
  children: React.ReactNode;
}

export function DesktopWizardShell({
  title,
  subtitle,
  badge = 'Driver Partner Registration',
  onSignOut,
  onCancel,
  children,
}: DesktopWizardShellProps) {
  const { isCompact } = useResponsive();

  if (isCompact) {
    return <>{children}</>;
  }

  return (
    <View style={styles.page}>
      {/* Top Application Bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarInner}>
          <View style={styles.brandGroup}>
            <Image source={LOGO} style={styles.logo} resizeMode="contain" />
            <View>
              <Text style={styles.brandTitle}>
                NESAM <Text style={{ color: colors.primary }}>CABS</Text>
              </Text>
              <Text style={styles.brandSub}>Tours & Travels Private Limited</Text>
            </View>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          </View>
          <View style={styles.actionsGroup}>
            <View style={styles.supportPill}>
              <Ionicons name="call-outline" size={14} color={colors.primary} />
              <Text style={styles.supportText}>Helpline: +91 94889 54445</Text>
            </View>
            {onCancel ? (
              <Pressable
                onPress={onCancel}
                style={({ pressed, hovered }: any) => [
                  styles.headerBtn,
                  hovered && { backgroundColor: '#F1F5F9' },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.headerBtnText}>Back</Text>
              </Pressable>
            ) : null}
            {onSignOut ? (
              <Pressable
                onPress={onSignOut}
                style={({ pressed, hovered }: any) => [
                  styles.signOutBtn,
                  hovered && { backgroundColor: '#FEE2E2' },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Ionicons name="log-out-outline" size={16} color={colors.danger} />
                <Text style={styles.signOutText}>Sign out</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      {/* Main Container */}
      <View style={styles.body}>
        <View style={styles.cardContainer}>
          <View style={styles.header}>
            <Text style={styles.pageTitle}>{title}</Text>
            {subtitle ? <Text style={styles.pageSubtitle}>{subtitle}</Text> : null}
          </View>
          {children}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    minHeight: '100%',
  },
  topBar: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
    ...shadows.sm,
  },
  topBarInner: {
    maxWidth: 1200,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  logo: {
    width: 36,
    height: 36,
  },
  brandTitle: {
    fontFamily: fonts.black,
    fontSize: 16,
    fontWeight: '900',
    color: colors.ink,
    letterSpacing: 0.3,
  },
  brandSub: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: colors.muted,
  },
  badge: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
  },
  actionsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  supportPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  supportText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  headerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    cursor: 'pointer' as any,
  },
  headerBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FFF5F5',
    cursor: 'pointer' as any,
  },
  signOutText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    fontWeight: '700',
    color: colors.danger,
  },
  body: {
    flex: 1,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    alignItems: 'center',
  },
  cardContainer: {
    width: '100%',
    maxWidth: 1040,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: space.xl,
    ...shadows.md,
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: space.md,
    marginBottom: space.lg,
  },
  pageTitle: {
    fontFamily: fonts.extraBold,
    fontSize: 24,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.3,
  },
  pageSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.muted,
    marginTop: 4,
  },
});
