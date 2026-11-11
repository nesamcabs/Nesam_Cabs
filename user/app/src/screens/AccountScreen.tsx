// Account hub. Layout follows the People Taxi profile page: a rounded profile hero with a large photo,
// a refund-credits card, then grouped settings lists with tinted icon tiles, and separate Session / Privacy cards.
// Colours, fonts and navigation are NESAM's own.
import React, { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Alert, Animated, Easing, Image, Linking, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import { useNavigation } from '@react-navigation/native';
import { useCustomerData } from '../context/CustomerData';
import { Button, Notice } from '../components/ui';
import { ScrollView } from '../components/layout';
import { AppHeader } from '../components/brand';
import { Icon, type IconName } from '../components/Icon';
import { choosePhotoSource } from '../components/photoSource';
import { PickerError, pickImage, uploadProfilePhoto } from '../services/storageService';
import { updateCustomerProfile } from '../services/userService';
import { signOutUser } from '../services/authService';
import { isActiveStatus } from '../services/rideService';
import { callFunction } from '../services/callables';
import { formatINR, formatPhone, initials } from '../utils/format';
import { describeError } from '../utils/retry';
import { COMPANY_LEGAL_NAME, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config/constants';
import { useResponsive } from '../theme/responsive';
import { colors, fonts, space } from '../theme';

/** Each kind of row keeps its own icon colour, so a list reads at a glance. */
type Tone = 'brand' | 'red' | 'blue' | 'green' | 'gold';
const TONE_COLOR: Record<Tone, string> = {
  brand: colors.primary,
  red: colors.danger,
  blue: colors.info,
  green: colors.success,
  gold: colors.gold,
};
/** A 12% tint of the tone on white, as a hex colour with alpha. */
const tint = (c: string) => `${c}1F`;

// ── Small building blocks ────────────────────────────────────────────────────────────────────────────────────────

/** Fades and lifts a block in once, staggered by `delay`. Skipped when the system asks for reduced motion. */
function Rise({ delay = 0, style, children }: { delay?: number; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let alive = true;
    let anim: Animated.CompositeAnimation | undefined;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (!alive) return;
        if (reduce) {
          v.setValue(1);
          return;
        }
        anim = Animated.timing(v, { toValue: 1, duration: 520, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
        anim.start();
      });
    return () => {
      alive = false;
      anim?.stop();
    };
  }, [v, delay]);
  return <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}>{children}</Animated.View>;
}

/** A soft decorative disc that drifts slowly behind the hero content. */
function Disc({ size, top, right, bottom, left, alpha, duration }: { size: number; top?: number; right?: number; bottom?: number; left?: number; alpha: number; duration: number }) {
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let alive = true;
    let loop: Animated.CompositeAnimation | undefined;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (!alive || reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(t, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(t, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
        );
        loop.start();
      });
    return () => {
      alive = false;
      loop?.stop();
    };
  }, [t, duration]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        right,
        bottom,
        left,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: `rgba(255,255,255,${alpha})`,
        transform: [
          { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, -14] }) },
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, 12] }) },
          { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) },
        ],
      }}
    />
  );
}

