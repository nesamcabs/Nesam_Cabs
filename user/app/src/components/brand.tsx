// Brand pieces shared by the customer screens: the modern header (emblem,
// dynamic page heading, notification + support actions) and the modern five-item service
// navigation (Airport · Multicity · Outstation · Local Rental · Account) with prominent middle hero.
import React, { useEffect, useState } from 'react';
import { Animated, Image, type ImageSourcePropType, Linking, Modal, Pressable, type PressableProps, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardHeight } from './KeyboardAvoid';
import { useNavigation } from '@react-navigation/native';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config/constants';
import { colors, fonts, radius, space } from '../theme';
import { BRAND, NESAM, VEHICLES, getVehicleImage } from '../assets/images';
import { Icon, type IconName } from './Icon';
import { useInbox } from '../context/Inbox';
import { useBookingDraft, type HomeService } from '../context/BookingDraft';
import { useDrawer } from '../context/Drawer';
import { useAuthGate } from '../context/AuthGate';
import { Steps } from './ui';
import { AiChatSheet } from './AiChatSheet';

export const LOGO = NESAM.emblem;
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

/** The website's header logo (wordmark), optionally tappable. */
export function BrandMark({ onPress, height = 38 }: { title?: string; subtitle?: string; onPress?: () => void; height?: number }) {
  const body = <Image source={NESAM.logo} style={{ width: Math.round(height * 3.05), height }} resizeMode="contain" accessible={false} />;
  if (!onPress) return <View accessibilityRole="header">{body}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="NESAM Cabs, book a ride" hitSlop={6}>
      {body}
    </Pressable>
  );
}

