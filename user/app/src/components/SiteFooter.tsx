// The website's footer, shown at the bottom of every page on wide windows: brand blurb, Services / Popular routes /
// Support / Policies columns and the legal line, on the brand red.
import React from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { COMPANY_LEGAL_NAME, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config/constants';
import { ROUTE_CORRIDORS } from '../data/routeCorridors';
import { useBookingDraft, type HomeService } from '../context/BookingDraft';
import { NESAM } from '../assets/images';
import { colors, fonts } from '../theme';

/** From this window width the website shows its desktop header and footer. */
export const SITE_FOOTER_MIN = 900;

type Link = { label: string; run: () => void };

/** `breakout`: the footer sits inside a width-capped list, so it widens itself to the window and stays centred. */
export function SiteFooter({ breakout }: { breakout?: boolean }) {
  const { width } = useWindowDimensions();
  const navigation = useNavigation();
  const { update, setService } = useBookingDraft();
  if (width < SITE_FOOTER_MIN) return null;

  const book = (service: HomeService, trip?: 'One Way' | 'Round Trip') => () => {
    setService(service);
    if (trip) update({ tripType: trip });
    navigation.navigate('Tabs', { screen: service === 'rental' ? 'Rentals' : 'Book' });
  };
  const legal = (section: 'terms' | 'privacy' | 'cancellation' | 'refund' | 'payment' | 'deletion') => () => navigation.navigate('LegalDocuments', { section });

  const columns: { title: string; links: Link[] }[] = [
    {
      title: 'Services',
      links: [
        { label: 'One Way Drop Taxi', run: book('outstation', 'One Way') },
        { label: 'Round Trips', run: book('outstation', 'Round Trip') },
        { label: 'Airport Transfers', run: book('airport') },
        { label: 'Hourly City Rental', run: book('rental') },
        { label: 'Temple & Pilgrimage Tours', run: book('multicity') },
        { label: 'Multicity Itineraries', run: book('multicity') },
      ],
    },
    {
      title: 'Popular Routes',
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
      title: 'Support',
      links: [
        { label: 'Help & Support', run: () => navigation.navigate('Support') },
        { label: 'Special Offers', run: () => navigation.navigate('Offers') },
        { label: `Call ${SUPPORT_PHONE_DISPLAY}`, run: () => void Linking.openURL(`tel:${SUPPORT_PHONE}`) },
      ],
    },
    {
      title: 'Policies',
      links: [
        { label: 'About NESAM Cabs', run: () => navigation.navigate('Settings') },
        { label: 'Terms & Conditions', run: legal('terms') },
        { label: 'Privacy & Location', run: legal('privacy') },
        { label: 'Cancellation Policy', run: legal('cancellation') },
        { label: 'Refund Policy', run: legal('refund') },
        { label: 'Fare & Payment Policy', run: legal('payment') },
        { label: 'Account & Data Deletion', run: legal('deletion') },
      ],
    },
  ];

  return (
    <View style={[styles.outer, breakout && { width, alignSelf: 'center', marginTop: 24 }]}>
      <View style={styles.inner}>
        <View style={styles.grid}>
          <View style={styles.brandCol}>
            <View style={styles.logoChip}>
              <Image source={NESAM.logo} style={styles.logo} resizeMode="contain" accessible={false} />
            </View>
            <Text style={styles.blurb}>
              Tamil Nadu and South India’s trusted cab network for outstation one-way drops, round trips, airport transfers, and hourly rentals.
            </Text>
          </View>
          {columns.map((c) => (
            <View key={c.title} style={styles.col} accessibilityRole="menu" accessibilityLabel={c.title}>
              <Text style={styles.colTitle} accessibilityRole="header">
                {c.title}
              </Text>
              {c.links.map((l) => (
                <Pressable key={l.label} onPress={l.run} accessibilityRole="link" style={({ hovered }: { hovered?: boolean }) => [styles.link, hovered && styles.linkHover]}>
                  <Text style={styles.linkText}>{l.label}</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </View>
        <View style={styles.legal}>
          <Text style={styles.legalText}>
            © {new Date().getFullYear()} NESAM Cabs · A Unit of {COMPANY_LEGAL_NAME}
          </Text>
          <Text style={styles.legalText}>Cash or UPI to your driver · nothing is charged when you book</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { width: '100%', paddingTop: 40, backgroundColor: 'transparent' },
  inner: { width: '100%', maxWidth: 1216, alignSelf: 'center', paddingHorizontal: 32, paddingTop: 48, paddingBottom: 26, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.primaryDark },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 32, alignItems: 'flex-start' },
  brandCol: { flexBasis: 260, flexGrow: 1.2, gap: 14, minWidth: 220 },
  logoChip: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.white },
  logo: { width: 138, height: 45 },
  blurb: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 22, color: 'rgba(255,255,255,0.82)' },
  col: { flexBasis: 170, flexGrow: 1, gap: 10, minWidth: 150 },
  colTitle: { marginBottom: 6, fontFamily: fonts.extraBold, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', color: '#FFD76A' },
  link: { paddingVertical: 2 },
  linkHover: { opacity: 0.8 },
  linkText: { fontFamily: fonts.semiBold, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.86)' },
  legal: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginTop: 40, paddingTop: 22, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)' },
  legalText: { fontFamily: fonts.medium, fontSize: 12.5, color: 'rgba(255,255,255,0.78)' },
});
