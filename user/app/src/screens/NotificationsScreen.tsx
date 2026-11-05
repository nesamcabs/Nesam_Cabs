import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FlatList, ScrollView } from '../components/layout';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import { useNavigation } from '@react-navigation/native';
import { useInbox } from '../context/Inbox';
import { EmptyState, Notice, TextButton } from '../components/ui';
import { AppHeader } from '../components/brand';
import { markAllNotificationsRead, markNotificationRead } from '../services/userService';
import { CATEGORIES, CATEGORY_LABEL, TONE_COLORS, toneOf } from '../utils/notificationModel';
import type { NotificationCategory } from '../types/notifications';
import { describeError } from '../utils/retry';
import { colors, fonts, space } from '../theme';

export function NotificationsScreen() {
  const navigation = useNavigation();
  const { notifications } = useInbox();
  const [filter, setFilter] = useState<NotificationCategory | 'all'>('all');
  const [error, setError] = useState('');
  const unread = notifications.filter((n) => !n.read);
  // Only categories that have something in them, so the bar stays short.
  const tabs = (['all', ...CATEGORIES] as const).filter((c) => c === 'all' || c === filter || notifications.some((n) => n.category === c));
  const shown = filter === 'all' ? notifications : notifications.filter((n) => n.category === filter);

  const markAll = async () => {
    setError('');
    try {
      await markAllNotificationsRead(unread.map((n) => n.id));
    } catch (e) {
      setError(describeError(e, 'Couldn’t update notifications.'));
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
<KeyboardAvoid>
      <AppHeader
        title="Notifications"
        active="alerts"
        rightAction={unread.length > 0 ? <TextButton title="Mark all read" icon="check-check" size={11} onPress={() => void markAll()} /> : undefined}
      />
      <View style={styles.container}>
        <View style={styles.head}>
          {tabs.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={{ flexGrow: 0 }}>
              {tabs.map((c) => {
                const count = (c === 'all' ? unread : unread.filter((n) => n.category === c)).length;
                const active = filter === c;
                return (
                  <Pressable key={c} onPress={() => setFilter(c)} style={[styles.tab, active && styles.tabOn]} accessibilityRole="button" accessibilityState={{ selected: active }}>
                    <Text style={[styles.tabText, active && styles.tabTextOn]}>
                      {c === 'all' ? 'All' : CATEGORY_LABEL[c]}
                      {count ? ` · ${count}` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
        </View>

        <FlatList
          data={shown}
          kind="narrow"
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.xxl }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={<Notice message={error} />}
          ListEmptyComponent={<EmptyState icon="bell" title="No notifications yet" message="Your trip updates will appear here." />}
          renderItem={({ item: n }) => {
            const tone = TONE_COLORS[toneOf(n)];
            return (
              <Pressable
                onPress={() => {
                  if (!n.read) markNotificationRead(n.id).catch(() => undefined);
                }}
                style={({ pressed }) => [styles.item, !n.read && { borderColor: tone.border, backgroundColor: tone.bg }, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel={`${n.read ? '' : 'Unread. '}${n.title}. ${n.message}`}
                accessibilityHint={n.read ? undefined : 'Marks as read'}
              >
                <View style={[styles.dot, { backgroundColor: n.read ? '#D5DAE1' : tone.bar }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.cat, !n.read && { color: tone.text }]}>{CATEGORY_LABEL[n.category]}</Text>
                  <View style={styles.titleRow}>
                    <Text style={styles.itemTitle}>{n.title}</Text>
                    <Text style={styles.timeText}>{n.time}</Text>
                  </View>
                  <Text style={styles.itemMessage}>{n.message}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      </View>
    </KeyboardAvoid>
</SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  container: { flex: 1 },
  head: { paddingHorizontal: space.xl, paddingTop: space.md, width: '100%', maxWidth: 780, alignSelf: 'center' },
  tabs: { gap: 8, paddingBottom: 4 },
  tab: { paddingHorizontal: 13, minHeight: 34, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#E3E7EC', backgroundColor: colors.white },
  tabOn: { backgroundColor: '#FFF1F1', borderColor: '#F3C3C3' },
  tabText: { fontFamily: fonts.medium, fontSize: 11.5, color: colors.text },
  tabTextOn: { color: colors.primary },
  item: { flexDirection: 'row', gap: 12, borderRadius: 10, borderWidth: 1, borderColor: '#E3E7EC', padding: 14, marginBottom: 10, backgroundColor: colors.white },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  cat: { fontFamily: fonts.medium, fontSize: 10, color: '#7A8494', marginBottom: 3, letterSpacing: 0.4, textTransform: 'uppercase' },
  titleRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  itemTitle: { fontFamily: fonts.semiBold, fontSize: 13.5, lineHeight: 19, color: colors.ink, flex: 1 },
  timeText: { fontFamily: fonts.regular, fontSize: 10.5, color: '#7A8494' },
  itemMessage: { fontFamily: fonts.regular, marginTop: 4, color: '#55606F', fontSize: 12, lineHeight: 18 },
});
