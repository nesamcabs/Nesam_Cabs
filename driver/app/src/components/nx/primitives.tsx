import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleProp, StyleSheet, TextInputProps, TextStyle, View, ViewStyle } from 'react-native';
import { Text, TextInput } from './Text';
import { nx, nxRadius, nxShadow } from '../../theme/nx';
import { NxIcon, NxIconName } from './Icon';

// ── Text ────────────────────────────────────────────────────────────────────

export const nxText = StyleSheet.create({
  heading: { fontSize: 18, fontWeight: '800', letterSpacing: -0.4, color: nx.tripInk },
  routeTitle: { fontSize: 23, fontWeight: '800', letterSpacing: -0.65, lineHeight: 30, color: nx.tripInk },
  copy: { fontSize: 12, lineHeight: 21, color: nx.tripMuted },
  note: { fontSize: 11, lineHeight: 19, color: nx.tripMuted, marginTop: 12 },
  small: { fontSize: 11, lineHeight: 16.5, color: nx.muted },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.6, color: nx.red },
  section: { fontSize: 16, fontWeight: '700', letterSpacing: -0.3, color: nx.ink },
});

// ── Panel ───────────────────────────────────────────────────────────────────

export function NxPanel({ children, style, accent }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; accent?: boolean }) {
  return <View style={[styles.panel, accent && styles.panelAccent, style]}>{children}</View>;
}

// ── Badge ───────────────────────────────────────────────────────────────────

type Tone = 'green' | 'red' | 'amber' | 'neutral';
const BADGE: Record<Tone, { bg: string; fg: string }> = {
  green: { bg: nx.greenSoft, fg: nx.green },
  red: { bg: nx.redSoft, fg: nx.red },
  amber: { bg: nx.amberSoft, fg: nx.amber },
  neutral: { bg: nx.page, fg: nx.muted },
};

export function NxBadge({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: NxIconName }) {
  const t = BADGE[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      {icon ? <NxIcon name={icon} size={11} color={t.fg} /> : null}
      <Text style={[styles.badgeText, { color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'soft' | 'ghost';

export function NxButton({
  title,
  onPress,
  variant = 'primary',
  icon,
  trailingIcon,
  loading,
  disabled,
  style,
  compact,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  icon?: NxIconName;
  trailingIcon?: NxIconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  accessibilityLabel?: string;
}) {
  const inactive = disabled || loading;
  const v = BUTTON[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: v.bg, borderColor: v.border },
        inactive && { opacity: variant === 'primary' ? 0.45 : 0.55 },
        pressed && !inactive && { opacity: 0.88 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={v.fg} /> : icon ? <NxIcon name={icon} size={16} color={v.fg} /> : null}
      <Text style={[styles.buttonText, { color: v.fg }]} numberOfLines={1}>
        {title}
      </Text>
      {trailingIcon && !loading ? <NxIcon name={trailingIcon} size={16} color={v.fg} /> : null}
    </Pressable>
  );
}

const BUTTON: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: nx.tripRed, fg: nx.white, border: nx.tripRed },
  secondary: { bg: nx.white, fg: nx.ink, border: nx.line },
  soft: { bg: nx.redSoft, fg: nx.red, border: nx.redSoft },
  ghost: { bg: 'transparent', fg: nx.red, border: 'transparent' },
};

/** The reference's "text-button": red, bold, no chrome. */
export function NxTextButton({ title, onPress, icon, trailingIcon, color = nx.red }: { title: string; onPress: () => void; icon?: NxIconName; trailingIcon?: NxIconName; color?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} hitSlop={8} style={styles.textButton}>
      {icon ? <NxIcon name={icon} size={13} color={color} /> : null}
      <Text style={[styles.textButtonText, { color }]}>{title}</Text>
      {trailingIcon ? <NxIcon name={trailingIcon} size={13} color={color} /> : null}
    </Pressable>
  );
}

// ── Pill tabs ───────────────────────────────────────────────────────────────

/** `scroll` keeps every pill on one line in a horizontally scrolling row instead of wrapping. */
export function NxPills<T extends string>({ options, value, onChange, label, scroll = false }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; scroll?: boolean }) {
  const pills = options.map((o) => {
    const on = o.value === value;
    return (
      <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)} style={[styles.pill, scroll && styles.pillNoShrink, on && styles.pillOn]}>
        <Text style={[styles.pillText, on && { color: nx.white }]} numberOfLines={scroll ? 1 : undefined}>
          {o.label}
        </Text>
      </Pressable>
    );
  });
  if (scroll) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.pillsScroll}
        contentContainerStyle={styles.pillsRow}
        keyboardShouldPersistTaps="handled"
        accessibilityRole="tablist"
        accessibilityLabel={label}
      >
        {pills}
      </ScrollView>
    );
  }
  return (
    <View style={styles.pills} accessibilityRole="tablist" accessibilityLabel={label}>
      {pills}
    </View>
  );
}

