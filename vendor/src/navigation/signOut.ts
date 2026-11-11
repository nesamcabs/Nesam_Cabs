import { createContext, useContext } from 'react';

/** Sign-out handler supplied by the app root (App.tsx → MainNavigator). */
export const SignOutCtx = createContext<() => void>(() => undefined);
export const useSignOut = () => useContext(SignOutCtx);
