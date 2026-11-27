// The frame for everything before the workspace (sign-in, verification status, errors): a brand panel beside the form on
// desktop and tablets, the brand lockup above the form on phones. Same tokens as the workspace (theme/nx.ts).
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from './nx/Text';
import { KeyboardAvoid } from './KeyboardAvoid';
import { NxLogo } from './nx/Brand';
import { NxIcon, type NxIconName } from './nx/Icon';
import { useLayout } from './nx/layout';
import { nx } from '../theme/nx';
import { COPYRIGHT_HOLDER } from '../config/constants';

const FEATURES: { icon: NxIconName; title: string; text: string }[] = [
  { icon: 'trip', title: 'Duties that fit your car', text: 'See the payout before you accept. No surprises.' },
  { icon: 'shield', title: 'Every trip, step by step', text: 'Photos, boarding OTP and closing — guided and verified.' },
  { icon: 'wallet', title: 'Every rupee accounted for', text: 'Earnings, settlements and payouts in one wallet.' },
];

export function AuthFrame({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  const { mode, width } = useLayout();
  const split = mode === 'sidebar' || (mode === 'rail' && width >= 820);
  const form = (
    <View style={styles.formCol}>
      {split ? null : (
        <View style={styles.phoneBrand}>
          <NxLogo />
        </View>
      )}
      {children}
      {footer !== undefined ? footer : <Text style={styles.legal}>© {new Date().getFullYear()} {COPYRIGHT_HOLDER}. All rights reserved.</Text>}
    </View>
  );
  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoid>
        <View style={[styles.row, !split && { flexDirection: 'column' }]}>
          {split ? (
            <View style={[styles.brandPanel, { width: Math.min(520, Math.max(360, width * 0.42)) }]}>
              <View style={styles.ring} pointerEvents="none" />
              <View style={styles.ringSmall} pointerEvents="none" />
              <View style={styles.brandCard}>
                <NxLogo />
              </View>
              <View style={{ flex: 1, justifyContent: 'center', paddingVertical: 32 }}>
                <Text style={styles.headline}>Drive with NESAM.</Text>
                <Text style={styles.subline}>Accept duties, run every trip step by step, and track what you earn — on your phone or on the web.</Text>
                <View style={{ marginTop: 34, gap: 22 }}>
                  {FEATURES.map((f) => (
                    <View key={f.title} style={styles.feature}>
                      <View style={styles.featureIcon}>
                        <NxIcon name={f.icon} size={19} color={nx.white} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.featureTitle}>{f.title}</Text>
                        <Text style={styles.featureText}>{f.text}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
              <View style={styles.panelFoot}>
                <NxIcon name="shield" size={13} color={nx.walletMuted} />
                <Text style={styles.panelFootText}>{COPYRIGHT_HOLDER}</Text>
              </View>
            </View>
          ) : null}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {form}
          </ScrollView>
        </View>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}

/** White card holding a step of the form, topped by the road from the NESAM emblem. */
export function AuthCard({ children, eyebrow, title, subtitle }: { children: React.ReactNode; eyebrow?: string; title?: string; subtitle?: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.road} accessible={false}>
        {Array.from({ length: 9 }, (_, i) => (
          <View key={i} style={styles.lane} />
        ))}
      </View>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      {title ? (
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: nx.page },
  row: { flex: 1, flexDirection: 'row' },
  brandPanel: { backgroundColor: nx.wallet, paddingHorizontal: 44, paddingTop: 40, paddingBottom: 30, overflow: 'hidden' },
  ring: { position: 'absolute', top: -90, right: -120, width: 360, height: 360, borderRadius: 180, borderWidth: 54, borderColor: 'rgba(255,255,255,0.035)' },
  ringSmall: { position: 'absolute', bottom: -70, left: -60, width: 200, height: 200, borderRadius: 100, borderWidth: 30, borderColor: 'rgba(216,32,53,0.16)' },
  brandCard: { alignSelf: 'stretch', backgroundColor: nx.white, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16 },
  headline: { fontSize: 38, lineHeight: 46, fontWeight: '700', letterSpacing: -1.4, color: nx.white },
  subline: { fontSize: 14, lineHeight: 23, color: nx.walletMuted, marginTop: 14, maxWidth: 400 },
  feature: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  featureIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  featureTitle: { fontSize: 14, fontWeight: '600', color: nx.white },
  featureText: { fontSize: 12.5, lineHeight: 19, color: nx.walletMuted, marginTop: 3 },
  panelFoot: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  panelFootText: { fontSize: 10, letterSpacing: 0.3, color: nx.walletMuted },
  // Centred on every screen height; taller content simply scrolls.
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 24 },
  formCol: { width: '100%', maxWidth: 440, alignSelf: 'center' },
  phoneBrand: { marginBottom: 28 },
  card: { backgroundColor: nx.white, borderWidth: 1, borderColor: nx.line, borderRadius: 18, padding: 24, paddingTop: 34, shadowColor: '#162033', shadowOpacity: 0.05, shadowRadius: 22, shadowOffset: { width: 0, height: 8 }, elevation: 2 },
  road: { position: 'absolute', top: 0, left: 0, right: 0, height: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', backgroundColor: '#121212', borderTopLeftRadius: 17, borderTopRightRadius: 17 },
  lane: { width: 16, height: 2, backgroundColor: nx.red },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.35, color: nx.muted, textTransform: 'uppercase', marginBottom: 6 },
  title: { fontSize: 23, fontWeight: '700', letterSpacing: -0.7, color: nx.ink },
  subtitle: { fontSize: 13, lineHeight: 21, color: nx.muted, marginTop: 6, marginBottom: 4 },
  legal: { fontSize: 11, lineHeight: 17, color: nx.subtle, textAlign: 'center', marginTop: 20 },
});
