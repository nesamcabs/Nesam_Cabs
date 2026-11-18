// "Choose vehicle & package" for a Round Trip (Customer UX 9.0): the vehicle class tabs (Sedan · SUV · Innova · Crysta), the chosen
// vehicle's name, then that vehicle's packages — the first as the hero card, the others compact — with the package that is in
// force highlighted. The server prices every package for every vehicle, so picking a vehicle or a package only changes the choice.
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { TextButton } from './ui';
import { getVehicleImage } from './brand';
import type { FareBreakdown, RideCategory } from '../types';
import type { ServerCategoryQuote, ServerTimePackage } from '../services/quoteService';
import { categoryLabel } from '../utils/categoryLabel';
import { formatINR, formatTime } from '../utils/format';
import { packageRuleText } from '../utils/timePackages';
import { colors, fonts, space } from '../theme';

const dayText = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short' })}`;
const clock = (d: Date) => formatTime(d).replace(/^0/, '');

/** The short class name on a vehicle tab: "Sedan", "SUV", "Innova", "Crysta". */
export function vehicleTabLabel(name: string): string {
  const n = name.trim();
  if (/crysta/i.test(n)) return 'Crysta';
  return n.replace(/\s*(or|\/)\s*similar$/i, '').replace(/^toyota\s+/i, '') || n;
}

export interface RoundVehiclePackageProps {
  categories: RideCategory[];
  selected: RideCategory | null;
  entryOf: (id?: string) => ServerCategoryQuote | undefined;
  quotes: Map<string, FareBreakdown>;
  packages: ServerTimePackage[];
  selectedPackage: ServerTimePackage | null;
  autoDays: boolean;
  fuelCng: boolean;
  serverReady: boolean;
  onPickVehicle: (c: RideCategory) => void;
  onPickPackage: (id: string) => void;
  onFuel: (c: RideCategory, cng: boolean) => void;
  onFareBreakup: (id: string) => void;
}

