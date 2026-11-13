// NESAM Partner design system (docs/NESAM_Vendor.html): buttons, badges, panels, key-values, underline tabs,
// notices, alert strips, search + dropdown filters, checkboxes, route stacks, steps and responsive grids.
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleProp, StyleSheet, useWindowDimensions, View, ViewStyle, type ImageSourcePropType } from 'react-native';
import { Text, TextInput } from './Text';
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
  secondary: { bg: colors.white, fg: colors.ink, border: colors.field, iconBg: '#F6F7F9' },
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
        hovered && !off && kind === 'secondary' && { backgroundColor: '#FAFAFB' },
        full && { alignSelf: 'stretch' },
        off && { opacity: 0.5 },
        pressed && !off && { transform: [{ scale: 0.985 }], opacity: 0.92 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={v.fg} size="small" />
      ) : icon ? (
        <Ionicons name={icon} size={text ? 15 : 17} color={v.fg} />
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
  neutral: ['#F6F7F9', '#6F7785'],
  green: ['#E9F7EF', '#167A50'],
  amber: ['#FFF5DE', '#946000'],
  red: ['#FFF0F2', '#B81C2A'],
  blue: ['#EEF3FF', '#2F5BD3'],
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
/** A plain bulleted list: a dot, then the text (one line each, wrapping under the text). */
export function BulletList({ items, style }: { items: string[]; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: 8 }, style]}>
      {items.map((t) => (
        <View key={t} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <View style={s.bulletDot} />
          <Text style={s.bulletText}>{t}</Text>
        </View>
      ))}
    </View>
  );
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

