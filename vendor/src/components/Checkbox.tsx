import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '../theme';

/** A labelled tick box with a large touch target. */
export function Checkbox({ checked, onChange, label, tone = colors.primary }: { checked: boolean; onChange: (v: boolean) => void; label: string; tone?: string }) {
  return (
    <Pressable onPress={() => onChange(!checked)} style={styles.row} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label}>
      <View style={[styles.box, { borderColor: tone }, checked && { backgroundColor: tone }]}>{checked ? <Text style={styles.tick}>✓</Text> : null}</View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.sm },
  box: { width: 26, height: 26, borderRadius: radius.sm, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  tick: { color: colors.white, fontWeight: '900', fontSize: 16 },
  label: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink },
});
