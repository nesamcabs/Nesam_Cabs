import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Application from 'expo-application';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { ActionError, callFunction } from '../services/callables';
import { Button, Notice } from './ui';
import { Checkbox } from './Checkbox';
import { colors, radius, space, type } from '../theme';

interface RequiredDoc {
  key: string;
  title: string;
  version: number;
  type: string;
  checkboxText: string;
}

/**
 * Stops the app until the signed-in person has accepted the current published
 * terms, privacy policy and consents for their role (a new version asks again).
 * If nothing is published, or the status can't be read, it lets them through.
 */
export function LegalGate({ role, children }: { role: 'driver' | 'vendor' | 'customer'; children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'ok' | 'needed'>('loading');
  const [missing, setMissing] = useState<RequiredDoc[]>([]);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [open, setOpen] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await callFunction<unknown, { missing: RequiredDoc[] }>('getLegalStatus', { role });
        if (!alive) return;
        if (!s.missing.length) return setState('ok');
        const entries = await Promise.all(s.missing.map(async (m) => [m.key, String((await getDoc(doc(db, 'legal_documents', m.key))).data()?.body ?? '')] as const));
        if (!alive) return;
        setMissing(s.missing);
        setOpen(s.missing[0]!.key);
        setBodies(Object.fromEntries(entries));
        setState('needed');
      } catch {
        // Not being able to read the status must not lock the person out.
        if (alive) setState('ok');
      }
    })();
    return () => {
      alive = false;
    };
  }, [role]);

  if (state === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (state === 'ok') return <>{children}</>;

  const text = missing.find((m) => m.checkboxText)?.checkboxText || 'I agree to the Terms & Conditions and Privacy Policy.';
  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      await callFunction('acceptLegalDocuments', {
        role,
        confirmed: true,
        accept: missing.map((m) => ({ key: m.key, version: m.version })),
        checkboxText: text,
        source: `${role}_app`,
        device: { platform: 'android', appVersion: Application.nativeApplicationVersion ?? '' },
      });
      setState('ok');
    } catch (err) {
      setError(err instanceof ActionError ? err.message : 'Could not record your acceptance. Try again.');
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.head}>
        <Text style={type.h1}>Please review and accept to continue</Text>
        <Text style={type.small}>These documents are new or have changed since you last accepted.</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {missing.map((m) => (
          <View key={m.key} style={styles.doc}>
            <Text style={styles.docTitle} onPress={() => setOpen(open === m.key ? '' : m.key)} accessibilityRole="button">
              {open === m.key ? '▾' : '▸'} {m.title} · version {m.version}
            </Text>
            {open === m.key ? <Text style={styles.docBody}>{bodies[m.key] || 'Loading…'}</Text> : null}
          </View>
        ))}
        <Notice message={error} />
      </ScrollView>
      <View style={styles.foot}>
        <Checkbox checked={checked} onChange={setChecked} label={text} />
        <Button title={busy ? 'Saving…' : 'Accept and continue'} loading={busy} disabled={!checked} onPress={() => void accept()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  root: { flex: 1, backgroundColor: colors.bg },
  head: { padding: space.lg, gap: space.xs, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card },
  body: { padding: space.lg, gap: space.md },
  doc: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md },
  docTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  docBody: { marginTop: space.sm, fontSize: 13, lineHeight: 19, color: colors.text },
  foot: { padding: space.lg, gap: space.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card },
});
