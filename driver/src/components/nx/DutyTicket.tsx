// The open-duty card, drawn as a ticket (the NESAM duty-card design, the same as in NESAM Partner):
//   ┌ NESAM strip, red to blue ─────────────────────────────────────┐
//   │ ● Theni ─────────────────────────────── [● ROUND TRIP] [TN → KL] │  the route: trip type and states,
//   │ ● Kanyakumari                               [295 km] [⌛ 2 Days] │  distance and how long it is booked for
//   │ [▦] 11:00 AM • 28 Nov 2026                  [◷ in 1 hr 15 min] │  pickup, and the time left to it
//   │ [▣] Innova Crysta SUV                        [⛽ Diesel / Petrol] │
//   │ [⌖] Cumbum Road Junction, Theni                      [➤ ~3 km] │  pickup point and how far it is
//   │ [● Driver Bata Included]  [● Toll, Parking & State Tax Extra]  │  what the payout covers
//   ├ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -┤
//   │ [● DRIVER PAY  ₹5,420]                        [✓ Accept duty]  │  or [Place bid] [✓ Accept ₹1,650]
//   └────────────────────────────────────────────────────────────────┘
// Tapping the ticket opens the duty; the buttons in its foot act on it.
import React from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from './Text';
import { nx } from '../../theme/nx';
import { NxStrip } from './NxStrip';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Hover = { pressed: boolean; hovered?: boolean };

const BLUE = '#2F5BD3';

/** A button in the ticket's foot: taking the duty (green), bidding for it (blue) or a quiet one (view a request). */
export interface TicketAction {
  label: string;
  onPress: () => void;
  icon?: IconName;
  tone?: 'accept' | 'bid' | 'quiet';
  /** On Accept, the payout in a yellow tag (a bidding duty, whose foot has no payout box). */
  amount?: string;
}

export interface DutyTicketProps {
  from: string;
  to: string;
  /** "TN → KL", "TN", or '' when the addresses do not say. */
  region?: string;
  /** "in 1 hr 15 min". */
  eta?: string;
  time: string;
  date: string;
  /** "One Way", "Round Trip" … */
  service: string;
  /** Round Trip, as booked: "8 Hours", "2 Days". */
  duration?: string;
  /** "295 km". */
  distance?: string;
  vehicle: string;
  /** "Diesel / Petrol" or "CNG". */
  fuel?: string;
  /** The pickup point, and its button (the map). */
  point: string;
  pointAction?: { label: string; accessibilityLabel: string; onPress: () => void };
  /** "Driver Bata Included" and "Toll, Parking & State Tax Extra". */
  included?: string;
  extras?: string;
  payout: string;
  payoutLabel: string;
  actions: TicketAction[];
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Short status lines (package, add-ons, via, pending approval). */
  children?: React.ReactNode;
}

const TONES = {
  red: { bg: '#FFF1F3', line: '#FAD0D7', fg: '#C81E33' },
  green: { bg: '#ECFBF2', line: '#BFE9D0', fg: '#15803D' },
  blue: { bg: '#EFF4FF', line: '#C9D7FA', fg: BLUE },
  violet: { bg: '#F5F1FF', line: '#DCD0FA', fg: '#6D3FD8' },
  amber: { bg: '#FFF8E6', line: '#F4DB9B', fg: '#A15C07' },
  grey: { bg: '#F8FAFC', line: '#DDE2E8', fg: '#475569' },
} as const;
type Tone = keyof typeof TONES;

/** Each trip type keeps one colour on every card. */
const typeTone = (service: string): Tone =>
  /round/i.test(service) ? 'green' : /airport/i.test(service) ? 'blue' : /rental|local|hour/i.test(service) ? 'violet' : /multi/i.test(service) ? 'amber' : 'red';

