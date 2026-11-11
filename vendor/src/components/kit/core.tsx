// NESAM Partner design system (docs/NESAM_Vendor.html): buttons, badges, panels, key-values, underline tabs,
// notices, alert strips, search + dropdown filters, checkboxes, route stacks, steps and responsive grids.
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
  type ImageSourcePropType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Sheet } from '../ui';
import { colors, fontFamily, radius, space } from '../../theme';
import { useLayout } from '../../theme/responsive';
import { carArt, initials } from './format';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue';

// ── Buttons ────────────────────────────────────────────────────────────────

export type BtnKind = 'primary' | 'secondary' | 'text' | 'bid' | 'light' | 'danger';
const BTN: Record<BtnKind, { bg: string; fg: string; border: string; iconBg: string }> = {
  primary: { bg: colors.primary, fg: colors.white, border: colors.primary, iconBg: 'rgba(255,255,255,0.16)' },
  secondary: { bg: colors.white, fg: '#43566D', border: '#D9E1EC', iconBg: '#F0F3F7' },
  text: { bg: 'transparent', fg: colors.primary, border: 'transparent', iconBg: 'transparent' },
  bid: { bg: colors.white, fg: colors.info, border: colors.infoBorder, iconBg: '#E5EDF9' },
  light: { bg: colors.white, fg: '#B12B2B', border: colors.white, iconBg: colors.primarySoft },
  danger: { bg: colors.white, fg: colors.danger, border: colors.primaryBorder, iconBg: colors.primarySoft },
};

export function Btn({
  title,
  onPress,
  kind = 'primary',
  icon,
  iconRight,
  busy,
  disabled,
  full,
  small,
  style,
  label,
}: {
  title: string;
  onPress: () => void;
  kind?: BtnKind;
  icon?: IconName;
  iconRight?: IconName;
  busy?: boolean;
  disabled?: boolean;
  full?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  label?: string;
}) {
  const v = BTN[kind];
  const off = !!disabled || !!busy;
  const text = kind === 'text';
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      accessibilityState={{ disabled: off, busy: !!busy }}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        s.btn,
        small && s.btnSmall,
        text && s.btnText,
        { backgroundColor: v.bg, borderColor: v.border },
        hovered && !off && kind === 'primary' && { backgroundColor: colors.primaryDark },
        hovered && !off && kind === 'bid' && { backgroundColor: colors.infoSoft },
        hovered && !off && kind === 'secondary' && { backgroundColor: '#FAFBFD' },
        full && { alignSelf: 'stretch' },
        off && { opacity: 0.5 },
        pressed && !off && { transform: [{ scale: 0.985 }], opacity: 0.92 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={v.fg} size="small" />
      ) : icon ? (
        text ? <Ionicons name={icon} size={15} color={v.fg} /> : <View style={[s.btnIcon, { backgroundColor: v.iconBg }]}><Ionicons name={icon} size={15} color={v.fg} /></View>
      ) : null}
      <Text style={[s.btnLabel, small && { fontSize: 12 }, text && { fontSize: 12.5 }, { color: v.fg }]} numberOfLines={1}>
        {title}
      </Text>
      {iconRight ? <Ionicons name={iconRight} size={14} color={v.fg} /> : null}
    </Pressable>
  );
}

/** A text-only action with a trailing chevron (the reference's vT). */
export const TextLink = ({ title, onPress, icon = 'chevron-forward' }: { title: string; onPress: () => void; icon?: IconName }) => (
  <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} hitSlop={6} style={({ pressed }) => [s.textLink, pressed && { opacity: 0.7 }]}>
    <Text style={s.textLinkLabel} numberOfLines={1}>{title}</Text>
    <Ionicons name={icon} size={14} color={colors.primary} />
  </Pressable>
);

// ── Badges, eyebrows, amounts ──────────────────────────────────────────────

