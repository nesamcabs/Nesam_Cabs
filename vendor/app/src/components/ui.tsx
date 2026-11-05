// Shared UI primitives for the NESAM Vendor app.
import React from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { KeyboardAvoid, useKeyboardHeight } from './KeyboardAvoid';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, type } from '../theme';
import { initials } from '../utils/format';

// ── Layout ──────────────────────────────────────────────────────────────────

export function Screen({
  children,
  scroll = true,
  edges = ['top'],
  padded = true,
  footer,
  refreshControl,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  padded?: boolean;
  footer?: React.ReactNode;
  refreshControl?: React.ComponentProps<typeof ScrollView>['refreshControl'];
}) {
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[padded && styles.padded, { paddingBottom: space.xxl }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, padded && styles.padded]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      <KeyboardAvoid>
        {body}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoid>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function Row({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.bold]} numberOfLines={2}>
        {label}
      </Text>
      <Text style={[styles.rowValue, bold && styles.bold]} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

// ── Buttons ─────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'dark' | 'success';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
  small,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  accessibilityLabel?: string;
}) {
  const v = BUTTON_VARIANTS[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: v.bg, borderColor: v.border },
        inactive && styles.btnDisabled,
        pressed && !inactive && styles.btnPressed,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} style={{ marginRight: 8 }} /> : null}
      <Text style={[styles.btnText, small && styles.btnTextSmall, { color: v.fg }]} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

const BUTTON_VARIANTS: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: colors.white, border: colors.primary },
  secondary: { bg: colors.white, fg: colors.ink, border: colors.border },
  danger: { bg: colors.danger, fg: colors.white, border: colors.danger },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  dark: { bg: colors.ink, fg: colors.white, border: colors.ink },
  success: { bg: colors.success, fg: colors.white, border: colors.success },
};

