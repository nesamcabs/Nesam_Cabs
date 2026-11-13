// The duty / booking card of the Partner panel. Two looks of one card:
//   • the full card (duty page, Bookings list): date and time chips, the route, a row of chips (service, distance, vehicle) and the
//     vendor payout beside the action;
//   • the compact card (`compact`, the marketplace list): three quiet bands, so many duties can be scanned quickly —
//       date · time ................................ price
//       Pickup → Drop (the hero line)
//       ─────────────────────────────────────────────
//       service, distance · vehicle ................ mode tag
//     The whole card is the tap target, so it has no button.
//
// Phones keep exactly the same layout as wide screens, only smaller; a long vehicle name is shortened with "…" rather than wrapping.
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
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
  /** The quiet, button-free list card. */
  compact?: boolean;
  /** A status badge (the publish mode, a booking state). */
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

/** The compact list card: date·time and the mode tag, the route, then the facts and the price. */
function CompactCard({ date, time, from, to, service, distance, vehicle, payout, badge, children, sm }: Pick<DutyCardProps, 'date' | 'time' | 'from' | 'to' | 'service' | 'distance' | 'vehicle' | 'payout' | 'badge' | 'children'> & { sm: boolean }) {
  return (
    <View style={[s.card, q.card]}>
      <View style={s.accent} />
      <View style={[q.inner, sm && q.innerSm]}>
        <View style={q.head}>
          <View style={q.when}>
            <Ionicons name="calendar-outline" size={sm ? 14 : 15} color="#8A94A6" />
            <Text style={[q.whenText, sm && q.whenTextSm]} numberOfLines={1}>{date || '—'}</Text>
            <View style={q.dot} />
            <Ionicons name="time-outline" size={sm ? 14 : 15} color="#8A94A6" />
            <Text style={[q.whenText, sm && q.whenTextSm]} numberOfLines={1}>{time || '—'}</Text>
          </View>
          {badge ? <View style={{ flexShrink: 0 }}>{badge}</View> : null}
        </View>

        <Text style={[q.route, sm && q.routeSm]} numberOfLines={2}>
          {from}<Text style={s.arrow}>  →  </Text>{to}
        </Text>

        <View style={q.rule} />

        <View style={q.foot}>
          <View style={q.facts}>
            <View style={q.serviceRow}>
              <Ionicons name={serviceIcon(service)} size={sm ? 14 : 15} color={colors.primary} />
              <Text style={[q.serviceText, sm && q.serviceTextSm]} numberOfLines={1}>{service}</Text>
              {distance ? <Text style={[q.factText, sm && q.factTextSm, q.distance]} numberOfLines={1}>·  {distance}</Text> : null}
            </View>
            {vehicle ? (
              // Same icon column and gap as the service line above, so both lines start at the same edge.
              <View style={q.serviceRow}>
                <Ionicons name="car-sport-outline" size={sm ? 14 : 15} color="#475569" />
                <Text style={[q.factText, sm && q.factTextSm, q.vehicleText, { flexShrink: 1 }]} numberOfLines={1}>{vehicle}</Text>
              </View>
            ) : null}
          </View>
          <View style={q.priceWrap}>
            <Text style={q.priceLabel} numberOfLines={1}>Vendor payout</Text>
            <View style={q.price}>
              <Text style={[q.priceText, sm && q.priceTextSm]} numberOfLines={1} adjustsFontSizeToFit>{payout}</Text>
            </View>
          </View>
        </View>
        {children}
      </View>
    </View>
  );
}

export function DutyCard({ date, time, from, to, service, distance, vehicle, payout, payoutLabel = 'Vendor payout', action, onPress, badge, children, accessibilityLabel, compact }: DutyCardProps) {
  const width = useWindowWidth();
  const sm = width < 560;
  const xs = width < 360;
  // A long button label ("Assign driver", "View booking") cannot sit beside the payout on a phone: it goes under it, full width.
  const stack = sm && (action?.label.length ?? 0) > 10;
  const body = compact ? (
    <CompactCard date={date} time={time} from={from} to={to} service={service} distance={distance} vehicle={vehicle} payout={payout} badge={badge} sm={sm}>{children}</CompactCard>
  ) : (
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
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={({ hovered }: { pressed: boolean; hovered?: boolean }) => [hovered && { opacity: 0.985 }]}>{body}</Pressable>
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

// The compact list card: a calm, airy three-band layout with one hero line (the route) and one strong figure (the price).
const q = StyleSheet.create({
  card: { borderRadius: 16 },
  inner: { flex: 1, minWidth: 0, paddingVertical: 13, paddingHorizontal: 18, gap: 9 },
  innerSm: { paddingVertical: 12, paddingHorizontal: 14, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  when: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
  whenText: { fontSize: 14, fontWeight: '600', color: '#334155', flexShrink: 1 },
  whenTextSm: { fontSize: 13 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#C3CAD6', marginHorizontal: 3 },
  // The price sits in a soft tinted pill of a minimum width, so the amounts line up down the list.
  price: { minWidth: 96, height: 34, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  priceWrap: { alignItems: 'center', gap: 2, flexShrink: 0 },
  priceLabel: { fontSize: 10.5, fontWeight: '600', color: '#8A94A6', letterSpacing: 0.2 },
  priceText: { fontSize: 18, fontWeight: '800', color: colors.primary, letterSpacing: -0.3 },
  priceTextSm: { fontSize: 16.5 },
  route: { fontSize: 19, fontWeight: '700', color: colors.ink, lineHeight: 26, letterSpacing: -0.4 },
  routeSm: { fontSize: 17, lineHeight: 23 },
  rule: { height: 1, backgroundColor: '#EEF1F5' },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  facts: { flex: 1, minWidth: 0, gap: 2 },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  distance: { flexShrink: 0 },
  serviceText: { fontSize: 14.5, fontWeight: '800', color: colors.primary, flexShrink: 1 },
  serviceTextSm: { fontSize: 13.5 },
  factText: { fontSize: 13, color: '#64748B', lineHeight: 18 },
  factTextSm: { fontSize: 12.5 },
  // The vehicle (class or car name) reads as the second line of the card, so it is bold and dark.
  vehicleText: { fontWeight: '700', color: '#1F2937' },
});

// Very small phones (under 360 px).
const x = StyleSheet.create({
  walletTile: { width: 38, height: 38, borderRadius: 11 },
  payLabel: { fontSize: 9.5, letterSpacing: 0.5 },
  pay: { fontSize: 20 },
  button: { paddingHorizontal: 10, gap: 4 },
  buttonText: { fontSize: 13 },
});