function Pill({ text, tone = 'grey', dot, caps, icon, tag }: { text: string; tone?: Tone; dot?: boolean; caps?: boolean; icon?: IconName; tag?: boolean }) {
  const t = TONES[tone];
  return (
    <View style={[k.pill, tag && k.pillTag, { backgroundColor: t.bg, borderColor: t.line }]}>
      {dot ? <View style={[k.pillDot, { backgroundColor: t.fg }]} /> : null}
      {icon ? <Ionicons name={icon} size={12} color={t.fg} /> : null}
      <Text style={[k.pillText, caps && k.pillCaps, tag && k.pillTagText, { color: t.fg }]} numberOfLines={tag ? 2 : 1}>{caps ? text.toUpperCase() : text}</Text>
    </View>
  );
}

const FUEL = {
  cng: { bg: '#ECFDF3', line: '#6EE7B7', fg: '#047857' },
  diesel: { bg: '#FFF7ED', line: '#FDBA74', fg: '#B45309' },
} as const;

/** The fuel the customer booked, in its own colour: CNG green with a leaf, diesel / petrol orange with a fuel pump. */
function FuelBadge({ fuel }: { fuel: string }) {
  const cng = /cng/i.test(fuel);
  const t = cng ? FUEL.cng : FUEL.diesel;
  return (
    <View style={[k.fuel, { backgroundColor: t.bg, borderColor: t.line }]}>
      {cng ? <Ionicons name="leaf-outline" size={14} color={t.fg} /> : <MaterialCommunityIcons name="gas-station-outline" size={15} color={t.fg} />}
      <Text style={[k.fuelText, { color: t.fg }]} numberOfLines={1}>{fuel}</Text>
    </View>
  );
}

function Tile({ icon, tone }: { icon: IconName; tone: 'blue' | 'grey' }) {
  return (
    <View style={[k.tile, tone === 'blue' ? k.tileBlue : k.tileGrey]}>
      <Ionicons name={icon} size={14} color={tone === 'blue' ? BLUE : '#334155'} />
    </View>
  );
}

const FOOT = {
  accept: { box: 'accept', hover: 'acceptHover', fg: nx.white },
  bid: { box: 'bid', hover: 'bidHover', fg: BLUE },
  quiet: { box: 'quiet', hover: 'quietHover', fg: nx.ink },
} as const;

function FootButton({ a, bare, pair }: { a: TicketAction; bare: boolean; pair: boolean }) {
  const look = FOOT[a.tone ?? 'accept'];
  return (
    <Pressable onPress={a.onPress} accessibilityRole="button" accessibilityLabel={a.amount ? `${a.label} ${a.amount}` : a.label}
      style={(s) => [k.btn, pair && k.btnPair, a.amount ? k.btnWide : null, k[look.box], (s as Hover).hovered && k[look.hover], s.pressed && k.pressed]}>
      {a.icon && !bare ? <Ionicons name={a.icon} size={15} color={look.fg} /> : null}
      <Text style={[k.btnText, { color: look.fg }]} numberOfLines={1}>{a.label}</Text>
      {a.amount ? <View style={k.btnAmount}><Text style={k.btnAmountText} numberOfLines={1}>{a.amount}</Text></View> : null}
    </Pressable>
  );
}

/**
 * How the date row fits on one line at a card's width. Wide cards use the normal setting; narrower ones set it tighter, then
 * leave the year off the date, and on the smallest phones drop the calendar tile too. Widths are estimates of the set text.
 */
function fitDateRow(cardWidth: number, p: DutyTicketProps) {
  const full = p.date || '—';
  if (cardWidth >= 470) return { compact: false, tile: true, date: full };
  const short = full.replace(/ [0-9]{4}$/, '');
  const eta = p.eta ? p.eta.length * 6.4 + 34 : 0;
  const needs = (date: string, tile: boolean) => 36 + (tile ? 28 : 0) + (date === full ? 138 : 106) + eta;
  if (needs(full, true) <= cardWidth) return { compact: true, tile: true, date: full };
  if (needs(short, true) <= cardWidth) return { compact: true, tile: true, date: short };
  return { compact: true, tile: false, date: short };
}

