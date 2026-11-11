import { bottomClearance } from '../src/utils/keyboardAvoid';

// A 2400px-high window (here in dp: 800) with a 24dp gesture/navigation area and a 300dp keyboard above it.
const windowHeight = 800;
const insetBottom = 24;

describe('bottomClearance', () => {
  it('stack screen at rest: clears the navigation bar', () => {
    expect(bottomClearance({ viewBottom: 800, windowHeight, insetBottom, keyboardHeight: 0 })).toBe(24);
  });

  it('tab screen at rest: the tab bar already clears the bar, so nothing is added', () => {
    expect(bottomClearance({ viewBottom: 800 - 80, windowHeight, insetBottom, keyboardHeight: 0 })).toBe(0);
  });

  it('keyboard open on a stack screen: lifts by the keyboard only (it already covers the bar)', () => {
    expect(bottomClearance({ viewBottom: 800, windowHeight, insetBottom, keyboardHeight: 300 })).toBe(324);
  });

  it('content that already ends above the bar by its own inset needs only the keyboard height', () => {
    // inside a SafeAreaView(bottom) the container's bottom edge is 24dp above the window bottom
    expect(bottomClearance({ viewBottom: 776, windowHeight, insetBottom, keyboardHeight: 300 })).toBe(300);
  });

  it('keyboard open on a tab screen with the tab bar still showing: lifts by the part the keyboard overlaps', () => {
    expect(bottomClearance({ viewBottom: 720, windowHeight, insetBottom, keyboardHeight: 300 })).toBe(244);
  });

  it('content well above the keyboard is left alone', () => {
    expect(bottomClearance({ viewBottom: 400, windowHeight, insetBottom, keyboardHeight: 300 })).toBe(0);
  });

  it('gesture navigation with no inset', () => {
    expect(bottomClearance({ viewBottom: 800, windowHeight, insetBottom: 0, keyboardHeight: 0 })).toBe(0);
    expect(bottomClearance({ viewBottom: 800, windowHeight, insetBottom: 0, keyboardHeight: 280 })).toBe(280);
  });

  it('ignores bad measurements instead of moving content off screen', () => {
    expect(bottomClearance({ viewBottom: NaN, windowHeight, insetBottom, keyboardHeight: 300 })).toBe(0);
    expect(bottomClearance({ viewBottom: 800, windowHeight: 0, insetBottom, keyboardHeight: 300 })).toBe(0);
    expect(bottomClearance({ viewBottom: 5000, windowHeight, insetBottom, keyboardHeight: 300 })).toBeLessThanOrEqual(324);
  });
});
