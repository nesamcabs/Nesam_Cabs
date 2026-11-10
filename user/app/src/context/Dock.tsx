// How much of the screen's bottom edge the floating bottom bar covers, so a page can keep its last item clear of it
// (the website's `--tabbar-occupied`). Zero on pages that have no bar.
import React, { createContext, useContext } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The bar is 92px tall with a 16px gap below it (plus the gesture-bar inset) and a little breathing room above. */
export const DOCK_HEIGHT = 92 + 16;

const Ctx = createContext(0);

export const useDockPad = () => useContext(Ctx);

/** Wraps pages that sit above the floating bar. */
export function DockPadding({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <Ctx.Provider value={DOCK_HEIGHT + insets.bottom}>{children}</Ctx.Provider>;
}