export function LinkText({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return (
    <Text accessibilityRole="link" style={styles.link} onPress={onPress}>
      {children}
    </Text>
  );
}

// ── Inputs ──────────────────────────────────────────────────────────────────

export function TextField({
  label,
  error,
  hint,
  prefix,
  required,
  style,
  ...input
}: TextInputProps & { label?: string; error?: string; hint?: string; prefix?: string; required?: boolean }) {
  return (
    <View style={[{ marginBottom: space.md }, style as StyleProp<ViewStyle>]}>
      {label ? (
        <Text style={styles.fieldLabel}>
          {label}
          {required ? <Text style={{ color: colors.primary }}> *</Text> : null}
        </Text>
      ) : null}
      <View style={[styles.inputWrap, !!error && styles.inputError, input.editable === false && styles.inputDisabled]}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput placeholderTextColor={colors.faint} style={styles.input} accessibilityLabel={label} {...input} />
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segment} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segmentItem, on && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={[styles.chip, active && styles.chipOn]}
    >
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

// ── Feedback ────────────────────────────────────────────────────────────────

type NoticeTone = 'error' | 'info' | 'success' | 'warning';
const NOTICE: Record<NoticeTone, { bg: string; border: string; fg: string }> = {
  error: { bg: colors.primarySoft, border: colors.primaryBorder, fg: colors.primaryDark },
  info: { bg: colors.infoSoft, border: '#C9D8F0', fg: colors.info },
  success: { bg: colors.successSoft, border: colors.successBorder, fg: colors.success },
  warning: { bg: colors.warningSoft, border: colors.warningBorder, fg: colors.warning },
};

export function Notice({
  message,
  tone = 'error',
  onRetry,
  style,
}: {
  message: string;
  tone?: NoticeTone;
  onRetry?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  if (!message) return null;
  const t = NOTICE[tone];
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      style={[styles.notice, { backgroundColor: t.bg, borderColor: t.border }, style]}
    >
      <Text style={[styles.noticeText, { color: t.fg }]}>{message}</Text>
      {onRetry ? (
        <Text style={[styles.noticeRetry, { color: t.fg }]} onPress={onRetry} accessibilityRole="button">
          Retry
        </Text>
      ) : null}
    </View>
  );
}

export function FullScreenLoader({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      {label ? <Text style={[type.small, { marginTop: space.md }]}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: React.ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMsg}>{message}</Text> : null}
      {action ? <View style={{ marginTop: space.md, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand' }) {
  const map = {
    neutral: { bg: '#F0F1F4', fg: '#596072' },
    success: { bg: colors.successSoft, fg: colors.success },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.primarySoft, fg: colors.danger },
    info: { bg: colors.infoSoft, fg: colors.info },
    brand: { bg: colors.primarySoft, fg: colors.primary },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: map.bg }]}>
      <Text style={[styles.badgeText, { color: map.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function Avatar({ name, photoUrl, size = 48 }: { name: string; photoUrl?: string; size?: number }) {
  if (photoUrl) {
    return <Image source={{ uri: photoUrl }} style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: colors.border }} />;
  }
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size * 0.3 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>{initials(name)}</Text>
    </View>
  );
}

// ── Sheet (bottom modal) ────────────────────────────────────────────────────

export function Sheet({
  visible,
  onClose,
  title,
  children,
  dismissible = true,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  dismissible?: boolean;
}) {
  // Edge-to-edge Android does not resize the window for the keyboard, so the sheet is lifted by the keyboard height
  // (reported above the navigation bar, which the sheet's bottom safe-area padding already clears). The sheet and its
  // scroll body may shrink, so the focused field and the actions stay reachable by scrolling. iOS keeps KeyboardAvoidingView.
  const keyboardHeight = useKeyboardHeight();
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={dismissible ? onClose : () => undefined}>
      <View style={[styles.sheetBackdrop, { paddingBottom: Platform.OS === 'android' ? keyboardHeight : 0 }]}>
        <Pressable style={{ flex: 1 }} onPress={dismissible ? onClose : undefined} accessibilityLabel="Close" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetShrink}>
          <SafeAreaView edges={['bottom']} style={[styles.sheet, styles.sheetShrink]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={type.h2} numberOfLines={2}>
                {title}
              </Text>
              {dismissible ? (
                <Text style={styles.sheetClose} onPress={onClose} accessibilityRole="button">
                  Close
                </Text>
              ) : null}
            </View>
            <ScrollView style={styles.sheetShrink} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.lg }}>
              {children}
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ── Partner (NESAM Partner design) building blocks ─────────────────────────

/** A number with a caption, for the stat strip at the top of a screen. */
export function Stat({ value, label, tone, onPress }: { value: string; label: string; tone?: 'accent' | 'good'; onPress?: () => void }) {
  const color = tone === 'accent' ? colors.primary : tone === 'good' ? colors.success : colors.ink;
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={`${label}: ${value}`} style={styles.stat}>
      <Text style={[styles.statValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Horizontally scrolling pill tabs with optional counts. */
export function PillTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number; hot?: boolean }[]; value: T; onChange: (id: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow} accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <Pressable key={t.id} onPress={() => onChange(t.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[styles.pill, on && styles.pillOn]}>
            <Text style={[styles.pillText, on && { color: colors.white }]}>{t.label}</Text>
            {t.count ? (
              <View style={[styles.pillCount, t.hot && !on && { backgroundColor: colors.primary }, on && { backgroundColor: 'rgba(255,255,255,0.22)' }]}>
                <Text style={[styles.pillCountText, (t.hot || on) && { color: colors.white }]}>{t.count}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Route with a pickup and a drop, as in the NESAM Driver app. */
export function RouteStack({ pickup, drop }: { pickup: string; drop: string }) {
  const name = (a: string) => a.split(',')[0]?.trim() || a || '—';
  const detail = (a: string) => {
    const i = a.indexOf(',');
    return i > 0 ? a.slice(i + 1).trim() : '';
  };
  return (
    <View style={styles.route}>
      <View style={styles.routeStop}>
        <View style={[styles.routeDot, { borderRadius: 6 }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.routeName} numberOfLines={1}>
            {name(pickup)}
          </Text>
          {detail(pickup) ? (
            <Text style={type.tiny} numberOfLines={1}>
              {detail(pickup)}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.routeLine} />
      <View style={styles.routeStop}>
        <View style={[styles.routeDot, { borderColor: colors.primary, borderRadius: 3 }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.routeName} numberOfLines={1}>
            {name(drop)}
          </Text>
          {detail(drop) ? (
            <Text style={type.tiny} numberOfLines={1}>
              {detail(drop)}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** A tappable row with an icon tile, used for account menus. */
export function MenuRow({ icon, label, value, onPress, danger }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value?: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: colors.bg }]}>
      <View style={[styles.menuIcon, danger && { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={icon} size={20} color={danger ? colors.danger : '#4B5160'} />
      </View>
      <Text style={[styles.menuLabel, danger && { color: colors.danger }]} numberOfLines={1}>
        {label}
      </Text>
      {value ? (
        <Text style={type.small} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  padded: { padding: space.lg },
  footer: {
    padding: space.lg,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    marginBottom: space.md,
    shadowColor: '#1B2632',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm, marginTop: space.sm },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.muted, letterSpacing: 0.6, textTransform: 'uppercase' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: space.md },
  rowLabel: { flex: 1, fontSize: 13, color: colors.muted },
  rowValue: { flexShrink: 1, fontSize: 13, color: colors.ink, fontWeight: '600', textAlign: 'right' },
  bold: { fontWeight: '800', color: colors.ink, fontSize: 15 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space.sm },
  btn: {
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  btnSmall: { minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.sm },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.85 },
  btnText: { fontSize: 15, fontWeight: '600' },
  btnTextSmall: { fontSize: 13 },
  link: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  fieldLabel: { ...type.label, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 48,
  },
  inputError: { borderColor: colors.primary },
  inputDisabled: { backgroundColor: '#F3F4F6' },
  prefix: { color: colors.primary, fontWeight: '800', marginRight: space.sm, fontSize: 15 },
  input: { flex: 1, fontSize: 15, color: colors.ink, paddingVertical: 10 },
  errorText: { color: colors.primaryDark, fontSize: 12, marginTop: 4 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 4 },
  segment: { flexDirection: 'row', backgroundColor: '#EEEEEE', borderRadius: radius.md, padding: 3 },
  segmentItem: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: radius.sm },
  segmentOn: { backgroundColor: colors.card, elevation: 1 },
  segmentText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  segmentTextOn: { color: colors.ink },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#F3F4F6',
    marginRight: space.sm,
    marginBottom: space.sm,
  },
  chipOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  chipTextOn: { color: colors.primary, fontWeight: '800' },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.md,
    gap: space.sm,
  },
  noticeText: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  noticeRetry: { fontSize: 13, fontWeight: '800', textDecorationLine: 'underline' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: space.xl },
  empty: {
    alignItems: 'center',
    padding: space.xl,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyTitle: { ...type.h3, textAlign: 'center' },
  emptyMsg: { ...type.small, textAlign: 'center', marginTop: 4 },
  badge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 7, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11.5, fontWeight: '700' },
  avatar: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontWeight: '800' },
  sheetBackdrop: { flex: 1, backgroundColor: colors.overlay, paddingTop: 40 },
  sheetShrink: { flexShrink: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    maxHeight: '90%',
  },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: space.sm },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space.md, gap: space.md },
  sheetClose: { color: colors.muted, fontWeight: '700', fontSize: 14, padding: 4 },
  stat: { flexGrow: 1, flexBasis: '46%', backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, paddingHorizontal: 14 },
  statValue: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  statLabel: { fontSize: 12, color: colors.muted, marginTop: 2 },
  pillRow: { gap: 8, paddingHorizontal: space.lg, paddingVertical: space.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 40, paddingHorizontal: 15, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  pillOn: { backgroundColor: '#20242E', borderColor: '#20242E' },
  pillText: { fontSize: 13, fontWeight: '600', color: '#596072' },
  pillCount: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, backgroundColor: '#F0F1F4', alignItems: 'center', justifyContent: 'center' },
  pillCountText: { fontSize: 11, fontWeight: '700', color: '#596072' },
  route: { marginVertical: space.sm, paddingLeft: 4 },
  routeStop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  routeDot: { width: 12, height: 12, borderWidth: 2, borderColor: '#576274', backgroundColor: colors.card, marginTop: 4 },
  routeLine: { width: 0, height: 14, marginLeft: 5, borderLeftWidth: 1, borderLeftColor: '#C6CCD7', borderStyle: 'dashed' },
  routeName: { fontSize: 15, fontWeight: '600', color: colors.ink },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 58, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  menuIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.ink },
});