/** Whether a stop's tags fit beside its place name; when they do not, they go on their own line under it. */
function tagsFit(cardWidth: number, name: string, tags: { text?: string; extra: number }[]) {
  const width = tags.reduce((sum, t) => (t.text ? sum + t.text.length * 6.8 + t.extra + 5 : sum), 0);
  // The card less its borders, padding, the route dot and the gap before the tags.
  return name.length * (name.length >= 15 ? 7.6 : 8.6) <= cardWidth - 68 - width;
}

export function DutyTicket(p: DutyTicketProps) {
  const { width } = useWindowDimensions();
  // The date row is always one line: time and date, then the time left to pickup. The card's own width sets how tight it is.
  const [measured, setMeasured] = React.useState(0);
  const cardWidth = measured || width - 28;
  const dateRow = fitDateRow(cardWidth, p);
  // Narrow phones drop the button icons so every label stays whole.
  const bare = width < 380;
  // A long one-word town (Thiruvananthapuram) is set a little smaller on phones, so it is not broken in two.
  const placeSize = (name: string) => (width < 380 && name.split(' ').some((word) => word.length >= 15) ? k.placeLong : null);
  const payBox = !p.actions.some((a) => a.amount);
  const topBelow = !tagsFit(cardWidth, p.from, [{ text: p.service, extra: 24 }, { text: p.region, extra: 16 }]);
  const endBelow = !tagsFit(cardWidth, p.to || '—', [{ text: p.distance, extra: 14 }, { text: p.duration, extra: 30 }]);
  // Top of the route: the trip type with the states to its right. Bottom: the distance and how long the duty is booked for.
  const topTags = (
    <>
      <Pill text={p.service} tone={typeTone(p.service)} dot caps />
      {p.region ? <Pill text={p.region} caps /> : null}
    </>
  );
  const endTags = p.distance || p.duration ? (
    <>
      {p.distance ? <Pill text={p.distance} /> : null}
      {p.duration ? <Pill text={p.duration} tone="violet" icon="hourglass-outline" /> : null}
    </>
  ) : null;
  return (
    <View style={k.card} onLayout={(e) => setMeasured(e.nativeEvent.layout.width)}>
      <NxStrip />

      <Pressable onPress={p.onPress} disabled={!p.onPress} accessibilityRole={p.onPress ? 'button' : undefined} accessibilityLabel={p.accessibilityLabel}
        style={(s) => [k.top, (s as Hover).hovered && { backgroundColor: '#FCFCFD' }]}>
        {/* The route: pickup and drop on a line from green to red, the states and the time to pickup beside them. */}
        <View style={k.route}>
          {/* The line ends at the drop's dot, also when the drop's tags sit under it. */}
          <View style={[k.routeLine, endBelow && endTags ? { bottom: 44 } : null]} />
          <View style={k.stop}>
            <View style={[k.dot, k.dotFrom]} />
            <Text style={[k.place, placeSize(p.from)]} numberOfLines={2}>{p.from}</Text>
            {topBelow ? null : topTags}
          </View>
          {topBelow ? <View style={k.routeTags}>{topTags}</View> : null}
          <View style={k.routeRule} />
          <View style={k.stop}>
            <View style={[k.dot, k.dotTo]} />
            <Text style={[k.place, placeSize(p.to)]} numberOfLines={2}>{p.to || '—'}</Text>
            {endBelow ? null : endTags}
          </View>
          {endBelow && endTags ? <View style={k.routeTags}>{endTags}</View> : null}
        </View>

        <View style={[k.box, k.wrap, dateRow.compact && k.dateBox]}>
          <View style={[k.lead, dateRow.compact && k.leadCompact]}>
            {dateRow.tile ? <Tile icon="calendar-outline" tone="blue" /> : null}
            <Text style={k.whenText} numberOfLines={1}>
              <Text style={[k.strong, dateRow.compact && k.whenCompact]}>{p.time || '—'}</Text>
              <Text style={k.muted}>{dateRow.compact ? ' • ' : '  •  '}</Text>
              <Text style={[k.strong, dateRow.compact && k.whenCompact]}>{dateRow.date}</Text>
            </Text>
          </View>
          {p.eta ? (
            <View style={[k.pills, dateRow.compact && k.pillsCompact]}>
              <Pill text={p.eta} tone="amber" icon="time-outline" />
            </View>
          ) : null}
        </View>

        <View style={k.box}>
          <Tile icon="car-outline" tone="grey" />
          <Text style={[k.strong, k.grow]} numberOfLines={2}>{p.vehicle || 'Any vehicle'}</Text>
          {p.fuel ? <FuelBadge fuel={p.fuel} /> : null}
        </View>

        <View style={[k.box, k.boxBlue]}>
          <Tile icon="location-outline" tone="blue" />
          <Text style={[k.point, k.grow]} numberOfLines={2}>{p.point}</Text>
          {p.pointAction ? (
            <Pressable onPress={p.pointAction.onPress} accessibilityRole="link" accessibilityLabel={p.pointAction.accessibilityLabel} hitSlop={6}
              style={(s) => [k.mapBtn, (s as Hover).hovered && { backgroundColor: '#EEF3FF' }]}>
              <Ionicons name="navigate" size={13} color={BLUE} />
              <Text style={k.mapText}>{p.pointAction.label}</Text>
            </Pressable>
          ) : null}
        </View>

        {p.included || p.extras ? (
          <View style={k.tags}>
            {p.included ? <View style={k.tag}><Pill text={p.included} tone="green" dot tag /></View> : null}
            {p.extras ? <View style={k.tag}><Pill text={p.extras} tone="amber" dot tag /></View> : null}
          </View>
        ) : null}
        {p.children}
      </Pressable>

      {/* The tear line, with a notch cut into each side. */}
      <View style={k.tear}>
        <View style={k.dashes}>{Array.from({ length: 60 }, (_, i) => <View key={i} style={k.dash} />)}</View>
        <View style={[k.notch, { left: -7 }]} />
        <View style={[k.notch, { right: -7 }]} />
      </View>

      <View style={k.foot}>
        {payBox ? (
          <View style={k.pay} accessible accessibilityLabel={`${p.payoutLabel} ${p.payout}`}>
            <View style={k.payHead}>
              <View style={k.payDot} />
              <Text style={k.payLabel} numberOfLines={1}>{p.payoutLabel.toUpperCase()}</Text>
            </View>
            <View style={k.payAmount}><Text style={k.payText} numberOfLines={1}>{p.payout}</Text></View>
          </View>
        ) : null}
        {p.actions.map((a) => <FootButton key={a.label} a={a} bare={bare} pair={!payBox} />)}
      </View>
    </View>
  );
}

