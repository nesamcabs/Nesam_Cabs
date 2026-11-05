// Whether the vendor tapped "Login" or "Apply". A Login with a number that
// has no vendor application shows a notice at the top of the onboarding
// wizard. Kept in memory (the Web used sessionStorage).
export type AuthIntent = 'login' | 'signup';

let intent: AuthIntent | null = null;

export function setAuthIntent(v: AuthIntent): void {
  intent = v;
}

export function getAuthIntent(): AuthIntent | null {
  return intent;
}
