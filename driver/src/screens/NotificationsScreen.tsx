// Notifications inbox (reference "Driver updates"): trips, approvals, payments and penalties from NESAM, with category
// filters. Opening one marks it read and goes to the page it is about.
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Text } from '../components/nx/Text';
import { useDriverData } from '../context/DriverData';
import { NxScreen } from '../components/nx/Shell';
import { NxIcon, type NxIconName } from '../components/nx/Icon';
import { NxBackLink, NxBadge, NxEmpty, NxPanel, NxPills, NxTextButton, isHovered } from '../components/nx/primitives';
import { markNotificationRead, markNotificationsRead } from '../services/driverService';
import { goTab } from '../navigation/navItems';
import { openNotificationTarget } from '../navigation/openNotification';
import { CATEGORIES, CATEGORY_LABEL, TONE_COLORS, toneOf } from '../utils/notificationModel';
import type { DriverNotification, NotificationCategory } from '../types/driver';
import { nx } from '../theme/nx';

const CATEGORY_ICON: Record<NotificationCategory, NxIconName> = { bookings: 'trip', approvals: 'shield', trips: 'car', payments: 'wallet', penalties: 'alert', general: 'bell' };

export function NotificationsScreen() {
  const navigation = useNavigation();
  const { notifications, account } = useDriverData();
  const fleet = !!account.driver.vendorId;
  const [filter, setFilter] = useState<NotificationCategory | 'all'>('all');
  const shown = filter === 'all' ? notifications : notifications.filter((n) => n.category === filter);
  const unread = (c: NotificationCategory | 'all') => notifications.filter((n) => !n.read && (c === 'all' || n.category === c)).length;
  const back = () => (navigation.canGoBack() ? navigation.goBack() : goTab('Home'));

  const open = (n: DriverNotification) => {
    if (!n.read) markNotificationRead(n.id).catch(() => undefined);
    // A notice that points nowhere else is read right here.
    if (!n.ctaPage || n.ctaPage === 'notifications') return;
    openNotificationTarget(n.ctaPage, { tripId: n.bookingId || undefined, fleet });
  };

  const markAll = () => markNotificationsRead(notifications.filter((n) => !n.read).map((n) => n.id)).catch(() => undefined);

  return (
    <NxScreen maxWidth={860}>
      <View style={styles.toolbar}>
        <NxBackLink label="Back" onPress={back} />
        {unread('all') > 0 ? <NxTextButton title="Mark all as read" icon="check" onPress={markAll} /> : null}
      </View>
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
        <NxPanel style={{ paddingVertical: 6, paddingHorizontal: 20 }}>
          {shown.map((n, i) => {
            const tone = TONE_COLORS[toneOf(n)];
            return (
              <Pressable
                key={n.id}
                style={(s) => [styles.item, i === shown.length - 1 && { borderBottomWidth: 0 }, isHovered(s) && { backgroundColor: '#FAFBFC' }]}
                onPress={() => open(n)}
                accessibilityRole="button"
                accessibilityLabel={`${n.title}. ${n.message}${n.read ? '' : '. Unread'}`}
              >
                <View style={[styles.icon, { backgroundColor: n.read ? nx.page : nx.redSoft }]}>
                  <NxIcon name={CATEGORY_ICON[n.category]} size={18} color={n.read ? nx.muted : nx.red} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.title, n.read && { fontWeight: '500' }]}>{n.title}</Text>
                    {!n.read ? <View style={[styles.dot, { backgroundColor: tone.bar }]} /> : null}
                    {n.severity === 'critical' || n.severity === 'warning' ? <NxBadge label={n.severity === 'critical' ? 'Urgent' : 'Warning'} tone={n.severity === 'critical' ? 'red' : 'amber'} /> : null}
                  </View>
                  {n.message ? <Text style={styles.message}>{n.message}</Text> : null}
                  <Text style={styles.meta}>
                    {CATEGORY_LABEL[n.category]} · {n.time}
                    {n.bookingCode || n.bookingId ? ` · Ref ${n.bookingCode || n.bookingId}` : ''}
                  </Text>
                </View>
                {n.ctaLabel ? <NxIcon name="chevron" size={15} color={nx.muted} /> : null}
              </Pressable>
            );
          })}
        </NxPanel>
      )}
    </NxScreen>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  icon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  title: { flexShrink: 1, fontSize: 13, fontWeight: '700', color: nx.ink },
  dot: { width: 8, height: 8, borderRadius: 4 },
  message: { fontSize: 12, lineHeight: 19, color: nx.muted },
  meta: { fontSize: 10.5, color: '#9CA1AB', marginTop: 6 },
});