const BADGE: Record<Tone, [string, string]> = {
  neutral: ['#F0F4F9', '#5E7189'],
  green: ['#EAF6EF', '#2F7A59'],
  amber: ['#FFF4DE', '#966A1F'],
  red: ['#FFECEA', '#B42323'],
  blue: ['#EAF1FB', '#315D98'],
};
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const [bg, fg] = BADGE[tone];
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeText, { color: fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export const Eyebrow = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) => (
  <View style={style}><Text style={s.eyebrow}>{children}</Text></View>
);

export const BigAmount = ({ value, tone }: { value: string; tone?: 'negative' | 'positive' }) => (
  <Text style={[s.big, tone === 'negative' && { color: colors.danger }, tone === 'positive' && { color: colors.success }]} numberOfLines={1} adjustsFontSizeToFit>
    {value}
  </Text>
);

// ── Containers ─────────────────────────────────────────────────────────────

export function Panel({ children, style, onPress, label }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; label?: string }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [s.panel, hovered && s.panelHover, pressed && { opacity: 0.94 }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[s.panel, style]}>{children}</View>;
}

export const Between = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[s.between, style]}>{children}</View>;
export const Inline = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[s.inline, style]}>{children}</View>;
export const Stack = ({ children, gap = 16, style }: { children: React.ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) => <View style={[{ gap }, style]}>{children}</View>;

export function H2({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[s.h2, style]} accessibilityRole="header">{children}</Text>;
}
export function Small({ children, style, lines }: { children: React.ReactNode; style?: object; lines?: number }) {
  return <Text style={[s.small, style]} numberOfLines={lines}>{children}</Text>;
}

/** Key-value rows (the reference's dl.v-key-values). */
export function KV({ rows, style }: { rows: ([string, React.ReactNode] | null | false)[]; style?: StyleProp<ViewStyle> }) {
  const list = rows.filter(Boolean) as [string, React.ReactNode][];
  return (
    <View style={[s.kv, style]}>
      {list.map(([k, v], i) => (
        <View key={`${k}-${i}`} style={[s.kvRow, i === list.length - 1 && { borderBottomWidth: 0 }]}>
          <Text style={s.kvKey}>{k}</Text>
          {typeof v === 'string' || typeof v === 'number' ? <Text style={s.kvValue}>{v}</Text> : <View style={{ flexShrink: 1, alignItems: 'flex-end' }}>{v}</View>}
        </View>
      ))}
    </View>
  );
}

/** Rows of N equal columns; the last row is padded so cards keep their width. */
export function Grid({ children, columns, gap = 16 }: { children: React.ReactNode; columns?: number; gap?: number }) {
  const layout = useLayout();
  const cols = columns ?? layout.columns;
  const items = React.Children.toArray(children).filter(Boolean);
  if (cols <= 1) return <View style={{ gap }}>{items}</View>;
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return (
    <View style={{ gap }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', gap, alignItems: 'stretch' }}>
          {row.map((child, c) => <View key={c} style={{ flex: 1, minWidth: 0 }}>{child}</View>)}
          {Array.from({ length: cols - row.length }).map((_, k) => <View key={`pad-${k}`} style={{ flex: 1 }} />)}
        </View>
      ))}
    </View>
  );
}

// ── Navigation within a page ───────────────────────────────────────────────

