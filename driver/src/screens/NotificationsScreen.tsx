// Notifications inbox: trips, approvals, payments and penalties from NESAM, with category filters, grouped by day. Each
// notice is a card in its category colour; a trip offer shows its route and payout apart from the other details. Opening
// one marks it read and goes to the page it is about.
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Text } from '../components/nx/Text';
import { useDriverData } from '../context/DriverData';
import { NxScreen } from '../components/nx/Shell';
import { NxIcon, type NxIconName } from '../components/nx/Icon';
import { NxBackLink, NxBadge, NxEmpty, NxPills, NxTextButton, isHovered } from '../components/nx/primitives';
import { useNow } from '../hooks/useNow';
import { markNotificationRead, markNotificationsRead } from '../services/driverService';
import { goTab } from '../navigation/navItems';
import { openNotificationTarget } from '../navigation/openNotification';
import { CATEGORIES, CATEGORY_LABEL, TONE_COLORS, toneOf } from '../utils/notificationModel';
import { formatTime12 } from '../utils/time';
import type { DriverNotification, NotificationCategory } from '../types/driver';
import { nx } from '../theme/nx';

const CATEGORY_ICON: Record<NotificationCategory, NxIconName> = { bookings: 'trip', approvals: 'shield', trips: 'car', payments: 'wallet', penalties: 'alert', general: 'bell' };

type Period = 'Today' | 'Yesterday' | 'Earlier';
const PERIODS: Period[] = ['Today', 'Yesterday', 'Earlier'];
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function periodOf(ms: number, now: number): Period {
  if (!ms) return 'Earlier';
  if (dayKey(ms) === dayKey(now)) return 'Today';
  return dayKey(ms) === dayKey(now - 24 * 3600000) ? 'Yesterday' : 'Earlier';
}

/** A trip offer reads "Pickup → Drop · when · vehicle · payout ₹X"; any other message is shown as written. */
const OFFER = /^(.+? → .+?) · (.+) · payout (₹[\d,.]+)$/;

export function NotificationsScreen() {
  const navigation = useNavigation();
  const { notifications, account } = useDriverData();
  const fleet = !!account.driver.vendorId;
  const now = useNow(60000);
  const [filter, setFilter] = useState<NotificationCategory | 'all'>('all');
  const shown = filter === 'all' ? notifications : notifications.filter((n) => n.category === filter);
  const unread = (c: NotificationCategory | 'all') => notifications.filter((n) => !n.read && (c === 'all' || n.category === c)).length;
  const total = unread('all');
  const back = () => (navigation.canGoBack() ? navigation.goBack() : goTab('Home'));

  const open = (n: DriverNotification) => {
    if (!n.read) markNotificationRead(n.id).catch(() => undefined);
    // A notice that points nowhere else is read right here.
    if (!n.ctaPage || n.ctaPage === 'notifications') return;
    openNotificationTarget(n.ctaPage, { tripId: n.bookingId || undefined, fleet });
  };

  const markAll = () => markNotificationsRead(notifications.filter((n) => !n.read).map((n) => n.id)).catch(() => undefined);

  const groups = PERIODS.map((period) => ({ period, items: shown.filter((n) => periodOf(n.createdAtMs, now) === period) })).filter((g) => g.items.length > 0);

  return (
    <NxScreen maxWidth={860}>
      <NxBackLink label="Back" onPress={back} />
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.heading} accessibilityRole="header">Notifications</Text>
          <Text style={styles.summary}>{total ? `${total} unread ${total === 1 ? 'update' : 'updates'}` : 'No unread updates'}</Text>
        </View>
        {total > 0 ? <NxTextButton title="Mark all as read" icon="check" onPress={markAll} /> : null}
      </View>
      <NxPills<NotificationCategory | 'all'>
        scroll
        style={{ marginBottom: 14 }}
        label="Notification categories"
        value={filter}
        onChange={setFilter}
        options={(['all', ...CATEGORIES] as const).map((c) => ({ value: c, label: `${c === 'all' ? 'All' : CATEGORY_LABEL[c]}${unread(c) ? ` (${unread(c)})` : ''}` }))}
      />
      {shown.length === 0 ? (
        <NxEmpty icon="bell" title="No notifications" message="Updates on trips, payments, approvals and penalties from NESAM will appear here." />
      ) : (
        groups.map((g) => (
          <View key={g.period} style={styles.group}>
            <View style={styles.groupHead}>
              <Text style={styles.groupTitle} accessibilityRole="header">{g.period}</Text>
              <View style={styles.groupRule} />
            </View>
            {g.items.map((n) => (
              <NoticeCard key={n.id} n={n} time={g.period !== 'Earlier' ? formatTime12(new Date(n.createdAtMs)) : n.time} onPress={() => open(n)} />
            ))}
          </View>
        ))
      )}
    </NxScreen>
  );
}

