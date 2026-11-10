// Terms, privacy & policies, as on the website's /legal page: the public customer policies (readable before sign-in,
// each with its "In short" box), then the agreement versions NESAM has published and whether this account has accepted
// them (acceptance itself happens in LegalGate when a new version is published).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView as RNScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { callFunction } from '../services/callables';
import { Badge, Disclosure, Notice } from '../components/ui';
import { AppHeader } from '../components/brand';
import { useAuthGate } from '../context/AuthGate';
import { useDockPad } from '../context/Dock';
import { COMPANY_LEGAL_NAME, SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config/constants';
import { ADDRESS, BRAND, POLICIES, UPDATED, type Block, type Policy } from '../data/policies';
import type { RootStackParamList } from '../navigation/types';
import { colors, fonts, space } from '../theme';

interface DocRow {
  key: string;
  title: string;
  version: number;
  body: string;
  accepted: boolean;
}

const TITLES: Record<Policy['id'], string> = {
  terms: 'Terms & Conditions',
  'trip-rules': 'Trip Rules & Charges',
  payment: 'Fare & Payment Policy',
  cancellation: 'Cancellation Policy',
  refund: 'Refund Policy',
  conduct: 'Passenger Conduct, Luggage & Pets',
  safety: 'Passenger Safety & Support',
  privacy: 'Privacy & Location Policy',
  deletion: 'Account & Data Deletion',
  complaints: 'Complaints & Grievances',
};

function BlockView({ block }: { block: Block }) {
  if ('h' in block) return <Text style={styles.h3}>{block.h}</Text>;
  if ('p' in block) return <Text style={styles.p}>{block.p}</Text>;
  const items = 'ul' in block ? block.ul : block.ol;
  const ordered = 'ol' in block;
  return (
    <View style={styles.list}>
      {items.map((t, i) => (
        <View key={i} style={styles.li}>
          <Text style={styles.bullet}>{ordered ? `${i + 1}.` : '•'}</Text>
          <Text style={styles.liText}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

export function LegalDocumentsScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'LegalDocuments'>>();
  const { guest } = useAuthGate();
  const dockPad = useDockPad();
  const [rows, setRows] = useState<DocRow[] | null>(null);
  const [error, setError] = useState('');
  const scroller = useRef<RNScrollView>(null);
  const offsets = useRef<Record<string, number>>({});
  const wanted = route.params?.section;

  const goTo = useCallback((id: string) => {
    const y = offsets.current[id];
    if (y != null) scroller.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  }, []);

  // Opening a section from the side menu scrolls to it once the page has laid out.
  useEffect(() => {
    if (!wanted) return undefined;
    const t = setTimeout(() => goTo(wanted), 350);
    return () => clearTimeout(t);
  }, [wanted, goTo]);

  // The published agreement versions belong to an account; a guest reads the policies only.
  useEffect(() => {
    if (guest) return undefined;
    let alive = true;
    (async () => {
      try {
        const s = await callFunction<unknown, { missing: { key: string }[]; required: { key: string; title: string; version: number }[] }>('getLegalStatus', { role: 'customer' });
        const missing = new Set(s.missing.map((m) => m.key));
        const bodies = await Promise.all(s.required.map(async (r) => String((await getDoc(doc(db, 'legal_documents', r.key))).data()?.body ?? '')));
        if (!alive) return;
        setRows(s.required.map((r, i) => ({ key: r.key, title: r.title || r.key, version: r.version, body: bodies[i] ?? '', accepted: !missing.has(r.key) })));
      } catch {
        if (alive) setError('We couldn’t load the documents. Check your connection and try again.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [guest]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <KeyboardAvoid>
        <AppHeader title="Terms, privacy and policies" onBack={() => navigation.goBack()} />
        <RNScrollView ref={scroller} contentContainerStyle={[styles.page, { paddingBottom: space.xxl + dockPad }]} showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <Text style={styles.h2}>{BRAND} customer policies</Text>
            <Text style={styles.p}>
              Last updated {UPDATED}. These policies explain how booking, fares, payments, cancellations, refunds, safety and your data work with {BRAND}. We have written them in plain language. If anything is unclear, call us on{' '}
              <Text style={styles.link} onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)}>
                {SUPPORT_PHONE_DISPLAY}
              </Text>{' '}
              and we will explain.
            </Text>
            <View style={styles.contents}>
              {POLICIES.map((p) => (
                <Pressable key={p.id} onPress={() => goTo(p.id)} accessibilityRole="link" hitSlop={4}>
                  <Text style={styles.link}>{TITLES[p.id]}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {POLICIES.map((p) => (
            <View key={p.id} style={styles.card} onLayout={(e) => {
                offsets.current[p.id] = e.nativeEvent.layout.y;
              }}>
              <Text style={styles.h2} accessibilityRole="header">
                {TITLES[p.id]}
              </Text>
              <View style={styles.short}>
                <Text style={styles.shortTitle}>In short</Text>
                {p.short.map((t, i) => (
                  <View key={i} style={styles.li}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={styles.liText}>{t}</Text>
                  </View>
                ))}
              </View>
              {p.blocks.map((b, i) => (
                <BlockView key={i} block={b} />
              ))}
            </View>
          ))}

          <View style={styles.card}>
            <Text style={styles.h2}>Contact us</Text>
            <Text style={styles.p}>
              {COMPANY_LEGAL_NAME}, {ADDRESS}
            </Text>
            <Text style={styles.p}>
              Call{' '}
              <Text style={styles.link} onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)}>
                {SUPPORT_PHONE_DISPLAY}
              </Text>
              , or email{' '}
              <Text style={styles.link} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}>
                {SUPPORT_EMAIL}
              </Text>
              .
            </Text>
          </View>

          {!guest ? (
            <>
              <Notice message={error} />
              {rows === null && !error ? <ActivityIndicator color={colors.primary} style={{ marginTop: space.lg }} /> : null}
              {rows && rows.length ? (
                <View style={styles.docs}>
                  {rows.map((r) => (
                    <Disclosure key={r.key} title={r.title} variant="faq">
                      <View style={{ marginBottom: 8 }}>
                        <Badge label={`Version ${r.version} · ${r.accepted ? 'Accepted' : 'Not yet accepted'}`} tone={r.accepted ? 'success' : 'warning'} />
                      </View>
                      <Text style={styles.p}>{r.body || 'This document has no text yet.'}</Text>
                    </Disclosure>
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <Text style={styles.guestNote}>Sign in to see the agreement versions published for your account and whether you have accepted them.</Text>
          )}
        </RNScrollView>
      </KeyboardAvoid>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  page: { paddingHorizontal: 14, paddingTop: space.sm, gap: 14 },
  card: { padding: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 6, backgroundColor: colors.white },
  h2: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 25, color: colors.ink },
  h3: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.ink, marginTop: 18 },
  p: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 24, color: colors.text, marginTop: 8 },
  link: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.primary },
  contents: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 8, marginTop: 12 },
  short: { marginTop: 12, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 6, backgroundColor: colors.primarySoft, borderLeftWidth: 4, borderLeftColor: colors.primary, gap: 4 },
  shortTitle: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink, marginBottom: 2 },
  list: { marginTop: 8, gap: 6 },
  li: { flexDirection: 'row', gap: 8 },
  bullet: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 23, color: colors.text, width: 16 },
  liText: { flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 23, color: colors.text },
  docs: { borderTopWidth: 1, borderTopColor: colors.border },
  guestNote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.muted, textAlign: 'center' },
});
