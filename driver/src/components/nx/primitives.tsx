// The reference's building blocks (panel, badge, buttons, pills, fields, rows, notes, empty states, route stack, metric
// cards, ledger rows, switch). Values follow docs/Nesam_Driver.html; on the web every pressable also gets a hover state.
import React from 'react';
import { ActivityIndicator, Platform, Pressable, PressableStateCallbackType, ScrollView, StyleProp, StyleSheet, TextInputProps, TextStyle, View, ViewStyle } from 'react-native';
import { Text, TextInput } from './Text';
import { nx, nxRadius, nxShadow } from '../../theme/nx';
import { NxIcon, NxIconName } from './Icon';

/** Pressable state including the web-only `hovered` flag that react-native-web reports. */
export const isHovered = (s: PressableStateCallbackType) => Platform.OS === 'web' && !!(s as PressableStateCallbackType & { hovered?: boolean }).hovered;

// ── Text ────────────────────────────────────────────────────────────────────

export const nxText = StyleSheet.create({
  heading: { fontSize: 18, fontWeight: '700', letterSpacing: -0.4, lineHeight: 25, color: nx.tripInk },
  routeTitle: { fontSize: 23, fontWeight: '700', letterSpacing: -0.65, lineHeight: 30, color: nx.tripInk },
  copy: { fontSize: 12.5, lineHeight: 21, color: nx.tripMuted },
  note: { fontSize: 11.5, lineHeight: 19, color: nx.tripMuted, marginTop: 12 },
  small: { fontSize: 11.5, lineHeight: 17, color: nx.muted },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.3, color: nx.muted, textTransform: 'uppercase' },
  section: { fontSize: 16, fontWeight: '700', letterSpacing: -0.3, color: nx.ink },
  amount: { fontSize: 20, fontWeight: '700', letterSpacing: -0.5, color: nx.ink },
});

// ── Panel ───────────────────────────────────────────────────────────────────

export function NxPanel({ children, style, accent }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; accent?: boolean }) {
  return <View style={[styles.panel, accent && styles.panelAccent, style]}>{children}</View>;
}

// ── Badge ───────────────────────────────────────────────────────────────────

export type NxTone = 'green' | 'red' | 'amber' | 'neutral';
const BADGE: Record<NxTone, { bg: string; fg: string }> = {
  green: { bg: nx.greenSoft, fg: nx.green },
  red: { bg: nx.redSoft, fg: nx.red },
  amber: { bg: nx.amberSoft, fg: nx.amber },
  neutral: { bg: nx.page, fg: nx.muted },
};

export function NxBadge({ label, tone = 'neutral', icon, style }: { label: string; tone?: NxTone; icon?: NxIconName; style?: StyleProp<ViewStyle> }) {
  const t = BADGE[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }, style]}>
      {icon ? <NxIcon name={icon} size={12} color={t.fg} /> : null}
      <Text style={[styles.badgeText, { color: t.fg }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────────

export type NxButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'dark';

const BUTTON: Record<NxButtonVariant, { bg: string; hover: string; fg: string; border: string }> = {
  primary: { bg: nx.tripRed, hover: nx.redDark, fg: nx.white, border: nx.tripRed },
  secondary: { bg: nx.white, hover: nx.page, fg: nx.ink, border: nx.line },
  soft: { bg: nx.redSoft, hover: nx.redFill, fg: nx.red, border: nx.redSoft },
  ghost: { bg: 'transparent', hover: nx.page, fg: nx.red, border: 'transparent' },
  dark: { bg: nx.ink, hover: '#2A2F3B', fg: nx.white, border: nx.ink },
};

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
  variant?: NxButtonVariant;
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
      style={(s) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: !inactive && isHovered(s) ? v.hover : v.bg, borderColor: variant === 'primary' && !inactive && isHovered(s) ? v.hover : v.border },
        inactive && { opacity: 0.48 },
        s.pressed && !inactive && { opacity: 0.88, transform: [{ translateY: 1 }] },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={v.fg} /> : icon ? <NxIcon name={icon} size={17} color={v.fg} /> : null}
      <Text style={[styles.buttonText, compact && { fontSize: 11.5 }, { color: v.fg }]} numberOfLines={1}>
        {title}
      </Text>
      {trailingIcon && !loading ? <NxIcon name={trailingIcon} size={17} color={v.fg} /> : null}
    </Pressable>
  );
}