function NoticeCard({ n, time, onPress }: { n: DriverNotification; time: string; onPress: () => void }) {
  const name = toneOf(n);
  const tone = TONE_COLORS[name];
  const offer = OFFER.exec(n.message);
  const ref = n.bookingCode || n.bookingId;
  const action = n.ctaLabel && n.ctaPage !== 'notifications' ? n.ctaLabel : '';
  const urgency = n.severity === 'critical' ? 'Urgent' : n.severity === 'warning' ? 'Important' : '';
  return (
    <Pressable
      style={(s) => [styles.card, !n.read && styles.cardUnread, isHovered(s) && styles.cardHover, s.pressed && { opacity: 0.92 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${n.title}. ${n.message}${n.read ? '' : '. Unread'}`}
    >
      <View style={[styles.accent, { backgroundColor: n.read ? nx.line : tone.bar }]} />
      <View style={styles.body}>
        <View style={styles.top}>
          <View style={[styles.icon, { backgroundColor: n.read || name === 'neutral' ? nx.page : tone.bg }]}>
            <NxIcon name={CATEGORY_ICON[n.category]} size={14} color={n.read ? nx.muted : tone.bar} />
          </View>
          <Text style={[styles.category, !n.read && { color: tone.text }]} numberOfLines={1}>{CATEGORY_LABEL[n.category]}</Text>
          {urgency ? <NxBadge label={urgency} tone={n.severity === 'critical' ? 'red' : 'amber'} /> : null}
          <Text style={styles.time} numberOfLines={1}>{time}</Text>
        </View>

        <View style={styles.titleRow}>
          <Text style={[styles.title, n.read && styles.titleRead]}>{n.title}</Text>
          {!n.read ? <View style={[styles.dot, { backgroundColor: tone.bar }]} /> : null}
        </View>

        {offer ? (
          <>
            <Text style={styles.route}>{offer[1]}</Text>
            <Text style={styles.message}>{offer[2]}</Text>
            <View style={styles.payout}>
              <Text style={styles.payoutLabel}>Payout</Text>
              <Text style={styles.payoutValue}>{offer[3]}</Text>
            </View>
          </>
        ) : n.message ? (
          <Text style={styles.message}>{n.message}</Text>
        ) : null}

        {ref || action ? (
          <View style={styles.foot}>
            <Text style={styles.ref} numberOfLines={1}>{ref ? `Ref. ${ref}` : ''}</Text>
            {action ? (
              <View style={styles.action}>
                <Text style={styles.actionText}>{action}</Text>
                <NxIcon name="chevron" size={13} color={nx.red} />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
  heading: { fontSize: 20, fontWeight: '700', letterSpacing: -0.5, color: nx.ink },
  summary: { fontSize: 12, color: nx.muted, marginTop: 2 },
  group: { marginBottom: 8 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  groupTitle: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: nx.muted },
  groupRule: { flex: 1, height: 1, backgroundColor: nx.line },
  card: { flexDirection: 'row', backgroundColor: nx.white, borderWidth: 1, borderColor: nx.line, borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  cardUnread: { borderColor: '#DADFE7' },
  cardHover: { borderColor: '#C9CFDA' },
  accent: { width: 4 },
  body: { flex: 1, minWidth: 0, paddingVertical: 12, paddingHorizontal: 14 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  category: { flexShrink: 1, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: nx.muted },
  time: { marginLeft: 'auto', flexShrink: 0, fontSize: 11, color: nx.muted },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 9 },
  title: { flexShrink: 1, fontSize: 14, fontWeight: '700', letterSpacing: -0.2, color: nx.ink },
  titleRead: { fontWeight: '600', color: nx.text },
  dot: { width: 7, height: 7, borderRadius: 4 },
  route: { fontSize: 13, fontWeight: '600', lineHeight: 19, color: nx.ink, marginTop: 5 },
  message: { fontSize: 12, lineHeight: 18, color: nx.muted, marginTop: 3 },
  payout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 8, backgroundColor: nx.page },
  payoutLabel: { fontSize: 11.5, fontWeight: '600', color: nx.muted },
  payoutValue: { fontSize: 16, fontWeight: '700', letterSpacing: -0.3, color: nx.ink },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, paddingTop: 9, borderTopWidth: 1, borderTopColor: nx.lineSoft },
  ref: { flex: 1, minWidth: 0, fontSize: 11, color: nx.muted },
  action: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  actionText: { fontSize: 12, fontWeight: '700', color: nx.red },
});