/** One settings row: tinted icon tile, label, optional right-hand value or count, chevron. */
function SettingRow({
  icon,
  tone = 'brand',
  label,
  value,
  count,
  onPress,
  first,
}: {
  icon: IconName;
  tone?: Tone;
  label: string;
  value?: string;
  count?: number;
  onPress: () => void;
  first?: boolean;
}) {
  const c = TONE_COLOR[tone];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}. ${value}` : label}
      style={({ pressed }) => [styles.setting, !first && styles.settingDivider, pressed && styles.settingPressed]}
    >
      <View style={[styles.settingIcon, { backgroundColor: tint(c) }]}>
        <Icon name={icon} size={20} color={c} />
      </View>
      <Text style={styles.settingLabel} numberOfLines={2}>
        {label}
      </Text>
      {value ? (
        <Text style={styles.settingValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {count ? (
        <View style={styles.count}>
          <Text style={styles.countText}>{count > 99 ? '99+' : count}</Text>
        </View>
      ) : null}
      <Icon name="chevron-right" size={18} color={colors.faint} />
    </Pressable>
  );
}

/** An eyebrow heading over a rounded list card. */
function Group({ title, delay, children }: { title: string; delay: number; children: React.ReactNode }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <Rise delay={delay} style={styles.group}>
      <Text style={styles.eyebrow} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.listCard}>
        {rows.map((row, i) => (
          <React.Fragment key={i}>{React.isValidElement<{ first?: boolean }>(row) ? React.cloneElement(row, { first: i === 0 }) : row}</React.Fragment>
        ))}
      </View>
    </Rise>
  );
}

/** A card with a title, a line of detail and one button, used for Session and Privacy. */
function ActionCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <View style={styles.actionCard}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSub}>{subtitle}</Text>
      </View>
      {children}
    </View>
  );
}

// ── Screen ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function AccountScreen() {
  const navigation = useNavigation();
  const { isDesktop } = useResponsive();
  const { profile, trips } = useCustomerData();
  const [photoBusy, setPhotoBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deletion, setDeletion] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const upcoming = useMemo(() => trips.filter((t) => isActiveStatus(t.status)).length, [trips]);

  const changePhoto = async () => {
    const source = await choosePhotoSource();
    if (!source) return;
    setError('');
    try {
      const asset = await pickImage(source);
      if (!asset) return;
      setPhotoBusy(0);
      const url = await uploadProfilePhoto(profile.uid, asset, setPhotoBusy);
      await updateCustomerProfile(profile.uid, { photoUrl: url });
    } catch (e) {
      setError(e instanceof PickerError ? e.message : describeError(e, 'Couldn’t update your photo.'));
    } finally {
      setPhotoBusy(null);
    }
  };

  const logout = () =>
    Alert.alert('Sign out of NESAM?', 'You’ll need to verify your phone number again to sign back in.', [
      { text: 'Stay signed in', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          signOutUser().catch(() => setError('Couldn’t sign out. Please try again.'));
        },
      },
    ]);

  const requestDeletion = () =>
    Alert.alert(
      'Delete your account?',
      'We will verify the request, settle anything still open (bookings, payments) and then delete your account and personal data. Records we must keep by law, such as invoices, are retained. You cannot undo this once it is processed.',
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Request deletion',
          style: 'destructive',
          onPress: () => {
            if (deleting) return;
            setDeleting(true);
            setDeletion(null);
            callFunction<{ role: string }, { alreadyOpen: boolean; liveBookings: number; reference: string }>('requestAccountDeletion', { role: 'customer' })
              .then((r) =>
                setDeletion({
                  tone: 'success',
                  text: `${r.alreadyOpen ? 'Your request is already with our team.' : 'Request received.'} Reference ${r.reference}. We will confirm by phone or email${r.liveBookings ? `. ${r.liveBookings} booking(s) are still open and must be completed or cancelled first` : ''}.`,
                }),
              )
              .catch((e: unknown) => setDeletion({ tone: 'error', text: describeError(e, 'The request was not sent. Please try again.') }))
              .finally(() => setDeleting(false));
          },
        },
      ],
    );

  const hero = (
    <Rise>
      <View style={styles.hero}>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none" pointerEvents="none">
          <Defs>
            <LinearGradient id="acctHero" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={colors.primary} />
              <Stop offset="0.6" stopColor={colors.primaryDark} />
              <Stop offset="1" stopColor="#B3141A" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#acctHero)" />
        </Svg>
        <Disc size={190} top={-70} right={-50} alpha={0.14} duration={9000} />
        <Disc size={140} bottom={-56} left={-44} alpha={0.1} duration={11000} />

        <Pressable
          onPress={() => void changePhoto()}
          disabled={photoBusy != null}
          accessibilityRole="button"
          accessibilityLabel="Change profile photo"
          style={({ pressed }) => [styles.photoRing, photoBusy != null && { opacity: 0.85 }, pressed && { transform: [{ scale: 0.97 }] }]}
        >
          {profile.photoUrl ? (
            <Image source={{ uri: profile.photoUrl }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, styles.photoInitials]}>
              <Text style={styles.photoInitialsText}>{initials(profile.name)}</Text>
            </View>
          )}
          <View style={styles.cam}>
            <Icon name="camera" size={16} color={colors.primary} />
          </View>
        </Pressable>

        <Text style={styles.heroName} numberOfLines={2}>
          {profile.name}
        </Text>
        <Text style={styles.heroLine}>{formatPhone(profile.phone)}</Text>
        {profile.email ? (
          <Text style={styles.heroLine} numberOfLines={1}>
            {profile.email}
          </Text>
        ) : null}
        {photoBusy != null ? <Text style={styles.heroLine}>Uploading photo… {photoBusy}%</Text> : null}

        <Pressable
          onPress={() => navigation.navigate('EditProfile')}
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
          style={({ pressed }) => [styles.heroBtn, pressed && { backgroundColor: '#F7F5F2' }]}
        >
          <Icon name="pencil" size={17} color={colors.primary} />
          <Text style={styles.heroBtnText}>Edit profile</Text>
        </Pressable>
      </View>
    </Rise>
  );

  const credit = (
    <Rise delay={70}>
      <Pressable
        onPress={() => navigation.navigate('PaymentHistory')}
        accessibilityRole="button"
        accessibilityLabel={`Refund credits ${formatINR(profile.walletBalance)}`}
        style={({ pressed }) => [styles.credit, pressed && styles.creditPressed]}
      >
        <View style={styles.creditIcon}>
          <Icon name="wallet" size={24} color={colors.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={styles.creditLabel}>Refund credits</Text>
          <Text style={styles.creditAmount}>{formatINR(profile.walletBalance)}</Text>
        </View>
        <Icon name="chevron-right" size={20} color={colors.faint} />
      </Pressable>
    </Rise>
  );

  const groups = (
    <View style={styles.groups}>
      <Group title="Profile & places" delay={120}>
        <SettingRow icon="map-pin" tone="brand" label="Saved places" onPress={() => navigation.navigate('SavedPlaces')} />
        <SettingRow icon="triangle-alert" tone="red" label="Emergency contact" value={profile.emergencyContact || 'Not set'} onPress={() => navigation.navigate('EditProfile')} />
        <SettingRow icon="languages" tone="blue" label="Language" value={profile.language || 'English'} onPress={() => navigation.navigate('EditProfile')} />
      </Group>

      <Group title="Payments & offers" delay={190}>
        <SettingRow icon="receipt-text" tone="green" label="Payments and refunds" onPress={() => navigation.navigate('PaymentHistory')} />
        <SettingRow icon="tag" tone="gold" label="Offers" onPress={() => navigation.navigate('Offers')} />
        <SettingRow icon="tickets" tone="brand" label="My trips" count={upcoming} onPress={() => navigation.navigate('Tabs', { screen: 'Trips' })} />
      </Group>

      <Group title="Help" delay={260}>
        <SettingRow icon="headphones" tone="blue" label="Help and support tickets" onPress={() => navigation.navigate('Support')} />
        <SettingRow icon="bell" tone="gold" label="Notifications & updates" onPress={() => navigation.navigate('Tabs', { screen: 'Alerts' })} />
        <SettingRow icon="phone" tone="green" label="Call NESAM" value={SUPPORT_PHONE_DISPLAY} onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} />
        <SettingRow icon="info" tone="gold" label="About NESAM & settings" onPress={() => navigation.navigate('Settings')} />
        <SettingRow icon="file-text" tone="brand" label="Terms, privacy & customer policies" onPress={() => navigation.navigate('LegalDocuments')} />
      </Group>

      <Rise delay={330} style={styles.group}>
        <Text style={styles.eyebrow} accessibilityRole="header">
          Session
        </Text>
        <ActionCard title="Sign out of this device" subtitle={COMPANY_LEGAL_NAME}>
          <Button title="Sign out" icon="log-out" onPress={logout} style={styles.actionBtn} />
        </ActionCard>
      </Rise>

      <Rise delay={400} style={styles.group}>
        <Text style={styles.eyebrow} accessibilityRole="header">
          Privacy
        </Text>
        <ActionCard title="Delete my account" subtitle="Ask us to erase your account and personal data.">
          <Button title="Request deletion" variant="secondary" loading={deleting} onPress={requestDeletion} style={styles.actionBtn} />
        </ActionCard>
        {deletion ? <Notice message={deletion.text} tone={deletion.tone} /> : null}
      </Rise>
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <KeyboardAvoid>
        <AppHeader title="Account" subtitle="Your details, saved places, payments and help." />
        <ScrollView kind={isDesktop ? 'medium' : 'narrow'} contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
          <Notice message={error} style={{ marginBottom: space.md }} />
          {isDesktop ? (
            <View style={styles.desktop}>
              <View style={styles.side}>
                {hero}
                {credit}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>{groups}</View>
            </View>
          ) : (
            <View style={styles.stack}>
              {hero}
              {credit}
              {groups}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}

const CARD_SHADOW = {
  shadowColor: '#14171C',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.07,
  shadowRadius: 14,
  elevation: 2,
} as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  page: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: 40 },
  stack: { gap: 14 },
  desktop: { flexDirection: 'row', alignItems: 'flex-start', gap: 28 },
  side: { width: 360, gap: 14 },
  groups: { gap: 22, minWidth: 0, maxWidth: 760 },

  // Profile hero
  hero: {
    alignItems: 'center',
    gap: 4,
    paddingTop: 30,
    paddingBottom: 22,
    paddingHorizontal: 20,
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.28,
    shadowRadius: 22,
    elevation: 6,
  },
  photoRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 6,
  },
  photo: { width: 104, height: 104, borderRadius: 52, backgroundColor: colors.border },
  photoInitials: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  photoInitialsText: { fontFamily: fonts.semiBold, fontSize: 38, color: colors.primary },
  cam: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 4,
  },
  heroName: { marginTop: 10, maxWidth: '100%', textAlign: 'center', fontFamily: fonts.extraBold, fontSize: 21, lineHeight: 28, letterSpacing: -0.2, color: colors.white },
  heroLine: { maxWidth: '100%', textAlign: 'center', fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: 'rgba(255,255,255,0.88)' },
  heroBtn: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    marginTop: 14,
    borderRadius: 14,
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  heroBtnText: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.primary },

  // Refund credits
  credit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    ...CARD_SHADOW,
  },
  creditPressed: { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder },
  creditIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: tint(colors.primary) },
  creditLabel: { fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 18, color: colors.muted },
  creditAmount: { fontFamily: fonts.extraBold, fontSize: 21, lineHeight: 28, letterSpacing: -0.2, color: colors.ink },

  // Groups and rows
  group: { gap: 10, minWidth: 0 },
  eyebrow: { marginLeft: 4, fontFamily: fonts.extraBold, fontSize: 11.5, lineHeight: 16, letterSpacing: 1.05, textTransform: 'uppercase', color: colors.muted },
  listCard: { borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, overflow: 'hidden', ...CARD_SHADOW },
  setting: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10, paddingHorizontal: 16 },
  settingDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  settingPressed: { backgroundColor: colors.primarySoft },
  settingIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { flex: 1, minWidth: 0, fontFamily: fonts.semiBold, fontSize: 14.5, lineHeight: 20, color: colors.ink },
  settingValue: { flexShrink: 1, maxWidth: '46%', textAlign: 'right', fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.muted },
  count: { minWidth: 24, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, alignItems: 'center', backgroundColor: colors.primarySoft },
  countText: { fontFamily: fonts.semiBold, fontSize: 11, color: colors.primary },

  // Session and privacy
  actionCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    ...CARD_SHADOW,
  },
  actionTitle: { fontFamily: fonts.semiBold, fontSize: 14.5, lineHeight: 21, color: colors.ink },
  actionSub: { marginTop: 2, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.muted },
  actionBtn: { flexGrow: 1, minWidth: 150, borderRadius: 14 },
});
