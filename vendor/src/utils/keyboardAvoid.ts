// How far the bottom of a screen's content has to be lifted so that nothing sits under the Android system navigation bar or
// under the on-screen keyboard.
//
// On Android 15+ (and on every Android version once the app draws edge-to-edge) the window is NOT resized when the keyboard opens,
// so `KeyboardAvoidingView` with `behavior` unset does nothing and the keyboard covers the fields. React Native reports the
// keyboard height as `ime.bottom - systemBars.bottom` (the part above the navigation bar), so the keyboard's top edge, measured
// from the top of the window, is `windowHeight - (keyboardHeight + insetBottom)`.
//
//   viewBottom      y of the bottom edge of the container, in window coordinates (View.measureInWindow)
//   windowHeight    full window height (edge-to-edge: includes the status and navigation bars)
//   insetBottom     system navigation bar / gesture area height (safe-area inset)
//   keyboardHeight  0 when the keyboard is closed
//
// The result is the larger of "clear the navigation bar" and "clear the keyboard" — the keyboard already covers the navigation
// bar, so the two must never be added together.

export interface BottomClearanceInput {
  viewBottom: number;
  windowHeight: number;
  insetBottom: number;
  keyboardHeight: number;
  /**
   * Physical screen height. The keyboard's top edge is measured from the screen, not from the window: a window that Android
   * has already shrunk for the keyboard (adjustResize) must not be lifted a second time. Defaults to the window height.
   */
  screenHeight?: number;
  /** The content already pads for the navigation bar itself (e.g. a bottom sheet's safe-area padding): lift for the keyboard only. */
  keyboardOnly?: boolean;
}

export function bottomClearance({ viewBottom, windowHeight, insetBottom, keyboardHeight, screenHeight, keyboardOnly }: BottomClearanceInput): number {
  if (![viewBottom, windowHeight, insetBottom, keyboardHeight].every(Number.isFinite) || windowHeight <= 0) return 0;
  const screen = screenHeight !== undefined && Number.isFinite(screenHeight) && screenHeight > 0 ? screenHeight : windowHeight;
  const gapToWindowBottom = Math.max(0, windowHeight - viewBottom);
  // With the keyboard open it covers the navigation bar, so only the keyboard matters.
  const underBars = keyboardHeight > 0 || keyboardOnly ? 0 : Math.max(0, insetBottom - gapToWindowBottom);
  const keyboardTop = screen - (keyboardHeight + insetBottom);
  const underKeyboard = keyboardHeight > 0 ? Math.max(0, viewBottom - keyboardTop) : 0;
  const clearance = Math.max(underBars, underKeyboard);
  // Never lift by more than the keyboard plus the bar: a bad measurement must not push the form off screen.
  return Math.round(Math.min(clearance, Math.max(0, keyboardHeight) + Math.max(0, insetBottom)));
}
