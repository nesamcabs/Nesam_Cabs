// NESAM Partner building blocks for the Vendor app, drawn after the client reference (NESAM_Complete_Vendor.html):
// page heading, duty card, assignment obligation, key-value list, underline tabs, buttons and badges.
import React from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export const rupees = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : `₹${(Math.round(n * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const dayText = (d: Date | null) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(d) : '—');
export const timeText = (d: Date | null) => (d ? new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(d) : '');
export const dayTime = (d: Date | null) => (d ? `${dayText(d)} · ${timeText(d)}` : '—');
export const plate = (v: string) => {
  const k = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = k.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : v;
};

export function PageHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <View style={styles.heading}>
      <View style={{ flex: 1 }}>
        <Text style={styles.h1} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

type BtnStyle = 'primary' | 'secondary' | 'text' | 'bid';
export function PButton({ title, onPress, style = 'primary', icon, busy, disabled, full, containerStyle }: {
  title: string; onPress: () => void; style?: BtnStyle; icon?: IconName; busy?: boolean; disabled?: boolean; full?: boolean; containerStyle?: StyleProp<ViewStyle>;
}) {
  const v = BTN[style];
  const off = disabled || busy;
  return (
    <Pressable onPress={off ? undefined : onPress} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => [styles.btn, style === 'text' && styles.btnText, { backgroundColor: v.bg, borderColor: v.border }, full && { alignSelf: 'stretch' }, off && { opacity: 0.5 }, pressed && !off && { opacity: 0.85 }, containerStyle]}>
      {busy ? <ActivityIndicator color={v.fg} size="small" /> : icon ? <Ionicons name={icon} size={style === 'text' ? 15 : 18} color={v.fg} /> : null}
      <Text style={[styles.btnLabel, style === 'text' && { fontSize: 13 }, { color: v.fg }]} numberOfLines={1}>{title}</Text>
    </Pressable>
  );
}
const BTN: Record<BtnStyle, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: colors.white, border: colors.primary },
  secondary: { bg: colors.white, fg: colors.ink, border: colors.border },
  text: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  bid: { bg: colors.white, fg: colors.primary, border: colors.primaryBorder },
};

export type Tone = 'neutral' | 'green' | 'amber' | 'red';
export function PBadge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const t = { neutral: ['#F1F3F6', '#5E6878'], green: [colors.successSoft, colors.success], amber: [colors.warningSoft, colors.warning], red: [colors.primarySoft, colors.primary] }[tone];
  return <View style={[styles.badge, { backgroundColor: t[0] }]}><Text style={[styles.badgeText, { color: t[1] }]} numberOfLines={1}>{label}</Text></View>;
}

export function Panel({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <View style={{ marginTop: 6 }}>
      {rows.map(([k, v], i) => (
        <View key={`${k}-${i}`} style={styles.kv}><Text style={styles.kvKey}>{k}</Text><Text style={styles.kvVal}>{v}</Text></View>
      ))}
    </View>
  );
}

export function UTabs<T extends string>({ items, value, onChange }: { items: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void }) {
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {items.map((t) => {
        const on = t.id === value;
        return (
          <Pressable key={t.id} onPress={() => onChange(t.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[styles.tab, on && styles.tabOn]}>
            <Text style={[styles.tabLabel, on && { color: colors.primary }]} numberOfLines={1}>{t.label}</Text>
            {t.count !== undefined ? <View style={[styles.tabCount, on && { backgroundColor: colors.primarySoft }]}><Text style={[styles.tabCountText, on && { color: colors.primary }]}>{t.count}</Text></View> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function ExtraTag() {
  return (
    <View style={styles.extra}><Ionicons name="receipt-outline" size={13} color={colors.muted} /><Text style={styles.extraText}>Toll · Parking · State tax <Text style={{ color: colors.info, fontWeight: '600' }}>Extra</Text></Text></View>
  );
}

/** Assign-by deadline, missed-deadline charge and the extras rule. */
export function Obligation({ label = 'Assign by', value, help, penalty }: { label?: string; value: string; help?: string; penalty: number }) {
  return (
    <View style={styles.obligation}>
      <View style={styles.oRow}><Ionicons name="time-outline" size={16} color={colors.warning} /><Text style={styles.oText}>{label} <Text style={styles.oStrong}>{value}</Text></Text></View>
      {help ? <Text style={styles.oHelp}>{help}</Text> : null}
      <View style={styles.oRow}><Ionicons name="warning-outline" size={16} color={colors.warning} /><Text style={styles.oText}>Missed assignment deadline <Text style={styles.oStrong}>{rupees(penalty)}</Text></Text></View>
      <Text style={styles.oHelp}>Confirm a verified driver and matching vehicle by the deadline. The duty stays accepted if overdue; an office-confirmed penalty is recorded in Wallet.</Text>
      <ExtraTag />
    </View>
  );
}

/** Duty card used by Trips (open duties) and Bookings (accepted duties). */
export function DutyCard({ pickupAt, pickupText, from, to, tripType, category, km, payout, payoutLabel = 'Vendor payout', code, badge, note, team, footer, onOpen }: {
  pickupAt: Date | null; pickupText?: string; from: string; to: string; tripType?: string; category?: string; km?: number; payout: number | null; payoutLabel?: string; code: string;
  badge?: React.ReactNode; note?: React.ReactNode; team?: [string, string]; footer?: React.ReactNode; onOpen?: () => void;
}) {
  return (
    <View style={styles.duty}>
      <View style={styles.dutyTop}>
        <View style={styles.oRow}><Ionicons name="calendar-outline" size={15} color={colors.ink} /><Text style={styles.dutyWhen}>{pickupAt ? dayTime(pickupAt) : pickupText || 'Pickup time to be confirmed'}</Text></View>
        {badge}
      </View>
      <Text style={styles.route}>{from || '—'} <Text style={{ color: colors.faint }}>→</Text> {to || '—'}</Text>
      <View style={styles.meta}>
        {tripType ? <View style={styles.service}><Text style={styles.serviceText}>{tripType}</Text></View> : null}
        {category ? <View style={styles.oRow}><Ionicons name="car-outline" size={16} color={colors.ink} /><Text style={styles.category}>{category}</Text></View> : null}
      </View>
      {km ? <View style={[styles.oRow, { marginTop: 8 }]}><Ionicons name="git-compare-outline" size={14} color={colors.muted} /><Text style={styles.km}>{km} km included</Text></View> : null}
      {team ? (
        <View style={[styles.meta, { marginTop: 8 }]}>
          <View style={styles.oRow}><Ionicons name="person-outline" size={14} color={colors.muted} /><Text style={styles.km}>{team[0]}</Text></View>
          <View style={styles.oRow}><Ionicons name="car-outline" size={14} color={colors.muted} /><Text style={styles.km}>{team[1]}</Text></View>
        </View>
      ) : null}
      {note}
      <ExtraTag />
      <View style={styles.dutyBottom}>
        <View><Text style={styles.payoutLabel}>{payoutLabel}</Text><Text style={styles.payout}>{rupees(payout)}</Text></View>
      </View>
      {footer ? <View style={styles.dutyActions}>{footer}</View> : null}
      <Pressable onPress={onOpen} disabled={!onOpen} accessibilityRole="button" accessibilityLabel={`Open ${code}`} style={styles.codeRow}>
        <Text style={styles.code}>{code}</Text>{onOpen ? <Ionicons name="chevron-forward" size={12} color={colors.faint} /> : null}
      </Pressable>
    </View>
  );
}

export function GateBanner({ title, message, action }: { title: string; message: string; action: React.ReactNode }) {
  return (
    <View style={styles.gate}>
      <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
      <View style={{ flex: 1 }}><Text style={styles.gateTitle}>{title}</Text><Text style={styles.gateText}>{message}</Text></View>
      {action}
    </View>
  );
}

export function Feedback({ message, tone = 'ok' }: { message: string; tone?: 'ok' | 'error' }) {
  if (!message) return null;
  return (
    <View accessibilityRole={tone === 'error' ? 'alert' : undefined} style={[styles.feedback, tone === 'error' && { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder }]}>
      <Ionicons name={tone === 'error' ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={18} color={tone === 'error' ? colors.primary : colors.success} />
      <Text style={[styles.feedbackText, tone === 'error' && { color: colors.primaryDark }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginBottom: space.lg },
  h1: { fontSize: 26, fontWeight: '700', color: colors.ink, letterSpacing: -0.5 },
  sub: { fontSize: 13, color: colors.muted, marginTop: 4 },
  btn: { minHeight: 46, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnText: { minHeight: 36, paddingHorizontal: 4, alignSelf: 'flex-start' },
  btnLabel: { fontSize: 14, fontWeight: '600' },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11.5, fontWeight: '600' },
  panel: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, marginBottom: space.md },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  kvKey: { flex: 1, fontSize: 13, color: colors.muted },
  kvVal: { flexShrink: 1, fontSize: 13, color: colors.ink, fontWeight: '600', textAlign: 'right' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: space.md },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 46, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.primary },
  tabLabel: { fontSize: 13, fontWeight: '600', color: colors.muted },
  tabCount: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 5, backgroundColor: '#F1F3F6', alignItems: 'center', justifyContent: 'center' },
  tabCountText: { fontSize: 10.5, fontWeight: '700', color: colors.muted },
  extra: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  extraText: { fontSize: 12, color: colors.muted },
  obligation: { borderWidth: 1, borderColor: colors.warningBorder, backgroundColor: colors.warningSoft, borderRadius: 12, padding: 14, marginVertical: space.md, gap: 6 },
  oRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  oText: { fontSize: 13, color: colors.text, flexShrink: 1 },
  oStrong: { fontWeight: '700', color: colors.ink },
  oHelp: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  duty: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 18, marginBottom: space.md },
  dutyTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm },
  dutyWhen: { fontSize: 14, fontWeight: '600', color: colors.ink },
  route: { fontSize: 19, fontWeight: '600', color: colors.ink, marginTop: 12, letterSpacing: -0.2 },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginTop: 10 },
  service: { backgroundColor: colors.primarySoft, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 5 },
  serviceText: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  category: { fontSize: 14, color: colors.ink, fontWeight: '500' },
  km: { fontSize: 13, color: colors.text },
  dutyBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 14 },
  payoutLabel: { fontSize: 12, color: colors.muted },
  payout: { fontSize: 26, fontWeight: '700', color: colors.ink, letterSpacing: -0.4 },
  dutyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, alignSelf: 'flex-start', minHeight: 24 },
  code: { fontSize: 11, color: colors.muted, letterSpacing: 0.4 },
  gate: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: colors.warningBorder, borderRadius: 14, padding: 14, marginBottom: space.md },
  gateTitle: { fontSize: 13, fontWeight: '600', color: colors.warning },
  gateText: { fontSize: 12, color: colors.text, marginTop: 2 },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.successSoft, borderWidth: 1, borderColor: colors.successBorder, borderRadius: 12, padding: 12, marginBottom: space.md },
  feedbackText: { flex: 1, fontSize: 13, color: colors.success, fontWeight: '500' },
});
