// The rides the rider minimised this session (not re-opened automatically). It lives in its own module, not in
// MainNavigator, so the screens that read it do not import the navigator that imports them (a require cycle).
import { createContext, useContext } from 'react';

export interface RideFocus {
  dismiss: (bookingId: string) => void;
  undismiss: (bookingId: string) => void;
}
export const RideFocusCtx = createContext<RideFocus>({ dismiss: () => undefined, undismiss: () => undefined });
export const useRideFocus = () => useContext(RideFocusCtx);
