// Profile — My Business and account settings (reference vBusiness): the partner profile beside the account menu
// (bank details, business & contact, agreements, documents, linking, alerts, penalties, help, deletion, sign out).
import React, { useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { Text } from '../../components/kit/Text';
import Constants from 'expo-constants';
import { useNavigation } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { useInbox } from '../../context/Inbox';
import { useSignOut } from '../../navigation/signOut';
import { Page } from '../../components/shell/Page';
import { Sheet, TextField } from '../../components/ui';
import { Badge, Btn, Feedback, H2, KV, MenuItem, Panel, Small } from '../../components/kit/core';
import { flash } from '../../components/kit/flash';
import { goSection } from '../../navigation/navigationRef';
import { requestAccountDeletion, requestBankChange } from '../../services/partnerOps';
import { COMPANY_LEGAL_NAME, SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../../config/constants';
import { formatPhone } from '../../utils/format';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily } from '../../theme';
import { useLayout } from '../../theme/responsive';

export function AccountScreen() {
  const navigation = useNavigation();
  const signOut = useSignOut();
  const { profile, record, actionLinks, requests } = useVendorData();
  const { unreadCount, unacknowledged } = useInbox();
  const { sideBySide } = useLayout();
  const [bank, setBank] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const b = record.business;
  const bankPending = requests.find((r) => r.type === 'bank_change' && r.status === 'Pending');

  const confirmSignOut = () => Alert.alert('Log out?', 'You will need to verify your phone number again to log back in.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Log out', style: 'destructive', onPress: signOut },
  ]);
  const confirmDeletion = () => Alert.alert('Delete your account?', 'NESAM will verify the request, settle anything still open (duties, dues, wallet and recharge) and then delete your account and personal data. Records required by law, such as invoices and settlements, are retained.', [
    { text: 'Keep my account', style: 'cancel' },
    {
      text: 'Request deletion', style: 'destructive', onPress: () => {
        if (deleting) return;
        setDeleting(true);
        requestAccountDeletion('vendor')
          .then((r) => flash(`${r.alreadyOpen ? 'Your request is already with the office.' : 'Request received.'} Reference ${r.reference}. NESAM will confirm by phone or email.`))
          .catch((e: unknown) => flash(e instanceof Error ? e.message : 'The request was not sent. Please try again.', 'error'))
          .finally(() => setDeleting(false));
      },
    },
  ]);

  const business = (
    <Panel style={{ flex: sideBySide ? 1 : undefined }}>
      <View style={styles.head}>
        <View style={styles.icon}><Ionicons name="business-outline" size={24} color={colors.primary} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <H2 style={{ fontSize: 18 }}>{profile.companyName || 'Fleet partner'}</H2>
          <Small>NSM-VN-{profile.id.slice(0, 6).toUpperCase()}</Small>
        </View>
        <Badge label="Verified" tone="green" />
      </View>
      <KV rows={[
        ['Vendor ID', `NSM-VN-${profile.id.slice(0, 6).toUpperCase()}`],
        ['Business name', profile.companyName || '—'],
        ['Authorised representative', profile.contactPerson || b?.vendorName || '—'],
        ['Mobile number', formatPhone(profile.phone)],
        ['Email', b?.email || profile.email || '—'],
        profile.gstin ? ['GSTIN', profile.gstin] : null,
        ['Account type', 'Fleet vendor'],
        ['Declared fleet size', profile.totalFleetSize ? String(profile.totalFleetSize) : '—'],
      ]} />
      <Btn kind="secondary" icon="call-outline" title="Request edit" onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} style={{ marginTop: 16, alignSelf: 'flex-start' }} />
    </Panel>
  );

  const menu = (
    <View style={{ flex: sideBySide ? 1 : undefined, gap: 16 }}>
      <Panel style={{ paddingVertical: 6 }}>
        <MenuItem icon="card-outline" title="Bank details" sub={record.payoutSummary?.bankLast4 ? `Account ending ${record.payoutSummary.bankLast4}${bankPending ? ' · change under review' : ''}` : 'Not added'} onPress={() => setBank(true)} />
        <MenuItem icon="document-text-outline" title="Agreement & accepted copy" onPress={() => navigation.navigate('Agreements')} />
        <MenuItem icon="shield-checkmark-outline" title="Documents & verification" onPress={() => navigation.navigate('Documents')} last />
      </Panel>
      <Panel style={{ paddingVertical: 6 }}>
        <MenuItem icon="call-outline" title="Nesam office" value={SUPPORT_PHONE_DISPLAY} onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} />
        <MenuItem icon="mail-outline" title="Email NESAM" value={SUPPORT_EMAIL} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
        <MenuItem icon="log-out-outline" title="Log out" danger last onPress={confirmSignOut} />
      </Panel>
    </View>
  );

  return (
    <Page title="Profile">
      {sideBySide ? <View style={{ flexDirection: 'row', gap: 22, alignItems: 'flex-start' }}>{business}{menu}</View> : <View style={{ gap: 16 }}>{business}{menu}</View>}
      {bank ? <BankSheet onClose={() => setBank(false)} pending={bankPending?.accountLast4 ?? ''} summary={record.payoutSummary} /> : null}
    </Page>
  );
}