const shadow = Platform.select({ web: { boxShadow: '0 8px 24px rgba(22,32,51,0.07)' } as object, default: { shadowColor: '#162033', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 2 } });

const k = StyleSheet.create({
  card: { backgroundColor: nx.white, borderRadius: 15, borderWidth: 1, borderColor: '#E4E7EC', overflow: 'hidden', ...shadow },
  top: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 1, gap: 6 },
  // route
  route: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 11, borderWidth: 1, borderColor: '#E9ECF1', backgroundColor: nx.white },
  routeTags: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, marginTop: 6 },
  routeLine: { position: 'absolute', left: 14, top: 18, bottom: 18, width: 2, borderRadius: 1, backgroundColor: '#F2B8C1' },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 22 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  dotFrom: { backgroundColor: '#16A34A', borderColor: '#D3F5E0' },
  dotTo: { backgroundColor: nx.red, borderColor: '#FDDDE2' },
  place: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700', color: nx.ink, letterSpacing: -0.2 },
  placeLong: { fontSize: 12.5, letterSpacing: -0.4 },
  routeRule: { height: 1, backgroundColor: '#EEF0F4', marginLeft: 19, marginVertical: 4 },
  // rows
  box: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 38, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 11, borderWidth: 1, borderColor: '#E9ECF1', backgroundColor: '#FBFCFD' },
  boxBlue: { backgroundColor: '#F5F8FF', borderColor: '#DBE4FA' },
  // The date row wraps its tags under the time on a narrow phone instead of squeezing them.
  wrap: { flexWrap: 'wrap', rowGap: 5 },
  lead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexGrow: 1, flexShrink: 1, minWidth: 0 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 5, marginLeft: 'auto', flexShrink: 1 },
  grow: { flex: 1, minWidth: 0 },
  tile: { width: 24, height: 24, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  tileBlue: { backgroundColor: '#E8EFFF' },
  tileGrey: { backgroundColor: '#EEF1F5' },
  whenText: { flexShrink: 1, fontSize: 12.5 },
  dateBox: { gap: 4, paddingHorizontal: 6 },
  leadCompact: { gap: 6 },
  pillsCompact: { gap: 4, flexWrap: 'nowrap', flexShrink: 0 },
  whenCompact: { fontSize: 12 },
  strong: { fontSize: 12.5, fontWeight: '700', color: nx.ink },
  muted: { fontSize: 11.5, fontWeight: '500', color: '#6F7785' },
  point: { fontSize: 12.5, fontWeight: '600', color: '#1F2937' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 20, paddingHorizontal: 7, borderRadius: 7, borderWidth: 1, flexShrink: 0 },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 10.5, fontWeight: '600' },
  pillCaps: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.5 },
  pillTag: { flexGrow: 1, justifyContent: 'center', gap: 4, paddingHorizontal: 5, minHeight: 22, borderRadius: 7 },
  pillTagText: { fontSize: 9.5, flexShrink: 1, textAlign: 'center' },
  fuel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 94, minHeight: 27, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1.5, flexShrink: 0 },
  fuelText: { fontSize: 12, fontWeight: '700' },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 25, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1, borderColor: '#BFD1F8', backgroundColor: nx.white, flexShrink: 0 },
  mapText: { fontSize: 11.5, fontWeight: '700', color: BLUE },
  tags: { flexDirection: 'row', alignItems: 'stretch', gap: 5 },
  tag: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minWidth: 0 },
  // tear
  tear: { height: 14, justifyContent: 'center', marginTop: 2 },
  dashes: { flexDirection: 'row', gap: 5, marginHorizontal: 14, height: 2, overflow: 'hidden' },
  dash: { width: 7, height: 2, borderRadius: 1, backgroundColor: '#D9DEE5', flexShrink: 0 },
  notch: { position: 'absolute', top: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: nx.page, borderWidth: 1, borderColor: '#E4E7EC' },
  // foot
  foot: { flexDirection: 'row', alignItems: 'stretch', gap: 7, paddingHorizontal: 8, paddingTop: 2, paddingBottom: 8 },
  pay: { flexGrow: 0, flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 6, rowGap: 3, minHeight: 40, paddingVertical: 4, paddingLeft: 9, paddingRight: 6, borderRadius: 10, borderWidth: 1, borderColor: '#BFE9D0', backgroundColor: '#ECFBF2' },
  payHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  payDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#16A34A' },
  payLabel: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.4, color: '#15803D' },
  payAmount: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, borderWidth: 1, borderColor: '#CDEBD9', backgroundColor: nx.white },
  payText: { fontSize: 14, fontWeight: '700', color: nx.ink, letterSpacing: -0.3 },
  btn: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 120, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1 },
  btnWide: { flexGrow: 1.4 },
  btnPair: { minWidth: 0 },
  accept: { backgroundColor: '#177A43', borderColor: '#177A43' },
  acceptHover: { backgroundColor: '#126436', borderColor: '#126436' },
  bid: { backgroundColor: '#EFF5FF', borderColor: '#C6D6FA' },
  bidHover: { backgroundColor: '#E3EDFF' },
  quiet: { backgroundColor: nx.white, borderColor: '#D8DFE9' },
  quietHover: { backgroundColor: '#F6F7F9' },
  pressed: { opacity: 0.92, transform: [{ scale: 0.985 }] },
  btnText: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  btnAmount: { paddingHorizontal: 8, paddingVertical: 1, borderRadius: 7, backgroundColor: '#FDE68A', flexShrink: 0 },
  btnAmountText: { fontSize: 12.5, fontWeight: '700', color: '#713F12' },
});
