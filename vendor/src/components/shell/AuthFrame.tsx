// The frame for everything before the workspace (sign-in, sign-up): a dark brand panel beside the form on tablets and
// desktop browsers, the NESAM PARTNER lockup above the form on phones — the same structure as the NESAM Driver app.
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PartnerBanner } from './PartnerBanner';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAvoid } from '../KeyboardAvoid';
import { colors, fontFamily } from '../../theme';
import { useLayout } from '../../theme/responsive';
import type { IconName } from '../kit/core';

export const AUTH = {
  panel: '#202128',
  panelMuted: '#BBBEC8',
  ink: '#171B24',
  muted: '#6F7785',
  line: '#E7EAF0',
  fieldLine: '#D8DFE9',
  page: '#F6F7F9',
} as const;

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'map-outline', title: 'Duties at a payout you see first', text: 'Accept the offer or bid your own price. No surprises.' },
  { icon: 'people-outline', title: 'Your drivers and fleet, one place', text: 'Assign a verified driver and vehicle to every duty in seconds.' },
  { icon: 'wallet-outline', title: 'Every rupee accounted for', text: 'Earnings, statements, settlements and payouts in one wallet.' },
];

/** The NESAM PARTNER banner (assets/brand/partner-banner.png). */
export function PartnerBrand({ size = 1 }: { size?: number }) {
  return <PartnerBanner height={Math.round(56 * size)} />;
}

export function AuthFrame({ children }: { children: React.ReactNode }) {
  const { width } = useLayout();
  const split = width >= 820;
  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoid>
        <View style={[styles.row, !split && { flexDirection: 'column' }]}>
          {split ? (
            <View style={[styles.panel, { width: Math.min(520, Math.max(360, width * 0.42)) }]}>
              <View style={styles.ring} pointerEvents="none" />
              <View style={styles.ringSmall} pointerEvents="none" />
              <View style={styles.brandCard}><PartnerBrand size={1.05} /></View>
              <View style={{ flex: 1, justifyContent: 'center', paddingVertical: 32 }}>
                <Text style={styles.headline}>Grow your fleet with NESAM.</Text>
                <Text style={styles.subline}>Accept duties, assign your team and track every settlement — on your phone or on the web.</Text>
                <View style={{ marginTop: 34, gap: 22 }}>
                  {FEATURES.map((f) => (
                    <View key={f.title} style={styles.feature}>
                      <View style={styles.featureIcon}><Ionicons name={f.icon} size={19} color={colors.white} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.featureTitle}>{f.title}</Text>
                        <Text style={styles.featureText}>{f.text}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
              <View style={styles.panelFoot}>
                <Ionicons name="shield-checkmark-outline" size={13} color={AUTH.panelMuted} />
                <Text style={styles.panelFootText}>NESAM TOURS & TRAVELS PRIVATE LIMITED</Text>
              </View>
            </View>
          ) : null}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.scroll, split && { justifyContent: 'center' }]} keyboardShouldPersistTaps="always" keyboardDismissMode="none" removeClippedSubviews={false}>
            <View style={styles.formCol}>
              {split ? null : <View style={styles.phoneBrand}><PartnerBrand size={1.25} /></View>}
              {children}
              <Text style={styles.legal}>NESAM Tours & Travels Private Limited · Built for every fleet.</Text>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}

/** White card holding one step of the form. */
export function AuthCard({ children, eyebrow, title, subtitle }: { children: React.ReactNode; eyebrow?: string; title?: string; subtitle?: React.ReactNode }) {
  return (
    <View style={styles.card}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      {title ? <Text style={styles.title} accessibilityRole="header">{title}</Text> : null}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: AUTH.page },
  row: { flex: 1, flexDirection: 'row' },
  panel: { backgroundColor: AUTH.panel, paddingHorizontal: 44, paddingTop: 40, paddingBottom: 30, overflow: 'hidden' },
  ring: { position: 'absolute', top: -90, right: -120, width: 360, height: 360, borderRadius: 180, borderWidth: 54, borderColor: 'rgba(255,255,255,0.035)' },
  ringSmall: { position: 'absolute', bottom: -70, left: -60, width: 200, height: 200, borderRadius: 100, borderWidth: 30, borderColor: 'rgba(198,40,40,0.18)' },
  brandCard: { alignSelf: 'flex-start', backgroundColor: colors.white, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16 },
  headline: { fontFamily, fontSize: 38, lineHeight: 46, fontWeight: '700', letterSpacing: -1.4, color: colors.white },
  subline: { fontFamily, fontSize: 14, lineHeight: 23, color: AUTH.panelMuted, marginTop: 14, maxWidth: 400 },
  feature: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  featureIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  featureTitle: { fontFamily, fontSize: 14, fontWeight: '600', color: colors.white },
  featureText: { fontFamily, fontSize: 12.5, lineHeight: 19, color: AUTH.panelMuted, marginTop: 3 },
  panelFoot: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  panelFootText: { fontFamily, fontSize: 10, letterSpacing: 0.3, color: AUTH.panelMuted },
  scroll: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 28, paddingBottom: 28 },
  formCol: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  phoneBrand: { alignItems: 'center', marginBottom: 26, marginTop: 6 },
  card: { backgroundColor: colors.white, borderWidth: 1, borderColor: AUTH.line, borderRadius: 18, padding: 24, shadowColor: '#162033', shadowOpacity: 0.05, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 2 },
  eyebrow: { fontFamily, fontSize: 10, fontWeight: '700', letterSpacing: 1.35, color: AUTH.muted, textTransform: 'uppercase', marginBottom: 6 },
  title: { fontFamily, fontSize: 23, fontWeight: '700', letterSpacing: -0.7, color: AUTH.ink },
  subtitle: { fontFamily, fontSize: 13, lineHeight: 21, color: AUTH.muted, marginTop: 6, marginBottom: 4 },
  legal: { fontFamily, fontSize: 11, lineHeight: 17, color: '#989DA6', textAlign: 'center', marginTop: 20 },
});
