// The profile side menu opened by the hamburger button, as on the website: the compact profile card and the account
// menu (the same content as the Account page). Tapping the pencil or Emergency contact opens that edit form right
// below it, in the drawer. Mirrors user/web/src/components/SideDrawer.tsx.
import React, { useEffect, useState } from 'react';
import { Animated, BackHandler, Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDrawer } from '../context/Drawer';
import { NESAM } from '../assets/images';
import { colors } from '../theme';
import { Icon } from './Icon';
import { AccountMenu } from './AccountMenu';
import { KeyboardAvoid } from './KeyboardAvoid';

export function SideDrawer() {
  const drawer = useDrawer();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(Math.round(width * 0.9), 400);
  const [mounted, setMounted] = useState(false);
  const [slide] = useState(() => new Animated.Value(0));
  const open = !!drawer?.open;

  // Opening mounts the panel straight away and starts it collapsed; closing keeps it mounted until it has slid out.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setMounted(true);
  }

  useEffect(() => {
    if (open) {
      Animated.timing(slide, { toValue: 1, duration: 240, useNativeDriver: true }).start();
      return undefined;
    }
    Animated.timing(slide, { toValue: 0, duration: 200, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
    return undefined;
  }, [open, slide]);

  useEffect(() => {
    if (!open) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      drawer?.closeDrawer();
      return true;
    });
    return () => sub.remove();
  }, [open, drawer]);

  if (!drawer || !mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessibilityViewIsModal>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: slide }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={drawer.closeDrawer} accessibilityRole="button" accessibilityLabel="Close profile" />
      </Animated.View>
      <Animated.View
        accessibilityLabel="Profile"
        style={[styles.panel, { width: panelWidth, paddingTop: insets.top, transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-panelWidth, 0] }) }] }]}
      >
        <View style={styles.head}>
          <Pressable onPress={drawer.closeDrawer} accessibilityRole="button" accessibilityLabel="Close profile">
            <Image source={NESAM.logo} style={styles.logo} resizeMode="contain" accessible={false} />
          </Pressable>
          <Pressable onPress={drawer.closeDrawer} accessibilityRole="button" accessibilityLabel="Close profile" hitSlop={8} style={styles.close}>
            <Icon name="x" size={18} color={colors.muted} strokeWidth={2} />
          </Pressable>
        </View>
        <KeyboardAvoid>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.body, { paddingBottom: 20 + insets.bottom }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <AccountMenu variant="drawer" onClose={drawer.closeDrawer} />
          </ScrollView>
        </KeyboardAvoid>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(15,23,42,0.5)' },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.bg,
    shadowColor: '#0F172A',
    shadowOffset: { width: 14, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 22,
    elevation: 24,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingLeft: 20, paddingRight: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.white },
  logo: { width: 116, height: 38 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 14 },
});
