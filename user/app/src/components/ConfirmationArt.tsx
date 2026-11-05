// The booking-confirmed illustration from the reference: a red cab driving along a dotted route
// to a green seal. Animated once (cab slides in, seal pops, ripple); static when the user prefers
// reduced motion.
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

const W = 260;
const H = 110;

export function ConfirmationArt({ animate }: { animate: boolean }) {
  const [reduce, setReduce] = useState(false);
  const [cab] = useState(() => new Animated.Value(0));
  const [seal] = useState(() => new Animated.Value(0));
  const [ripple] = useState(() => new Animated.Value(0));
  const run = animate && !reduce;

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduce(v)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!run) {
      cab.setValue(1);
      seal.setValue(1);
      ripple.setValue(1);
      return undefined;
    }
    cab.setValue(0);
    seal.setValue(0);
    ripple.setValue(0);
    const anim = Animated.sequence([
      Animated.timing(cab, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.parallel([
        Animated.spring(seal, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
        Animated.timing(ripple, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    ]);
    anim.start();
    return () => anim.stop();
  }, [run, cab, seal, ripple]);

  return (
    <View style={styles.box} accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
        <Rect x={15} y={34} width={230} height={59} rx={29.5} fill="#fff5f2" />
        <Path d="M31 78h191" stroke="#e6c7c1" strokeWidth={1.6} strokeDasharray="3 6" strokeLinecap="round" />
        <Path d="M31 78h110" stroke="#c62828" strokeWidth={2.3} strokeLinecap="round" />
        <Circle cx={29} cy={78} r={4} fill="white" stroke="#d7aaa1" strokeWidth={1.6} />
      </Svg>
      <Animated.View style={[styles.layer, { opacity: cab, transform: [{ translateX: cab.interpolate({ inputRange: [0, 1], outputRange: [-18, 0] }) }] }]}>
        <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
          <G>
            <Path d="M27 58h7l7-10h17l11 10 8 3v12H24V62l3-4Z" fill="#c62828" />
            <Path d="m43 51-5 7h12v-7h-7ZM53 51v7h11l-8-7h-3Z" fill="white" />
            <Path d="M24 65h53" stroke="#a71f1f" strokeWidth={1.3} />
            <Circle cx={35} cy={73} r={5} fill="#394457" />
            <Circle cx={66} cy={73} r={5} fill="#394457" />
            <Circle cx={35} cy={73} r={2} fill="white" />
            <Circle cx={66} cy={73} r={2} fill="white" />
            <Path d="M27 62h5M71 62h4" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
          </G>
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.layer, { opacity: ripple.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.7, 0.35] }), transform: [{ scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.15] }) }] }]}>
        <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
          <Circle cx={218} cy={57} r={25} stroke="#83b796" strokeWidth={1.5} />
        </Svg>
      </Animated.View>
      <Animated.View style={[styles.layer, { opacity: seal, transform: [{ scale: seal.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }]}>
        <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
          <Circle cx={218} cy={57} r={28} fill="white" />
          <Circle cx={218} cy={57} r={24} fill="#edf8f0" stroke="#d7ebdd" />
          <Path d="m208 57 7 7 13-14" stroke="#278050" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: W, height: H, alignSelf: 'center' },
  layer: { position: 'absolute', left: 0, top: 0, width: W, height: H },
});
