// The Local Taxi ride state machine. One table decides which transitions exist and who may make them; every
// function that changes a ride status goes through assertTransition(), so a client can never skip a step.
//
//   requested → searching → assigned → driver_arriving → driver_arrived → in_progress → completed
//   plus the outcomes cancelled, expired and no_driver_available.
//
// A driver who gives a ride back (cancel or reject after assignment) sends it to `searching` again for the next
// driver instead of cancelling the customer's trip. A customer cancelling is the only way a trip becomes `cancelled`
// before it starts, apart from staff.

export const RIDE_STATUSES = [
  'requested', 'searching', 'assigned', 'driver_arriving', 'driver_arrived', 'in_progress', 'completed', 'cancelled', 'expired', 'no_driver_available',
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];
export type Actor = 'customer' | 'driver' | 'admin' | 'system';

export const TERMINAL: readonly RideStatus[] = ['completed', 'cancelled', 'expired', 'no_driver_available'];
export const isTerminal = (s: string): boolean => (TERMINAL as readonly string[]).includes(s);
/** A driver is attached to the ride in these states. */
export const DRIVER_ATTACHED: readonly RideStatus[] = ['assigned', 'driver_arriving', 'driver_arrived', 'in_progress'];

const RULES: Record<RideStatus, Partial<Record<RideStatus, readonly Actor[]>>> = {
  requested: { searching: ['system'], expired: ['system'], cancelled: ['customer', 'admin'] },
  searching: { assigned: ['driver', 'admin'], no_driver_available: ['system', 'admin'], cancelled: ['customer', 'admin'], expired: ['system'] },
  assigned: { driver_arriving: ['driver', 'admin'], searching: ['driver', 'system', 'admin'], cancelled: ['customer', 'admin'] },
  driver_arriving: { driver_arrived: ['driver', 'admin'], searching: ['driver', 'system', 'admin'], cancelled: ['customer', 'admin'] },
  driver_arrived: { in_progress: ['driver'], searching: ['driver', 'system', 'admin'], cancelled: ['customer', 'driver', 'admin'] },
  in_progress: { completed: ['driver', 'admin'], cancelled: ['admin'] },
  completed: {},
  cancelled: {},
  expired: {},
  no_driver_available: {},
};

export function canTransition(from: string, to: string, actor: Actor): boolean {
  const row = RULES[from as RideStatus];
  const allowed = row?.[to as RideStatus];
  return !!allowed && allowed.includes(actor);
}

/** Why a transition is refused, or '' when it is allowed. Safe to show to the person who tried it. */
export function transitionProblem(from: string, to: string, actor: Actor): string {
  if (!RIDE_STATUSES.includes(from as RideStatus) || !RIDE_STATUSES.includes(to as RideStatus)) return 'Unknown ride status.';
  if (isTerminal(from)) return 'This ride has already ended.';
  const row = RULES[from as RideStatus];
  const allowed = row[to as RideStatus];
  if (!allowed) return `A ride that is ${from.replace(/_/g, ' ')} cannot move to ${to.replace(/_/g, ' ')}.`;
  if (!allowed.includes(actor)) return 'You cannot make this change to the ride.';
  return '';
}
