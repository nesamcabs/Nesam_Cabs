// Settings / About NESAM.
import React, { useEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { useCustomerData } from '../context/CustomerData';
import { Card, MenuGroup, MenuRow, Notice, Row, TextButton } from '../components/ui';
import { ScrollView } from '../components/layout';
import { AppHeader } from '../components/brand';
import { isConfirmationSoundOn, playConfirmationSound, setConfirmationSound } from '../services/confirmationSound';
import { COMPANY_LEGAL_NAME, SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config/constants';
import { callFunction } from '../services/callables';
import { colors, fonts, space } from '../theme';

export function SettingsScreen() {
  const navigation = useNavigation();
  const { profile } = useCustomerData();
  const [sound, setSound] = useState(true);
  const [deletion, setDeletion] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    void isConfirmationSoundOn().then(setSound);
  }, []);
  const requestDeletion = () =>
    Alert.alert(
      'Delete your account?',
      'We will verify the request, settle anything still open (bookings, payments) and then delete your account and personal data. Records we must keep by law, such as invoices, are retained. You cannot undo this once it is processed.',
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Request deletion',
          style: 'destructive',
          onPress: () => {
            if (deleting) return;
            setDeleting(true);
            setDeletion(null);
            callFunction<{ role: string }, { alreadyOpen: boolean; liveBookings: number; reference: string }>('requestAccountDeletion', { role: 'customer' })
              .then((r) =>
                setDeletion({
                  tone: 'success',
                  text: `${r.alreadyOpen ? 'Your request is already with our team.' : 'Request received.'} Reference ${r.reference}. We will confirm by phone or email${r.liveBookings ? `. ${r.liveBookings} booking(s) are still open and must be completed or cancelled first` : ''}.`,
                }),
              )
              .catch((e: unknown) => setDeletion({ tone: 'error', text: e instanceof Error ? e.message : 'The request was not sent. Please try again.' }))
              .finally(() => setDeleting(false));
          },
        },
      ],
    );
  return (
    <SafeAreaView style={styles.root} edges={['top']}>
<KeyboardAvoid>
      <AppHeader title="Settings" onBack={() => navigation.goBack()} />
      <ScrollView kind="narrow" contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <Card>
          <Row label="Language" value={profile.language || 'English'} />
        </Card>
        <Card>
          <View style={styles.soundRow}>
            <Text style={styles.head}>Booking confirmation sound</Text>
            <Switch
              value={sound}
              onValueChange={(v) => {
                setSound(v);
                void setConfirmationSound(v);
              }}
              trackColor={{ true: '#E59A9A', false: '#D5DAE1' }}
              thumbColor={sound ? colors.primary : '#F4F5F7'}
              accessibilityLabel="Booking confirmation sound"
            />
          </View>
          <Text style={styles.text}>A soft chime after a new booking. Turn it off anytime.</Text>
          <TextButton title="Preview sound" icon="volume-2" size={12} onPress={() => void playConfirmationSound(true)} style={{ alignSelf: 'flex-start', marginTop: 6 }} />
        </Card>
        <Card>
          <Text style={styles.head}>About NESAM</Text>
          <Text style={styles.text}>{COMPANY_LEGAL_NAME}. Cabs & car rentals for outstation, airport and local rental journeys across Tamil Nadu.</Text>
          <View style={{ height: space.md }} />
          <Row label="Office phone" value={SUPPORT_PHONE_DISPLAY} />
          <Row label="Email" value={SUPPORT_EMAIL} />
          <Row label="App version" value={Constants.expoConfig?.version ?? '1.0.0'} />
          <View style={{ height: space.sm }} />
          <Text style={styles.text}>© {new Date().getFullYear()} {COMPANY_LEGAL_NAME}. All rights reserved.</Text>
        </Card>
        <MenuGroup>
          <MenuRow icon="phone" title="Call NESAM" subtitle={SUPPORT_PHONE_DISPLAY} onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} />
          <MenuRow icon="headphones" title="Help & Support" subtitle="Get help with your journey" onPress={() => navigation.navigate('Support')} />
          <MenuRow icon="mail" title="Email NESAM" subtitle={SUPPORT_EMAIL} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
          <MenuRow icon="file-text" title="Terms, privacy & cancellation" subtitle="Agreements and policies" onPress={() => navigation.navigate('LegalDocuments')} />
          <MenuRow icon="trash-2" title="Delete my account" subtitle="Ask NESAM to erase your account and data" onPress={requestDeletion} />
        </MenuGroup>
        {deletion ? <Notice tone={deletion.tone} message={deletion.text} /> : null}
      </ScrollView>
    </KeyboardAvoid>
</SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  page: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xxl },
  soundRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 },
  head: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.ink, marginBottom: 6 },
  text: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 19, color: '#55606F' },
});
