import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PartnerNotification } from '../types/notifications';
import { CATEGORY_LABEL, TONE_COLORS, toneOf } from '../utils/notificationModel';
import { playTone } from '../services/notificationService';
import { formatDateTime12 } from '../utils/time';
import { radius, space } from '../theme';

/** A notification older than this is history, not news — it never pops up. */
const FRESH_MS = 5 * 60 * 1000;
const MAX_VISIBLE = 3;

/**
 * Colour-coded popups for important new events, with a tone per type: new trip,
 * approval/confirmation, general. Quiet inbox entries and everything that was
 * already there when the app opened never pop up. Critical alerts stay until dismissed.
 */
export function NotificationPopups({ notifications, onOpen, onRead }: { notifications: PartnerNotification[]; onOpen: (n: PartnerNotification) => void; onRead: (n: PartnerNotification) => void }) {
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
    setPopups((cur) => [...cur, ...show.map((n) => ({ key: `${n.id}-${now}`, n }))].slice(-8));
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

function PopupCard({ n, onClose, onAct }: { n: PartnerNotification; onClose: () => void; onAct: () => void }) {
  const tone = TONE_COLORS[toneOf(n)];
  useEffect(() => {
    if (n.severity === 'critical') return undefined;
    const t = setTimeout(onClose, n.severity === 'warning' ? 12000 : 8000);
    return () => clearTimeout(t);
  }, [n.severity, onClose]);
  return (
    <View style={[styles.card, { backgroundColor: tone.bg, borderColor: tone.border }]} accessibilityRole={n.severity === 'critical' ? 'alert' : undefined}>
      <View style={[styles.bar, { backgroundColor: tone.bar }]} />
      <View style={styles.content}>
        <View style={styles.top}>
          <Text style={[styles.chip, { color: tone.text, borderColor: tone.border }]}>{n.severity === 'critical' ? 'CRITICAL' : CATEGORY_LABEL[n.category].toUpperCase()}</Text>
          <Text style={styles.time}>{n.createdAtMs ? formatDateTime12(new Date(n.createdAtMs)) : 'Just now'}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss notification" hitSlop={10}>
            <Text style={styles.x}>✕</Text>
          </Pressable>
        </View>
        <Text style={[styles.title, { color: tone.text }]}>{n.title}</Text>
        <Text style={styles.message}>{n.message}</Text>
        {n.bookingCode || n.bookingId ? <Text style={styles.ref}>Ref {n.bookingCode || n.bookingId}</Text> : null}
        <View style={styles.actions}>
          <Pressable onPress={onAct} style={[styles.cta, { backgroundColor: tone.bar }]} accessibilityRole="button">
            <Text style={styles.ctaText}>{n.ctaLabel}</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.dismiss} accessibilityRole="button">
            <Text style={styles.dismissText}>Dismiss</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space.md, gap: space.sm, zIndex: 50 },
  card: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.md, overflow: 'hidden', elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  bar: { width: 6 },
  content: { flex: 1, padding: space.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chip: { fontSize: 10, fontWeight: '900', borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  time: { flex: 1, fontSize: 11, color: '#4B5563' },
  x: { fontSize: 16, fontWeight: '800', color: '#374151', paddingHorizontal: 4 },
  title: { fontSize: 15, fontWeight: '800', marginTop: 4 },
  message: { fontSize: 13, color: '#1F2937', marginTop: 2 },
  ref: { fontSize: 11, color: '#4B5563', marginTop: 4 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  cta: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  dismiss: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: '#9CA3AF', backgroundColor: 'rgba(255,255,255,0.7)' },
  dismissText: { color: '#1F2937', fontWeight: '700', fontSize: 13 },
});
