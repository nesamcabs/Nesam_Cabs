// A section heading with a one-line description, shared by the Add vehicle and Add driver forms; later sections are set off by a hairline.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../kit/Text';
import { colors, fontFamily } from '../../theme';

export function Section({ title, text, first }: { title: string; text: string; first?: boolean }) {
  return (
    <View style={[styles.section, !first && styles.sectionRule]}>
      <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
      <Text style={styles.sectionText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 16 },
  sectionRule: { marginTop: 10, paddingTop: 20, borderTopWidth: 1, borderTopColor: colors.border },
  sectionTitle: { fontFamily, fontSize: 15, fontWeight: '700', color: colors.ink, letterSpacing: -0.2 },
  sectionText: { fontFamily, fontSize: 12, color: colors.muted, lineHeight: 18, marginTop: 3 },
});