/** The reference's "text-button": red, bold, no chrome. */
export function NxTextButton({ title, onPress, icon, trailingIcon, color = nx.red, disabled }: { title: string; onPress: () => void; icon?: NxIconName; trailingIcon?: NxIconName; color?: string; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      onPress={disabled ? undefined : onPress}
      hitSlop={8}
      style={(s) => [styles.textButton, disabled && { opacity: 0.5 }, isHovered(s) && { opacity: 0.75 }]}
    >
      {icon ? <NxIcon name={icon} size={14} color={color} /> : null}
      <Text style={[styles.textButtonText, { color }]}>{title}</Text>
      {trailingIcon ? <NxIcon name={trailingIcon} size={14} color={color} /> : null}
    </Pressable>
  );
}

/** "‹ My Trips" style back link at the top of a page (the reference's `.trip-back`). */
export function NxBackLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Back to ${label}`} style={(s) => [styles.back, isHovered(s) && { opacity: 0.7 }]}>
      <NxIcon name="back" size={16} color={nx.muted} />
      <Text style={styles.backText}>{label}</Text>
    </Pressable>
  );
}

/** Square icon button with a hairline border (top-bar bell / help). */
export function NxIconButton({ icon, onPress, label, color = nx.ink, dot, size = 42 }: { icon: NxIconName; onPress: () => void; label: string; color?: string; dot?: boolean; size?: number }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={(s) => [styles.iconButton, { width: size, height: size }, isHovered(s) && { backgroundColor: nx.page }, s.pressed && { opacity: 0.8 }]}
    >
      <NxIcon name={icon} size={20} color={color} />
      {dot ? <View style={styles.iconDot} /> : null}
    </Pressable>
  );
}

// ── Switch ──────────────────────────────────────────────────────────────────

/** The reference's 47×27 switch (green when on). */
export function NxSwitch({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <Pressable
      onPress={disabled ? undefined : () => onChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      hitSlop={6}
      style={[styles.switch, { backgroundColor: value ? nx.green : '#9EA3AD', alignItems: value ? 'flex-end' : 'flex-start' }, disabled && { opacity: 0.5 }]}
    >
      <View style={styles.switchKnob} />
    </Pressable>
  );
}

// ── Pill tabs ───────────────────────────────────────────────────────────────

/**
 * `scroll` keeps every pill on one line in a horizontally scrolling row instead of wrapping.
 * `fill` splits the row into equal-width tabs that always fit the screen (phones), up to a comfortable width on desktop.
 */
export function NxPills<T extends string>({ options, value, onChange, label, scroll = false, fill = false, style }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; scroll?: boolean; fill?: boolean; style?: StyleProp<ViewStyle> }) {
  const pills = options.map((o) => {
    const on = o.value === value;
    return (
      <Pressable
        key={o.value}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        onPress={() => onChange(o.value)}
        style={(s) => [styles.pill, scroll && styles.pillNoShrink, fill && styles.pillFill, on ? styles.pillOn : isHovered(s) && { backgroundColor: nx.page }]}
      >
        <Text style={[styles.pillText, fill && { textAlign: 'center' }, on && { color: nx.white }]} numberOfLines={1} adjustsFontSizeToFit={fill} minimumFontScale={0.8}>
          {o.label}
        </Text>
      </Pressable>
    );
  });
  if (fill) {
    return (
      <View style={[styles.pills, styles.pillsFill, style]} accessibilityRole="tablist" accessibilityLabel={label}>
        {pills}
      </View>
    );
  }
  if (scroll) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.pillsScroll, style]}
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
    <View style={[styles.pills, style]} accessibilityRole="tablist" accessibilityLabel={label}>
      {pills}
    </View>
  );
}

/** A compact select-like button (the reference's date filter). */
export function NxSelectButton({ label, onPress, disabled, icon = 'calendar', accessibilityLabel }: { label: string; onPress: () => void; disabled?: boolean; icon?: NxIconName; accessibilityLabel?: string }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      style={(s) => [styles.select, disabled && { opacity: 0.5 }, isHovered(s) && !disabled && { backgroundColor: nx.page }]}
    >
      <NxIcon name={icon} size={13} color={nx.muted} />
      <Text style={styles.selectText} numberOfLines={1}>
        {label}
      </Text>
      <NxIcon name="chevron" size={12} color={nx.muted} />
    </Pressable>
  );
}

// ── Fields ──────────────────────────────────────────────────────────────────

/** Labelled text field in the reference's dialog/form style (1px #D8DFE9 border, 10px radius, 46px high). */
export function NxField({ label, hint, suffix, style, ...input }: TextInputProps & { label: string; hint?: string; suffix?: string }) {
  return (
    <View style={[{ marginTop: 16 }, style as StyleProp<ViewStyle>]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.fieldWrap, input.multiline && { alignItems: 'flex-start', minHeight: 96 }]}>
        <TextInput placeholderTextColor="#8A909B" accessibilityLabel={label} style={[styles.fieldInput, input.multiline && { minHeight: 80, textAlignVertical: 'top' }]} {...input} />
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

/** Label / value line (the reference's `detail-line` / `nx-row`). */
export function NxRow({ label, value, strong, valueStyle, last }: { label: string; value: React.ReactNode; strong?: boolean; valueStyle?: StyleProp<TextStyle>; last?: boolean }) {
  return (
    <View style={[styles.row, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.rowLabel} numberOfLines={3}>
        {label}
      </Text>
      <Text style={[styles.rowValue, strong && { fontSize: 15 }, valueStyle]} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

/** Grey / amber / red note with an info icon (the reference's `info-note`). */
export function NxInfo({ children, tone = 'neutral', style, icon = 'info' }: { children: React.ReactNode; tone?: 'neutral' | 'amber' | 'red' | 'green'; style?: StyleProp<ViewStyle>; icon?: NxIconName }) {
  const bg = tone === 'amber' ? nx.amberSoft : tone === 'red' ? nx.redSoft : tone === 'green' ? nx.greenSoft : nx.page;
  const fg = tone === 'amber' ? nx.amber : tone === 'red' ? nx.red : tone === 'green' ? nx.green : nx.muted;
  return (
    <View style={[styles.info, { backgroundColor: bg }, style]} accessibilityRole={tone === 'red' || tone === 'amber' ? 'alert' : undefined}>
      <NxIcon name={icon} size={15} color={tone === 'neutral' ? '#828B98' : fg} />
      <Text style={[styles.infoText, { color: fg }]}>{children}</Text>
    </View>
  );
}

/** A quiet line under a list (the reference's `list-note`). */
export function NxNote({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.note, style]}>
      <NxIcon name="info" size={13} color={nx.muted} />
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

/** Status strip (green "Customer on board" / amber "Under review"). */
export function NxStatusLine({ children, tone = 'green', icon = 'check' }: { children: React.ReactNode; tone?: 'green' | 'amber'; icon?: NxIconName }) {
  const green = tone === 'green';
  return (
    <View style={[styles.statusLine, { backgroundColor: green ? nx.greenSoft : nx.amberSoft }]}>
      <NxIcon name={icon} size={15} color={green ? nx.green : nx.amber} />
      <Text style={[styles.statusText, { color: green ? nx.green : nx.amber }]}>{children}</Text>
    </View>
  );
}

/** Rounded square holding an icon. */
export function NxIconTile({ icon, tone = 'neutral', size = 38 }: { icon: NxIconName; tone?: 'neutral' | 'red' | 'green'; size?: number }) {
  const bg = tone === 'red' ? nx.redSoft : tone === 'green' ? nx.greenSoft : nx.page;
  const fg = tone === 'red' ? nx.red : tone === 'green' ? nx.green : '#7A8290';
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: bg }]}>
      <NxIcon name={icon} size={Math.round(size * 0.47)} color={fg} />
    </View>
  );
}

export function NxEmpty({ icon, title, message, action }: { icon: NxIconName; title: string; message?: string; action?: React.ReactNode }) {
  return (
    <NxPanel style={styles.empty}>
      <View style={styles.emptyIcon}>
        <NxIcon name={icon} size={25} color={nx.faint} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyText}>{message}</Text> : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </NxPanel>
  );
}

export function NxSectionHeading({ title, caption, right, badge, style }: { title: string; caption?: string; right?: React.ReactNode; badge?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.sectionHead, style]}>
      <View style={{ flex: 1, minWidth: 0 }}>
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

/** Card heading (title + caption on the left, a badge or icon on the right). */
export function NxCardHeading({ title, caption, right }: { title: string; caption?: string; right?: React.ReactNode }) {
  return (
    <View style={styles.cardHead}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.cardTitle} accessibilityRole="header">
          {title}
        </Text>
        {caption ? <Text style={[nxText.small, { marginTop: 4 }]}>{caption}</Text> : null}
      </View>
      {right}
    </View>
  );
}

// ── Metric card & ledger row ────────────────────────────────────────────────

export function NxMetric({ label, value, foot, icon, onPress, accent, small }: { label: string; value: string; foot: string; icon: NxIconName; onPress?: () => void; accent?: boolean; small?: boolean }) {
  return (
    <Pressable
      style={(s) => [styles.metric, onPress && isHovered(s) && styles.metricHover]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label}: ${value}. ${foot}`}
    >
      <View style={styles.metricTop}>
        <Text style={styles.metricLabel} numberOfLines={1}>
          {label}
        </Text>
        <NxIcon name={icon} size={16} color="#969BA5" />
      </View>
      <Text style={[styles.metricValue, accent && { color: nx.red }, small && { fontSize: 16, letterSpacing: -0.3 }]} numberOfLines={2} adjustsFontSizeToFit>
        {value}
      </Text>
      <View style={styles.metricFootRow}>
        <Text style={styles.metricFoot} numberOfLines={2}>
          {foot}
        </Text>
        {onPress ? <NxIcon name="chevron" size={11} color="#838894" /> : null}
      </View>
    </Pressable>
  );
}

