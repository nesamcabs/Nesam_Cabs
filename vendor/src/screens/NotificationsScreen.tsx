import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useInbox } from '../context/Inbox';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import { EmptyState } from '../components/ui';
import { markNotificationRead } from '../services/partnerNotifications';
import { CATEGORIES, CATEGORY_LABEL, TONE_COLORS, toneOf } from '../utils/notificationModel';
import type { NotificationCategory } from '../types/notifications';
import { colors, radius, space, type } from '../theme';

export function NotificationsScreen() {
  const { notifications } = useInbox();
  const [filter, setFilter] = useState<NotificationCategory | 'all'>('all');
  const shown = filter === 'all' ? notifications : notifications.filter((n) => n.category === filter);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoid>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {(['all', ...CATEGORIES] as const).map((c) => {
            const count = c === 'all' ? notifications.filter((n) => !n.read).length : notifications.filter((n) => n.category === c && !n.read).length;
            const active = filter === c;
            return (
              <Pressable key={c} onPress={() => setFilter(c)} style={[styles.tab, active && styles.tabOn]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <Text style={[styles.tabText, active && { color: colors.white }]}>
                  {c === 'all' ? 'All' : CATEGORY_LABEL[c]}
                  {count ? ` (${count})` : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <FlatList
        data={shown}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: space.lg }}
        ListEmptyComponent={<EmptyState title="No notifications" message="Trip, payment, penalty and approval updates from NESAM appear here." />}
        renderItem={({ item: n }) => {
          const tone = TONE_COLORS[toneOf(n)];
          return (
            <Pressable
              onPress={() => {
                if (!n.read) markNotificationRead(n.id).catch(() => undefined);
              }}
              style={[styles.item, { borderColor: n.read ? colors.border : tone.border, backgroundColor: n.read ? '#FAFAFA' : tone.bg }]}
              accessibilityRole="button"
            >
              <View style={[styles.dot, { backgroundColor: n.read ? colors.border : tone.bar }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cat}>{CATEGORY_LABEL[n.category].toUpperCase()}</Text>
                <Text style={type.h3}>{n.title}</Text>
                <Text style={[type.small, { marginTop: 2 }]}>{n.message}</Text>
                <Text style={[type.tiny, { marginTop: 4 }]}>{n.time}</Text>
              </View>
            </Pressable>
          );
        }}
      />
      </KeyboardAvoid>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm },
  tab: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontSize: 13, fontWeight: '700', color: colors.text },
  item: { flexDirection: 'row', gap: space.md, borderRadius: radius.lg, borderWidth: 1, padding: space.md, marginBottom: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  cat: { fontSize: 10, fontWeight: '800', color: colors.muted, marginBottom: 2 },
});
