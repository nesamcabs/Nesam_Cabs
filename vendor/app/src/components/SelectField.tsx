import React, { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, type } from '../theme';

/** Tap-to-open option list (replaces the Web <select>). */
export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select',
  error,
  required,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={[type.label, { marginBottom: 6 }]}>
        {label}
        {required ? <Text style={{ color: colors.primary }}> *</Text> : null}
      </Text>
      <Pressable onPress={() => setOpen(true)} style={[styles.field, !!error && { borderColor: colors.primary }]} accessibilityRole="button" accessibilityLabel={label}>
        <Text style={[type.body, { flex: 1, color: current ? colors.ink : colors.faint }]} numberOfLines={1}>
          {current?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.card }} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <Pressable onPress={() => setOpen(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.ink} />
            </Pressable>
            <Text style={type.h3}>{label}</Text>
          </View>
          <FlatList
            data={options}
            keyExtractor={(o) => o.value}
            renderItem={({ item }) => (
              <Pressable
                style={styles.option}
                onPress={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: item.value === value }}
              >
                <Text style={[type.body, { flex: 1 }, item.value === value && { fontWeight: '800', color: colors.primary }]}>{item.label}</Text>
                {item.value === value ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 48,
    backgroundColor: colors.card,
  },
  err: { color: colors.primaryDark, fontSize: 12, marginTop: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  option: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, minHeight: 50, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
