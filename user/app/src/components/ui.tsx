// Shared UI primitives for the NESAM Customer app, styled to the customer reference
// design: white pages, 10–13px cards with pale borders, 7px red primary buttons,
// 6px fields with small slate labels, Inter text.
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageSourcePropType,
  ImageStyle,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { KeyboardAvoid } from './KeyboardAvoid';
import { colors, fonts, radius, shadows, space, type } from '../theme';
import { useResponsive, type ContentKind } from '../theme/responsive';
import { ScrollView, useContentStyle } from './layout';
import { initials } from '../utils/format';
import { Icon, type IconName } from './Icon';

// ── Layout ──────────────────────────────────────────────────────────────────

export function Screen({
  children,
  scroll = true,
  edges = ['top'],
  padded = true,
  footer,
  refreshControl,
  kind = 'narrow',
  bg,
  header,
}: {
  children: React.ReactNode;
  /** Page background (defaults to white, as in the reference). */
  bg?: string;
  scroll?: boolean;
  edges?: Edge[];
  padded?: boolean;
  footer?: React.ReactNode;
  /** Fixed content above the scrolling body (e.g. the brand header). */
  header?: React.ReactNode;
  refreshControl?: React.ComponentProps<typeof ScrollView>['refreshControl'];
  /** 'narrow' (forms, details) or 'wide' (dashboards, card grids) content column on large windows. */
  kind?: ContentKind;
}) {
  const content = useContentStyle(kind);
  const body = scroll ? (
    <ScrollView
      kind={kind}
      contentContainerStyle={[padded && styles.padded, { paddingBottom: space.xxl }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, content, padded && styles.padded]}>{children}</View>
  );
  return (
    <SafeAreaView style={[styles.screen, bg ? { backgroundColor: bg } : null]} edges={edges}>
      {header}
      <KeyboardAvoid>
        {body}
        {footer ? (
          <View style={styles.footer}>
            <View style={content}>{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoid>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Page heading: square back button, title and one-line description. */
export function PageHead({ title, subtitle, onBack, right }: { title: string; subtitle?: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <View style={styles.pageHead}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={6} accessibilityRole="button" accessibilityLabel="Back" style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Icon name="arrow-left" size={17} color="#757880" />
        </Pressable>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.pageTitle} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={styles.pageSub}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** The three-bar booking progress indicator. */
export function Steps({ step, total = 3 }: { step: number; total?: number }) {
  return (
    <View style={styles.steps} accessibilityRole="progressbar" accessibilityLabel={`Step ${step} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.step, i < step && styles.stepOn]} />
      ))}
    </View>
  );
}

export function Eyebrow({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <Text style={type.eyebrow}>{children}</Text>
    </View>
  );
}

/** Eyebrow + Manrope heading used by the home sections. */
export function SectionHeading({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return (
    <View style={{ marginBottom: space.md }}>
      {eyebrow ? <Text style={[type.eyebrow, { marginBottom: 9 }]}>{eyebrow}</Text> : null}
      <Text style={styles.sectionHeading} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={[type.small, { marginTop: 4 }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {children}
      </Text>
      {right}
    </View>
  );
}

export function Row({ label, value, bold, hint }: { label: string; value: React.ReactNode; bold?: boolean; hint?: string }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, bold && styles.bold]} numberOfLines={2}>
          {label}
        </Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Text style={[styles.rowValue, bold && styles.boldValue]} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

/** Card of tappable rows (account menu style). */
export function MenuGroup({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.menuGroup, style]}>
      {items.map((c, i) => (
        <View key={i} style={i > 0 ? styles.menuDivider : undefined}>
          {c}
        </View>
      ))}
    </View>
  );
}

export function MenuRow({
  icon,
  title,
  subtitle,
  onPress,
  count,
  tone,
  right,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress: () => void;
  count?: number;
  tone?: 'danger';
  right?: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title} style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
      <View style={styles.menuIcon}>
        <Icon name={icon} size={18} color={tone === 'danger' ? colors.primary : '#777D88'} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.menuTitle, tone === 'danger' && { color: colors.primary }]}>{title}</Text>
        {subtitle ? <Text style={styles.menuSub}>{subtitle}</Text> : null}
      </View>
      {count ? (
        <View style={styles.menuCount}>
          <Text style={styles.menuCountText}>{count > 99 ? '99+' : count}</Text>
        </View>
      ) : null}
      {right ?? <Icon name="chevron-right" size={15} color="#9BA1AB" />}
    </Pressable>
  );
}

/** Collapsible “details” row (the reference uses native <details> with a ▸ marker). */
export function Disclosure({
  title,
  children,
  initiallyOpen = false,
  variant = 'marker',
}: {
  title: string;
  children: React.ReactNode;
  initiallyOpen?: boolean;
  /** 'marker' = ▸ title (forms); 'faq' = title with + / × on the right. */
  variant?: 'marker' | 'faq';
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const toggle = () => {
    if (Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => !o);
  };
  if (variant === 'faq') {
    return (
      <View style={styles.faqItem}>
        <Pressable onPress={toggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.faqSummary}>
          <Text style={styles.faqTitle}>{title}</Text>
          <Icon name={open ? 'x' : 'plus'} size={open ? 20 : 17} color={open ? '#AE262D' : '#7E8896'} />
        </Pressable>
        {open ? <View style={styles.faqAnswer}>{children}</View> : null}
      </View>
    );
  }
  return (
    <View>
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.disclosure}>
        <Text style={styles.disclosureMarker}>{open ? '▾' : '▸'}</Text>
        <Text style={styles.disclosureTitle}>{title}</Text>
      </Pressable>
      {open ? <View style={{ paddingBottom: space.sm }}>{children}</View> : null}
    </View>
  );
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
  icon,
  iconRight,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  accessibilityLabel?: string;
  /** Leading line icon. */
  icon?: IconName;
  /** Trailing line icon (e.g. the arrow on “Search Cabs”). */
  iconRight?: IconName;
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
        pressed && !inactive && { backgroundColor: v.pressed },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} style={{ marginRight: 8 }} /> : icon ? <Icon name={icon} size={small ? 15 : 18} color={v.fg} /> : null}
      <Text style={[styles.btnText, small && styles.btnTextSmall, { color: v.fg }]} numberOfLines={2} maxFontSizeMultiplier={1.4}>
        {title}
      </Text>
      {iconRight && !loading ? <Icon name={iconRight} size={small ? 15 : 18} color={v.fg} /> : null}
    </Pressable>
  );
}

const BUTTON_VARIANTS: Record<ButtonVariant, { bg: string; fg: string; border: string; pressed: string }> = {
  primary: { bg: colors.primary, fg: colors.white, border: colors.primary, pressed: colors.primaryDark },
  secondary: { bg: colors.white, fg: colors.ink, border: colors.border, pressed: colors.subtle },
  danger: { bg: colors.white, fg: colors.primary, border: colors.primaryBorder, pressed: colors.primarySoft },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent', pressed: colors.primarySoft },
  dark: { bg: colors.navy, fg: colors.white, border: colors.navy, pressed: '#0F151D' },
  success: { bg: colors.successStrong, fg: colors.white, border: colors.successStrong, pressed: colors.success },
};

/** Red text action with an optional icon (e.g. “Edit”, “View fare”, “Add stop”). */
export function TextButton({
  title,
  onPress,
  icon,
  iconRight,
  color = colors.primary,
  size = 12,
  disabled,
  accessibilityLabel,
  style,
}: {
  title: string;
  onPress: () => void;
  icon?: IconName;
  iconRight?: IconName;
  color?: string;
  size?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.textBtn, (pressed || disabled) && { opacity: disabled ? 0.45 : 0.7 }, style]}
    >
      {icon ? <Icon name={icon} size={size + 3} color={color} /> : null}
      <Text style={[styles.textBtnText, { color, fontSize: size }]}>{title}</Text>
      {iconRight ? <Icon name={iconRight} size={size + 2} color={color} /> : null}
    </Pressable>
  );
}

export function LinkText({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return (
    <Text accessibilityRole="link" style={styles.link} onPress={onPress}>
      {children}
    </Text>
  );
}

/** Two-button “Back / Home” bar the reference pins under booking flow pages. */
export function FlowFooter({ onBack, onHome, children }: { onBack: () => void; onHome?: () => void; children?: React.ReactNode }) {
  return (
    <View style={{ gap: space.md }}>
      {children}
      <View style={styles.flowFooterRow}>
        <Button title="Back" icon="arrow-left" variant="secondary" onPress={onBack} style={styles.flowFooterBtn} />
        {onHome ? <Button title="Home" icon="house" variant="secondary" onPress={onHome} style={styles.flowFooterBtn} /> : null}
      </View>
    </View>
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
  right,
  ...input
}: TextInputProps & { label?: string; error?: string; hint?: string; prefix?: string; required?: boolean; right?: React.ReactNode }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ marginBottom: space.lg }, style as StyleProp<ViewStyle>]}>
      {label ? (
        <Text style={styles.fieldLabel}>
          {label}
          {required ? <Text style={{ color: colors.primary }}> *</Text> : null}
        </Text>
      ) : null}
      <View style={[styles.inputWrap, focused && styles.inputFocused, !!error && styles.inputError, input.editable === false && styles.inputDisabled]}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          placeholderTextColor={colors.faint}
          style={[styles.input, input.multiline && styles.inputMultiline]}
          accessibilityLabel={label}
          accessibilityHint={error || hint}
          {...input}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
        />
        {right}
      </View>
      {error ? (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

/** Two-up pill group (e.g. “To airport / From airport”). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.segment, style]} accessibilityRole="radiogroup">
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

/** Underlined tabs (One Way / Round Trip; My Bookings uses `Chip`s). */
export function Tabs<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)} style={[styles.tab, on && styles.tabOn]}>
            <Text style={[styles.tabText, on && styles.tabTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, active, onPress, count, accessibilityLabel }: { label: string; active?: boolean; onPress?: () => void; count?: number; accessibilityLabel?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [styles.chip, active && styles.chipOn, pressed && styles.pressed]}
    >
      <Text style={[styles.chipText, active && styles.chipTextOn]} numberOfLines={1}>
        {label}
        {count ? ` · ${count}` : ''}
      </Text>
    </Pressable>
  );
}

/** Round radio dot. */
export function RadioDot({ on }: { on: boolean }) {
  return <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioInner} /> : null}</View>;
}

/** Selectable option card (payment choice style). */
export function RadioCard({
  selected,
  onPress,
  title,
  subtitle,
  right,
  disabled,
  icon,
}: {
  selected: boolean;
  onPress: () => void;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  disabled?: boolean;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      style={({ pressed }) => [styles.radioCard, selected && styles.radioCardOn, disabled && { opacity: 0.5 }, pressed && styles.pressed]}
    >
      {icon ? <Icon name={icon} size={20} color={selected ? colors.primary : colors.muted} /> : <RadioDot on={selected} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.radioTitle}>{title}</Text>
        {subtitle ? <Text style={styles.radioSub}>{subtitle}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

// ── Feedback ────────────────────────────────────────────────────────────────

type NoticeTone = 'error' | 'info' | 'success' | 'warning';
const NOTICE: Record<NoticeTone, { bg: string; border: string; fg: string; icon: IconName }> = {
  error: { bg: '#FFF4F3', border: colors.primaryBorder, fg: colors.primaryDark, icon: 'info' },
  info: { bg: colors.surface, border: colors.divider, fg: '#55606F', icon: 'info' },
  success: { bg: colors.successSoft, border: colors.successBorder, fg: colors.success, icon: 'circle-check' },
  warning: { bg: colors.warningSoft, border: colors.warningBorder, fg: colors.warning, icon: 'info' },
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
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      style={[styles.notice, { backgroundColor: t.bg, borderColor: t.border }, style]}
    >
      <Icon name={t.icon} size={16} color={t.fg} />
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

export function EmptyState({
  title,
  message,
  action,
  image,
  imageStyle,
  icon,
}: {
  title: string;
  message?: string;
  action?: React.ReactNode;
  image?: ImageSourcePropType;
  imageStyle?: StyleProp<ImageStyle>;
  /** Line icon in the reference empty-state style (preferred over an illustration). */
  icon?: IconName;
}) {
  return (
    <View style={styles.empty}>
      {icon ? (
        <View style={{ marginBottom: space.md }}>
          <Icon name={icon} size={30} color="#7A8494" strokeWidth={1.6} />
        </View>
      ) : image ? (
        <Image source={image} style={[styles.emptyImage, imageStyle]} resizeMode="contain" accessible={false} importantForAccessibility="no" />
      ) : null}
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMsg}>{message}</Text> : null}
      {action ? <View style={{ marginTop: space.lg, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';
const BADGE: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: '#F0F3F7', fg: '#465265' },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: '#FFF1F1', fg: colors.primary },
  info: { bg: colors.infoSoft, fg: colors.info },
  brand: { bg: '#FFF1F1', fg: colors.primary },
};

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: BadgeTone }) {
  const map = BADGE[tone];
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
    return <Image source={{ uri: photoUrl }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.border }} />;
  }
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
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
  subtitle,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  dismissible?: boolean;
  subtitle?: string;
}) {
  const r = useResponsive();
  const wide = !r.isCompact;
  return (
    <Modal visible={visible} transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={dismissible ? onClose : () => undefined} statusBarTranslucent>
      <View style={[styles.sheetBackdrop, wide && styles.sheetBackdropWide]}>
        <Pressable style={wide ? StyleSheet.absoluteFill : { flex: 1 }} onPress={dismissible ? onClose : undefined} accessibilityLabel="Close" accessibilityRole="button" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={wide ? styles.sheetWideWrap : undefined}>
          <SafeAreaView edges={wide ? [] : ['bottom']} style={[styles.sheet, wide && styles.sheetWide, { maxHeight: wide ? r.height - space.xl * 2 : Math.round(r.height * 0.9) }]}>
            {wide ? null : <View style={styles.sheetHandle} />}
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle} accessibilityRole="header" numberOfLines={2}>
                  {title}
                </Text>
                {subtitle ? <Text style={[type.small, { marginTop: 2 }]}>{subtitle}</Text> : null}
              </View>
              {dismissible ? (
                <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={({ pressed }) => [styles.sheetClose, pressed && styles.pressed]}>
                  <Icon name="x" size={18} color="#757880" />
                </Pressable>
              ) : null}
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: space.lg }}>
              {children}
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  padded: { paddingHorizontal: space.xl, paddingTop: space.xl },
  pressed: { opacity: 0.72 },
  footer: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: '#E5E8ED',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: '#E3E7EC',
    padding: 18,
    marginBottom: space.md,
  },
  pageHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xl },
  back: {
    width: 38,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#E3E7EC',
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageTitle: { ...type.h1 },
  pageSub: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, color: '#6D7785', marginTop: 4 },
  steps: { flexDirection: 'row', gap: 6, marginBottom: space.xl },
  step: { flex: 1, height: 3, borderRadius: 3, backgroundColor: '#E0E5E1' },
  stepOn: { backgroundColor: colors.primary },
  sectionHeading: { ...type.h2, fontSize: 23, lineHeight: 31 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md, marginTop: space.sm },
  sectionTitle: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.ink, letterSpacing: -0.2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 8, gap: space.md },
  rowLabel: { fontFamily: fonts.regular, fontSize: 13, color: '#55606F' },
  rowHint: { fontFamily: fonts.regular, fontSize: 10, color: '#8A929E', marginTop: 2 },
  rowValue: { flexShrink: 1, fontFamily: fonts.semiBold, fontSize: 13, color: colors.ink, textAlign: 'right' },
  bold: { fontFamily: fonts.semiBold, color: colors.ink, fontSize: 16 },
  boldValue: { fontFamily: fonts.bold, color: colors.ink, fontSize: 17 },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: space.md },
  menuGroup: { borderRadius: radius.xl, borderWidth: 1, borderColor: '#E3E7EC', paddingHorizontal: 15, paddingVertical: 2, backgroundColor: colors.white, marginBottom: 14 },
  menuDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, minHeight: 64 },
  menuIcon: { width: 35, height: 35, borderRadius: 10, backgroundColor: '#F6F7F9', alignItems: 'center', justifyContent: 'center' },
  menuTitle: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 19.5, color: colors.text },
  menuSub: { fontFamily: fonts.regular, fontSize: 10.5, lineHeight: 15, color: '#9499A3', marginTop: 2 },
  menuCount: { minWidth: 22, paddingHorizontal: 5, paddingVertical: 3, borderRadius: 6, backgroundColor: '#FFF2F2', alignItems: 'center' },
  menuCountText: { fontFamily: fonts.medium, fontSize: 10, color: colors.primary },
  faqItem: { borderBottomWidth: 1, borderBottomColor: '#E3E6EB' },
  faqSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, paddingVertical: 17, minHeight: 54 },
  faqTitle: { flex: 1, fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 19, color: '#343D4B' },
  faqAnswer: { paddingRight: 22, paddingBottom: 17 },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, minHeight: 44 },
  disclosureMarker: { fontSize: 10, color: colors.ink, width: 10 },
  disclosureTitle: { fontFamily: fonts.semiBold, fontSize: 12.5, color: colors.ink },
  btn: {
    minHeight: 48,
    paddingHorizontal: 15,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    cursor: 'pointer' as any,
  },
  btnSmall: { minHeight: 38, paddingHorizontal: space.md, gap: 6 },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' as any },
  btnText: { fontFamily: fonts.semiBold, fontSize: 14.5, textAlign: 'center', flexShrink: 1 },
  btnTextSmall: { fontSize: 12.5 },
  textBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, minHeight: 34 },
  textBtnText: { fontFamily: fonts.medium },
  link: { color: colors.link, fontFamily: fonts.medium, fontSize: 13, cursor: 'pointer' as any },
  flowFooterRow: { flexDirection: 'row', gap: space.md },
  flowFooterBtn: { flex: 1, minHeight: 46 },
  fieldLabel: { fontFamily: fonts.regular, fontSize: 11.5, color: '#697587', marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 11,
    minHeight: 46,
  },
  inputFocused: { borderColor: '#B7BEC9' },
  inputError: { borderColor: colors.primary, backgroundColor: '#FFFBFB' },
  inputDisabled: { backgroundColor: '#F4F6F9', borderColor: '#E7EAEF' },
  prefix: { color: '#697587', fontFamily: fonts.medium, marginRight: 8, fontSize: 15 },
  input: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.value, paddingVertical: 11, letterSpacing: -0.2 },
  inputMultiline: { minHeight: 84, textAlignVertical: 'top' },
  errorText: { color: colors.primaryDark, fontFamily: fonts.medium, fontSize: 12, marginTop: 5 },
  hint: { color: '#6D7785', fontFamily: fonts.regular, fontSize: 11, marginTop: 5 },
  segment: { flexDirection: 'row', backgroundColor: '#F6F7F9', borderRadius: 11, borderWidth: 1, borderColor: '#ECEEF2', padding: 4, gap: 4 },
  segmentItem: { flex: 1, minHeight: 40, paddingVertical: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent' },
  segmentOn: { backgroundColor: colors.white, borderColor: '#E3E6EB', ...shadows.sm },
  segmentText: { fontFamily: fonts.medium, fontSize: 12.5, color: '#666D79' },
  segmentTextOn: { color: colors.primary },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E7EAEE' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, minHeight: 44, borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1 },
  tabOn: { borderBottomColor: colors.primary },
  tabText: { fontFamily: fonts.medium, fontSize: 13, color: '#7B8390' },
  tabTextOn: { fontFamily: fonts.semiBold, color: colors.primary },
  chip: {
    flexGrow: 1,
    flexBasis: 0,
    minHeight: 38,
    paddingHorizontal: 6,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E3E7EC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: '#FFF1F1', borderColor: '#F3C3C3' },
  chipText: { fontFamily: fonts.medium, fontSize: 11, color: colors.text },
  chipTextOn: { color: colors.primary },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: '#8D95A1', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  radioOn: { borderColor: colors.primary },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  radioCard: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: '#E3E7EC', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 16, backgroundColor: colors.white, marginBottom: 10 },
  radioCardOn: { borderColor: '#E59A9A', backgroundColor: '#FFF6F5' },
  radioTitle: { fontFamily: fonts.semiBold, fontSize: 12.5, color: colors.ink },
  radioSub: { fontFamily: fonts.regular, fontSize: 10.5, color: '#6D7785', marginTop: 3 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: space.md,
    gap: 9,
  },
  noticeText: { flex: 1, fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 18 },
  noticeRetry: { fontFamily: fonts.semiBold, fontSize: 12.5, textDecorationLine: 'underline' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white, padding: space.xl },
  empty: {
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: 40,
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: '#E3E7EC',
  },
  emptyImage: { width: 120, height: 120, marginBottom: space.md },
  emptyTitle: { fontFamily: fonts.semiBold, fontSize: 13.5, color: '#5F6978', textAlign: 'center' },
  emptyMsg: { fontFamily: fonts.regular, fontSize: 12, color: '#6D7785', textAlign: 'center', marginTop: 4, lineHeight: 18 },
  badge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: radius.xs, alignSelf: 'flex-start' },
  badgeText: { fontFamily: fonts.bold, fontSize: 10, letterSpacing: 0.2 },
  avatar: { backgroundColor: '#FFF1F1', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontFamily: fonts.medium },
  sheetBackdrop: { flex: 1, backgroundColor: colors.overlay },
  sheetBackdropWide: { justifyContent: 'center', alignItems: 'center', padding: space.xl },
  sheetWideWrap: { width: '100%', maxWidth: 560, maxHeight: '100%' },
  sheetWide: { borderRadius: 16, paddingTop: space.sm },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: space.xl,
  },
  sheetHandle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: '#DDE2E8', marginTop: space.sm },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space.lg, gap: space.md },
  sheetTitle: { fontFamily: fonts.semiBold, fontSize: 18, color: colors.ink, letterSpacing: -0.4 },
  sheetClose: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: '#E3E7EC', alignItems: 'center', justifyContent: 'center' },
});
