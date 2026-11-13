// This user's notifications and penalties, subscribed once per session.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { PartnerNotification, PartnerPenalty } from '../types/notifications';
import { subscribeToNotifications, subscribeToPenalties } from '../services/partnerNotifications';
import { registerForPush } from '../services/notificationService';

interface InboxValue {
  notifications: PartnerNotification[];
  penalties: PartnerPenalty[];
  unreadCount: number;
  /** Penalties not yet acknowledged or disputed. */
  unacknowledged: PartnerPenalty[];
}

const Ctx = createContext<InboxValue | null>(null);

export function useInbox(): InboxValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('InboxProvider is missing');
  return v;
}

/**
 * This is the rider app: it reads only the rider inbox (every site's notifications — the trips list shows every site's
 * bookings too) and registers its push token as a rider device.
 */
export function InboxProvider({ userId, role, penaltyField, children }: { userId: string; role: 'customer'; penaltyField?: 'driverId' | 'vendorId'; children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<PartnerNotification[]>([]);
  const [penalties, setPenalties] = useState<PartnerPenalty[]>([]);

  // No user id means a guest browsing the booking form: nothing to read.
  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      return undefined;
    }
    return subscribeToNotifications(userId, setNotifications);
  }, [userId]);
  useEffect(() => (userId && penaltyField ? subscribeToPenalties(penaltyField, userId, setPenalties) : undefined), [userId, penaltyField]);
  useEffect(() => {
    if (userId) void registerForPush(userId, role);
  }, [userId, role]);

  const value = useMemo<InboxValue>(
    () => ({
      notifications,
      penalties,
      unreadCount: notifications.filter((n) => !n.read).length,
      unacknowledged: penalties.filter((p) => p.status === 'Pending' && !p.acknowledged),
    }),
    [notifications, penalties],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
