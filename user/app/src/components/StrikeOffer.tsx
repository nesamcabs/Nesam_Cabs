// The struck-out higher price above a fare, with how much lower the fare is than it ("13% OFF"). Display only
// (admin → Service & Fare Settings → Strike out price). Same look as the websites' StrikeOffer.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatINR } from '../utils/format';
import { fonts } from '../theme';

export function StrikeOffer({ was, now }: { was: number; now: number }) {
  if (!(now > 0 && was > now)) return null;
  const off = Math.round(((was - now) / was) * 100);
  return (
    <View style={s.row} accessible accessibilityLabel={`Earlier price ${formatINR(was)}${off > 0 ? `, ${off} percent off` : ''}`}>
      <View>
        <Text style={s.was}>{formatINR(was)}</Text>
        <View style={s.slash} />
      </View>
      {off > 0 ? (
        <View style={s.tag}>
          <View style={s.hole} />
          <Text style={s.tagText}>{off}% OFF</Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  was: { fontFamily: fonts.semiBold, fontSize: 13, color: '#66615A' },
  slash: { position: 'absolute', left: -3, right: -3, top: '48%', height: 2, borderRadius: 2, backgroundColor: '#e5383b', transform: [{ rotate: '-10deg' }] },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingLeft: 5, paddingRight: 7, backgroundColor: '#139a55', borderTopLeftRadius: 10, borderBottomLeftRadius: 10, borderTopRightRadius: 5, borderBottomRightRadius: 5 },
  hole: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff' },
  tagText: { fontFamily: fonts.bold, fontSize: 10.5, color: '#fff', letterSpacing: 0.3 },
});
