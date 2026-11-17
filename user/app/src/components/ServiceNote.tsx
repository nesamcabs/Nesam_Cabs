// The one-line note under a service's tabs (Customer UX 9.0) and its "Details" sheet: what the service includes, what it does
// not, and which charges are extra. The words live in `data/serviceCopy`; no price is ever written here.
import React, { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Button, Sheet } from './ui';
import { Icon } from './Icon';
import { PressableScale } from './brand';
import { SERVICE_COPY, type ServiceNoteKind } from '../data/serviceCopy';
import { colors, fonts, space } from '../theme';

export function ServiceNote({ kind, compact = false, style }: { kind: ServiceNoteKind; compact?: boolean; style?: StyleProp<ViewStyle> }) {
  const [open, setOpen] = useState(false);
  const copy = SERVICE_COPY[kind];
  return (
    <>
      <View style={[styles.note, style]} accessibilityRole="summary">
        <Icon name="info" size={14} color={colors.primary} strokeWidth={2} />
        <View style={styles.text}>
          <Text style={styles.title}>{copy.title}</Text>
          {compact ? null : <Text style={styles.sub}>{copy.sub}</Text>}
        </View>
        <PressableScale onPress={() => setOpen(true)} activeScale={0.95} style={styles.more} accessibilityRole="button" accessibilityLabel={`${copy.heading} service details`}>
          <Text style={styles.moreText}>Details</Text>
        </PressableScale>
      </View>
      <Sheet visible={open} onClose={() => setOpen(false)} title={copy.heading}>
        <Text style={styles.intro}>{copy.intro}</Text>
        {copy.items.map(([label, text]) => {
          const no = label === 'Not included';
          return (
            <View key={label} style={styles.row}>
              <View style={[styles.mark, no && styles.markNo]}>
                <Icon name={no ? 'x' : 'check'} size={13} color={no ? '#B42318' : '#1A7A3F'} strokeWidth={2.6} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowLabel}>{label}</Text>
                <Text style={styles.rowText}>{text}</Text>
              </View>
            </View>
          );
        })}
        <Button title="Got it" onPress={() => setOpen(false)} style={{ marginTop: space.md }} />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  note: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6, paddingVertical: 4, paddingLeft: 9, paddingRight: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.white },
  text: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.bold, fontSize: 11.5, lineHeight: 15, color: colors.ink },
  sub: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 13, color: colors.muted, marginTop: 1 },
  more: { minHeight: 24, paddingHorizontal: 9, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontFamily: fonts.bold, fontSize: 10.5, color: colors.primary },
  intro: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.muted, marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  mark: { width: 22, height: 22, marginTop: 1, borderRadius: 11, backgroundColor: '#E7F5EC', alignItems: 'center', justifyContent: 'center' },
  markNo: { backgroundColor: '#FEF1F0' },
  rowLabel: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  rowText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.muted, marginTop: 2 },
});
