// "Choose Payment Option": book now and pay later, pay a part now (the office sets the percentage), or pay everything now.
// Which of them appear is the office's decision per pickup district and date (Service & Fare Settings › Payment options); the server
// sends the list and checks the choice again when the booking is made. The website shows the same three cards.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { choiceText, type PayChoice, type PayChoiceId } from '../services/paymentService';
import { formatINR } from '../utils/format';
import { colors, fonts } from '../theme';

const BLUE = '#1D63E6';
const TINT = '#EAF2FF';
const LINE = '#E3E8F1';
const ICON: Record<PayChoiceId, IconName> = { later: 'calendar-days', part: 'wallet', full: 'credit-card' };

export function PaymentChoiceCards({ choices, value, onChange, total, disabled }: { choices: PayChoice[]; value: PayChoiceId; onChange: (id: PayChoiceId) => void; total: number; disabled?: boolean }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.headIcon}><Icon name="credit-card" size={22} color={BLUE} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} accessibilityRole="header">Choose Payment Option</Text>
          <Text style={styles.sub}>Select how you’d like to pay for this trip</Text>
        </View>
      </View>
      <View style={styles.secure}>
        <Icon name="shield-check" size={14} color="#067647" />
        <Text style={styles.secureText}>Secure Payment</Text>
      </View>
      <View accessibilityRole="radiogroup">
        {choices.map((c) => {
          const t = choiceText(c, total);
          const on = c.id === value;
          return (
            <Pressable
              key={c.id}
              onPress={disabled ? undefined : () => onChange(c.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: !!disabled }}
              accessibilityLabel={`${t.title}. ${t.subtitle}. ${c.id === 'later' ? 'Nothing to pay now' : `${t.label} ${formatINR(t.amount)}`}${c.recommended ? '. Recommended' : ''}`}
              style={({ pressed }) => [styles.card, on && styles.cardOn, disabled && { opacity: 0.6 }, pressed && { opacity: 0.85 }]}
            >
              <View style={[styles.dot, on && styles.dotOn]}>{on ? <View style={styles.dotInner} /> : null}</View>
              <View style={styles.iconTile}><Icon name={ICON[c.id]} size={20} color={BLUE} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.cardTitle}>{t.title}</Text>
                  {c.recommended ? (
                    <View style={styles.badge}>
                      <Icon name="star" size={10} color="#fff" fill="#fff" />
                      <Text style={styles.badgeText}>Recommended</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.cardSub}>{t.subtitle}</Text>
              </View>
              {c.id === 'later' ? (
                <View style={styles.pill}><Text style={styles.pillText}>{formatINR(0)}</Text></View>
              ) : (
                <View style={styles.amt}>
                  <Text style={styles.amtLabel}>{t.label}</Text>
                  <Text style={styles.amtValue}>{formatINR(t.amount)}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, marginBottom: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: TINT, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
  sub: { fontFamily: fonts.regular, fontSize: 12, color: '#667085', marginTop: 2 },
  secure: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 10, marginBottom: 12, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#ECFDF3' },
  secureText: { fontFamily: fonts.semiBold, fontSize: 11.5, color: '#067647' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderColor: LINE, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 13, backgroundColor: '#fff', marginBottom: 10 },
  cardOn: { borderColor: BLUE, backgroundColor: '#F3F8FF' },
  dot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#98A2B3', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  dotOn: { borderColor: BLUE },
  dotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: BLUE },
  iconTile: { width: 40, height: 40, borderRadius: 11, backgroundColor: TINT, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, rowGap: 4 },
  cardTitle: { fontFamily: fonts.bold, fontSize: 14.5, color: colors.ink },
  cardSub: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 16, color: '#667085', marginTop: 3 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: BLUE },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 10, color: '#fff' },
  pill: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, backgroundColor: TINT },
  pillText: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  amt: { alignItems: 'flex-end', paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: LINE },
  amtLabel: { fontFamily: fonts.regular, fontSize: 10.5, color: '#667085' },
  amtValue: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink, marginTop: 1 },
});
