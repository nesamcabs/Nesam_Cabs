import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import { Icon } from './Icon';

/** A labelled tick box (reference style: small square, quiet label) with a full-row touch target. */
export function Checkbox({ checked, onChange, label, tone = colors.primary }: { checked: boolean; onChange: (v: boolean) => void; label: string; tone?: string }) {
  return (
    <Pressable onPress={() => onChange(!checked)} style={styles.row} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label}>
      <View style={[styles.box, checked && { backgroundColor: tone, borderColor: tone }]}>{checked ? <Icon name="check" size={13} color={colors.white} strokeWidth={3} /> : null}</View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 10, minHeight: 44 },
  box: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: '#8D95A1', alignItems: 'center', justifyContent: 'center', marginTop: 1, backgroundColor: colors.white },
  label: { flex: 1, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: '#55606F' },
});
