// The five customer milestones of a booking, driven only by its real status and trip stage:
// Booking Confirmed → Driver Assigned → Driver Arrived → Trip Started → Trip Completed.
// "Confirmed" means NESAM approved the request; before that the first step says it is awaiting
// review. "Driver on the way" is shown inside Driver Assigned (no separate milestone).
import type { TripRecord } from '@core/types';

export type MilestoneState = 'done' | 'current' | 'todo';
export interface Milestone {
  key: 'confirmed' | 'assigned' | 'arrived' | 'started' | 'completed';
  label: string;
  state: MilestoneState;
  detail: string;
  at: Date | null;
}

const RANK: Record<TripRecord['phase'], number> = {
  awaiting_review: 0,
  arranging: 1,
  partner_confirmed: 1,
  driver_assigned: 2,
  driver_en_route: 2,
  driver_arrived: 3,
  in_trip: 4,
  completed: 5,
  cancelled: -1,
};

type Input = Pick<TripRecord, 'phase' | 'status' | 'approvedAt' | 'assignedAt' | 'startedAt' | 'completedAt' | 'driver'>;

export function milestones(t: Input): Milestone[] {
  const rank = t.status === 'Pending' ? 0 : RANK[t.phase];
  const steps: { key: Milestone['key']; label: string; need: number; at: Date | null }[] = [
    { key: 'confirmed', label: 'Booking Confirmed', need: 1, at: t.approvedAt ?? null },
    { key: 'assigned', label: 'Driver Assigned', need: 2, at: t.assignedAt ?? null },
    { key: 'arrived', label: 'Driver Arrived', need: 3, at: null },
    { key: 'started', label: 'Trip Started', need: 4, at: t.startedAt ?? null },
    { key: 'completed', label: 'Trip Completed', need: 5, at: t.completedAt ?? null },
  ];
  const firstOpen = steps.findIndex((s) => rank < s.need);
  return steps.map((s, i) => {
    const state: MilestoneState = rank >= s.need ? 'done' : i === firstOpen ? 'current' : 'todo';
    let detail = '';
    if (s.key === 'confirmed' && state !== 'done') detail = 'Awaiting NESAM review';
    if (s.key === 'assigned') {
      if (state === 'done') detail = t.driver?.name ? `${t.driver.name}${t.driver.vehicleNumber ? ` · ${t.driver.vehicleNumber}` : ''}` : '';
      else if (state === 'current') detail = t.phase === 'partner_confirmed' ? 'Vendor assigned — driver details pending' : 'NESAM is arranging your vehicle';
    }
    if (s.key === 'arrived' && state === 'current' && t.phase === 'driver_en_route') detail = 'Your driver is on the way';
    if (s.key === 'started' && state === 'current' && t.phase === 'driver_arrived') detail = 'Share your boarding OTP with the driver';
    return { key: s.key, label: s.label, state, detail, at: s.at };
  });
}