/** A round header button (notifications): 42px, soft red when it is the open page. */
function HeaderAction({ icon, label, onPress, active, badge }: { icon: IconName; label: string; onPress: () => void; active?: boolean; badge?: number }) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} unread` : label}
      hitSlop={4}
      activeScale={0.9}
      style={[styles.action, active && styles.actionOn]}
    >
      <Icon name={icon} size={22} color={active ? colors.primary : colors.ink} strokeWidth={1.9} />
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

/** Help button in the header: opens a small panel with “Ask NESAM” and “Call us”, as on the website. */
export function SupportMenuAction({ active, glass }: { active?: boolean; glass?: boolean }) {
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState(false);
  const insets = useSafeAreaInsets();
  const item = (icon: IconName, bg: string, fg: string, title: string, sub: string, onPress: () => void) => (
    <PressableScale key={title} onPress={onPress} activeScale={0.98} style={styles.menuRow} accessibilityRole="button" accessibilityLabel={title}>
      <View style={[styles.menuIcon, { backgroundColor: bg }]}>
        <Icon name={icon} size={18} color={fg} strokeWidth={2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuSub} numberOfLines={1}>{sub}</Text>
      </View>
    </PressableScale>
  );
  return (
    <>
      <PressableScale
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Help: ask NESAM or call us"
        hitSlop={4}
        activeScale={0.92}
        style={[styles.supportBtn, glass && styles.supportGlass, (active || open) && styles.supportOn]}
      >
        <Icon name="headphones" size={21} color={active || open ? colors.white : colors.primary} strokeWidth={1.9} />
      </PressableScale>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.menuPanel, { top: insets.top + 64 }]}>
          {item('sparkles', colors.primarySoft, colors.primary, 'Ask NESAM', 'Instant travel help', () => { setOpen(false); setChat(true); })}
          {item('phone', colors.successSoft, colors.success, 'Call us', `24/7 booking · ${SUPPORT_PHONE_DISPLAY}`, () => { setOpen(false); void Linking.openURL(`tel:${SUPPORT_PHONE}`); })}
        </View>
      </Modal>
      <AiChatSheet visible={chat} onClose={() => setChat(false)} />
    </>
  );
}

/** Notifications bell with the unread count. Needs InboxProvider, so it renders only with the header actions (signed-in screens). */
export function NotificationsAction({ active }: { active?: boolean }) {
  const navigation = useNavigation();
  const { unreadCount } = useInbox();
  const { guest, requestSignIn } = useAuthGate();
  // The website shows "Sign in" here until someone is signed in.
  if (guest) {
    return (
      <PressableScale onPress={() => requestSignIn({ title: 'Sign in to NESAM Cabs' })} accessibilityRole="button" accessibilityLabel="Sign in" activeScale={0.94} style={styles.signIn} containerStyle={{ flexShrink: 0 }}>
        <Text style={styles.signInText} numberOfLines={1}>Sign in</Text>
      </PressableScale>
    );
  }
  return <HeaderAction icon="bell" label="Notifications" active={active} badge={unreadCount} onPress={() => navigation.navigate('Tabs', { screen: 'Alerts' })} />;
}

/** The hamburger that opens the side menu (absent on the sign-in screens, which have no menu). */
export function MenuButton({ glass }: { glass?: boolean }) {
  const drawer = useDrawer();
  if (!drawer) return null;
  return (
    <PressableScale
      onPress={drawer.openDrawer}
      accessibilityRole="button"
      accessibilityLabel="Open menu"
      accessibilityState={{ expanded: drawer.open }}
      hitSlop={4}
      activeScale={0.9}
      style={[styles.menuBtn, glass && styles.menuBtnGlass]}
      containerStyle={glass ? undefined : { marginLeft: -6 }}
    >
      <Icon name="menu" size={22} color={colors.ink} strokeWidth={2} />
    </PressableScale>
  );
}

/**
 * The website's phone header: menu button, logo, then help and notifications on the right, over a hairline gold rule.
 * With a `title` the page heading (back button + title) follows beneath it, like the website's page heads.
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
    <View style={styles.headWrap}>
      <View style={styles.top}>
        <View style={styles.headerLeft}>
          <MenuButton />
          <BrandMark onPress={() => navigation.navigate('Tabs', { screen: 'Book' })} />
        </View>
        <View style={styles.actions}>
          {rightAction ? (
            rightAction
          ) : actions ? (
            <>
              <SupportMenuAction active={active === 'support'} />
              <NotificationsAction active={active === 'alerts'} />
            </>
          ) : null}
        </View>
      </View>
      <View style={styles.goldRule} />
      {title ? (
        <View style={styles.pageHead}>
          {onBack ? (
            <PressableScale onPress={onBack} hitSlop={8} activeScale={0.9} accessibilityRole="button" accessibilityLabel="Back" style={styles.headerBackBtn}>
              <Icon name="arrow-left" size={18} color={colors.ink} strokeWidth={2.1} />
            </PressableScale>
          ) : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.pageTitle} numberOfLines={2} accessibilityRole="header" maxFontSizeMultiplier={1.2}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={styles.pageSubtitle} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Kept for screens that still pass a custom right-hand action. */
export function MobileBrandHeader({ rightAction, title }: { showTrustBar?: boolean; rightAction?: React.ReactNode; title?: string }) {
  return <AppHeader title={title} actions={false} rightAction={rightAction} />;
}

export function BrandHeader({ right, title }: { right?: React.ReactNode; title?: string }) {
  return <MobileBrandHeader rightAction={right} title={title} />;
}

export type NavKey = HomeService | 'account';

/** The bottom bar: the website's four services (Outstation, Multicity, Local, Airport) and Profile. */
const NAV_ITEMS: { key: NavKey; label: string; image: ImageSourcePropType }[] = [
  { key: 'outstation', label: 'Outstation', image: NESAM.navOutstation },
  { key: 'multicity', label: 'Multicity', image: NESAM.navMulticity },
  { key: 'rental', label: 'Local', image: NESAM.navLocal },
  { key: 'airport', label: 'Airport', image: NESAM.navAirport },
  { key: 'account', label: 'Profile', image: NESAM.navProfile },
];

/** One bar item: the active one rises on a red disc, with a little pop. */
function NavItem({ item, on, onPress }: { item: (typeof NAV_ITEMS)[number]; on: boolean; onPress: () => void }) {
  const [rise] = useState(() => new Animated.Value(on ? 1 : 0));
  useEffect(() => {
    Animated.spring(rise, { toValue: on ? 1 : 0, speed: 16, bounciness: 9, useNativeDriver: true }).start();
  }, [on, rise]);
  const lift = rise.interpolate({ inputRange: [0, 1], outputRange: [0, -18] });
  const disc = rise.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  return (
    <PressableScale
      activeScale={0.92}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={item.label}
      onPress={onPress}
      containerStyle={styles.navCell}
      style={styles.navItem}
    >
      <Animated.View style={[styles.navIcon, { transform: [{ translateY: lift }] }]}>
        <Animated.View style={[styles.navDisc, { opacity: rise, transform: [{ scale: disc }] }]} />
        <Image source={item.image} style={styles.navImg} resizeMode="contain" accessible={false} />
      </Animated.View>
      <Text style={[styles.navLabel, on && styles.navLabelOn]} numberOfLines={1} maxFontSizeMultiplier={1.1}>
        {item.label}
      </Text>
    </PressableScale>
  );
}

/**
 * The floating bottom bar, as on the website: a white rounded card with the service icons; the current one rises on a
 * red disc. `active` is the highlighted item; leave it out to follow the service chosen on the booking form, or pass
 * null on pages that belong to none of them.
 */
export function BottomNav({ active }: { active?: NavKey | null }) {
  const navigation = useNavigation();
  const { service, setService } = useBookingDraft();
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardHeight() > 0;
  const { guest, requestSignIn } = useAuthGate();
  const selected = active === undefined ? service : active;
  if (keyboardOpen) return null;

  return (
    <View style={[styles.dock, { paddingBottom: 16 + insets.bottom }]} pointerEvents="box-none">
      <View style={styles.nav} accessibilityRole="tablist" accessibilityLabel="Services and profile">
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.key}
            item={item}
            on={selected === item.key}
            onPress={() => {
              if (item.key === 'account') {
                // Profile asks a guest to sign in, as on the website.
                if (guest) requestSignIn({ title: 'Sign in to NESAM Cabs' });
                else navigation.navigate('Tabs', { screen: 'Account' });
                return;
              }
              setService(item.key);
              // Local is a map flow of its own; every other service uses the booking form.
              navigation.navigate('Tabs', { screen: item.key === 'rental' ? 'Rentals' : 'Book' });
            }}
          />
        ))}
      </View>
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
        <Icon name="arrow-left" size={17} color="#9A958C" strokeWidth={2.2} />
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
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 6 },
  menuIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  menuTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  menuSub: { fontFamily: fonts.semiBold, fontSize: 12, color: colors.muted, marginTop: 1 },
  menuPanel: {
    position: 'absolute',
    right: 16,
    width: 270,
    maxWidth: '86%',
    padding: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 7,
    backgroundColor: colors.white,
    shadowColor: '#14171C',
    shadowOffset: { width: 0, height: 24 },
    shadowOpacity: 0.28,
    shadowRadius: 30,
    elevation: 16,
  },
  headWrap: { backgroundColor: colors.white },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    height: 60,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  goldRule: { height: 1, backgroundColor: colors.goldLine },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, marginRight: 8 },
  pageHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, backgroundColor: colors.bg },
  headerBackBtn: { width: 36, height: 36, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  pageTitle: { fontFamily: fonts.semiBold, fontSize: 22, lineHeight: 28, letterSpacing: -0.2, color: colors.ink },
  pageSubtitle: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.muted, marginTop: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  signIn: { minHeight: 40, paddingHorizontal: 16, borderRadius: 4, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  signInText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.white, letterSpacing: 0.3 },
  menuBtn: { width: 40, height: 40, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  menuBtnGlass: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.92)' },
  supportBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  supportGlass: { backgroundColor: 'rgba(255,255,255,0.92)' },
  supportOn: { backgroundColor: colors.primary },
  action: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  actionOn: { backgroundColor: colors.primarySoft },
  badge: {
    position: 'absolute',
    top: 3,
    right: 2,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: fonts.bold, fontSize: 9, lineHeight: 12, color: colors.white },
  // The floating bar: a white card inset 16px from the edges, 92px tall, with a 32px radius.
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'transparent', paddingHorizontal: 16, alignItems: 'center' },
  nav: {
    width: '100%',
    maxWidth: 590,
    height: 92,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingTop: 8,
    paddingBottom: 10,
    paddingHorizontal: 4,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E3E5ED',
    borderRadius: 32,
    shadowColor: '#1C2B4C',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.09,
    shadowRadius: 15,
    elevation: 6,
  },
  navCell: { flex: 1, minWidth: 0, height: '100%' },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  navIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  navDisc: {
    position: 'absolute',
    top: -10,
    left: -10,
    right: -10,
    bottom: -10,
    borderRadius: 34,
    borderWidth: 5,
    borderColor: colors.white,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  navImg: { width: 48, height: 48 },
  navLabel: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 20, color: '#101827' },
  navLabelOn: { color: colors.primary },
  back: {
    width: 36,
    height: 36,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xl },
  subHeaderPadded: { paddingHorizontal: space.xl, paddingTop: space.xl, marginBottom: space.lg, backgroundColor: colors.white },
  subTitle: { fontFamily: fonts.semiBold, fontSize: 22, lineHeight: 28, letterSpacing: -0.2, color: colors.ink },
  subSubtitle: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.muted, marginTop: 4 },
  support: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, padding: 18, marginBottom: space.md, backgroundColor: colors.white },
  supportHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  supportIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  supportTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.ink },
  supportSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  supportCall: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 48, borderRadius: radius.sm, backgroundColor: colors.primary, paddingHorizontal: 12 },
  supportCallText: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.white, flexShrink: 1, textAlign: 'center' },
});
