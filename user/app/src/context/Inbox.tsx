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

export function InboxProvider({ userId, role, penaltyField, children }: { userId: string; role: 'driver' | 'vendor' | 'customer'; penaltyField?: 'driverId' | 'vendorId'; children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<PartnerNotification[]>([]);
  const [penalties, setPenalties] = useState<PartnerPenalty[]>([]);

  useEffect(() => subscribeToNotifications(userId, setNotifications, { role }), [userId, role]);
  useEffect(() => (penaltyField ? subscribeToPenalties(penaltyField, userId, setPenalties) : undefined), [userId, penaltyField]);
  useEffect(() => {
    void registerForPush(userId, role);
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
