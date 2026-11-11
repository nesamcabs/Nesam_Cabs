// NESAM Partner header from the client reference: logo + NESAM PARTNER wordmark, then Notifications,
// 24/7 Helpdesk and Profile.
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useInbox } from '../context/Inbox';
import { colors, space } from '../theme';

export function AppHeader({ right }: { right?: React.ReactNode }) {
  const navigation = useNavigation();
  const { unreadCount, unacknowledged } = useInbox();
  const insets = useSafeAreaInsets();
  const dot = unreadCount > 0 || unacknowledged.length > 0;

  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 10) }]}>
      <Pressable style={styles.brand} onPress={() => navigation.navigate('Tabs', { screen: 'Trips' })} accessibilityRole="button" accessibilityLabel="NESAM Partner Trips">
        <View style={styles.logoBox}><Image source={require('../../assets/partner-logo.jpg')} style={styles.logo} /></View>
        <View>
          <Text style={styles.title}>NESAM</Text>
          <Text style={styles.label}>PARTNER</Text>
        </View>
      </Pressable>
      <View style={styles.rightRow}>
        {right}
        <Pressable style={styles.iconBtn} onPress={() => navigation.navigate('Alerts')} accessibilityRole="button" accessibilityLabel={dot ? 'Notifications, unread' : 'Notifications'}>
          <Ionicons name="notifications-outline" size={19} color={colors.ink} />
          {dot ? <View style={styles.dot} /> : null}
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={() => navigation.navigate('Helpdesk')} accessibilityRole="button" accessibilityLabel="24/7 Helpdesk">
          <Ionicons name="headset-outline" size={18} color={colors.ink} />
          <Text style={styles.tiny}>24/7</Text>
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={() => navigation.navigate('Account')} accessibilityRole="button" accessibilityLabel="Profile and My Business">
          <Ionicons name="person-outline" size={18} color={colors.ink} />
          <Text style={styles.tiny}>Profile</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: 10, backgroundColor: '#fff', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  logoBox: { width: 38, height: 38, overflow: 'hidden' },
  logo: { width: 48, height: 47, marginLeft: -5, marginTop: -5 },
  title: { fontSize: 22, fontWeight: '800', color: colors.primary, letterSpacing: -0.3, lineHeight: 24 },
  label: { fontSize: 9, fontWeight: '700', color: colors.primary, letterSpacing: 2.4 },
  rightRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconBtn: { minWidth: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  tiny: { fontSize: 8.5, color: colors.text, marginTop: 1 },
  dot: { position: 'absolute', top: 9, right: 11, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
});
