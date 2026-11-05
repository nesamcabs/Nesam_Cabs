// Brand pieces shared by the customer screens: the modern header (emblem,
// dynamic page heading, notification + support actions) and the modern five-item service
// navigation (Airport · Multicity · Outstation · Local Rental · Account) with prominent middle hero.
import React, { useState } from 'react';
import { Animated, Image, Linking, Pressable, type PressableProps, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardHeight } from './KeyboardAvoid';
import { useNavigation } from '@react-navigation/native';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config/constants';
import { colors, fonts, radius, space } from '../theme';
import { BRAND, REFERENCE, VEHICLES, getVehicleImage } from '../assets/images';
import { Icon, TravelIcon, type IconName, type TravelGlyph } from './Icon';
import { useInbox } from '../context/Inbox';
import { useBookingDraft, type HomeService } from '../context/BookingDraft';
import { Steps } from './ui';

export const LOGO = REFERENCE.emblem;
export const APP_ICON = BRAND.logo;
export const VEHICLE_IMAGES = VEHICLES;
export { getVehicleImage };

/** A responsive pressable that scales down slightly with a spring on touch, giving tactile click feedback. */
export function PressableScale({
  onPress,
  onPressIn,
  onPressOut,
  style,
  children,
  activeScale = 0.93,
  containerStyle,
  disabled,
  ...props
}: PressableProps & {
  activeScale?: number;
  /** Layout of the outer Animated.View (the element a flex row actually sees), e.g. to share a row's width. */
  containerStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode | ((state: { pressed: boolean }) => React.ReactNode);
}) {
  const [scale] = useState(() => new Animated.Value(1));

  const handlePressIn = (e: any) => {
    if (disabled) return;
    Animated.spring(scale, {
      toValue: activeScale,
      speed: 55,
      bounciness: 0,
      useNativeDriver: true,
    }).start();
    onPressIn?.(e);
  };

  const handlePressOut = (e: any) => {
    Animated.spring(scale, {
      toValue: 1,
      speed: 30,
      bounciness: 12,
      useNativeDriver: true,
    }).start();
    onPressOut?.(e);
  };

  return (
    <Animated.View style={[containerStyle, { transform: [{ scale }] }]}>
      <Pressable
        {...props}
        disabled={disabled}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={style}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

/** Emblem + Page Heading (moves all page headings right to the logo). */
export function BrandMark({
  title,
  subtitle,
  onPress,
}: {
  title?: string;
  subtitle?: string;
  onPress?: () => void;
}) {
  const body = (
    <View style={styles.brand}>
      <View style={styles.logoWrap}>
        <Image source={LOGO} style={styles.logo} resizeMode="contain" accessible={false} />
      </View>
      {title ? (
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.headerSubtitle} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return <View accessibilityRole="header">{body}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Home" hitSlop={6}>
      {body}
    </Pressable>
  );
}

function HeaderAction({ icon, label, onPress, active, badge }: { icon: IconName; label: string; onPress: () => void; active?: boolean; badge?: number }) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} unread` : label}
      hitSlop={6}
      activeScale={0.88}
      style={[styles.action, active && styles.actionOn]}
    >
      <Icon name={icon} size={20} color={active ? colors.primary : '#4B5563'} strokeWidth={2.0} />
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText} maxFontSizeMultiplier={1.1}>
            {badge > 9 ? '9+' : badge}
          </Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

/** Notifications bell with the unread count. Needs InboxProvider, so it renders only with the header actions (signed-in screens). */
function NotificationsAction({ active }: { active: boolean }) {
  const navigation = useNavigation();
  const { unreadCount } = useInbox();
  return (
    <HeaderAction
      icon="bell"
      label="Notifications"
      active={active}
      badge={unreadCount}
      onPress={() => navigation.navigate('Tabs', { screen: 'Alerts' })}
    />
  );
}

/**
 * The app header. Renders the logo emblem on the left with the page heading right to it,
 * optional back button when navigating, and action icons (notifications with unread count + support) on the right.
 */
export function AppHeader({
  title,
  subtitle,
  onBack,
  active,
  actions = true,
  rightAction,
}: {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  active?: 'alerts' | 'support';
  actions?: boolean;
  rightAction?: React.ReactNode;
}) {
  const navigation = useNavigation();

  return (
    <View style={styles.top}>
      <View style={styles.headerLeft}>
        {onBack ? (
          <PressableScale
            onPress={onBack}
            hitSlop={8}
            activeScale={0.88}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.headerBackBtn}
          >
            <Icon name="arrow-left" size={18} color="#475569" strokeWidth={2.2} />
          </PressableScale>
        ) : null}
        <BrandMark
          title={title}
          subtitle={subtitle}
          onPress={() => navigation.navigate('Tabs', { screen: 'Book' })}
        />
      </View>
      <View style={styles.actions}>
        {rightAction ? (
          rightAction
        ) : actions ? (
          <>
            <NotificationsAction active={active === 'alerts'} />
            <HeaderAction
              icon="headphones"
              label="Help and support"
              active={active === 'support'}
              onPress={() => navigation.navigate('Support')}
            />
          </>
        ) : null}
      </View>
    </View>
  );
}

/** Kept for screens that still pass a custom right-hand action. */
export function MobileBrandHeader({ rightAction, title }: { showTrustBar?: boolean; rightAction?: React.ReactNode; title?: string }) {
  return (
    <View style={styles.top}>
      <BrandMark title={title} />
      {rightAction ? <View style={styles.actions}>{rightAction}</View> : null}
    </View>
  );
}

export function BrandHeader({ right, title }: { right?: React.ReactNode; title?: string }) {
  return <MobileBrandHeader rightAction={right} title={title} />;
}

export type NavKey = HomeService | 'account';

const NAV_ITEMS: { key: NavKey; label: string; glyph: TravelGlyph }[] = [
  { key: 'airport', label: 'Airport', glyph: 'airport' },
  { key: 'multicity', label: 'Multicity', glyph: 'multicity' },
  { key: 'outstation', label: 'Outstation', glyph: 'outstation' },
  { key: 'rental', label: 'Local Rental', glyph: 'rental' },
  { key: 'account', label: 'Account', glyph: 'account' },
];

/**
 * Modern bottom navigation.
 * Features modern stylish icons, prominent elevated red-filled Outstation middle button,
 * and micro-animations for click feedback.
 */
export function BottomNav({ active }: { active?: NavKey }) {
  const navigation = useNavigation();
  const { service, setService } = useBookingDraft();
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardHeight() > 0;
  const selected = active ?? service;
  if (keyboardOpen) return null;

  return (
    <View style={[styles.nav, { paddingBottom: Math.max(8, insets.bottom) }]} accessibilityRole="tablist" accessibilityLabel="Services and account">
      {NAV_ITEMS.map((item) => {
        const on = selected === item.key;
        const isMiddle = item.key === 'outstation';

        if (isMiddle) {
          return (
            <PressableScale
              key={item.key}
              activeScale={0.88}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={item.label}
              onPress={() => {
                setService('outstation');
                navigation.navigate('Tabs', { screen: 'Book' });
              }}
              containerStyle={styles.navCell}
              style={styles.navItemMiddle}
            >
              <View style={[styles.middleCircle, on && styles.middleCircleOn]}>
                <TravelIcon name={item.glyph} size={26} color="#FFFFFF" strokeWidth={2.2} />
              </View>
              <Text style={[styles.navLabel, styles.middleLabel, on && styles.middleLabelOn]} numberOfLines={1} maxFontSizeMultiplier={1.15}>
                {item.label}
              </Text>
              <View style={[styles.navBar, on && styles.navBarOn, { marginTop: 2 }]} />
            </PressableScale>
          );
        }

        return (
          <PressableScale
            key={item.key}
            activeScale={0.92}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={item.label}
            onPress={() => {
              if (item.key === 'account') {
                navigation.navigate('Tabs', { screen: 'Account' });
                return;
              }
              setService(item.key);
              navigation.navigate('Tabs', { screen: 'Book' });
            }}
            containerStyle={styles.navCell}
            style={styles.navItem}
          >
            <View style={styles.navSymbol}>
              <TravelIcon name={item.glyph} size={24} color={on ? colors.primaryActive : '#64748B'} strokeWidth={on ? 2.0 : 1.7} />
            </View>
            <Text style={[styles.navLabel, on && styles.navLabelOn]} numberOfLines={1} maxFontSizeMultiplier={1.15}>
              {item.label}
            </Text>
            <View style={[styles.navBar, on && styles.navBarOn]} />
          </PressableScale>
        );
      })}
    </View>
  );
}

/** Round icon button used in headers. */
export function IconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return <HeaderAction icon={icon} label={label} onPress={onPress} />;
}

/** Back button, title and the three-step progress bars for the booking steps. */
export function StepHeader({ title, subtitle, step, onBack }: { title: string; subtitle?: string; step: number; onBack: () => void }) {
  return (
    <View>
      <SubHeader title={title} subtitle={subtitle} onBack={onBack} plain />
      <Steps step={step} />
    </View>
  );
}

/** Sub-page heading (square back button + title + description), as in the reference. */
export function SubHeader({
  title,
  subtitle,
  onBack,
  right,
  rightAction,
  plain,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  right?: React.ReactNode;
  rightAction?: React.ReactNode;
  /** Render without its own horizontal padding (inside an already padded page). */
  plain?: boolean;
}) {
  const r = rightAction ?? right;
  return (
    <View style={[styles.subHeader, !plain && styles.subHeaderPadded]}>
      <PressableScale onPress={onBack} hitSlop={6} activeScale={0.88} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
        <Icon name="arrow-left" size={17} color="#757880" strokeWidth={2.2} />
      </PressableScale>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.subTitle} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={styles.subSubtitle}>{subtitle}</Text> : null}
      </View>
      {r ? <View>{r}</View> : null}
    </View>
  );
}

/** “Booking support” card with the approved support number. */
export function SupportBanner() {
  return (
    <View style={styles.support}>
      <View style={styles.supportHead}>
        <View style={styles.supportIcon}>
          <Icon name="headphones" size={19} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.supportTitle}>Booking support</Text>
          <Text style={styles.supportSub}>NESAM Tours & Travels</Text>
        </View>
      </View>
      <PressableScale
        onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)}
        activeScale={0.96}
        style={styles.supportCall}
        accessibilityRole="button"
        accessibilityLabel={`Call our office on ${SUPPORT_PHONE_DISPLAY}`}
      >
        <Icon name="phone" size={18} color={colors.white} />
        <Text style={styles.supportCallText}>Call our office · {SUPPORT_PHONE_DISPLAY}</Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    paddingHorizontal: space.lg,
    paddingVertical: 11,
    minHeight: 64,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF0F3',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  logoWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  logo: { width: 44, height: 44 },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 18.5,
    lineHeight: 23,
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 14,
    color: '#64748B',
    marginTop: 1,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  action: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionOn: { backgroundColor: '#FFF1F1' },
  badge: {
    position: 'absolute',
    top: 3,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 9, lineHeight: 11, color: colors.white },
  nav: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: '#E5E8ED',
    paddingTop: 8,
    paddingHorizontal: 6,
    alignItems: 'flex-end',
  },
  // Every tab shares the row equally; the Pressable inside fills its cell.
  navCell: { flex: 1, minWidth: 0 },
  navItem: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 2,
    minHeight: 52,
  },
  navItemMiddle: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: -22,
    minHeight: 68,
  },
  middleCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3.5,
    borderColor: colors.white,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  middleCircleOn: {
    backgroundColor: colors.primaryActive,
    shadowOpacity: 0.55,
    transform: [{ scale: 1.05 }],
  },
  middleLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 10.5,
    marginTop: 3,
  },
  middleLabelOn: {
    color: colors.primary,
    fontFamily: fonts.bold,
  },
  navSymbol: { width: 36, height: 26, alignItems: 'center', justifyContent: 'center' },
  navLabel: { fontFamily: fonts.medium, fontSize: 10, lineHeight: 12.5, color: '#64748B', letterSpacing: -0.1, marginTop: 4 },
  navLabelOn: { fontFamily: fonts.semiBold, color: colors.primaryActive },
  navBar: { width: 16, height: 2, borderRadius: 1, marginTop: 3, backgroundColor: 'transparent' },
  navBarOn: { backgroundColor: colors.primaryActive },
  back: {
    width: 38,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#E3E7EC',
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xl },
  subHeaderPadded: { paddingHorizontal: space.xl, paddingTop: space.xl, marginBottom: space.lg, backgroundColor: colors.white },
  subTitle: { fontFamily: fonts.semiBold, fontSize: 23, lineHeight: 30, letterSpacing: -0.6, color: colors.ink },
  subSubtitle: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: '#6D7785', marginTop: 4 },
  support: { borderWidth: 1, borderColor: '#E3E7EC', borderRadius: radius.xl, padding: 18, marginBottom: space.md, backgroundColor: colors.white },
  supportHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  supportIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF1F1', alignItems: 'center', justifyContent: 'center' },
  supportTitle: { fontFamily: fonts.semiBold, fontSize: 13.5, color: colors.ink },
  supportSub: { fontFamily: fonts.regular, fontSize: 12, color: '#55606F', marginTop: 2 },
  supportCall: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.primary, paddingHorizontal: 12 },
  supportCallText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.white, flexShrink: 1, textAlign: 'center' },
});
