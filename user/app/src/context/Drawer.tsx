// The side menu's open state, shared by every header's hamburger button (the website's header menu button).
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface DrawerValue {
  open: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const Ctx = createContext<DrawerValue | null>(null);

/** Null outside the signed-in app (sign-in screens have no side menu). */
export function useDrawer(): DrawerValue | null {
  return useContext(Ctx);
}

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openDrawer = useCallback(() => setOpen(true), []);
  const closeDrawer = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, openDrawer, closeDrawer }), [open, openDrawer, closeDrawer]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