/** Underline tabs with optional counts (the reference's v-tabs). Scrolls sideways on phones. */
export function Tabs<T extends string>({ items, value, onChange, style }: { items: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.tabsWrap, style]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs} accessibilityRole="tablist">
        {items.map((t) => {
          const on = t.id === value;
          return (
            <Pressable key={t.id} onPress={() => onChange(t.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={s.tab}>
              <Text style={[s.tabText, on && s.tabTextOn]}>{t.label}</Text>
              {t.count !== undefined ? (
                <View style={[s.tabCount, on && { backgroundColor: colors.primarySoft }]}>
                  <Text style={[s.tabCountText, on && { color: colors.primary }]}>{t.count}</Text>
                </View>
              ) : null}
              {on ? <View style={s.tabBar} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function SectionLine({ title, meta, action }: { title?: string; meta?: string; action?: React.ReactNode }) {
  return (
    <View style={s.sectionLine}>
      <View style={s.inline}>
        {title ? <Text style={s.sectionTitle}>{title}</Text> : null}
        {meta ? <Text style={s.sectionMeta}>{meta}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <View style={s.steps} accessibilityLabel={`Step ${current} of ${steps.length}`}>
      {steps.map((name, i) => {
        const n = i + 1;
        const done = n < current;
        const on = n === current;
        return (
          <View key={name} style={s.step}>
            <View style={[s.stepDot, done && s.stepDone, on && s.stepOn]}>
              {done ? <Ionicons name="checkmark" size={14} color={colors.success} /> : <Text style={[s.stepNum, on && { color: colors.white }]}>{n}</Text>}
            </View>
            <Text style={[s.stepName, on && { color: colors.primary, fontWeight: '600' }, done && { color: colors.success }]} numberOfLines={1}>{name}</Text>
            {i < steps.length - 1 ? <View style={s.stepLine} /> : null}
          </View>
        );
      })}
    </View>
  );
}

// ── Messages ───────────────────────────────────────────────────────────────

const NOTICE: Record<Tone, { bg: string; border: string; fg: string; icon: IconName }> = {
  neutral: { bg: '#F4F6F8', border: '#E9EDF2', fg: '#5F6F82', icon: 'information-circle-outline' },
  green: { bg: colors.successSoft, border: colors.successBorder, fg: '#3D7559', icon: 'checkmark-circle-outline' },
  amber: { bg: colors.warningSoft, border: colors.warningBorder, fg: '#8A6A35', icon: 'time-outline' },
  red: { bg: '#FFF4F2', border: '#F3D2CC', fg: '#A33A2C', icon: 'alert-circle-outline' },
  blue: { bg: '#F2F6FC', border: '#D9E4F3', fg: '#3E5F88', icon: 'information-circle-outline' },
};

export function Notice({ title, text, tone = 'neutral', icon, action, style }: { title: string; text?: string; tone?: Tone; icon?: IconName; action?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = NOTICE[tone];
  return (
    <View style={[s.notice, { backgroundColor: t.bg, borderColor: t.border }, style]} accessibilityRole={tone === 'red' ? 'alert' : undefined}>
      <Ionicons name={icon ?? t.icon} size={18} color={t.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.noticeTitle, { color: t.fg }]}>{title}</Text>
        {text ? <Text style={[s.noticeText, { color: t.fg }]}>{text}</Text> : null}
        {action ? <View style={{ marginTop: 8, alignItems: 'flex-start' }}>{action}</View> : null}
      </View>
    </View>
  );
}

/** Inline result of an action: green for success, red for an error. Renders nothing when empty. */
export function Feedback({ message, tone = 'ok' }: { message: string; tone?: 'ok' | 'error' }) {
  if (!message) return null;
  const ok = tone === 'ok';
  return (
    <View style={[s.feedback, ok ? { backgroundColor: colors.successSoft, borderColor: colors.successBorder } : { backgroundColor: '#FFF4F2', borderColor: '#F3D2CC' }]} accessibilityRole={ok ? undefined : 'alert'} accessibilityLiveRegion="polite">
      <Ionicons name={ok ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={17} color={ok ? colors.success : colors.danger} />
      <Text style={[s.feedbackText, { color: ok ? colors.success : '#A33A2C' }]}>{message}</Text>
    </View>
  );
}

/** A full-width alert row that opens something (the reference's v-strip). */
export function Strip({ icon, title, sub, tone = 'neutral', onPress }: { icon: IconName; title: string; sub?: string; tone?: Tone; onPress: () => void }) {
  const t = NOTICE[tone];
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => [s.strip, { backgroundColor: tone === 'neutral' ? colors.card : t.bg, borderColor: tone === 'neutral' ? colors.border : t.border }, pressed && { opacity: 0.85 }]}>
      <Ionicons name={icon} size={17} color={t.fg} />
      <View style={{ flex: 1 }}>
        <Text style={[s.stripTitle, { color: t.fg }]}>{title}</Text>
        {sub ? <Text style={[s.stripSub, { color: t.fg }]}>{sub}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={15} color={t.fg} />
    </Pressable>
  );
}

export function Empty({ title, text, action, icon = 'clipboard-outline' }: { title: string; text?: string; action?: React.ReactNode; icon?: IconName }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}><Ionicons name={icon} size={24} color={colors.faint} /></View>
      <Text style={s.emptyTitle}>{title}</Text>
      {text ? <Text style={s.emptyText}>{text}</Text> : null}
      {action ? <View style={{ marginTop: 14 }}>{action}</View> : null}
    </View>
  );
}

// ── Inputs ─────────────────────────────────────────────────────────────────

export function SearchBox({ value, onChange, placeholder, style }: { value: string; onChange: (v: string) => void; placeholder: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.search, style]}>
      <Ionicons name="search-outline" size={17} color="#9BA5B1" />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#A0A8B3" style={s.searchInput} accessibilityLabel={placeholder} returnKeyType="search" autoCorrect={false} />
      {value ? (
        <Pressable onPress={() => onChange('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8}>
          <Ionicons name="close-circle" size={17} color="#B5BEC9" />
        </Pressable>
      ) : null}
    </View>
  );
}

export interface Option<T extends string> { value: T; label: string; hint?: string }

/** A select box: tapping opens the option list (a centred dialog on wide screens, a bottom sheet on phones). */
export function Dropdown<T extends string>({ value, options, onChange, label, icon, style }: { value: T; options: Option<T>[]; onChange: (v: T) => void; label: string; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}: ${current?.label ?? ''}`} style={({ pressed }) => [s.select, pressed && { opacity: 0.85 }, style]}>
        {icon ? <Ionicons name={icon} size={16} color="#8794A3" /> : null}
        <Text style={s.selectText} numberOfLines={1}>{current?.label ?? label}</Text>
        <Ionicons name="chevron-down" size={15} color="#8794A3" />
      </Pressable>
      {open ? (
        <Sheet visible onClose={() => setOpen(false)} title={label}>
          {options.map((o) => {
            const on = o.value === value;
            return (
              <Pressable key={o.value} onPress={() => { onChange(o.value); setOpen(false); }} accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={({ pressed }) => [s.option, on && s.optionOn, pressed && { opacity: 0.8 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.optionText, on && { color: colors.primary, fontWeight: '600' }]}>{o.label}</Text>
                  {o.hint ? <Text style={s.small}>{o.hint}</Text> : null}
                </View>
                {on ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </Sheet>
      ) : null}
    </>
  );
}

/** Search + filters row: side by side on wide screens, stacked under the search on phones. */
export function Toolbar({ children }: { children: React.ReactNode }) {
  const { wide } = useLayout();
  const items = React.Children.toArray(children).filter(Boolean);
  if (wide) return <View style={s.toolbar}>{items}</View>;
  const [first, ...rest] = items;
  return (
    <View style={{ gap: 10, marginBottom: 18 }}>
      {first}
      {rest.length ? <View style={{ flexDirection: 'row', gap: 10 }}>{rest.map((r, i) => <View key={i} style={{ flex: 1, minWidth: 0 }}>{r}</View>)}</View> : null}
    </View>
  );
}

export function Check({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <Pressable onPress={() => !disabled && onChange(!checked)} accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} style={({ pressed }) => [s.check, pressed && { opacity: 0.85 }, disabled && { opacity: 0.5 }]}>
      <View style={[s.checkBox, checked && s.checkOn]}>{checked ? <Ionicons name="checkmark" size={13} color={colors.white} /> : null}</View>
      <Text style={s.checkText}>{label}</Text>
    </Pressable>
  );
}

/** A selectable row inside a dialog or wizard (radio semantics). */
export function Choice({ title, sub, selected, disabled, reason, onPress, left }: { title: string; sub?: string; selected: boolean; disabled?: boolean; reason?: string; onPress: () => void; left?: React.ReactNode }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} accessibilityRole="radio" accessibilityState={{ selected, disabled: !!disabled }}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [s.choice, selected && s.choiceOn, hovered && !disabled && !selected && { borderColor: '#C9D4E1' }, disabled && { opacity: 0.55 }, pressed && { opacity: 0.85 }]}>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.choiceTitle} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={s.small} numberOfLines={2}>{sub}</Text> : null}
        {reason ? <Text style={[s.small, { color: colors.warning }]} numberOfLines={2}>{reason}</Text> : null}
      </View>
      <View style={[s.radio, selected && s.radioOn]}>{selected ? <View style={s.radioDot} /> : null}</View>
    </Pressable>
  );
}

// ── People, vehicles, routes ───────────────────────────────────────────────

export function Avatar({ name, size = 44, tone = 'red' }: { name: string; size?: number; tone?: 'red' | 'blue' }) {
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size * 0.32 }, tone === 'blue' && { backgroundColor: '#EEF3FA' }]}>
      <Text style={[s.avatarText, { fontSize: size * 0.34 }, tone === 'blue' && { color: '#4D6A89' }]}>{initials(name)}</Text>
    </View>
  );
}

const CARS: Record<ReturnType<typeof carArt>, ImageSourcePropType> = {
  sedan: require('../../../assets/cars/sedan.webp'),
  suv: require('../../../assets/cars/suv.webp'),
  innova: require('../../../assets/cars/innova.jpeg'),
  crysta: require('../../../assets/cars/crysta.webp'),
  carens: require('../../../assets/cars/carens.png'),
};
export function CarImage({ category, model, width = 125, height = 77 }: { category: string; model?: string; width?: number; height?: number }) {
  return <Image source={CARS[carArt(category, model)]} style={{ width, height }} resizeMode="contain" accessibilityLabel={`${model || category} vehicle`} />;
}

/** Pickup and drop with the connecting dotted line (the reference's v-route-stack). */
export function RouteStack({ from, fromSub, to, toSub }: { from: string; fromSub?: string; to: string; toSub?: string }) {
  return (
    <View style={s.routeStack}>
      <View style={s.routeRow}>
        <View style={s.routeRail}><View style={s.routeDotA} /><View style={s.routeLine} /></View>
        <View style={{ flex: 1, paddingBottom: 14 }}>
          <Text style={s.routeName}>{from}</Text>
          {fromSub ? <Text style={s.small}>{fromSub}</Text> : null}
        </View>
      </View>
      <View style={s.routeRow}>
        <View style={s.routeRail}><View style={s.routeDotB} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.routeName}>{to}</Text>
          {toSub ? <Text style={s.small}>{toSub}</Text> : null}
        </View>
      </View>
    </View>
  );
}

/** "From → To" headline used on duty and booking cards. */
export function RouteTitle({ from, to, size = 19 }: { from: string; to: string; size?: number }) {
  return (
    <Text style={[s.routeTitle, { fontSize: size }]} numberOfLines={2}>
      {from} <Text style={s.routeArrow}>→</Text> {to}
    </Text>
  );
}

export function Meta({ items }: { items: ({ icon?: IconName; text: string; badge?: boolean } | null | false)[] }) {
  return (
    <View style={s.meta}>
      {(items.filter(Boolean) as { icon?: IconName; text: string; badge?: boolean }[]).map((m, i) =>
        m.badge ? <Badge key={i} label={m.text} /> : (
          <View key={i} style={s.metaItem}>
            {m.icon ? <Ionicons name={m.icon} size={15} color="#7D8DA0" /> : null}
            <Text style={s.metaText}>{m.text}</Text>
          </View>
        ),
      )}
    </View>
  );
}

/** A big tappable account menu row (the reference's v-account-menu / v-help-actions). */
export function MenuItem({ icon, title, sub, onPress, danger, value, last }: { icon: IconName; title: string; sub?: string; onPress: () => void; danger?: boolean; value?: string; last?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [s.menu, last && { borderBottomWidth: 0 }, (pressed || hovered) && { backgroundColor: '#FAFBFD' }]}>
      <View style={[s.menuIcon, danger && { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={icon} size={19} color={danger ? colors.danger : '#5B6F86'} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.menuTitle, danger && { color: colors.danger }]} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={s.small} numberOfLines={2}>{sub}</Text> : null}
      </View>
      {value ? <Text style={[s.small, { maxWidth: 140 }]} numberOfLines={1}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color="#A5B0BD" />
    </Pressable>
  );
}

export const s = StyleSheet.create({
  btn: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  btnSmall: { minHeight: 38, paddingHorizontal: 12, paddingVertical: 7, gap: 7 },
  btnText: { minHeight: 32, paddingHorizontal: 0, paddingVertical: 4, gap: 5 },
  btnIcon: { width: 24, height: 24, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  btnLabel: { fontSize: 13, fontWeight: '600', fontFamily, flexShrink: 1 },
  textLink: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, alignSelf: 'flex-start' },
  textLinkLabel: { fontSize: 12.5, fontWeight: '600', color: colors.primary, fontFamily },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, alignSelf: 'flex-start' },
  badgeText: { fontSize: 10.5, fontWeight: '600', fontFamily },
  eyebrow: { fontSize: 10, fontWeight: '600', letterSpacing: 1.1, color: '#64778C', fontFamily },
  big: { fontSize: 30, fontWeight: '700', letterSpacing: -0.8, color: '#334C67', marginTop: 12, marginBottom: 6, fontFamily },
  panel: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 22, minWidth: 0 },
  panelHover: { borderColor: '#CFD9E5', shadowColor: '#283747', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minWidth: 0 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  h2: { fontSize: 16, fontWeight: '600', color: colors.ink, letterSpacing: -0.25, fontFamily },
  small: { fontSize: 12, color: colors.muted, lineHeight: 19, fontFamily },
  kv: { marginTop: 10 },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EEF1F5' },
  kvKey: { fontSize: 12, color: '#6A7C92', flexShrink: 1, lineHeight: 19, fontFamily },
  kvValue: { fontSize: 12.5, color: '#354E69', fontWeight: '500', textAlign: 'right', flexShrink: 1, lineHeight: 19, fontFamily },
  tabsWrap: { borderBottomWidth: 1, borderBottomColor: colors.border, marginVertical: 18 },
  tabs: { gap: 22, paddingRight: 8 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingTop: 10, paddingBottom: 12 },
  tabText: { fontSize: 13, color: '#63778E', fontWeight: '500', fontFamily },
  tabTextOn: { color: colors.primary, fontWeight: '600' },
  tabCount: { minWidth: 20, paddingHorizontal: 6, height: 18, borderRadius: 9, backgroundColor: '#EEF2F7', alignItems: 'center', justifyContent: 'center' },
  tabCountText: { fontSize: 10, fontWeight: '600', color: '#6B7C90', fontFamily },
  tabBar: { position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, borderRadius: 2, backgroundColor: colors.primary },
  sectionLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginTop: 4, marginBottom: 14, flexWrap: 'wrap' },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: colors.ink, fontFamily },
  sectionMeta: { fontSize: 12, color: '#708096', fontFamily },
  steps: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  step: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  stepDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: '#D8E2EE', backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  stepOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepDone: { backgroundColor: '#EDF6F1', borderColor: '#CCE4D7' },
  stepNum: { fontSize: 12, fontWeight: '600', color: '#8492A4', fontFamily },
  stepName: { fontSize: 12, color: '#8492A4', flexShrink: 1, fontFamily },
  stepLine: { flex: 1, height: 1, backgroundColor: '#DCE4EF', marginLeft: 2, minWidth: 8 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, borderWidth: 1, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 14 },
  noticeTitle: { fontSize: 12.5, fontWeight: '600', lineHeight: 19, fontFamily },
  noticeText: { fontSize: 12, lineHeight: 19, marginTop: 3, opacity: 0.92, fontFamily },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 13, marginBottom: 16 },
  feedbackText: { flex: 1, fontSize: 12.5, fontWeight: '500', lineHeight: 19, fontFamily },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 46, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 13 },
  stripTitle: { fontSize: 12.5, fontWeight: '500', fontFamily },
  stripSub: { fontSize: 11, marginTop: 2, opacity: 0.85, fontFamily },
  empty: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 22, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  emptyIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#F3F6FA', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.ink, textAlign: 'center', fontFamily },
  emptyText: { fontSize: 12.5, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 19, maxWidth: 420, fontFamily },
  search: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 46, borderWidth: 1, borderColor: '#DCE3EC', borderRadius: 10, paddingHorizontal: 13, backgroundColor: colors.white },
  searchInput: { flex: 1, minWidth: 0, fontSize: 13, color: '#334E6B', paddingVertical: 10, fontFamily },
  select: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#DCE3EC', borderRadius: 10, paddingHorizontal: 12, backgroundColor: colors.white, minWidth: 0 },
  selectText: { flex: 1, fontSize: 13, color: '#4F6077', fontFamily },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, marginBottom: 4 },
  optionOn: { backgroundColor: colors.primarySoft },
  optionText: { fontSize: 14, color: colors.ink, fontFamily },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 8 },
  checkBox: { width: 19, height: 19, borderRadius: 5, borderWidth: 1.5, borderColor: '#AFBBC9', alignItems: 'center', justifyContent: 'center', marginTop: 1, backgroundColor: colors.white },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkText: { flex: 1, fontSize: 12.5, color: '#61748B', lineHeight: 20, fontFamily },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62, borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: colors.white, marginBottom: 9 },
  choiceOn: { borderColor: colors.primary, backgroundColor: '#FFF8F7' },
  choiceTitle: { fontSize: 14, fontWeight: '600', color: colors.ink, fontFamily },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#AFBBC9', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  avatar: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontWeight: '700', fontFamily },
  routeStack: { marginTop: 18, marginBottom: 6 },
  routeRow: { flexDirection: 'row', gap: 12 },
  routeRail: { width: 12, alignItems: 'center' },
  routeDotA: { width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: '#5B6E85', backgroundColor: colors.white, marginTop: 4 },
  routeDotB: { width: 11, height: 11, borderRadius: 3, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.white, marginTop: 4 },
  routeLine: { flex: 1, width: 0, borderLeftWidth: 1.5, borderLeftColor: '#C9D2DE', borderStyle: 'dashed', marginTop: 3 },
  routeName: { fontSize: 15, fontWeight: '600', color: colors.ink, fontFamily },
  routeTitle: { fontWeight: '600', color: '#26384C', lineHeight: 28, letterSpacing: -0.3, fontFamily },
  routeArrow: { color: '#8B9AAB', fontWeight: '400' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, rowGap: 8, marginTop: 11 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 12, color: '#65778D', fontFamily },
  menu: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 62, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#EEF1F5' },
  menuIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#F2F5F9', alignItems: 'center', justifyContent: 'center' },
  menuTitle: { fontSize: 13.5, fontWeight: '500', color: colors.ink, fontFamily },
});
