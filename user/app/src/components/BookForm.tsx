// The website's booking-form pieces (user/web/src/pages/book/BookingForm.tsx + the `.bf` styles), measured from the live
// page: pink pill tabs, white route fields on a dotted rail with a green start dot and a red drop pin, a round swap
// button, outlined date / time cells with a little "Today" chip, and the solid red "Let's Go !" button.
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './brand';
import { colors, fonts } from '../theme';

/** Field outline on the booking card (a soft rose, as on the website). */
export const FIELD_LINE = '#DAC0C9';
const TAB_WELL = '#FCE6E7';
const TAB_INK = '#8B2128';

/** One Way / Round Trip, To airport / From airport, Hourly Rental / Pickup & Drop: two pill tabs in a pink well. */
export function PillTabs<T extends string>({ options, value, onChange, style }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.tabs, style]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)} style={[styles.tab, on && styles.tabOn]}>
            <Text style={[styles.tabText, on && styles.tabTextOn]} numberOfLines={1} maxFontSizeMultiplier={1.15}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A tappable place field: the empty field shows its label as the placeholder, a chosen place shows a small label over the name. */
export function LocationField({
  label,
  value,
  address,
  error,
  onPress,
  trailing,
  leading,
}: {
  label: string;
  value?: string;
  address?: string;
  error?: string;
  onPress: () => void;
  trailing?: React.ReactNode;
  /** A pin shown inside the field, before the text (the Multicity form, which has no rail). */
  leading?: React.ReactNode;
}) {
  return (
    <View>
      <PressableScale
        onPress={onPress}
        activeScale={0.985}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? 'not set'}`}
        accessibilityHint={error || 'Opens location search'}
        style={[styles.field, !!error && styles.fieldError]}
      >
        {leading}
        <View style={{ flex: 1, minWidth: 0 }}>
          {value ? (
            <>
              <Text style={styles.fieldLabel} numberOfLines={1}>
                {label}
              </Text>
              <Text style={styles.fieldValue} numberOfLines={1}>
                {value}
              </Text>
              {address && address !== value ? (
                <Text style={styles.fieldAddr} numberOfLines={1}>
                  {address}
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.fieldPlaceholder} numberOfLines={1}>
              {label}
            </Text>
          )}
        </View>
        {trailing ?? <Icon name="chevron-right" size={16} color={colors.muted} strokeWidth={2} />}
      </PressableScale>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/** The red drop pin (a teardrop with a white dot). */
export function DropPinIcon() {
  return (
    <Svg width={22} height={26} viewBox="0 0 22 26">
      <Path d="M11 1C5.9 1 2.2 4.8 2.2 9.6c0 5.7 6.2 11.5 8 14.1.4.5 1.2.5 1.6 0 1.8-2.6 8-8.4 8-14.1C19.8 4.8 16.1 1 11 1Z" fill="#E8344C" />
      <Path d="M11 6.4a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Z" fill="#fff" />
    </Svg>
  );
}

/**
 * Pickup field above a drop field with the website's rail beside them: a green start dot, a dashed curve and the red
 * pin. The drop field steps in a little, and the round swap button sits between them on the right.
 */
export function RouteRail({
  pickup,
  drop,
  onSwap,
  swapDisabled,
  middle,
}: {
  pickup: React.ReactNode;
  drop: React.ReactNode;
  onSwap?: () => void;
  swapDisabled?: boolean;
  /** Extra rows between pickup and drop (itinerary stops). */
  middle?: React.ReactNode;
}) {
  return (
    <View style={styles.rail}>
      <View style={styles.railArt} pointerEvents="none">
        <Svg width={44} height="100%" viewBox="0 0 44 140" preserveAspectRatio="none">
          <Path d="M17 38 C 2 58, 2 96, 31 118" stroke="#8D9AAE" strokeWidth={2} strokeDasharray="6 6" strokeLinecap="round" fill="none" />
        </Svg>
        <View style={styles.startDotHalo}>
          <View style={styles.startDot} />
        </View>
        <View style={styles.dropPin}>
          <DropPinIcon />
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <View>{pickup}</View>
        {middle}
        <View style={{ marginLeft: 18 }}>{drop}</View>
      </View>
      {onSwap ? (
        <PressableScale
          onPress={onSwap}
          disabled={swapDisabled}
          activeScale={0.88}
          accessibilityRole="button"
          accessibilityLabel="Swap pickup and drop"
          style={[styles.swap, swapDisabled && { opacity: 0.55 }]}
          containerStyle={styles.swapWrap}
        >
          <Icon name="arrow-up-down" size={20} color={colors.primary} strokeWidth={2.2} />
        </PressableScale>
      ) : null}
    </View>
  );
}

/** Date / time cell: small uppercase label top-left, the value at the bottom, an icon on the right and an optional chip. */
export function ScheduleCell({
  label,
  value,
  icon,
  chip,
  error,
  onPress,
}: {
  label: string;
  value?: string;
  icon: IconName;
  chip?: string;
  error?: string;
  onPress: () => void;
}) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <PressableScale
        onPress={onPress}
        activeScale={0.97}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || 'not set'}`}
        accessibilityHint={error || undefined}
        style={[styles.cell, !!error && styles.fieldError]}
      >
        <Text style={styles.cellLabel}>{label}</Text>
        <Text style={styles.cellValue} numberOfLines={1}>
          {value ?? ''}
        </Text>
        <View style={styles.cellIcon}>
          <Icon name={icon} size={22} color={colors.ink} strokeWidth={1.9} />
        </View>
      </PressableScale>
      {chip ? (
        <View style={styles.chip} pointerEvents="none">
          <Text style={styles.chipText}>{chip}</Text>
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

/** The solid red call to action ("Let's Go !", "See fares"). */
export function GoButton({ title, onPress, loading, disabled, style }: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <PressableScale
      onPress={disabled || loading ? undefined : onPress}
      activeScale={0.98}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={[styles.go, (disabled || loading) && { opacity: 0.6 }, style]}
    >
      <Text style={styles.goText} maxFontSizeMultiplier={1.2}>
        {loading ? 'Please wait…' : title}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', padding: 5, gap: 4, borderRadius: 4, backgroundColor: TAB_WELL },
  tab: { flex: 1, minHeight: 44, paddingHorizontal: 12, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.primary },
  tabText: { fontFamily: fonts.bold, fontSize: 16, color: TAB_INK },
  tabTextOn: { color: colors.white },
  field: {
    minHeight: 64,
    paddingVertical: 9,
    paddingLeft: 16,
    paddingRight: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: FIELD_LINE,
    borderRadius: 6,
    backgroundColor: colors.white,
  },
  fieldError: { borderColor: colors.danger, backgroundColor: '#FFFBFA' },
  fieldLabel: { fontFamily: fonts.bold, fontSize: 10.5, lineHeight: 14, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.muted },
  fieldValue: { fontFamily: fonts.extraBold, fontSize: 16, lineHeight: 22, color: colors.ink },
  fieldAddr: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 15, color: colors.muted },
  fieldPlaceholder: { fontFamily: fonts.bold, fontSize: 14, letterSpacing: 0.42, textTransform: 'uppercase', color: colors.ink },
  error: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, color: colors.danger, marginTop: 5, marginLeft: 2 },
  rail: { paddingLeft: 38, position: 'relative' },
  railArt: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 44 },
  startDotHalo: { position: 'absolute', left: 10, top: 20, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(34,168,90,0.3)', alignItems: 'center', justifyContent: 'center' },
  startDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#22A85A' },
  dropPin: { position: 'absolute', left: 17, bottom: 18 },
  swapWrap: { position: 'absolute', right: 24, top: '50%', marginTop: -20 },
  swap: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#F5B0B2', backgroundColor: '#FCE9E9', alignItems: 'center', justifyContent: 'center' },
  cell: {
    height: 62,
    borderWidth: 1,
    borderColor: FIELD_LINE,
    borderRadius: 6,
    backgroundColor: colors.white,
    paddingLeft: 12,
    paddingRight: 32,
    paddingTop: 20,
    paddingBottom: 4,
    justifyContent: 'flex-end',
  },
  cellLabel: { position: 'absolute', top: 8, left: 14, fontFamily: fonts.extraBold, fontSize: 10.4, letterSpacing: 0.42, textTransform: 'uppercase', color: colors.muted },
  cellValue: { fontFamily: fonts.semiBold, fontSize: 16, lineHeight: 26, color: colors.ink },
  cellIcon: { position: 'absolute', right: 10, top: 0, bottom: 0, justifyContent: 'center' },
  chip: { position: 'absolute', top: -9, right: 10, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, backgroundColor: '#DFCAD4' },
  chipText: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, color: colors.ink },
  go: { minHeight: 52, borderRadius: 4, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  goText: { fontFamily: fonts.semiBold, fontSize: 16, letterSpacing: 0.48, color: colors.white },
});
