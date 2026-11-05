import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import { useNavigation } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { Button, EmptyState } from '../components/ui';
import { ScrollView } from '../components/layout';
import { AppHeader } from '../components/brand';
import { isCouponLive, subscribeToCoupons } from '../services/pricingService';
import type { Coupon } from '../types';
import { colors, fonts, space } from '../theme';

export function OffersScreen() {
  const navigation = useNavigation();
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => subscribeToCoupons(setCoupons), []);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const live = useMemo(() => (coupons ?? []).filter((c) => isCouponLive(c)), [coupons]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
<KeyboardAvoid>
      <AppHeader title="Offers & Coupons" onBack={() => navigation.goBack()} />
      <ScrollView kind="narrow" contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        {coupons === null ? (
          <Text style={styles.loading}>Loading offers…</Text>
        ) : live.length === 0 ? (
          <EmptyState icon="tag" title="No offers right now" message="Check back soon for discounts and promo codes." />
        ) : (
          <View style={{ gap: 12 }}>
            {live.map((c) => (
              <View key={c.id} style={styles.card}>
                <View style={styles.tag}>
                  <Text style={styles.tagText}>{c.discountType === 'PERCENTAGE' ? `${c.discountValue}% OFF` : `FLAT ₹${c.discountValue} OFF`}</Text>
                </View>
                <Text style={styles.title}>
                  {c.discountType === 'PERCENTAGE' ? `${c.discountValue}% off${c.maximumDiscount ? ` (up to ₹${c.maximumDiscount})` : ''}` : `₹${c.discountValue} instant discount`}
                </Text>
                <Text style={styles.desc}>{c.description || c.name}</Text>
                <Text style={styles.terms}>
                  {c.minimumBookingAmount ? `Min booking ₹${c.minimumBookingAmount} · ` : ''}
                  {c.firstBookingOnly ? 'First trip only · ' : ''}
                  {c.validUntil ? `Valid till ${c.validUntil}` : 'No expiry date'}
                </Text>
                <Button
                  small
                  icon={copied === c.code ? 'check' : 'copy'}
                  variant={copied === c.code ? 'secondary' : 'dark'}
                  title={copied === c.code ? 'Copied' : `Copy ${c.code}`}
                  onPress={() => {
                    void Clipboard.setStringAsync(c.code).then(() => setCopied(c.code));
                  }}
                  accessibilityLabel={`Copy code ${c.code}`}
                  style={{ marginTop: 12, alignSelf: 'flex-start' }}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </KeyboardAvoid>
</SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  page: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xxl },
  loading: { fontFamily: fonts.medium, textAlign: 'center', marginTop: space.xl, color: colors.muted, fontSize: 13 },
  card: { borderWidth: 1, borderColor: '#E3E7EC', borderRadius: 10, padding: 16, backgroundColor: colors.white },
  tag: { alignSelf: 'flex-start', backgroundColor: '#FFF1F1', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5, marginBottom: 10 },
  tagText: { fontFamily: fonts.bold, color: colors.primary, fontSize: 10, letterSpacing: 0.4 },
  title: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.ink },
  desc: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: '#55606F', marginTop: 4 },
  terms: { fontFamily: fonts.regular, fontSize: 11, color: '#7A8494', marginTop: 6 },
});