export function BankSheet({ onClose, pending, summary }: { onClose: () => void; pending: string; summary: { accountHolderName: string; bankLast4: string; ifsc: string; upiId?: string; bankName?: string; branchName?: string } | null }) {
  const [holder, setHolder] = useState(summary?.accountHolderName ?? '');
  const [account, setAccount] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [bankName, setBankName] = useState('');
  const [branch, setBranch] = useState('');
  const [upi, setUpi] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (holder.trim().length < 3) { setError('Enter the account holder name.'); return; }
    if (!/^\d{8,20}$/.test(account)) { setError('Enter the full account number (8 to 20 digits).'); return; }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase())) { setError('Enter a valid IFSC code (for example HDFC0001234).'); return; }
    if (bankName.trim().length < 2) { setError('Enter the bank name.'); return; }
    if (branch.trim().length < 2) { setError('Enter the branch name.'); return; }
    if (upi.trim() && !/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/.test(upi.trim())) { setError('Enter a valid UPI ID (for example name@bank) or leave it empty.'); return; }
    setBusy(true); setError('');
    try { await requestBankChange({ accountHolder: holder, accountNumber: account, ifsc, bankName, branchName: branch, upiId: upi }); flash('Bank change requested. It takes effect after office approval.'); onClose(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet visible onClose={onClose} title="Bank details" dismissible={!busy}>
      <KV rows={[
        ['Account holder', summary?.accountHolderName || '—'],
        ['Account ending', summary?.bankLast4 ? `•••• ${summary.bankLast4}` : '—'],
        ['IFSC code', summary?.ifsc || '—'],
        summary?.bankName ? ['Bank', summary.bankName] : null,
        summary?.branchName ? ['Branch', summary.branchName] : null,
        summary?.upiId ? ['UPI ID', summary.upiId] : null,
      ]} style={{ marginTop: 0 }} />
      {pending ? <Small style={{ marginTop: 14 }}>A change to the account ending {pending} is with the office.</Small> : (
        <View style={{ marginTop: 18 }}>
          <H2 style={{ fontSize: 14, marginBottom: 12 }}>Request a change</H2>
          <TextField label="Account holder name" required value={holder} onChangeText={setHolder} autoCapitalize="words" />
          <TextField label="Account number" required value={account} onChangeText={(v) => setAccount(v.replace(/\D/g, '').slice(0, 20))} keyboardType="number-pad" />
          <TextField label="IFSC code" required value={ifsc} onChangeText={(v) => setIfsc(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))} autoCapitalize="characters" placeholder="HDFC0001234" />
          <TextField label="Bank name" required value={bankName} onChangeText={setBankName} autoCapitalize="words" />
          <TextField label="Branch name" required value={branch} onChangeText={setBranch} autoCapitalize="words" />
          <TextField label="UPI ID · optional" value={upi} onChangeText={setUpi} autoCapitalize="none" autoCorrect={false} placeholder="name@bank" hint="Bank changes take effect after office approval." />
          <Feedback tone="error" message={error} />
          <Btn title="Request bank change" icon="send-outline" full busy={busy} onPress={() => void submit()} />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  icon: { width: 48, height: 48, borderRadius: 13, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  version: { fontFamily, fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 22 },
});