export function RoundVehiclePackage(p: RoundVehiclePackageProps) {
  const { categories, selected, packages } = p;
  const entry = p.entryOf(selected?.id);
  const unavailable = p.serverReady && entry && !entry.ok ? entry.error || 'Not available for this trip' : '';
  const standard = packages.find((x) => x.id === 'same:full') ?? packages.find((x) => x.id === 'next');
  const quote = selected ? p.quotes.get(selected.id) : undefined;
  const photo = selected ? (selected.imageUrl ? { uri: selected.imageUrl } : getVehicleImage(selected.name)) : undefined;

  const badge = (x: ServerTimePackage) => {
    const save = standard && standard !== x ? standard.fare.total - x.fare.total : 0;
    if (save > 0) return `${formatINR(save)} less than ${standard!.label}`;
    return x.kind === 'morning' ? 'Early-return option' : x.id === standard?.id ? 'Standard package' : 'Recommended package';
  };
  const detailOf = (x: ServerTimePackage) => {
    const split = x.dayKm && x.dayKm.length > 1 ? ` (First day: ${x.dayKm[0]} km + ${x.dayKm.length === 2 ? 'Next day' : 'Each next day'}: ${x.dayKm[1]} km)` : '';
    const when = x.kind === 'morning' ? 'Overnight' : x.hours ? `Up to ${x.hours} hours` : x.kind === 'next_day' ? `${x.days} calendar days${split}` : 'Full day';
    return `${x.includedKm} km included · ${when}`;
  };
  const endOf = (x: ServerTimePackage) => {
    const end = new Date(x.endAt);
    return `Return by ${dayText(end)}, ${clock(end)}`;
  };

  return (
    <View style={s.root}>
      <Text style={s.title} accessibilityRole="header">Choose vehicle & package</Text>

      <View style={s.tabs} accessibilityRole="radiogroup" accessibilityLabel="Vehicle">
        {categories.map((c) => {
          const on = selected?.id === c.id;
          const e = p.entryOf(c.id);
          const off = p.serverReady && !!e && !e.ok;
          return (
            <Pressable
              key={c.id}
              onPress={() => !off && p.onPickVehicle(c)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: off }}
              accessibilityLabel={`${vehicleTabLabel(c.name)}${off ? ', not available for this trip' : ''}`}
              style={[s.tab, on && s.tabOn, off && s.tabOff]}
            >
              <Image source={c.imageUrl ? { uri: c.imageUrl } : getVehicleImage(c.name)} style={s.tabPhoto} resizeMode="contain" accessible={false} />
              <Text style={[s.tabText, on && s.tabTextOn]} numberOfLines={1}>{vehicleTabLabel(c.name)}</Text>
            </Pressable>
          );
        })}
      </View>

      {selected ? (
        <View style={s.caption}>
          <Icon name="car" size={15} color={colors.primary} />
          <Text style={s.captionStrong}>{vehicleTabLabel(selected.name)}</Text>
          <Text style={s.captionText} numberOfLines={1}>{categoryLabel(selected)} · {selected.seats} seats · AC</Text>
        </View>
      ) : null}

      {p.autoDays && packages[0] ? <Text style={s.auto}>No same-day package fits this pickup time and trip, so it is planned as a {packages[0].days}-day trip.</Text> : null}
      {unavailable ? <Text style={s.unavail}>{unavailable}</Text> : null}

      {packages.length ? (
        <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Round-trip packages">
          {packages.map((x, i) => {
            const on = x.id === p.selectedPackage?.id;
            const hero = i === 0;
            return (
              <Pressable
                key={x.id}
                onPress={() => p.onPickPackage(x.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${x.label}, ${formatINR(x.fare.total)}`}
                style={[hero ? s.hero : s.compact, on && s.pkgOn]}
              >
                {hero ? (
                  <>
                    <View style={s.heroTop}>
                      <Text style={s.badge}>{badge(x)}</Text>
                      <View style={[s.tick, on && s.tickOn]}><Icon name="check" size={10} color={on ? colors.white : 'transparent'} strokeWidth={3} /></View>
                    </View>
                    <View style={s.heroMain}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.heroName}>{x.label}</Text>
                        <Text style={s.sub}>{detailOf(x)}</Text>
                        <Text style={s.sub}>Driver bata{x.days > 1 ? ` for ${x.days === 2 ? 'both' : 'all'} days` : ''} included</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={s.price}>{formatINR(x.fare.total)}</Text>
                        {photo ? <Image source={photo} style={s.heroPhoto} resizeMode="contain" accessible={false} /> : null}
                      </View>
                    </View>
                    <Text style={s.foot}><Text style={s.footStrong}>{endOf(x)}</Text> · Extra {formatINR(x.extraKmRate)}/km</Text>
                  </>
                ) : (
                  <View style={s.compactRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.compactName}>{x.label}</Text>
                      <Text style={s.sub}>{detailOf(x)}</Text>
                      <Text style={s.sub}><Text style={s.footStrong}>{endOf(x)}</Text> · Driver bata included · Extra {formatINR(x.extraKmRate)}/km</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <Text style={s.priceSm}>{formatINR(x.fare.total)}</Text>
                      <View style={[s.tick, s.tickStatic, on && s.tickOn]}><Icon name="check" size={10} color={on ? colors.white : 'transparent'} strokeWidth={3} /></View>
                    </View>
                  </View>
                )}
                {x.upgrade && on ? <Text style={s.note}>Still running after {clock(new Date(x.morningCutoffAt ?? x.endAt))}? It upgrades to {x.upgrade.label} (+{formatINR(x.upgrade.increase)}, {x.upgrade.includedKm} km included).</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ) : quote && selected ? (
        <View style={[s.hero, s.pkgOn]}>
          <View style={s.heroMain}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.heroName}>Round Trip{entry?.ok && entry.days ? ` · ${entry.days} ${entry.days === 1 ? 'day' : 'days'}` : ''}</Text>
              <Text style={s.sub}>{entry?.ok && entry.includedKm ? `${entry.includedKm} km included` : 'Fare confirmed by quote'}</Text>
              <Text style={s.sub}>Driver bata included{entry?.ok && entry.extraKmRate ? ` · Extra ${formatINR(entry.extraKmRate)}/km` : ''}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.price}>{formatINR(quote.total)}</Text>
              {photo ? <Image source={photo} style={s.heroPhoto} resizeMode="contain" accessible={false} /> : null}
            </View>
          </View>
        </View>
      ) : null}

      {packages.length ? (
        <View style={s.ruleRow}>
          <Icon name="clock-3" size={15} color={colors.primary} strokeWidth={2} />
          <Text style={s.ruleText}>{packageRuleText(packages, clock)}</Text>
        </View>
      ) : null}

      {selected && entry?.ok && entry.cng ? (
        <View style={s.fuelRow} accessibilityRole="radiogroup">
          {([[false, 'Diesel / Petrol'], [true, 'CNG']] as const).map(([cng, label]) => {
            const active = cng === p.fuelCng;
            return (
              <Pressable key={label} onPress={() => p.onFuel(selected, cng)} accessibilityRole="radio" accessibilityState={{ selected: active }} accessibilityLabel={`${label} for ${selected.name}`} style={[s.fuelBtn, active && (cng ? s.fuelCng : s.fuelDiesel)]}>
                <Text style={[s.fuelText, active && { color: cng ? '#11773a' : '#a85a00' }]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={s.footRow}>
        <Text style={s.sub}>Toll, parking & state permit tax extra. Your package is the minimum charge; a longer or farther trip moves to the next package.</Text>
        {selected ? <TextButton title="Fare details & exclusions" icon="receipt-text" size={11} onPress={() => p.onFareBreakup(selected.id)} accessibilityLabel="View fare details and exclusions" /> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.white },
  ruleText: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 18, color: colors.muted },
  root: { marginTop: space.md, gap: 10 },
  title: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: { flexGrow: 1, flexBasis: '22%', minWidth: 72, alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 4, borderWidth: 1.5, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.white },
  tabOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  tabOff: { opacity: 0.45 },
  tabPhoto: { width: 64, height: 38 },
  tabText: { fontFamily: fonts.semiBold, fontSize: 12.5, color: colors.text },
  tabTextOn: { color: colors.primary },
  caption: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  captionStrong: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink },
  captionText: { flex: 1, minWidth: 0, fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
  auto: { fontFamily: fonts.regular, fontSize: 12, color: '#7a4b00', backgroundColor: '#fff7e6', padding: 8, borderRadius: 8 },
  unavail: { fontFamily: fonts.medium, fontSize: 12, color: colors.primaryDark },
  hero: { padding: 12, gap: 8, borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.white },
  compact: { padding: 12, gap: 6, borderWidth: 1.5, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.white },
  pkgOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { fontFamily: fonts.bold, fontSize: 11, color: '#11773a', backgroundColor: '#e8f8ee', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  tick: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  tickStatic: { alignSelf: 'flex-end' },
  tickOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  heroMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroName: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
  compactName: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  heroPhoto: { width: 96, height: 52 },
  price: { fontFamily: fonts.bold, fontSize: 20, color: colors.ink },
  priceSm: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  compactRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  sub: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, color: colors.muted, marginTop: 1 },
  foot: { fontFamily: fonts.regular, fontSize: 11.5, color: colors.muted },
  footStrong: { fontFamily: fonts.bold, color: colors.text },
  note: { fontFamily: fonts.regular, fontSize: 11.5, color: '#7a4b00' },
  fuelRow: { flexDirection: 'row', gap: 8 },
  fuelBtn: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.white },
  fuelDiesel: { borderColor: '#e07b00', backgroundColor: '#fff4e0' },
  fuelCng: { borderColor: '#2A7555', backgroundColor: '#e8f8ee' },
  fuelText: { fontFamily: fonts.bold, fontSize: 14, color: colors.text },
  footRow: { gap: 4 },
});
