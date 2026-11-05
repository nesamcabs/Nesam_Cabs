// Rides the rider minimised this session are not re-opened automatically.
const dismissed = new Set<string>();

export const markRideDismissed = (id: string) => void dismissed.add(id);
export const unmarkRideDismissed = (id: string) => void dismissed.delete(id);
export const isRideDismissed = (id: string) => dismissed.has(id);
