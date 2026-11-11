// Confirmation shown at the top of the workspace after an action (the reference's v-feedback), wherever the user lands next.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily } from '../../theme';

type FlashMsg = { id: number; text: string; tone: 'ok' | 'error' };
let seq = 0;
const listeners = new Set<(m: FlashMsg | null) => void>();

/** Show a short confirmation (or error) above the current page. */
export function flash(text: string, tone: 'ok' | 'error' = 'ok'): void {
  if (!text) return;
  const msg = { id: ++seq, text, tone };
  listeners.forEach((l) => l(msg));
}

export function FlashHost() {
  const [msg, setMsg] = useState<FlashMsg | null>(null);
  useEffect(() => {
    const l = (m: FlashMsg | null) => setMsg(m);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  useEffect(() => {
    if (!msg) return undefined;
    const t = setTimeout(() => setMsg((m) => (m?.id === msg.id ? null : m)), msg.tone === 'ok' ? 6000 : 9000);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  const ok = msg.tone === 'ok';
  return (
    <View pointerEvents="box-none" style={styles.host}>
      <View style={[styles.toast, ok ? styles.ok : styles.err]} accessibilityRole={ok ? undefined : 'alert'} accessibilityLiveRegion="polite">
        <Ionicons name={ok ? 'checkmark-circle' : 'alert-circle'} size={19} color={ok ? colors.success : colors.danger} />
        <Text style={[styles.text, { color: ok ? '#2A6A4D' : '#9A2F25' }]}>{msg.text}</Text>
        <Pressable onPress={() => setMsg(null)} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={10}>
          <Ionicons name="close" size={17} color={ok ? '#5A8A72' : '#B0574D'} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, top: 12, alignItems: 'center', paddingHorizontal: 14, zIndex: 50 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 620, width: '100%', borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, shadowColor: '#283747', shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  ok: { backgroundColor: '#F2FAF5', borderColor: '#CFE7D8' },
  err: { backgroundColor: '#FFF5F3', borderColor: '#F1CFC8' },
  text: { flex: 1, fontSize: 13, fontWeight: '500', lineHeight: 19, fontFamily },
});
