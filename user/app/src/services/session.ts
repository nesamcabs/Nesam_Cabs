// Sign-in session helpers shared by the app and the website (no React Native imports: the website builds this file too).
import { signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '../config/firebase';

// A stored sign-in whose refresh token the server no longer accepts (revoked, user disabled or removed, key from another
// project) makes the token endpoint answer 400 on every attempt. Such a session can never work again: it is cleared, and the
// customer carries on signed out (guest) instead of every request failing. A network failure is NOT a dead session.
const DEAD_SESSION_CODES = new Set([
  'auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-disabled', 'auth/user-not-found',
  'auth/id-token-revoked', 'auth/invalid-credential', 'auth/requires-recent-login',
]);
export const isDeadSessionError = (error: unknown): boolean => DEAD_SESSION_CODES.has((error as { code?: string } | null)?.code ?? '');

/** The signed-in user's ID token, or '' when there is no user or the stored session was dead (it is cleared on the way). */
export async function currentIdToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) return '';
  try {
    return await user.getIdToken();
  } catch (error) {
    if (!isDeadSessionError(error)) throw error;
    await firebaseSignOut(auth).catch(() => undefined);
    return '';
  }
}
