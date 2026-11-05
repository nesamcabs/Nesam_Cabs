// Terms, privacy & policies: the customer documents NESAM has published, the version in
// force and whether this account has accepted it (acceptance itself happens in
// LegalGate when a new version is published).
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import { useNavigation } from '@react-navigation/native';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { callFunction } from '../services/callables';
import { Badge, Disclosure, Notice } from '../components/ui';
import { ScrollView } from '../components/layout';
import { AppHeader } from '../components/brand';
import { colors, fonts, space } from '../theme';

interface DocRow {
  key: string;
  title: string;
  version: number;
  body: string;
  accepted: boolean;
}

export function LegalDocumentsScreen() {
  const navigation = useNavigation();
  const [rows, setRows] = useState<DocRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
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
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
<KeyboardAvoid>
      <AppHeader title="Terms & Privacy" onBack={() => navigation.goBack()} />
      <ScrollView kind="narrow" contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <Notice message={error} />
        {rows === null && !error ? <ActivityIndicator color={colors.primary} style={{ marginTop: space.xl }} /> : null}
        {rows && rows.length === 0 ? <Text style={styles.muted}>NESAM has not published customer terms or a privacy policy in the app yet. Contact support for a copy.</Text> : null}
        <View style={rows && rows.length ? styles.list : undefined}>
          {rows?.map((r) => (
            <View key={r.key}>
              <Disclosure title={r.title} variant="faq">
                <View style={{ marginBottom: 8 }}>
                  <Badge label={`Version ${r.version} · ${r.accepted ? 'Accepted' : 'Not yet accepted'}`} tone={r.accepted ? 'success' : 'warning'} />
                </View>
                <Text style={styles.body}>{r.body || 'This document has no text yet.'}</Text>
              </Disclosure>
            </View>
          ))}
        </View>
      </ScrollView>
    </KeyboardAvoid>
</SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  page: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xxl },
  list: { borderTopWidth: 1, borderTopColor: '#E3E6EB' },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: space.xl },
  body: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 20, color: '#55606F' },
});
