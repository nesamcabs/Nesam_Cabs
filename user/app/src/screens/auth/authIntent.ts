// Whether the rider tapped "Login" or "Sign Up" — only changes wording on the
// profile-setup screen. Kept in memory (the Web used sessionStorage).
export type AuthIntent = 'login' | 'signup';

let intent: AuthIntent | null = null;

export function setAuthIntent(v: AuthIntent): void {
  intent = v;
}

export function getAuthIntent(): AuthIntent | null {
  return intent;
}
