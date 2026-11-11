import React from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from './Text';
import { POPPINS } from '../../theme/fonts';
import { nx } from '../../theme/nx';

const EMBLEM = require('../../../assets/brand/nesam-emblem.jpg');

// Full "NESAM CABS" lockup (480×154), copied from the customer app.
const LOCKUP = require('../../../assets/brand/nesam-cabs-logo.webp');
const LOCKUP_RATIO = 480 / 154;

// The emblem JPEG has padding; the reference crops it inside a square wrapper (width 127.45%, left −13.57%, top −11.95%).
const SOURCE = { width: 512, height: 497 };

/**
 * Top bar header lockup:
 * Displays the emblem logo on the left, hides brand name & driver wordmarks,
 * and renders the active page heading and optional subtitle directly to the right of the logo.
 */
export function NxBrand({ title, subtitle }: { title?: string; subtitle?: string }) {
  const { width } = useWindowDimensions();
  const narrow = width <= 360;
  const symbol = narrow ? 36 : 40;
  const imgW = symbol * 1.2745;
  const displayTitle = title || 'Home';

  // Home carries the full NESAM CABS lockup (same artwork as the customer app) instead of emblem + page title.
  if (displayTitle === 'Home') {
    const h = narrow ? 36 : 42;
    return (
      <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel="Home · NESAM Driver">
        <Image source={LOCKUP} accessible={false} style={{ width: Math.round(h * LOCKUP_RATIO), height: h }} resizeMode="contain" />
      </View>
    );
  }

  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel={`${displayTitle} · NESAM Driver`}>
      <View style={[styles.emblemWrapper, { width: symbol, height: symbol }]}>
        <Image
          source={EMBLEM}
          accessible={false}
          style={{
            position: 'absolute',
            width: imgW,
            height: imgW * (SOURCE.height / SOURCE.width),
            left: -symbol * 0.1357,
            top: -symbol * 0.1195,
          }}
          resizeMode="contain"
        />
      </View>
      <View style={styles.headingWrap}>
        <Text
          style={[
            styles.title,
            narrow && { fontSize: 16, lineHeight: 20 },
          ]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
        >
          {displayTitle}
        </Text>
        {subtitle && !narrow ? (
          <Text style={styles.subtitle} numberOfLines={1} maxFontSizeMultiplier={1.15}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, marginRight: 6 },
  emblemWrapper: { borderRadius: 10, overflow: 'hidden', backgroundColor: nx.white, borderWidth: 1, borderColor: '#EDF1F5' },
  headingWrap: { flex: 1, minWidth: 0, justifyContent: 'center' },
  title: {
    color: '#0F172A',
    fontFamily: POPPINS.bold,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 22,
    includeFontPadding: false,
  },
  subtitle: {
    color: '#64748B',
    fontFamily: POPPINS.medium,
    fontSize: 10.5,
    marginTop: 1,
    includeFontPadding: false,
  },
});
