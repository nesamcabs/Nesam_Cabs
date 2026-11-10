// Country dialling-code field for phone numbers (mobile and WhatsApp): a compact button that opens a searchable list.
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Sheet } from './ui';
import { Icon } from './Icon';
import { DIAL_CODES, type DialCode } from '../data/countryCodes';
import { colors, fonts, radius } from '../theme';

export function CountryCodePicker({ value, onChange, label = 'Country code' }: { value: string; onChange: (code: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const list = useMemo<readonly DialCode[]>(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, '');
    if (!q) return DIAL_CODES;
    return DIAL_CODES.filter((c) => c.country.toLowerCase().includes(q) || c.code.replace('+', '').startsWith(q));
  }, [query]);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}. Change`}
        style={({ pressed }) => [styles.btn, pressed && { backgroundColor: colors.subtle }]}
      >
        <Text style={styles.code}>{value}</Text>
        <Icon name="chevron-down" size={15} color={colors.muted} strokeWidth={2.2} />
      </Pressable>
      <Sheet
        visible={open}
        onClose={() => {
          setOpen(false);
          setQuery('');
        }}
        title="Country code"
      >
        <View style={styles.searchWrap}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search country or code"
            placeholderTextColor={colors.faint}
            style={styles.search}
            autoCorrect={false}
            accessibilityLabel="Search country or code"
          />
        </View>
        <FlatList
          data={list}
          keyExtractor={(c) => `${c.country}-${c.code}`}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={false}
          ListEmptyComponent={<Text style={styles.empty}>No country matches “{query}”.</Text>}
          renderItem={({ item }) => {
            const on = item.code === value;
            return (
              <Pressable
                onPress={() => {
                  onChange(item.code);
                  setOpen(false);
                  setQuery('');
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && { backgroundColor: colors.subtle }]}
              >
                <Text style={[styles.country, on && styles.countryOn]} numberOfLines={1}>{item.country}</Text>
                <Text style={[styles.rowCode, on && styles.countryOn]}>{item.code}</Text>
              </Pressable>
            );
          }}
        />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 6, marginRight: 4, minHeight: 36 },
  code: { fontFamily: fonts.semiBold, fontSize: 15.5, color: colors.value },
  searchWrap: { marginHorizontal: 20, marginBottom: 8 },
  search: { minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: 12, fontFamily: fonts.regular, fontSize: 15, color: colors.value },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: 20 },
  rowOn: { backgroundColor: colors.primarySoft },
  country: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.text, paddingRight: 12 },
  countryOn: { fontFamily: fonts.semiBold, color: colors.primary },
  rowCode: { fontFamily: fonts.medium, fontSize: 14.5, color: colors.muted },
  empty: { textAlign: 'center', color: colors.muted, padding: 24, fontFamily: fonts.regular },
});
