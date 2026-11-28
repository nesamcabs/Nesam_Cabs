// The booking card of the Partner panel (Bookings list): date and time chips, the route, a row of chips (service, distance,
// vehicle) and the vendor payout beside the action. It keeps the same layout on phones as on wide screens, only smaller.
// The Duties list draws its duties with DutyTicket. Amount and Road are shared with the Duty details page.
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { colors } from '../../theme';
import { useWindowWidth } from '../../theme/responsive';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const serviceIcon = (label: string): IconName => (/round/i.test(label) ? 'repeat' : /airport/i.test(label) ? 'airplane-outline' : /rental|local/i.test(label) ? 'time-outline' : 'swap-horizontal');

export interface DutyCardProps {
  /** "13/11/2026" and "04:55 PM". */
  date: string;
  time: string;
  from: string;
  to: string;
  /** "One Way", "Round Trip" … */
  service: string;
  /** "381 km" (omitted when unknown). */
  distance?: string;
  vehicle: string;
  payout: string;
  payoutLabel?: string;
  /** The button beside the payout; none on a page that has its own actions. */
  action?: { label: string; onPress: () => void; icon?: IconName };
  /** The card as a whole opens something (the list); the button then only repeats it for clarity. */
  onPress?: () => void;
  /** A status badge (a booking state). */
  badge?: React.ReactNode;
  /** Extra lines under the card's main content (fuel, deadline, notes). */
  children?: React.ReactNode;
  accessibilityLabel?: string;
}