// ── Fields ──────────────────────────────────────────────────────────────────

/** Labelled text field in the reference's dialog/form style (1px #D8DFE9 border, 10px radius, 46px high). */
export function NxField({ label, hint, suffix, style, ...input }: TextInputProps & { label: string; hint?: string; suffix?: string }) {
  return (
    <View style={[{ marginTop: 16 }, style as StyleProp<ViewStyle>]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldWrap}>
        <TextInput placeholderTextColor="#8A909B" accessibilityLabel={label} style={styles.fieldInput} {...input} />
        {suffix ? <Text style={styles.fieldSuffix}>{suffix}</Text> : null}
      </View>
      {hint ? <Text style={[nxText.small, { marginTop: 6 }]}>{hint}</Text> : null}
    </View>
  );
}

export function NxFormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <Text accessibilityRole="alert" style={styles.formError}>
      {message}
    </Text>
  );
}

// ── Rows & notes ────────────────────────────────────────────────────────────

export function NxRow({ label, value, strong, valueStyle }: { label: string; value: React.ReactNode; strong?: boolean; valueStyle?: StyleProp<TextStyle> }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel} numberOfLines={2}>
        {label}
      </Text>
      <Text style={[styles.rowValue, strong && { fontSize: 14 }, valueStyle]} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

export function NxInfo({ children, tone = 'neutral', style }: { children: React.ReactNode; tone?: 'neutral' | 'amber' | 'red'; style?: StyleProp<ViewStyle> }) {
  const bg = tone === 'amber' ? nx.amberSoft : tone === 'red' ? nx.redSoft : nx.page;
  const fg = tone === 'amber' ? nx.amber : tone === 'red' ? nx.red : nx.muted;
  return (
    <View style={[styles.info, { backgroundColor: bg }, style]} accessibilityRole={tone === 'neutral' ? undefined : 'alert'}>
      <NxIcon name="info" size={15} color={fg} />
      <Text style={[styles.infoText, { color: fg }]}>{children}</Text>
    </View>
  );
}

export function NxEmpty({ icon, title, message, action }: { icon: NxIconName; title: string; message?: string; action?: React.ReactNode }) {
  return (
    <NxPanel style={styles.empty}>
      <View style={styles.emptyIcon}>
        <NxIcon name={icon} size={24} color={nx.faint} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyText}>{message}</Text> : null}
      {action ? <View style={{ marginTop: 16, alignSelf: 'stretch' }}>{action}</View> : null}
    </NxPanel>
  );
}