/** Icon tile + title / caption + right-aligned value (the reference's `ledger-item`). */
export function NxListItem({
  icon,
  title,
  caption,
  value,
  valueCaption,
  valueColor = nx.green,
  right,
  onPress,
  tone,
  last,
  strike,
}: {
  icon: NxIconName;
  title: string;
  caption?: string;
  value?: string;
  valueCaption?: string;
  valueColor?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  tone?: 'neutral' | 'red' | 'green';
  last?: boolean;
  strike?: boolean;
}) {
  const body = (
    <>
      <NxIconTile icon={icon} tone={tone} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.itemTitle} numberOfLines={2}>
          {title}
        </Text>
        {caption ? (
          <Text style={styles.itemCaption} numberOfLines={3}>
            {caption}
          </Text>
        ) : null}
      </View>
      {value !== undefined ? (
        <View style={{ alignItems: 'flex-end', flexShrink: 0, maxWidth: '45%' }}>
          <Text style={[styles.itemValue, { color: valueColor }, strike && { textDecorationLine: 'line-through', opacity: 0.6 }]} numberOfLines={1}>
            {value}
          </Text>
          {valueCaption ? <Text style={[styles.itemCaption, { textAlign: 'right' }]}>{valueCaption}</Text> : null}
        </View>
      ) : null}
      {right}
    </>
  );
  if (!onPress) return <View style={[styles.item, last && { borderBottomWidth: 0 }]}>{body}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={(s) => [styles.item, last && { borderBottomWidth: 0 }, isHovered(s) && { backgroundColor: '#FAFBFC' }]}>
      {body}
    </Pressable>
  );
}

