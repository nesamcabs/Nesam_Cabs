import React, { useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardHeight } from '../KeyboardAvoid';
import type { TabParamList } from '../../navigation/types';
import { nx } from '../../theme/nx';
import { POPPINS } from '../../theme/fonts';
import { NxIcon, NxIconName } from './Icon';
import { useLayout } from './layout';

interface TabConfig {
  label: string;
  icon: NxIconName;
}

const ITEMS: Record<string, TabConfig> = {
  Marketplace: { label: 'Marketplace', icon: 'marketplace' },
  Trip: { label: 'My Trips', icon: 'trip' },
  Home: { label: 'Home', icon: 'home' },
  Wallet: { label: 'Wallet', icon: 'wallet' },
  Profile: { label: 'Profile', icon: 'user' },
  Earnings: { label: 'Earnings', icon: 'chart' },
};

function TabPressable({
  children,
  onPress,
  style,
  accessibilityLabel,
  selected,
  activeScale = 0.92,
}: {
  children: React.ReactNode;
  onPress: () => void;
  style?: unknown;
  accessibilityLabel: string;
  selected: boolean;
  activeScale?: number;
}) {
  const [scale] = useState(() => new Animated.Value(1));

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: activeScale,
      speed: 60,
      bounciness: 0,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      speed: 35,
      bounciness: 12,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[{ flex: 1, alignItems: 'center' }, { transform: [{ scale }] }]}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={style as never}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/**
 * Modern professional driver bottom navigation:
 * 1. Bottom Left: Marketplace (Open duties & bidding)
 * 2. Position 2: My Trips
 * 3. Middle: Home (dominant, elevated red-filled circle hero action)
 * 4. Position 4: Wallet
 * 5. Position 5: Profile (includes Earnings inside)
 */
export function NxTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { short } = useLayout();
  const keyboardOpen = useKeyboardHeight() > 0;
  if (keyboardOpen) return null;

  return (
    <View
      style={[
        styles.bar,
        {
          paddingBottom: Math.max(8, insets.bottom),
          paddingLeft: 4 + insets.left,
          paddingRight: 4 + insets.right,
        },
      ]}
      accessibilityRole="tablist"
      accessibilityLabel="Driver bottom navigation"
    >
      {state.routes.map((route, index) => {
        const item = ITEMS[route.name];
        if (!item) return null;
        const focused = state.index === index;
        const isMiddleHome = route.name === 'Home';

        const handlePress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name as never);
        };

        if (isMiddleHome) {
          return (
            <TabPressable
              key={route.key}
              onPress={handlePress}
              selected={focused}
              accessibilityLabel={`${item.label} tab${focused ? ', active' : ''}`}
              activeScale={0.88}
              style={[styles.middleWrapper, short && styles.middleWrapperShort]}
            >
              <View style={[styles.middleCircle, focused && styles.middleCircleFocused]}>
                <NxIcon name="home" size={24} color="#FFFFFF" strokeWidth={2.2} />
              </View>
              <Text
                style={[
                  styles.middleLabel,
                  focused && styles.middleLabelFocused,
                ]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.15}
              >
                {item.label}
              </Text>
              <View style={[styles.navBar, focused && styles.navBarOn, { marginTop: 2 }]} />
            </TabPressable>
          );
        }

        const color = focused ? nx.red : '#64748B';

        return (
          <TabPressable
            key={route.key}
            onPress={handlePress}
            selected={focused}
            accessibilityLabel={`${item.label} tab${focused ? ', active' : ''}`}
            style={[styles.item, short && styles.itemShort]}
          >
            <View style={styles.iconWrap}>
              <NxIcon name={item.icon} size={22} color={color} strokeWidth={focused ? 2.0 : 1.7} />
            </View>
            <Text
              style={[
                styles.label,
                { color },
                focused && styles.labelFocused,
              ]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.15}
            >
              {item.label}
            </Text>
            <View style={[styles.navBar, focused && styles.navBarOn]} />
          </TabPressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 6,
    paddingHorizontal: 4,
    alignItems: 'flex-end',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 8,
  },
  item: {
    width: '100%',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 2,
    gap: 3,
  },
  itemShort: {
    minHeight: 42,
    gap: 2,
    paddingBottom: 2,
  },
  iconWrap: {
    width: 32,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 10,
    fontFamily: POPPINS.medium,
    lineHeight: 13,
    color: '#64748B',
    letterSpacing: -0.1,
  },
  labelFocused: {
    fontFamily: POPPINS.bold,
    color: nx.red,
  },
  navBar: {
    width: 14,
    height: 2.5,
    borderRadius: 1.5,
    marginTop: 2,
    backgroundColor: 'transparent',
  },
  navBarOn: {
    backgroundColor: nx.red,
  },
  middleWrapper: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: -22,
    minHeight: 68,
  },
  middleWrapperShort: {
    marginTop: -16,
    minHeight: 56,
  },
  middleCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#C62828',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3.5,
    borderColor: '#FFFFFF',
    shadowColor: '#C62828',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 9,
  },
  middleCircleFocused: {
    backgroundColor: '#A71F1F',
    shadowOpacity: 0.6,
    transform: [{ scale: 1.05 }],
  },
  middleLabel: {
    fontSize: 10.5,
    fontFamily: POPPINS.semibold,
    lineHeight: 14,
    color: '#1E293B',
    marginTop: 3,
    letterSpacing: -0.1,
  },
  middleLabelFocused: {
    fontFamily: POPPINS.bold,
    color: nx.red,
  },
});