/** Pill tabs with a small count chip, like the driver app: white pills with a hairline border, the open one solid ink. `fill` shares the width equally (few tabs); otherwise they scroll sideways on phones. */
export function Tabs<T extends string>({ items, value, onChange, style, action, fill }: { items: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void; style?: StyleProp<ViewStyle>; action?: React.ReactNode; fill?: boolean }) {
  const tabs = items.map((t) => {
    const on = t.id === value;
    return (
      <Pressable
        key={t.id}
        onPress={() => onChange(t.id)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={t.count !== undefined ? `${t.label}, ${t.count}` : t.label}
        style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [s.tab, fill && { flex: 1 }, on && s.tabOn, hovered && !on && { backgroundColor: colors.bg }]}
      >
        <Text style={[s.tabText, on && s.tabTextOn]} numberOfLines={1}>{t.label}</Text>
        {t.count !== undefined ? (
          <View style={[s.tabCount, on && s.tabCountOn]}>
            <Text style={[s.tabCountText, on && { color: colors.primary }]}>{t.count}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  });
  return (
    <View style={[s.tabsWrap, action ? s.tabsWrapAction : null, style]}>
      {fill ? (
        <View style={[s.tabs, { flex: 1, flexDirection: 'row', paddingRight: 0 }]} accessibilityRole="tablist">{tabs}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={action ? { flex: 1 } : undefined} contentContainerStyle={s.tabs} accessibilityRole="tablist">
          {tabs}
        </ScrollView>
      )}
      {action ? <View style={{ flexShrink: 0, paddingLeft: 12 }}>{action}</View> : null}
    </View>
  );
}

/** A page-level action: outlined (or red when `primary`), the same height and radius as the tabs, icon beside the label. Buttons in a row share the width equally. */
export function ActionButton({ icon, label, onPress, primary, disabled, count, active }: { icon: IconName; label: string; onPress: () => void; primary?: boolean; disabled?: boolean; count?: number; /** The panel this button opens is showing. */ active?: boolean }) {
  const fg = primary ? colors.white : colors.ink;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled: !!disabled, expanded: active }} accessibilityLabel={count ? `${label}, ${count} awaiting action` : label}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        s.actionBtn, primary && s.actionBtnPrimary, active && !primary && { backgroundColor: colors.primarySoft, borderColor: colors.primary }, disabled && { opacity: 0.5 },
        !disabled && !primary && (pressed || hovered) && { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder },
        !disabled && primary && pressed && { backgroundColor: colors.primaryDark },
      ]}>
      <View>
        <Ionicons name={icon} size={19} color={primary ? colors.white : colors.primary} />
        {count ? <View style={s.actionDot}><Text style={s.actionDotText}>{count > 9 ? '9+' : count}</Text></View> : null}
      </View>
      <Text style={[s.actionBtnText, { color: fg }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function SectionLine({ title, meta, action, stacked }: { title?: string; meta?: string; action?: React.ReactNode; /** Put `meta` under the title instead of beside it. */ stacked?: boolean }) {
  return (
    <View style={s.sectionLine}>
      {stacked ? (
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          {title ? <Text style={s.sectionTitle}>{title}</Text> : null}
          {meta ? <Text style={[s.sectionMeta, { marginTop: 3 }]}>{meta}</Text> : null}
        </View>
      ) : (
        <View style={s.inline}>
          {title ? <Text style={s.sectionTitle}>{title}</Text> : null}
          {meta ? <Text style={s.sectionMeta}>{meta}</Text> : null}
        </View>
      )}
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
  neutral: { bg: '#F6F7F9', border: '#F1F2F5', fg: '#6F7785', icon: 'information-circle-outline' },
  green: { bg: colors.successSoft, border: colors.successBorder, fg: '#167A50', icon: 'checkmark-circle-outline' },
  amber: { bg: colors.warningSoft, border: colors.warningBorder, fg: '#946000', icon: 'time-outline' },
  red: { bg: '#FFF0F2', border: '#F7CDD3', fg: '#B81C2A', icon: 'alert-circle-outline' },
  blue: { bg: '#F6F7F9', border: '#D9E4F3', fg: '#3E5F88', icon: 'information-circle-outline' },
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
    <View style={[s.feedback, ok ? { backgroundColor: colors.successSoft, borderColor: colors.successBorder } : { backgroundColor: '#FFF0F2', borderColor: '#F7CDD3' }]} accessibilityRole={ok ? undefined : 'alert'} accessibilityLiveRegion="polite">
      <Ionicons name={ok ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={17} color={ok ? colors.success : colors.danger} />
      <Text style={[s.feedbackText, { color: ok ? colors.success : '#B81C2A' }]}>{message}</Text>
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
      <Ionicons name="search-outline" size={17} color="#A9AEB8" />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#A9AEB8" style={s.searchInput} accessibilityLabel={placeholder} returnKeyType="search" autoCorrect={false} />
      {value ? (
        <Pressable onPress={() => onChange('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8}>
          <Ionicons name="close-circle" size={17} color="#C3C8D0" />
        </Pressable>
      ) : null}
    </View>
  );
}

export interface Option<T extends string> { value: T; label: string; hint?: string }

/** A select box: tapping opens its option list right under the field (above it when there is no room below). */
export function Dropdown<T extends string>({ value, options, onChange, label, icon, style }: { value: T; options: Option<T>[]; onChange: (v: T) => void; label: string; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const trigger = useRef<View>(null);
  const { width: winW, height: winH } = useWindowDimensions();
  const current = options.find((o) => o.value === value);

  const show = () => {
    if (!trigger.current) { setOpen(true); return; }
    trigger.current.measureInWindow((x, y, w, h) => { setBox({ x, y, w, h }); setOpen(true); });
  };
  const close = () => setOpen(false);

  // The list sits under the field, as wide as it (at least 200), kept inside the window; above it when below is too tight.
  const ROW = 46;
  const want = Math.min(options.length * ROW + 12, 340);
  const menu = (() => {
    if (!box) return null;
    const below = winH - (box.y + box.h) - 16;
    const above = box.y - 16;
    const up = below < Math.min(want, 220) && above > below;
    const room = Math.max(120, up ? above : below);
    const width = Math.min(Math.max(box.w, 200), winW - 24);
    const left = Math.max(12, Math.min(box.x, winW - width - 12));
    const height = Math.min(want, room - 6);
    return { left, width, height, ...(up ? { bottom: winH - box.y + 6 } : { top: box.y + box.h + 6 }) };
  })();

  return (
    <>
      <Pressable ref={trigger} onPress={show} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${label}: ${current?.label ?? ''}`} style={({ pressed }) => [s.select, open && s.selectOpen, pressed && { opacity: 0.85 }, style]}>
        {icon ? <Ionicons name={icon} size={16} color="#8B919C" /> : null}
        <Text style={s.selectText} numberOfLines={1}>{current?.label ?? label}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color="#8B919C" />
      </Pressable>
      {open && menu ? (
        <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close list" />
          <View style={[s.dropMenu, menu]} accessibilityRole="menu">
            <ScrollView showsVerticalScrollIndicator={options.length * ROW + 12 > menu.height} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 6 }}>
              {options.map((o) => {
                const on = o.value === value;
                return (
                  <Pressable key={o.value} onPress={() => { onChange(o.value); close(); }} accessibilityRole="menuitem" accessibilityState={{ selected: on }}
                    style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [s.menuItem, (on || hovered) && s.optionOn, pressed && { opacity: 0.8 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.optionText, on && { color: colors.primary, fontWeight: '600' }]} numberOfLines={1}>{o.label}</Text>
                      {o.hint ? <Text style={s.small}>{o.hint}</Text> : null}
                    </View>
                    {on ? <Ionicons name="checkmark" size={17} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Modal>
      ) : null}
      {/* No window position (unusual): fall back to the bottom sheet. */}
      {open && !menu ? (
        <Sheet visible onClose={close} title={label}>
          {options.map((o) => (
            <Pressable key={o.value} onPress={() => { onChange(o.value); close(); }} accessibilityRole="radio" accessibilityState={{ selected: o.value === value }} style={({ pressed }) => [s.option, o.value === value && s.optionOn, pressed && { opacity: 0.8 }]}>
              <Text style={s.optionText}>{o.label}</Text>
            </Pressable>
          ))}
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
      {rest.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{rest.map((r, i) => <View key={i} style={{ flexGrow: 1, flexBasis: rest.length === 1 ? '100%' : '45%', minWidth: 0 }}>{r}</View>)}</View> : null}
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
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [s.choice, selected && s.choiceOn, hovered && !disabled && !selected && { borderColor: '#D8DFE9' }, disabled && { opacity: 0.55 }, pressed && { opacity: 0.85 }]}>
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
    <View style={[s.avatar, { width: size, height: size, borderRadius: size * 0.32 }, tone === 'blue' && { backgroundColor: '#F6F7F9' }]}>
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
            {m.icon ? <Ionicons name={m.icon} size={15} color="#8B919C" /> : null}
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
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [s.menu, last && { borderBottomWidth: 0 }, (pressed || hovered) && { backgroundColor: '#FAFAFB' }]}>
      <View style={[s.menuIcon, danger && { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={icon} size={19} color={danger ? colors.danger : '#6F7785'} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.menuTitle, danger && { color: colors.danger }]} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={s.small} numberOfLines={2}>{sub}</Text> : null}
      </View>
      {value ? <Text style={[s.small, { maxWidth: 140 }]} numberOfLines={1}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color="#A9AEB8" />
    </Pressable>
  );
}

export const s = StyleSheet.create({
  btn: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  btnSmall: { minHeight: 38, paddingHorizontal: 12, paddingVertical: 7, gap: 7 },
  btnText: { minHeight: 32, paddingHorizontal: 0, paddingVertical: 4, gap: 5 },
  btnIcon: { width: 24, height: 24, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  btnLabel: { fontSize: 12.5, fontWeight: '700', fontFamily, flexShrink: 1 },
  textLink: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, alignSelf: 'flex-start' },
  textLinkLabel: { fontSize: 12.5, fontWeight: '700', color: colors.primary, fontFamily },
  badge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, alignSelf: 'flex-start' },
  badgeText: { fontSize: 10.5, fontWeight: '700', fontFamily },
  eyebrow: { fontSize: 10, fontWeight: '600', letterSpacing: 1.1, color: '#6F7785', fontFamily },
  big: { fontSize: 30, fontWeight: '700', letterSpacing: -0.8, color: colors.ink, marginTop: 12, marginBottom: 6, fontFamily },
  panel: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 20, minWidth: 0, shadowColor: '#162033', shadowOpacity: 0.03, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  panelHover: { borderColor: '#D4D7DE', shadowOpacity: 0.07, shadowRadius: 14 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minWidth: 0 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  h2: { fontSize: 16, fontWeight: '700', color: colors.ink, letterSpacing: -0.4, fontFamily },
  bulletDot: { width: 5, height: 5, borderRadius: 3, marginTop: 8, backgroundColor: colors.primary },
  bulletText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 21, color: '#424B5A', fontFamily },
  small: { fontSize: 12, color: colors.muted, lineHeight: 19, fontFamily },
  kv: { marginTop: 10 },
  kvRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F2F5' },
  kvKey: { fontSize: 12, color: '#6F7785', flexShrink: 1, lineHeight: 19, fontFamily },
  kvValue: { fontSize: 12.5, color: '#424B5A', fontWeight: '500', textAlign: 'right', flexShrink: 1, lineHeight: 19, fontFamily },
  tabsWrap: { marginTop: 14, marginBottom: 20 },
  tabsWrapAction: { flexDirection: 'row', alignItems: 'center' },
  tabs: { gap: 8, paddingRight: 8 },
  tab: { minHeight: 38, paddingVertical: 6, paddingHorizontal: 12, flexDirection: 'row', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontSize: 12.5, fontWeight: '600', color: colors.muted, fontFamily },
  tabTextOn: { color: colors.white },
  tabCount: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF0F4' },
  tabCountOn: { backgroundColor: colors.white },
  tabCountText: { fontSize: 11, fontWeight: '700', color: colors.muted, fontFamily },
  actionBtn: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 46, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.white },
  actionBtnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionBtnText: { fontSize: 13.5, fontWeight: '600', fontFamily, flexShrink: 1 },
  actionDot: { position: 'absolute', top: -7, right: -10, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: colors.primary, borderWidth: 1.5, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  actionDotText: { fontSize: 9, fontWeight: '700', color: colors.white, lineHeight: 11, fontFamily },
  sectionLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginTop: 4, marginBottom: 14, flexWrap: 'wrap' },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, fontFamily },
  sectionMeta: { fontSize: 12, color: '#6F7785', fontFamily },
  steps: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  step: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  stepDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: '#E7EAF0', backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  stepOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepDone: { backgroundColor: '#EDF6F1', borderColor: '#CCE4D7' },
  stepNum: { fontSize: 12, fontWeight: '600', color: '#8B919C', fontFamily },
  stepName: { fontSize: 12, color: '#8B919C', flexShrink: 1, fontFamily },
  stepLine: { flex: 1, height: 1, backgroundColor: '#DCE4EF', marginLeft: 2, minWidth: 8 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, borderWidth: 1, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 14 },
  noticeTitle: { fontSize: 12.5, fontWeight: '600', lineHeight: 19, fontFamily },
  noticeText: { fontSize: 12, lineHeight: 19, marginTop: 3, opacity: 0.92, fontFamily },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 13, marginBottom: 16 },
  feedbackText: { flex: 1, fontSize: 12.5, fontWeight: '500', lineHeight: 19, fontFamily },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 46, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 13 },
  stripTitle: { fontSize: 12.5, fontWeight: '500', fontFamily },
  stripSub: { fontSize: 11, marginTop: 2, opacity: 0.85, fontFamily },
  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 22, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  emptyIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#F6F7F9', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, textAlign: 'center', fontFamily },
  emptyText: { fontSize: 12.5, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 19, maxWidth: 420, fontFamily },
  search: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 46, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, backgroundColor: colors.white },
  searchInput: { flex: 1, minWidth: 0, fontSize: 13.5, color: '#424B5A', paddingVertical: 10, fontFamily },
  select: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, backgroundColor: colors.white, minWidth: 0 },
  selectText: { flex: 1, fontSize: 13.5, color: '#6F7785', fontFamily },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, marginBottom: 4 },
  optionOn: { backgroundColor: colors.primarySoft },
  selectOpen: { borderColor: colors.primary },
  dropMenu: { position: 'absolute', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden', shadowColor: '#171B24', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.14, shadowRadius: 22, elevation: 12 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8 },
  optionText: { fontSize: 14, color: colors.ink, fontFamily },
  // On wide screens the filters sit at the right end of the row (a search box, when there is one, fills the space before them).
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginBottom: 20 },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 8 },
  checkBox: { width: 19, height: 19, borderRadius: 5, borderWidth: 1.5, borderColor: '#C3C8D0', alignItems: 'center', justifyContent: 'center', marginTop: 1, backgroundColor: colors.white },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkText: { flex: 1, fontSize: 12.5, color: '#6F7785', lineHeight: 20, fontFamily },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62, borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: colors.white, marginBottom: 9 },
  choiceOn: { borderColor: colors.primary, backgroundColor: '#FFF8F7' },
  choiceTitle: { fontSize: 14, fontWeight: '700', color: colors.ink, fontFamily },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: '#C3C8D0', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  avatar: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontWeight: '700', fontFamily },
  routeStack: { marginTop: 18, marginBottom: 6 },
  routeRow: { flexDirection: 'row', gap: 12 },
  routeRail: { width: 12, alignItems: 'center' },
  routeDotA: { width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: '#6F7785', backgroundColor: colors.white, marginTop: 4 },
  routeDotB: { width: 11, height: 11, borderRadius: 3, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.white, marginTop: 4 },
  routeLine: { flex: 1, width: 0, borderLeftWidth: 1.5, borderLeftColor: '#D8DFE9', borderStyle: 'dashed', marginTop: 3 },
  routeName: { fontSize: 15, fontWeight: '700', color: colors.ink, fontFamily },
  routeTitle: { fontWeight: '600', color: '#424B5A', lineHeight: 28, letterSpacing: -0.3, fontFamily },
  routeArrow: { color: '#8B919C', fontWeight: '400' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, rowGap: 8, marginTop: 11 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 12, color: '#6F7785', fontFamily },
  menu: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 62, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#F1F2F5' },
  menuIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#F6F7F9', alignItems: 'center', justifyContent: 'center' },
  menuTitle: { fontSize: 13.5, fontWeight: '500', color: colors.ink, fontFamily },
});