// ── Route stack ─────────────────────────────────────────────────────────────

/** Pickup → drop stack with the reference's hollow/solid dots joined by a dashed line. */
export function NxRouteStack({ pickup, drop, compact }: { pickup: string; drop: string; compact?: boolean }) {
  return (
    <View style={[styles.route, compact && { paddingTop: 4 }]}>
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
      <View style={{ flex: 1, minWidth: 0, paddingBottom: first ? 14 : 0 }}>
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
  panel: { backgroundColor: nx.white, borderWidth: 1, borderColor: nx.line, borderRadius: nxRadius.panel, padding: 20, marginBottom: 16, ...nxShadow },
  panelAccent: { borderTopWidth: 2, borderTopColor: nx.red },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: nxRadius.badge, paddingVertical: 5, paddingHorizontal: 8, maxWidth: 220 },
  badgeText: { fontSize: 10.5, fontWeight: '700', flexShrink: 1 },
  button: { minHeight: 46, borderRadius: nxRadius.button, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  buttonCompact: { minHeight: 40, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 9, gap: 7 },
  buttonText: { fontSize: 12.5, fontWeight: '700', flexShrink: 1 },
  textButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  textButtonText: { fontSize: 12, fontWeight: '700' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, alignSelf: 'flex-start' },
  backText: { fontSize: 13, color: nx.muted },
  iconButton: { borderRadius: 12, backgroundColor: nx.white, borderWidth: 1, borderColor: nx.line, alignItems: 'center', justifyContent: 'center' },
  iconDot: { position: 'absolute', top: 9, right: 10, width: 9, height: 9, borderRadius: 5, backgroundColor: nx.red, borderWidth: 2, borderColor: nx.white },
  switch: { width: 47, height: 27, borderRadius: 14, padding: 4, justifyContent: 'center' },
  switchKnob: { width: 19, height: 19, borderRadius: 10, backgroundColor: nx.white, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 },
  pillsScroll: { flexGrow: 0, marginBottom: 22 },
  pillsRow: { flexDirection: 'row', gap: 8 },
  pillNoShrink: { flexShrink: 0 },
  pillsFill: { flexWrap: 'nowrap', width: '100%', maxWidth: 520 },
  pillFill: { flex: 1, minWidth: 0, paddingHorizontal: 6 },
  pill: { minHeight: 38, paddingVertical: 8, paddingHorizontal: 15, borderWidth: 1, borderColor: nx.line, borderRadius: 9, backgroundColor: nx.white, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: nx.ink, borderColor: nx.ink },
  pillText: { fontSize: 12, fontWeight: '600', color: nx.muted },
  select: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, maxWidth: 160, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: nx.line, backgroundColor: nx.white },
  selectText: { fontSize: 11.5, color: '#626875', flexShrink: 1 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: nx.tripInk },
  fieldWrap: { flexDirection: 'row', alignItems: 'center', minHeight: 46, marginTop: 7, borderWidth: 1, borderColor: nx.fieldLine, borderRadius: 10, backgroundColor: nx.white, paddingHorizontal: 12 },
  fieldInput: { flex: 1, minWidth: 0, fontSize: 15, color: nx.ink, paddingVertical: 10 },
  fieldSuffix: { fontSize: 14, color: nx.muted, marginLeft: 8 },
  formError: { fontSize: 12, lineHeight: 19, color: nx.red, marginTop: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 15, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  rowLabel: { flex: 1, fontSize: 12, lineHeight: 18, color: nx.tripMuted },
  rowValue: { flexShrink: 1, maxWidth: '62%', fontSize: 12.5, fontWeight: '600', color: nx.tripInk, textAlign: 'right' },
  info: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 13, marginTop: 14 },
  infoText: { flex: 1, fontSize: 11.5, lineHeight: 19 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 12 },
  noteText: { flex: 1, fontSize: 11.5, lineHeight: 19, color: nx.muted },
  statusLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 9, paddingVertical: 11, paddingHorizontal: 12 },
  statusText: { flex: 1, fontSize: 11.5, lineHeight: 19, fontWeight: '600' },
  tile: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 22 },
  emptyIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: nx.page, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: nx.ink, textAlign: 'center', marginBottom: 6 },
  emptyText: { fontSize: 12, lineHeight: 18, color: nx.muted, textAlign: 'center', maxWidth: 280 },
  emptyAction: { marginTop: 20, alignSelf: 'stretch', alignItems: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 15, marginBottom: 18 },
  cardTitle: { fontSize: 16, fontWeight: '700', letterSpacing: -0.4, color: nx.ink },
  metric: { flex: 1, minWidth: 0, backgroundColor: nx.white, borderWidth: 1, borderColor: nx.line, borderRadius: nxRadius.metric, paddingVertical: 16, paddingHorizontal: 17, ...nxShadow },
  metricHover: { borderColor: '#D4D7DE', transform: [{ translateY: -2 }] },
  metricTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 7, marginBottom: 10 },
  metricLabel: { flex: 1, fontSize: 11.5, fontWeight: '500', color: nx.muted },
  metricValue: { fontSize: 25, fontWeight: '700', letterSpacing: -0.8, color: nx.ink },
  metricFootRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 7 },
  metricFoot: { flexShrink: 1, fontSize: 11, color: '#838894' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  itemTitle: { fontSize: 12.5, fontWeight: '600', color: nx.ink },
  itemCaption: { fontSize: 11, lineHeight: 16, color: nx.muted, marginTop: 3 },
  itemValue: { fontSize: 13.5, fontWeight: '700' },
  route: { paddingTop: 18, paddingBottom: 6 },
  stop: { flexDirection: 'row', gap: 13 },
  dotCol: { width: 10, alignItems: 'center', paddingTop: 6 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  dotHollow: { borderWidth: 2, borderColor: nx.red, backgroundColor: nx.white },
  dotSolid: { backgroundColor: nx.ink, borderRadius: 2, width: 8, height: 8 },
  dotLine: { flex: 1, width: 0, borderLeftWidth: 1, borderStyle: 'dashed', borderColor: '#C9CDD5', marginTop: 3 },
  stopName: { fontSize: 15.5, fontWeight: '700', letterSpacing: -0.25, color: nx.ink },
  stopDetail: { fontSize: 11.5, lineHeight: 18, color: nx.muted, marginTop: 2 },
});
