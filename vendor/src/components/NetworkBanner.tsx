import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { colors } from '../theme';

/** Offline / back-online strip shown above everything. */
export function NetworkBanner() {
  const { online, recovered } = useNetworkStatus();
  const insets = useSafeAreaInsets();
  if (online && !recovered) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.bar, { paddingTop: insets.top + 4, backgroundColor: online ? colors.success : colors.ink }]}
    >
      <Text style={styles.text}>{online ? 'Back online' : 'You’re offline — changes will sync when you reconnect'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: 6, alignItems: 'center' },
  text: { color: colors.white, fontSize: 12, fontWeight: '700' },
});
