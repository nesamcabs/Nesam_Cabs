// The side menu opened by the hamburger button: the everyday links as icon rows, then the website footer's
// groups (services, popular routes, policies) as simple accordions, with the support phone at the bottom.
// Mirrors user/web/src/components/SideDrawer.tsx.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Image, Linking, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { COMPANY_LEGAL_NAME, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config/constants';
import { ROUTE_CORRIDORS } from '../data/routeCorridors';
import { useBookingDraft, type HomeService } from '../context/BookingDraft';
import { useDrawer } from '../context/Drawer';
import { NESAM } from '../assets/images';
import { colors, fonts } from '../theme';
import { Icon, type IconName } from './Icon';

type Go = () => void;

export function SideDrawer() {
  const drawer = useDrawer();
  const navigation = useNavigation();
  const { update, setService } = useBookingDraft();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(Math.round(width * 0.86), 360);
  const [mounted, setMounted] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  const slide = useRef(new Animated.Value(0)).current;
  const open = !!drawer?.open;

  useEffect(() => {
    if (open) {
      setMounted(true);
      setGroup(null);
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

  const go = (fn: Go) => () => {
    drawer.closeDrawer();
    fn();
  };
  const book = (service: HomeService, trip?: 'One Way' | 'Round Trip') => () => {
    setService(service);
    if (trip) update({ tripType: trip });
    navigation.navigate('Tabs', { screen: service === 'rental' ? 'Rentals' : 'Book' });
  };

  const QUICK: { label: string; icon: IconName; run: Go }[] = [
    { label: 'Book a ride', icon: 'car', run: book('outstation') },
    { label: 'My trips', icon: 'route', run: () => navigation.navigate('Tabs', { screen: 'Trips' }) },
    { label: 'Account', icon: 'user-round', run: () => navigation.navigate('Tabs', { screen: 'Account' }) },
    { label: 'Offers', icon: 'tag', run: () => navigation.navigate('Offers') },
    { label: 'Help & support', icon: 'help-circle', run: () => navigation.navigate('Support') },
  ];

  const GROUPS: { title: string; links: { label: string; run: Go }[] }[] = [
    {
      title: 'Services',
      links: [
        { label: 'One-way drop taxi', run: book('outstation', 'One Way') },
        { label: 'Round trips', run: book('outstation', 'Round Trip') },
        { label: 'Airport transfers', run: book('airport') },
        { label: 'Local rental', run: book('rental') },
        { label: 'Temple & pilgrimage tours', run: book('multicity') },
        { label: 'Multicity itineraries', run: book('multicity') },
      ],
    },
    {
      title: 'Popular routes',
      links: ROUTE_CORRIDORS.map((r) => ({
        label: `${r.origin} to ${r.destination}`,
        run: () => {
          setService('outstation');
          update({ pickup: r.pickup, drop: r.drop, tripType: 'One Way', stops: [] });
          navigation.navigate('Tabs', { screen: 'Book' });
        },
      })),
    },
    {
      title: 'Policies',
      links: [
        { label: 'Terms & Conditions', run: () => navigation.navigate('LegalDocuments', { section: 'terms' }) },
        { label: 'Privacy & location', run: () => navigation.navigate('LegalDocuments', { section: 'privacy' }) },
        { label: 'Cancellation policy', run: () => navigation.navigate('LegalDocuments', { section: 'cancellation' }) },
        { label: 'Refund policy', run: () => navigation.navigate('LegalDocuments', { section: 'refund' }) },
        { label: 'Fare & payment policy', run: () => navigation.navigate('LegalDocuments', { section: 'payment' }) },
        { label: 'Account & data deletion', run: () => navigation.navigate('LegalDocuments', { section: 'deletion' }) },
      ],
    },
  ];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessibilityViewIsModal>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: slide }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={drawer.closeDrawer} accessibilityRole="button" accessibilityLabel="Close menu" />
      </Animated.View>
      <Animated.View
        accessibilityLabel="Menu"
        style={[styles.panel, { width: panelWidth, paddingTop: insets.top, transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-panelWidth, 0] }) }] }]}
      >
        <View style={styles.head}>
          <Pressable onPress={drawer.closeDrawer} accessibilityRole="button" accessibilityLabel="Close menu">
            <Image source={NESAM.logo} style={styles.logo} resizeMode="contain" accessible={false} />
          </Pressable>
          <Pressable onPress={drawer.closeDrawer} accessibilityRole="button" accessibilityLabel="Close menu" hitSlop={8} style={styles.close}>
            <Icon name="x" size={18} color={colors.muted} strokeWidth={2} />
          </Pressable>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
          <View style={styles.quick}>
            {QUICK.map((q) => (
              <Pressable key={q.label} onPress={go(q.run)} accessibilityRole="button" style={({ pressed }) => [styles.quickRow, pressed && styles.pressed]}>
                <View style={styles.quickIcon}>
                  <Icon name={q.icon} size={18} color={colors.primary} strokeWidth={1.9} />
                </View>
                <Text style={styles.quickText}>{q.label}</Text>
              </Pressable>
            ))}
          </View>
          {GROUPS.map((g) => {
            const on = group === g.title;
            return (
              <View key={g.title} style={styles.group}>
                <Pressable onPress={() => setGroup(on ? null : g.title)} accessibilityRole="button" accessibilityState={{ expanded: on }} style={styles.groupHead}>
                  <Text style={styles.groupTitle}>{g.title}</Text>
                  <Icon name={on ? 'chevron-up' : 'chevron-down'} size={16} color={colors.ink} strokeWidth={2} />
                </Pressable>
                {on ? (
                  <View style={styles.links}>
                    {g.links.map((l) => (
                      <Pressable key={l.label} onPress={go(l.run)} accessibilityRole="link" style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
                        <Text style={styles.linkText}>{l.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>

        <View style={[styles.foot, { paddingBottom: 14 + insets.bottom }]}>
          <Pressable onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} accessibilityRole="button" style={({ pressed }) => [styles.call, pressed && { backgroundColor: colors.primaryDark }]}>
            <Icon name="phone" size={16} color={colors.white} strokeWidth={2} />
            <Text style={styles.callText}>Call {SUPPORT_PHONE_DISPLAY}</Text>
          </Pressable>
          <Text style={styles.copy}>© {new Date().getFullYear()} {COMPANY_LEGAL_NAME}</Text>
        </View>
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
    backgroundColor: colors.white,
    shadowColor: '#0F172A',
    shadowOffset: { width: 14, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 22,
    elevation: 24,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingLeft: 20, paddingRight: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  logo: { width: 116, height: 38 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  quick: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, gap: 2 },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 56, paddingHorizontal: 8, borderRadius: 10 },
  quickIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  quickText: { fontFamily: fonts.semiBold, fontSize: 15.5, color: colors.ink },
  pressed: { backgroundColor: colors.surface },
  group: { marginHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.border },
  groupHead: { minHeight: 52, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupTitle: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  links: { paddingLeft: 8, paddingBottom: 10 },
  link: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 8 },
  linkText: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted },
  foot: { paddingHorizontal: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  call: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 48, borderRadius: 12, backgroundColor: colors.primary },
  callText: { fontFamily: fonts.bold, fontSize: 15, color: colors.white },
  copy: { marginTop: 10, textAlign: 'center', fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
});
