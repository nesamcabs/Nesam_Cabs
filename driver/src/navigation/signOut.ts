// The sign-out action shared with the pages. Kept apart from MainNavigator so ProfileScreen can read it without a require cycle.
import { createContext, useContext } from 'react';

export const SignOutCtx = createContext<() => void>(() => undefined);
export const useSignOut = () => useContext(SignOutCtx);
