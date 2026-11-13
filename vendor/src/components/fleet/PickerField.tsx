// A select box whose list opens right under it, on the same page (no second sheet): a short, scrollable panel with a search box
// when the list is long (every make on the market). Used where a list is long or depends on another choice (models of the make).
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, TextInput } from '../kit/Text';
import { colors, radius, space } from '../../theme';

export interface PickerOption { value: string; label: string; hint?: string }

export function PickerField({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select',
  disabled,
  disabledText,
  error,
  hint,
  required,
  searchable = true,
  suffix = '',
  style,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Not choosable yet (e.g. the model before a make is picked); `disabledText` says why. */
  disabled?: boolean;
  disabledText?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  /** Show the search box (on by default for lists of more than 8). */
  searchable?: boolean;
  /** Appended to the shown value, e.g. " passengers". */
  suffix?: string;
  style?: object;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const showSearch = searchable && options.length > 8;
  const close = () => { setOpen(false); setQuery(''); };

  return (
    <View style={[{ marginBottom: space.md }, style]}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={{ color: colors.primary }}> *</Text> : null}
      </Text>
      {open && showSearch ? (
        // A long list: the field itself becomes the search box, so there is one box to type in and the matches show below it.
        <View style={[styles.field, styles.fieldOpen, !!error && styles.fieldError]}>
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder={current ? current.label : placeholder}
            placeholderTextColor={colors.faint}
            style={styles.searchInput}
            autoCorrect={false}
            accessibilityLabel={`Search ${label}`}
          />
          <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Close ${label} list`}>
            <Ionicons name="chevron-up" size={17} color={colors.muted} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => !disabled && (open ? close() : setOpen(true))}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${current ? current.label : disabled ? disabledText ?? '' : placeholder}`}
          accessibilityState={{ disabled: !!disabled, expanded: open }}
          style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.field, !!error && styles.fieldError, disabled && styles.fieldOff, hovered && !disabled && { borderColor: '#C3C8D0' }, open && styles.fieldOpen]}
        >
          <Text style={[styles.value, !current && styles.placeholder]} numberOfLines={1}>
            {current ? `${current.label}${suffix}` : disabled ? disabledText ?? placeholder : placeholder}
          </Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={17} color={disabled ? '#C3C8D0' : colors.muted} />
        </Pressable>
      )}
      {open ? (
        <View style={styles.panel}>
          <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
            {shown.length === 0 ? <Text style={styles.none}>Nothing matches “{query}”.</Text> : null}
            {shown.map((o) => {
              const on = o.value === value;
              return (
                <Pressable
                  key={o.value}
                  onPress={() => { onChange(o.value); close(); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [styles.option, on && styles.optionOn, hovered && !on && { backgroundColor: colors.bg }]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.optionText, on && { color: colors.primary, fontWeight: '700' }]} numberOfLines={1}>{o.label}{suffix}</Text>
                    {o.hint ? <Text style={styles.optionHint} numberOfLines={1}>{o.hint}</Text> : null}
                  </View>
                  {on ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** A read-only field that shows a value NESAM filled in (with a lock), e.g. the category. */
export function LockedField({ label, value, placeholder, hint }: { label: string; value: string; placeholder: string; hint?: string }) {
  return (
    <View style={{ marginBottom: space.md }}>
      <View style={styles.lockedLabel}>
        <Text style={styles.label}>{label}</Text>
        <Ionicons name="lock-closed-outline" size={12} color={colors.faint} />
      </View>
      <View style={[styles.field, styles.fieldOff]} accessibilityLabel={`${label}: ${value || placeholder}`}>
        <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1}>{value || placeholder}</Text>
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '600', color: colors.ink, marginBottom: 7 },
  lockedLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  field: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.field, borderRadius: radius.md, paddingHorizontal: 13, backgroundColor: colors.white },
  fieldError: { borderColor: colors.primary },
  fieldOpen: { borderColor: colors.primary },
  fieldOff: { backgroundColor: colors.bg, borderColor: colors.border },
  value: { flex: 1, fontSize: 14, color: colors.ink },
  placeholder: { color: colors.faint },
  error: { fontSize: 12, color: colors.primary, marginTop: 5 },
  hint: { fontSize: 11, color: colors.muted, marginTop: 5 },
  panel: { marginTop: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.white, padding: 6, shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  list: { maxHeight: 248 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14, color: colors.ink, paddingVertical: 10 },
  none: { fontSize: 13, color: colors.muted, textAlign: 'center', paddingVertical: 24 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md, marginBottom: 3 },
  optionOn: { backgroundColor: colors.primarySoft },
  optionText: { fontSize: 14, color: colors.ink },
  optionHint: { fontSize: 11, color: colors.muted, marginTop: 2 },
});