export function NxSectionHeading({ title, caption, right, badge }: { title: string; caption?: string; right?: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <View style={styles.sectionHead}>
      <View style={{ flex: 1 }}>
        <View style={styles.sectionTitleRow}>
          <Text style={nxText.section} accessibilityRole="header">
            {title}
          </Text>
          {badge}
        </View>
        {caption ? <Text style={[nxText.small, { marginTop: 3 }]}>{caption}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** Pickup → drop stack with the reference's hollow/solid dots joined by a dotted line. */
export function NxRouteStack({ pickup, drop }: { pickup: string; drop: string }) {
  return (
    <View style={styles.route}>
      <Stop address={pickup} first />
      <Stop address={drop} />
    </View>
  );
}

function Stop({ address, first }: { address: string; first?: boolean }) {
  const name = placeName(address);
  const detail = placeDetail(address);
  return (
    <View style={styles.stop}>
      <View style={styles.dotCol}>
        <View style={[styles.dot, first ? styles.dotHollow : styles.dotSolid]} />
        {first ? <View style={styles.dotLine} /> : null}
      </View>
      <View style={{ flex: 1, paddingBottom: first ? 12 : 0 }}>
        <Text style={styles.stopName} numberOfLines={2}>
          {name}
        </Text>
        {detail ? (
          <Text style={styles.stopDetail} numberOfLines={2}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** "Koyambedu Bus Terminus, Chennai, TN" → "Koyambedu Bus Terminus". */
export function placeName(address: string | undefined): string {
  const a = (address ?? '').trim();
  const first = a.split(',')[0]?.trim();
  return first || a || '—';
}

/** Text after the first comma; empty when there is none. */
export function placeDetail(address: string | undefined): string {
  const a = (address ?? '').trim();
  const i = a.indexOf(',');
  return i > 0 && i < a.length - 1 ? a.slice(i + 1).trim() : '';
}

const styles = StyleSheet.create({
  panel: { backgroundColor: nx.white, borderWidth: 1, borderColor: nx.line, borderRadius: nxRadius.panel, padding: 17, marginBottom: 16, ...nxShadow },
  panelAccent: { borderTopWidth: 2, borderTopColor: nx.red },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: nxRadius.badge, paddingVertical: 6, paddingHorizontal: 8 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  button: { minHeight: 46, borderRadius: nxRadius.button, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonCompact: { minHeight: 42, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 8 },
  buttonText: { fontSize: 12.5, fontWeight: '700' },
  textButton: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 30 },
  textButtonText: { fontSize: 11.5, fontWeight: '700' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  pillsScroll: { flexGrow: 0, marginBottom: 20 },
  pillsRow: { flexDirection: 'row', gap: 8 },
  pillNoShrink: { flexShrink: 0 },
  pill: { minHeight: 38, paddingVertical: 8, paddingHorizontal: 15, borderWidth: 1, borderColor: nx.line, borderRadius: 9, backgroundColor: nx.white, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: nx.ink, borderColor: nx.ink },
  pillText: { fontSize: 11.5, fontWeight: '700', color: nx.muted },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 13, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  rowLabel: { flex: 1, fontSize: 12, color: nx.tripMuted },
  rowValue: { flexShrink: 1, fontSize: 12.5, fontWeight: '700', color: nx.tripInk, textAlign: 'right' },
  info: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderRadius: 11, padding: 12, marginTop: 14 },
  infoText: { flex: 1, fontSize: 11.5, lineHeight: 18 },
  empty: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 22 },
  emptyIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: nx.page, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: nx.ink, textAlign: 'center', marginBottom: 6 },
  emptyText: { fontSize: 11.5, lineHeight: 17, color: nx.muted, textAlign: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  route: { paddingTop: 16, paddingBottom: 4 },
  stop: { flexDirection: 'row', gap: 12 },
  dotCol: { width: 12, alignItems: 'center', paddingTop: 6 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotHollow: { borderWidth: 2, borderColor: nx.red, backgroundColor: nx.white },
  dotSolid: { backgroundColor: nx.ink },
  dotLine: { flex: 1, width: 0, borderLeftWidth: 1, borderStyle: 'dotted', borderColor: '#BFC5D0', marginTop: 3 },
  stopName: { fontSize: 16, fontWeight: '700', letterSpacing: -0.25, color: nx.ink },
  stopDetail: { fontSize: 11, color: nx.muted, marginTop: 2 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: nx.tripInk },
  fieldWrap: { flexDirection: 'row', alignItems: 'center', minHeight: 46, marginTop: 7, borderWidth: 1, borderColor: nx.fieldLine, borderRadius: 10, backgroundColor: nx.white, paddingHorizontal: 12 },
  fieldInput: { flex: 1, fontSize: 15, color: nx.ink, paddingVertical: 10 },
  fieldSuffix: { fontSize: 13, color: nx.muted, marginLeft: 8 },
  formError: { fontSize: 11.5, lineHeight: 19, color: nx.red, marginTop: 10 },
});
