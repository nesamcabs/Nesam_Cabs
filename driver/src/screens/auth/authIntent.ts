// Whether the driver tapped "Login" or "Sign Up". Decides whether a number
// with no driver account goes straight to registration or to the "no account
// found" screen. Kept in memory (the Web used local state).
export type AuthIntent = 'login' | 'signup';

let intent: AuthIntent | null = null;

export function setAuthIntent(v: AuthIntent): void {
  intent = v;
}

export function getAuthIntent(): AuthIntent | null {
  return intent;
}