function Chip({ icon, text, tone = 'grey', sm, shrink }: { icon: IconName; text: string; tone?: 'pink' | 'grey'; sm: boolean; shrink?: boolean }) {
  const pink = tone === 'pink';
  return (
    <View style={[s.chip, sm && c.chip, pink ? s.chipPink : s.chipGrey, shrink ? s.fill : s.noShrink]}>
      <Ionicons name={icon} size={sm ? 13 : 16} color={pink ? colors.primary : '#6F7785'} />
      <Text style={[s.chipText, sm && c.chipText, pink && { color: colors.primary, fontWeight: '700' }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const Divider = ({ sm, tall }: { sm: boolean; tall?: boolean }) => <View style={[s.vline, sm && c.vline, tall && { height: sm ? 40 : 46 }]} />;

/** "₹6,255.30" as a small ₹, large 6,255 and small .30; any other text ("Your quote") as it is. `big` is the duty page's size. */
export function Amount({ text, sm, big }: { text: string; sm?: boolean; big?: boolean }) {
  const m = /^(₹)([\d,]+)(\.\d+)?$/.exec(text);
  const size = [q.amount, sm && q.amountSm, big && q.amountBig];
  if (!m) return <Text style={size} numberOfLines={1}>{text}</Text>;
  return (
    <Text style={size} numberOfLines={1}>
      <Text style={[q.amountSym, sm && q.amountSymSm, big && q.amountSymBig]}>{m[1]}</Text>{m[2]}{m[3] ? <Text style={[q.amountFrac, sm && q.amountFracSm, big && q.amountFracBig]}>{m[3]}</Text> : null}
    </Text>
  );
}

/** The NESAM road from the pickup (a ring) to the drop (a red dot): dark, with red lane marks and the distance on a tag in the middle. */
export function Road({ distance, style }: { distance?: string; style?: StyleProp<ViewStyle> }) {
  const [width, setWidth] = useState(0);
  const lanes = Math.max(0, Math.floor((width - 16) / 14));
  return (
    <View style={[r.wrap, style]}>
      <View style={r.road} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {Array.from({ length: lanes }, (_, i) => <View key={i} style={r.lane} />)}
      </View>
      <View style={[r.dot, r.start]} />
      <View style={[r.dot, r.end]} />
      {distance ? (
        <View style={r.middle}>
          <View style={r.tag}>
            <Ionicons name="car-sport" size={12} color={colors.ink} />
            <Text style={r.tagText} numberOfLines={1}>{distance}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function DutyCard({ date, time, from, to, service, distance, vehicle, payout, payoutLabel = 'Vendor payout', action, onPress, badge, children, accessibilityLabel }: DutyCardProps) {
  const width = useWindowWidth();
  const sm = width < 560;
  const xs = width < 360;
  // A long button label ("Assign driver", "View booking") cannot sit beside the payout on a phone: it goes under it, full width.
  const stack = sm && (action?.label.length ?? 0) > 10;
  const body = (
    <View style={[s.card, sm && c.card]}>
      <View style={s.accent} />
      <View style={[s.inner, sm && c.inner]}>
        <View style={[s.row, sm && c.row, { flexWrap: badge ? 'wrap' : 'nowrap' }]}>
          <View style={[s.chip, sm && c.chip, s.chipPink, s.shrink, s.fillDate]}>
            <Ionicons name="calendar-outline" size={sm ? 14 : 16} color={colors.primary} />
            <Text style={[s.when, sm && c.when]} numberOfLines={1}>{date || '—'}</Text>
          </View>
          <Divider sm={sm} />
          <View style={[s.chip, sm && c.chip, s.chipPink, s.noShrink]}>
            <Ionicons name="time-outline" size={sm ? 14 : 16} color={colors.primary} />
            <Text style={[s.when, sm && c.when]} numberOfLines={1}>{time || '—'}</Text>
          </View>
          {badge ? <View style={{ marginLeft: 'auto' }}>{badge}</View> : null}
        </View>

        <View style={s.routeRow}>
          <Ionicons name="location" size={sm ? 19 : 22} color={colors.primary} style={{ marginTop: sm ? 3 : 4 }} />
          <Text style={[s.route, sm && c.route]} numberOfLines={3}>
            {from}<Text style={s.arrow}>  →  </Text>{to}
          </Text>
        </View>

        <View style={[s.row, sm && c.row, { flexWrap: 'wrap' }]}>
          <Chip icon={serviceIcon(service)} text={service} tone="pink" sm={sm} />
          {distance ? <>{sm ? null : <Divider sm={sm} />}<Chip icon="navigate-outline" text={distance} sm={sm} /></> : null}
          {sm ? null : <Divider sm={sm} />}
          <Chip icon="car-sport-outline" text={vehicle} sm={sm} shrink />
        </View>

        {children}

        <View style={s.rule} />
        <View style={[s.bottom, sm && c.bottom, stack && { flexDirection: 'column', alignItems: 'stretch', gap: 12 }]}>
          <View style={[s.payout, sm && c.payout]}>
            <View style={[s.walletTile, sm && c.walletTile, xs && x.walletTile]}><Ionicons name="wallet-outline" size={sm ? 21 : 24} color={colors.primary} /></View>
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              <Text style={[s.payLabel, sm && c.payLabel, xs && x.payLabel]} numberOfLines={1}>{payoutLabel.toUpperCase()}</Text>
              <Text style={[s.pay, sm && c.pay, xs && x.pay]} numberOfLines={1} adjustsFontSizeToFit>{payout}</Text>
            </View>
          </View>
          {action ? (
            <>
              {stack ? null : <Divider sm={sm} tall />}
              <Pressable onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.label}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [s.button, sm && c.button, xs && x.button, stack && { alignSelf: 'stretch' }, hovered && { backgroundColor: colors.primaryDark }, pressed && { opacity: 0.92 }]}>
                {action.icon ? <Ionicons name={action.icon} size={sm ? 16 : 18} color="#fff" /> : null}
                <Text style={[s.buttonText, sm && c.buttonText, xs && x.buttonText]} numberOfLines={1}>{action.label}</Text>
                <Ionicons name="chevron-forward" size={sm ? 16 : 18} color="#fff" />
              </Pressable>
            </>
          ) : null}
        </View>
      </View>
    </View>
  );
  return onPress ? (
    // With a button of its own inside, the card is not itself a "button" (on the web that would be a <button> in a <button>).
    <Pressable onPress={onPress} accessibilityRole={action ? undefined : 'button'} accessibilityLabel={accessibilityLabel} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [hovered && { opacity: 0.985 }]}>{body}</Pressable>
  ) : body;
}

const shadow = Platform.select({ web: { boxShadow: '0 6px 22px rgba(22,32,51,0.07)' } as object, default: { shadowColor: '#162033', shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2 } });

const s = StyleSheet.create({
  card: { flexDirection: 'row', backgroundColor: colors.white, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, ...shadow },
  accent: { width: 5, backgroundColor: colors.primary },
  inner: { flex: 1, minWidth: 0, paddingVertical: 18, paddingHorizontal: 18, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, rowGap: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 14, borderRadius: 12 },
  shrink: { flexShrink: 1, minWidth: 0 },
  // The info chips share the row evenly, so their edges line up with the date row above and the payout row below.
  fill: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: 0, justifyContent: 'center' },
  fillDate: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: 0 },
  noShrink: { flexShrink: 0 },
  chipPink: { backgroundColor: colors.primarySoft },
  chipGrey: { backgroundColor: '#F6F7F9' },
  chipText: { fontSize: 14, color: colors.ink, flexShrink: 1 },
  when: { fontSize: 15, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  vline: { width: 1, height: 26, backgroundColor: '#D8DFE9', flexShrink: 0 },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  route: { flex: 1, fontSize: 22, fontWeight: '700', color: colors.ink, letterSpacing: -0.6, lineHeight: 30 },
  arrow: { color: colors.primary, fontWeight: '700' },
  rule: { height: 1, backgroundColor: colors.border, marginTop: 2 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  payout: { flexDirection: 'row', alignItems: 'center', gap: 14, flexShrink: 1, minWidth: 0 },
  walletTile: { width: 52, height: 52, borderRadius: 14, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  payLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 1.2, color: '#6F7785' },
  pay: { fontSize: 28, fontWeight: '700', color: colors.primary, letterSpacing: -0.8, marginTop: 2 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 52, paddingHorizontal: 26, borderRadius: 12, backgroundColor: colors.primary, minWidth: 170, flexShrink: 0 },
  buttonText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});

// The same card on phones: everything stays on its row, just smaller.
const c = StyleSheet.create({
  card: { borderRadius: 18 },
  inner: { paddingVertical: 15, paddingHorizontal: 10, gap: 12 },
  row: { gap: 6, rowGap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 7, gap: 4, borderRadius: 10 },
  chipText: { fontSize: 11.5 },
  when: { fontSize: 13 },
  vline: { height: 22 },
  route: { fontSize: 18, lineHeight: 25, letterSpacing: -0.5 },
  bottom: { gap: 9 },
  payout: { gap: 10 },
  walletTile: { width: 44, height: 44, borderRadius: 12 },
  payLabel: { fontSize: 10.5, letterSpacing: 0.9 },
  pay: { fontSize: 22 },
  button: { minHeight: 44, paddingHorizontal: 13, gap: 6, minWidth: 0, borderRadius: 11 },
  buttonText: { fontSize: 14 },
});

// The amount (Duty details page).
const q = StyleSheet.create({
  amount: { fontSize: 24, fontWeight: '700', color: colors.ink, letterSpacing: -0.6, lineHeight: 30 },
  amountSm: { fontSize: 23, lineHeight: 29 },
  amountSym: { fontSize: 16, fontWeight: '600', color: '#475569', letterSpacing: 0 },
  amountSymSm: { fontSize: 15 },
  amountFrac: { fontSize: 14, fontWeight: '600', color: '#475569', letterSpacing: 0 },
  amountFracSm: { fontSize: 13 },
  amountBig: { fontSize: 32, lineHeight: 40, letterSpacing: -0.9 },
  amountSymBig: { fontSize: 20 },
  amountFracBig: { fontSize: 18 },
});

// The NESAM road between the places (Duty details): the dark road, its red lane marks, the two ends and the distance tag.
const ROAD = '#1D2129';
const r = StyleSheet.create({
  wrap: { height: 22, marginTop: 6, justifyContent: 'center' },
  road: { position: 'absolute', left: 7, right: 7, top: 8, height: 6, borderRadius: 3, backgroundColor: ROAD, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', overflow: 'hidden', paddingHorizontal: 8 },
  lane: { width: 7, height: 2, borderRadius: 1, backgroundColor: colors.primary },
  dot: { position: 'absolute', top: 4, width: 14, height: 14, borderRadius: 7 },
  start: { left: 0, backgroundColor: colors.white, borderWidth: 3.5, borderColor: ROAD },
  end: { right: 0, backgroundColor: colors.primary },
  middle: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 22, paddingHorizontal: 10, borderRadius: 11, backgroundColor: colors.white, borderWidth: 1, borderColor: '#D9DEE6' },
  tagText: { fontSize: 11.5, fontWeight: '700', color: colors.ink },
});

// Very small phones (under 360 px).
const x = StyleSheet.create({
  walletTile: { width: 38, height: 38, borderRadius: 11 },
  payLabel: { fontSize: 9.5, letterSpacing: 0.5 },
  pay: { fontSize: 20 },
  button: { paddingHorizontal: 10, gap: 4 },
  buttonText: { fontSize: 13 },
});
