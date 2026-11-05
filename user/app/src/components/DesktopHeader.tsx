import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius, space, type } from '../theme';
import { useResponsive } from '../theme/responsive';

interface DesktopHeaderProps {
  title: string;
  subtitle?: string;
  badge?: string;
  onBack?: () => void;
  actions?: React.ReactNode;
}

export function DesktopHeader({ title, subtitle, badge, onBack, actions }: DesktopHeaderProps) {
  const { isCompact } = useResponsive();
  if (isCompact) return null;

  return (
    <View style={styles.header}>
      <View style={styles.titleArea}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            style={({ pressed, hovered }: any) => [
              styles.backBtn,
              hovered && { backgroundColor: '#F1F5F9' },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.ink} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            {badge ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{badge}</Text>
              </View>
            ) : null}
          </View>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      {actions ? <View style={styles.actionsArea}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    marginBottom: space.lg,
    gap: space.md,
  },
  titleArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flex: 1,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    cursor: 'pointer' as any,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  title: {
    fontFamily: fonts.extraBold,
    fontSize: 22,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.3,
  },
  badge: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  actionsArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
});

