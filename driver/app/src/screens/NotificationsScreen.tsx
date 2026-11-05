// Notifications inbox (the reference shows these in a "Driver updates" dialog; the app keeps its full inbox with the
// category filters and the same mark-as-read call).
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/nx/Text';
import { useNavigation } from '@react-navigation/native';
import { useDriverData } from '../context/DriverData';
import { NxScreen } from '../components/nx/Shell';
import { NxIcon, NxIconName } from '../components/nx/Icon';
import { NxBadge, NxEmpty, NxPanel, NxPills, nxText } from '../components/nx/primitives';
import { markNotificationRead } from '../services/driverService';
import { CATEGORIES, CATEGORY_LABEL, TONE_COLORS, toneOf } from '../utils/notificationModel';
import type { NotificationCategory } from '../types/driver';
import { nx } from '../theme/nx';

const CATEGORY_ICON: Record<NotificationCategory, NxIconName> = { bookings: 'trip', approvals: 'shield', trips: 'car', payments: 'wallet', penalties: 'alert', general: 'bell' };

export function NotificationsScreen() {
  const navigation = useNavigation();
  const { notifications } = useDriverData();
  const [filter, setFilter] = useState<NotificationCategory | 'all'>('all');
  const shown = filter === 'all' ? notifications : notifications.filter((n) => n.category === filter);
  const unread = (c: NotificationCategory | 'all') => notifications.filter((n) => !n.read && (c === 'all' || n.category === c)).length;

  return (
    <NxScreen
      tabs={false}
      title="Notifications"
      subtitle="Updates & Alerts"
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Tabs', { screen: 'Home' }))}
    >
      <Text style={nxText.routeTitle}>Driver updates</Text>
      <Text style={[nxText.copy, { marginTop: 6, marginBottom: 18 }]}>Trips, approvals, payments and penalties from NESAM.</Text>
      <NxPills<NotificationCategory | 'all'>
        scroll
        label="Notification categories"
        value={filter}
        onChange={setFilter}
        options={(['all', ...CATEGORIES] as const).map((c) => ({ value: c, label: `${c === 'all' ? 'All' : CATEGORY_LABEL[c]}${unread(c) ? ` (${unread(c)})` : ''}` }))}
      />
      {shown.length === 0 ? (
        <NxEmpty icon="bell" title="No notifications" message="Trip, payment, penalty and approval updates from NESAM appear here." />
      ) : (
        <NxPanel style={{ paddingVertical: 6 }}>
          {shown.map((n) => (
            <Pressable
              key={n.id}
              style={[styles.item, { opacity: n.read ? 0.72 : 1 }]}
              onPress={() => {
                if (!n.read) markNotificationRead(n.id).catch(() => undefined);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${n.title}. ${n.message}${n.read ? '' : '. Unread, double tap to mark as read'}`}
            >
              <View style={styles.icon}>
                <NxIcon name={CATEGORY_ICON[n.category]} size={18} color={nx.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{n.title}</Text>
                  {!n.read ? <View style={[styles.dot, { backgroundColor: TONE_COLORS[toneOf(n)].bar }]} /> : null}
                  {n.severity === 'critical' || n.severity === 'warning' ? <NxBadge label={n.severity === 'critical' ? 'Urgent' : 'Warning'} tone={n.severity === 'critical' ? 'red' : 'amber'} /> : null}
                </View>
                {n.message ? <Text style={nxText.copy}>{n.message}</Text> : null}
                <Text style={[nxText.small, { marginTop: 4 }]}>
                  {CATEGORY_LABEL[n.category]} · {n.time}
                  {n.bookingCode || n.bookingId ? ` · Ref ${n.bookingCode || n.bookingId}` : ''}
                </Text>
              </View>
            </Pressable>
          ))}
        </NxPanel>
      )}
    </NxScreen>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: nx.page, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  title: { flexShrink: 1, fontSize: 13, fontWeight: '700', color: nx.ink },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: nx.red },
});
