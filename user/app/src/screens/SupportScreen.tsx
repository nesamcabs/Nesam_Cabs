// Help & Support: call the office, FAQs, raise a ticket and see my tickets (real
// support_tickets collection). Reached from the header, Account and a booking's “Request a change”.
import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAvoid } from '../components/KeyboardAvoid';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useCustomerData } from '../context/CustomerData';
import { Badge, Button, Chip, Disclosure, EmptyState, Notice, Segmented, TextField } from '../components/ui';
import { ScrollView } from '../components/layout';
import { AppHeader, SupportBanner } from '../components/brand';
import { SUPPORT_CATEGORIES, submitSupportTicket, subscribeToSupportTickets } from '../services/userService';
import { SUPPORT_WHATSAPP } from '../config/constants';
import type { SupportTicket } from '../types';
import { describeError } from '../utils/retry';
import { colors, fonts, space } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Support'>;
type Tab = 'faqs' | 'ticket' | 'mine';

const FAQS = [
  { q: 'How do I cancel my booking?', a: 'Open the booking from My Bookings and tap “Cancel booking”. The sheet shows whether a cancellation fee applies before you confirm.' },
  { q: 'When are driver details shared?', a: 'As soon as a driver is assigned — name, phone, vehicle number and rating appear on your booking.' },
  { q: 'What is the boarding code?', a: 'A 4-digit code shown on your booking. Share it with your driver only once you are in the car; the trip cannot start without it.' },
  { q: 'How are tolls charged?', a: 'Tolls, parking and state entry permits paid by the driver are added to your final receipt against actual receipts.' },
  { q: 'What payment modes are accepted?', a: 'Cash or UPI, paid to your driver at the end of your journey.' },
  { q: 'Can I book an outstation trip in advance?', a: 'Yes. Choose Outstation, set your pickup date and time, and NESAM will arrange a verified vehicle.' },
];

export function SupportScreen({ route, navigation }: Props) {
  const { profile } = useCustomerData();
  const [tab, setTab] = useState<Tab>(route.params?.bookingId ? 'ticket' : 'faqs');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [category, setCategory] = useState(SUPPORT_CATEGORIES[0]!);
  const [bookingId, setBookingId] = useState(route.params?.bookingId ?? '');
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [listError, setListError] = useState('');

  useEffect(
    () => subscribeToSupportTickets(profile.uid, setTickets, (e) => setListError(describeError(e, 'Couldn’t load your tickets.'))),
    [profile.uid],
  );

  const submit = async () => {
    if (description.trim().length < 10) return setError('Please describe the issue in at least 10 characters.');
    if (sending) return undefined;
    setSending(true);
    setError('');
    try {
      await submitSupportTicket(profile, { category, bookingId, description });
      setDescription('');
      setBookingId('');
      setSubmitted(true);
      setTab('mine');
    } catch (e) {
      setError(describeError(e, 'We couldn’t submit your request. Please try again or call NESAM.'));
    } finally {
      setSending(false);
    }
    return undefined;
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
<KeyboardAvoid>
      <AppHeader title="Help & Support" active="support" onBack={() => navigation.goBack()} />
      <ScrollView kind="narrow" contentContainerStyle={styles.page} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <SupportBanner />
        <Button
          title="WhatsApp NESAM"
          icon="message-circle"
          variant="secondary"
          onPress={() => void Linking.openURL(`https://wa.me/${SUPPORT_WHATSAPP}`)}
          style={{ marginBottom: space.lg }}
        />

        <Segmented
          options={[
            { value: 'faqs', label: 'FAQs' },
            { value: 'ticket', label: 'Help request' },
            { value: 'mine', label: `My requests${tickets.length ? ` (${tickets.length})` : ''}` },
          ]}
          value={tab}
          onChange={setTab}
        />
        <View style={{ height: space.lg }} />

        {tab === 'faqs' ? (
          <View style={styles.faqList}>
            {FAQS.map((f) => (
              <Disclosure key={f.q} title={f.q} variant="faq">
                <Text style={styles.faqA}>{f.a}</Text>
              </Disclosure>
            ))}
          </View>
        ) : null}

        {tab === 'ticket' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Send a help request</Text>
            <Text style={styles.label}>Topic</Text>
            <View style={styles.chips}>
              {SUPPORT_CATEGORIES.map((c) => (
                <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} />
              ))}
            </View>
            <TextField label="Booking ID (optional)" value={bookingId} onChangeText={setBookingId} autoCapitalize="characters" placeholder="e.g. NT260928-ABCDE" />
            <Text style={styles.label}>Your message</Text>
            <TextInput
              value={description}
              onChangeText={(v) => setDescription(v.slice(0, 2000))}
              multiline
              placeholder="Tell us what happened"
              placeholderTextColor={colors.faint}
              style={styles.textarea}
              accessibilityLabel="Your message"
            />
            <Notice message={error} />
            <Button title="Send request" icon="send" variant="secondary" loading={sending} onPress={() => void submit()} />
            <Text style={styles.safety}>For immediate safety concerns, contact local emergency services (112) and call NESAM.</Text>
          </View>
        ) : null}

        {tab === 'mine' ? (
          <View>
            {submitted ? <Notice tone="success" message="Request sent. Our team will review it and get back to you shortly." /> : null}
            <Notice message={listError} />
            {tickets.length === 0 ? (
              <EmptyState icon="headphones" title="No requests yet" message="Requests you send appear here with their status." action={<Button title="Send a help request" onPress={() => setTab('ticket')} />} />
            ) : (
              tickets.map((t) => (
                <View key={t.id} style={[styles.card, { marginBottom: 12 }]}>
                  <View style={styles.ticketHead}>
                    <Text style={styles.ticketCategory}>{t.category}</Text>
                    <Badge label={t.status} tone={t.status === 'Resolved' || t.status === 'Closed' ? 'success' : 'warning'} />
                  </View>
                  {t.bookingId ? <Text style={styles.ticketMeta}>Booking ID: {t.bookingId}</Text> : null}
                  <Text style={styles.ticketDesc}>{t.description}</Text>
                  <Text style={styles.ticketMeta}>Sent {t.createdAt}</Text>
                </View>
              ))
            )}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoid>
</SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  page: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xxl },
  faqList: { borderTopWidth: 1, borderTopColor: '#E3E6EB' },
  faqA: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 22, color: '#727D8B' },
  card: { borderWidth: 1, borderColor: '#E3E7EC', borderRadius: 13, padding: 18, backgroundColor: colors.white },
  cardTitle: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.ink, marginBottom: 14 },
  label: { fontFamily: fonts.regular, fontSize: 11.5, color: '#697587', marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: space.lg },
  textarea: { fontFamily: fonts.regular, borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 12, minHeight: 100, textAlignVertical: 'top', color: colors.value, fontSize: 14, marginBottom: space.md },
  safety: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 18, color: '#6D7785', marginTop: 14 },
  ticketHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  ticketCategory: { fontFamily: fonts.semiBold, fontSize: 14, color: colors.ink, flex: 1 },
  ticketMeta: { fontFamily: fonts.regular, fontSize: 11.5, color: '#7A8494', marginTop: 6 },
  ticketDesc: { fontFamily: fonts.regular, fontSize: 13, color: colors.text, marginTop: 8, lineHeight: 19 },
});
