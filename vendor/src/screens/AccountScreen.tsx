// Account: who this partner is, the things that need attention (requests, alerts, penalties), the documents and agreements on
// file, and help. Everything else lives in the tabs.
import React, { useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { useVendorData } from '../context/VendorData';
import { useInbox } from '../context/Inbox';
import { useSignOut } from '../navigation/MainNavigator';
import { Avatar, Badge, Card, MenuRow, Screen } from '../components/ui';
import { COMPANY_LEGAL_NAME, SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../config/constants';
import { formatPhone } from '../utils/format';
import { colors, space, type } from '../theme';
import { Sheet, TextField } from '../components/ui';
import { Feedback, KV, PButton } from '../components/partner';
import { requestAccountDeletion, requestBankChange } from '../services/partnerOps';

export function AccountScreen() {
  const navigation = useNavigation();
  const signOut = useSignOut();
  const { profile, openLinks, record, requests } = useVendorData();
  const [bank, setBank] = useState(false);
  const [notice, setNotice] = useState('');
  const { unreadCount, penalties, unacknowledged } = useInbox();
  const owed = penalties.filter((x) => ['Pending', 'Acknowledged', 'Disputed'].includes(x.status)).length;

  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'You’ll need to verify your phone number again to sign back in.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);

  const [deleting, setDeleting] = useState(false);
  const confirmDeletion = () =>
    Alert.alert(
      'Delete your account?',
      'NESAM will verify the request, settle anything still open (duties, dues, wallet and deposit) and then delete your account and personal data. Records we must keep by law, such as invoices and settlements, are retained.',
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Request deletion',
          style: 'destructive',
          onPress: () => {
            if (deleting) return;
            setDeleting(true);
            requestAccountDeletion('vendor')
              .then((r) => setNotice(`${r.alreadyOpen ? 'Your request is already with the office.' : 'Request received.'} Reference ${r.reference}. NESAM will confirm by phone or email.`))
              .catch((e: unknown) => setNotice(e instanceof Error ? e.message : 'The request was not sent. Please try again.'))
              .finally(() => setDeleting(false));
          },
        },
      ],
    );

  return (
    <View style={styles.root}>
      <Screen edges={[]}>
        <Text style={[type.h1]}>Profile</Text>
        <Text style={[type.small, { marginBottom: space.md }]}>My Business and account settings.</Text>
        <Feedback message={notice} />
        <Card>
          <View style={styles.head}>
            <Avatar name={profile.companyName} size={56} />
            <View style={{ flex: 1 }}>
              <Text style={type.h2} numberOfLines={1}>
                {profile.companyName || 'Fleet partner'}
              </Text>
              <Text style={type.small}>{formatPhone(profile.phone)}</Text>
              <Text style={type.tiny}>Partner ID {profile.id.slice(0, 8).toUpperCase()}</Text>
            </View>
          </View>
          <View style={{ marginTop: space.sm, flexDirection: 'row' }}>
            <Badge label="Verified partner" tone="success" />
          </View>
        </Card>

        <Text style={[type.label, styles.group]}>Needs your attention</Text>
        <Card style={styles.menu}>
          <MenuRow
            icon="swap-horizontal-outline"
            label="Linking requests"
            value={openLinks.length ? `${openLinks.length} open` : undefined}
            onPress={() => navigation.navigate('Requests')}
          />
          <MenuRow
            icon="notifications-outline"
            label="Alerts"
            value={unreadCount ? `${unreadCount} new` : undefined}
            onPress={() => navigation.navigate('Alerts')}
          />
          <MenuRow
            icon="alert-circle-outline"
            label="Penalties"
            value={unacknowledged.length ? `${unacknowledged.length} to review` : owed ? `${owed} open` : undefined}
            onPress={() => navigation.navigate('Penalties')}
          />
        </Card>

        <Text style={[type.label, styles.group]}>On file</Text>
        <Card style={styles.menu}>
          <MenuRow icon="business-outline" label="Business & contact details" onPress={() => navigation.navigate('Profile')} />
          <MenuRow icon="card-outline" label="Bank details" value={record.payoutSummary?.bankLast4 ? `Ending ${record.payoutSummary.bankLast4}` : 'Not added'} onPress={() => setBank(true)} />
          <MenuRow icon="headset-outline" label="24/7 Helpdesk" onPress={() => navigation.navigate('Helpdesk')} />
          <MenuRow icon="document-text-outline" label="Documents & compliance" onPress={() => navigation.navigate('Documents')} />
          <MenuRow icon="shield-checkmark-outline" label="Agreements accepted" onPress={() => navigation.navigate('Agreements')} />
        </Card>

        <Text style={[type.label, styles.group]}>Help</Text>
        <Card style={styles.menu}>
          <MenuRow icon="call-outline" label="NESAM office" value={SUPPORT_PHONE_DISPLAY} onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} />
          <MenuRow icon="mail-outline" label="Email NESAM" value={SUPPORT_EMAIL} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
          <MenuRow icon="trash-outline" label="Delete my account" onPress={confirmDeletion} danger />
          <MenuRow icon="log-out-outline" label="Sign out" onPress={confirmSignOut} danger />
        </Card>
        <Text style={[type.tiny, { textAlign: 'center' }]}>NESAM Vendor v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
        <Text style={[type.tiny, { textAlign: 'center' }]}>© {new Date().getFullYear()} {COMPANY_LEGAL_NAME}. All rights reserved.</Text>
      </Screen>
      {bank ? <BankSheet onClose={() => setBank(false)} onDone={(m) => { setBank(false); setNotice(m); }} pending={requests.find((r) => r.type === 'bank_change' && r.status === 'Pending')?.accountLast4 ?? ''} summary={record.payoutSummary} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  group: { marginTop: space.sm, marginBottom: space.xs },
  menu: { padding: 0, overflow: 'hidden' },
});

function BankSheet({ onClose, onDone, pending, summary }: { onClose: () => void; onDone: (m: string) => void; pending: string; summary: { accountHolderName: string; bankLast4: string; ifsc: string } | null }) {
  const [holder, setHolder] = useState(summary?.accountHolderName ?? '');
  const [last4, setLast4] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (holder.trim().length < 2) { setError('Enter the account holder name.'); return; }
    if (!/^\d{4}$/.test(last4)) { setError('Enter the last four digits of the new account.'); return; }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase())) { setError('Enter a valid IFSC (for example HDFC0001234).'); return; }
    setBusy(true); setError('');
    try { await requestBankChange(holder, last4, ifsc); onDone('Bank change requested. It takes effect after office approval.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet visible onClose={onClose} title="Bank details" dismissible={!busy}>
      <KV rows={[['Account holder', summary?.accountHolderName || '—'], ['Account ending', summary?.bankLast4 ? `•••• ${summary.bankLast4}` : '—'], ['IFSC', summary?.ifsc || '—']]} />
      {pending ? <Text style={[type.small, { marginTop: space.md }]}>A change to the account ending {pending} is with the office.</Text> : (
        <View style={{ marginTop: space.md }}>
          <TextField label="Account holder" value={holder} onChangeText={setHolder} />
          <TextField label="New account last four digits" value={last4} onChangeText={(v) => setLast4(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" />
          <TextField label="IFSC" value={ifsc} onChangeText={(v) => setIfsc(v.toUpperCase().slice(0, 11))} autoCapitalize="characters" hint="Bank changes take effect after office approval." />
          <Feedback tone="error" message={error} />
          <PButton title="Request bank change" icon="arrow-forward" full busy={busy} onPress={() => void submit()} />
        </View>
      )}
    </Sheet>
  );
}
