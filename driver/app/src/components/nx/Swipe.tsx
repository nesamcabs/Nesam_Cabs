/* eslint-disable react-hooks/refs --
   PanResponder handlers are created once and must read live values (track width, busy flag, commit callback) through
   refs; this is the documented React Native gesture pattern, and every ref is updated in an effect, never during render. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityActionEvent, Animated, GestureResponderEvent, LayoutChangeEvent, PanResponder, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { nx } from '../../theme/nx';
import { NxIcon } from './Icon';

const KNOB = 48;
const INSET = 5;
/** Release at 96% of the track or beyond commits; anything shorter springs back (as in the reference). */
const THRESHOLD = 0.96;
/** A drag only starts if the finger lands on the knob (the reference allows the first 60px). */
const GRAB_ZONE = 60;

interface Props {
  label: string;
  /** Resolve true (or nothing) when the action succeeded; false — or a thrown error — puts the knob back. */
  onCommit: () => Promise<boolean | void>;
  disabled?: boolean;
  /** Another action is already running on the screen. */
  busy?: boolean;
}

/**
 * The reference's slide-to-confirm control, built from PanResponder + Animated. TalkBack / VoiceOver users get an
 * "activate" action on the same element, so the gesture is never the only way in.
 */
export function NxSwipe({ label, onCommit, disabled = false, busy = false }: Props) {
  const [x] = useState(() => new Animated.Value(0));
  const [trackWidth, setTrackWidth] = useState(0);
  const [complete, setComplete] = useState(false);
  const travel = Math.max(0, trackWidth - KNOB - INSET * 2);

  // The responder is created once, so everything it reads lives in refs.
  const live = useRef({ travel, inactive: disabled || busy, running: false, commit: onCommit, grabbed: false, pos: 0 });
  useEffect(() => {
    live.current.travel = travel;
    live.current.inactive = disabled || busy;
    live.current.commit = onCommit;
  });

  const back = () => {
    live.current.pos = 0;
    Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
  };

  const run = async () => {
    const s = live.current;
    if (s.running || s.inactive) return;
    s.running = true;
    setComplete(true);
    Animated.timing(x, { toValue: s.travel, duration: 90, useNativeDriver: true }).start();
    let ok = false;
    try {
      ok = (await s.commit()) !== false;
    } catch {
      ok = false;
    }
    if (!ok) {
      s.running = false;
      setComplete(false);
      back();
    }
    // On success the screen moves on (or re-renders this control) — the knob stays down meanwhile.
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (e: GestureResponderEvent) => !live.current.inactive && !live.current.running && e.nativeEvent.locationX <= GRAB_ZONE + INSET,
        onMoveShouldSetPanResponder: () => live.current.grabbed,
        onPanResponderGrant: () => {
          live.current.grabbed = true;
        },
        onPanResponderMove: (_e, g) => {
          const s = live.current;
          if (!s.grabbed || s.running || s.inactive) return;
          const v = Math.min(Math.max(g.dx, 0), s.travel);
          s.pos = v;
          x.setValue(v);
        },
        onPanResponderRelease: () => {
          const s = live.current;
          s.grabbed = false;
          if (s.running || s.inactive) return;
          if (s.travel > 0 && s.pos / s.travel >= THRESHOLD) void run();
          else back();
        },
        onPanResponderTerminate: () => {
          live.current.grabbed = false;
          if (!live.current.running) back();
        },
        onPanResponderTerminationRequest: () => false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);
  const inactive = disabled || busy;
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'activate') void run();
  };

  return (
    <View
      onLayout={onLayout}
      style={[styles.track, complete && styles.trackDone, inactive && !complete && styles.trackOff]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityHint="Drag the knob to the end, or double tap to confirm."
      accessibilityState={{ disabled: inactive, busy }}
      accessibilityActions={[{ name: 'activate', label }]}
      onAccessibilityAction={onAction}
      {...responder.panHandlers}
    >
      {/* The fill is a full-width bar slid in from the left with the knob (translateX only — width cannot use the native driver). */}
      <Animated.View style={[styles.fill, complete && styles.fillDone, { width: trackWidth, left: KNOB + INSET * 2 - trackWidth, transform: [{ translateX: x }] }]} pointerEvents="none" />
      <Text style={[styles.label, complete && { color: nx.green }, inactive && !complete && { color: '#E6A1A9' }]} pointerEvents="none">
        {complete ? 'Working…' : label}
      </Text>
      <Animated.View style={[styles.knob, complete && styles.knobDone, inactive && !complete && styles.knobOff, { transform: [{ translateX: x }] }]} pointerEvents="none">
        <NxIcon name={complete ? 'check' : 'chevron'} size={22} color={nx.white} />
      </Animated.View>
    </View>
  );
}

/** Spoken hint for screens that show a swipe: the reference keeps this as screen-reader-only text. */
export const SWIPE_HELP = 'Drag right to confirm, or double tap the slider.';

const styles = StyleSheet.create({
  track: { height: 58, borderRadius: 14, backgroundColor: nx.redSoft, marginTop: 19, justifyContent: 'center', overflow: 'hidden' },
  trackDone: { backgroundColor: nx.greenSoft },
  trackOff: { opacity: 0.7 },
  fill: { position: 'absolute', top: 0, bottom: 0, backgroundColor: '#FFE0E4', borderRadius: 14 },
  fillDone: { backgroundColor: '#D5EFE0' },
  label: { textAlign: 'center', fontSize: 12.5, fontWeight: '700', color: nx.tripRed, paddingLeft: KNOB, paddingRight: 8 },
  knob: { position: 'absolute', left: INSET, top: INSET, width: KNOB, height: KNOB, borderRadius: 11, backgroundColor: nx.tripRed, alignItems: 'center', justifyContent: 'center', shadowColor: nx.tripRed, shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  knobDone: { backgroundColor: nx.green },
  knobOff: { backgroundColor: '#E8A3AB' },
});
