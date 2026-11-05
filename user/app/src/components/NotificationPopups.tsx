import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PartnerNotification } from '../types/notifications';
import { CATEGORY_LABEL, TONE_COLORS, toneOf } from '../utils/notificationModel';
import { playTone } from '../services/notificationService';
import { Icon } from './Icon';
import { colors, fonts, space } from '../theme';

/** A notification older than this is history, not news — it never pops up. */
const FRESH_MS = 5 * 60 * 1000;
const MAX_VISIBLE = 2;

/**
 * Compact, modern notification popups for new events.
 * Outside the notification page, notifications are displayed as simple, clean,
 * non-intrusive floating banners that show a 1-line summary.
 * Full content and details are reserved for inside the Notifications page.
 */
export function NotificationPopups({
  notifications,
  onOpen,
  onRead,
}: {
  notifications: PartnerNotification[];
  onOpen: (n: PartnerNotification) => void;
  onRead: (n: PartnerNotification) => void;
}) {
  const seen = useRef<Set<string> | null>(null);
  const [popups, setPopups] = useState<{ key: string; n: PartnerNotification }[]>([]);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(notifications.map((n) => n.id));
      return;
    }
    const fresh = notifications.filter((n) => !seen.current!.has(n.id));
    fresh.forEach((n) => seen.current!.add(n.id));
    const now = Date.now();
    const show = fresh.filter((n) => !n.read && n.popup && now - (n.createdAtMs || now) < FRESH_MS);
    if (!show.length) return;
    setPopups((cur) => [...cur, ...show.map((n) => ({ key: `${n.id}-${now}`, n }))].slice(-6));
    const lead = show.find((n) => n.severity === 'critical') ?? show[0]!;
    playTone(lead.sound, lead.severity === 'critical' ? 2 : 1);
  }, [notifications]);

  const visible = popups.slice(-MAX_VISIBLE);
  const close = (key: string) => setPopups((cur) => cur.filter((p) => p.key !== key));
  if (!visible.length) return null;

  return (
    <SafeAreaView style={styles.wrap} pointerEvents="box-none" edges={['top']}>
      {visible.map((p) => (
        <PopupCard
          key={p.key}
          n={p.n}
          onClose={() => close(p.key)}
          onAct={() => {
            close(p.key);
            onRead(p.n);
            onOpen(p.n);
          }}
        />
      ))}
    </SafeAreaView>
  );
}

function PopupCard({
  n,
  onClose,
  onAct,
}: {
  n: PartnerNotification;
  onClose: () => void;
  onAct: () => void;
}) {
  const currentTone = toneOf(n);
  const tone = TONE_COLORS[currentTone];
  const [translateY] = useState(() => new Animated.Value(-30));
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, speed: 40, bounciness: 8, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [translateY, opacity]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -30, duration: 180, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => onClose());
  };

  useEffect(() => {
    if (n.severity === 'critical') return undefined;
    const t = setTimeout(dismiss, n.severity === 'warning' ? 9000 : 6000);
    return () => clearTimeout(t);
  }, [n.severity]);

  const iconName = currentTone === 'green' ? 'circle-check' : currentTone === 'red' ? 'circle-x' : 'bell';

  return (
    <Animated.View style={[styles.anim, { opacity, transform: [{ translateY }] }]}>
      <Pressable
        onPress={onAct}
        style={({ pressed }) => [styles.banner, pressed && { opacity: 0.92 }]}
        accessibilityRole="button"
        accessibilityLabel={`${n.title}. ${n.message}. Tap to view.`}
      >
        <View style={[styles.bar, { backgroundColor: tone.bar }]} />
        <View style={[styles.iconWrap, { backgroundColor: tone.bg }]}>
          <Icon name={iconName} size={17} color={tone.bar} />
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {n.title}
            </Text>
            <Text style={styles.category}>{CATEGORY_LABEL[n.category]}</Text>
          </View>
          <Text style={styles.message} numberOfLines={1}>
            {n.message}
          </Text>
        </View>
        <Pressable
          onPress={dismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          style={styles.closeBtn}
        >
          <Icon name="x" size={15} color="#94A3B8" />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 6,
    left: 0,
    right: 0,
    paddingHorizontal: space.lg,
    gap: 8,
    zIndex: 9999,
  },
  anim: {
    width: '100%',
    maxWidth: 540,
    alignSelf: 'center',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    paddingVertical: 10,
    paddingRight: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 6,
  },
  bar: {
    width: 4.5,
    alignSelf: 'stretch',
    borderRadius: 2,
    marginRight: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  body: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  title: {
    fontFamily: fonts.semiBold,
    fontSize: 13.5,
    lineHeight: 18,
    color: '#0F172A',
    flex: 1,
  },
  category: {
    fontFamily: fonts.medium,
    fontSize: 9.5,
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  message: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    color: '#475569',
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
    marginLeft: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
