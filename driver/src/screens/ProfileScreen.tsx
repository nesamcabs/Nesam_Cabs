// My Profile (reference "My Profile"): a short page: who the driver is, a menu of profile pages that each open on their own
// screen (details, contact & payout, documents, licence & ID, penalties) and the help / account actions.
import React, { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { useNavigation } from '@react-navigation/native';
import { Text } from '../components/nx/Text';
import { useDriverData } from '../context/DriverData';
import { useSignOut } from '../navigation/MainNavigator';
import type { ProfileSection } from '../navigation/types';
import { NxScreen, useShell } from '../components/nx/Shell';
import { NxTwoPane, useLayout } from '../components/nx/layout';
import { Avatar } from '../components/nx/AppFrame';
import { PolicyDialog } from '../components/nx/Cancellation';
import { NxIcon, type NxIconName } from '../components/nx/Icon';
import { NxBadge, NxPanel, isHovered } from '../components/nx/primitives';
import { requestAccountDeletion } from '../services/partnerRequests';
import { formatINR } from '../utils/format';
import { COMPANY_LEGAL_NAME, SUPPORT_EMAIL } from '../config/constants';
import { nx } from '../theme/nx';

function ActionRow({ icon, title, sub, onPress, danger, last }: { icon: NxIconName; title: string; sub?: string; onPress: () => void; danger?: boolean; last?: boolean }) {
  return (
    <Pressable style={(s) => [styles.action, last && { borderBottomWidth: 0 }, isHovered(s) && { backgroundColor: '#FAFBFC' }]} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      <NxIcon name={icon} size={17} color={danger ? nx.red : nx.muted} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.actionTitle, danger && { color: nx.red }]}>{title}</Text>
        {sub ? <Text style={styles.actionSub}>{sub}</Text> : null}
      </View>
      <NxIcon name="chevron" size={15} color={nx.muted} />
    </Pressable>
  );
}

export function ProfileScreen() {
  const navigation = useNavigation();
  const signOut = useSignOut();
  const { openSupport } = useShell();
  const { wide } = useLayout();
  const { account, cancelPolicy, penalties } = useDriverData();
  const { driver } = account;
  const fleet = !!driver.vendorId;
  const [policyOpen, setPolicyOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const open = (section: ProfileSection) => navigation.navigate('ProfileSection', { section });

  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'You’ll need to verify your phone number again to sign back in.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);

  const confirmDeletion = () =>
    Alert.alert(
      'Delete your account?',
      'NESAM will verify the request, settle anything still open (duties, dues, wallet and deposit) and then delete your account and personal data. Records we must keep by law, such as trip and settlement records, are retained.',
      [
        { text: 'Keep my account', style: 'cancel' },
        {
          text: 'Request deletion',
          style: 'destructive',
          onPress: () => {
            if (deleting) return;
            setDeleting(true);
            requestAccountDeletion('driver')
              .then((r) => Alert.alert(r.alreadyOpen ? 'Already requested' : 'Request received', `Reference ${r.reference}. NESAM will confirm by phone or email.`))
              .catch((e: unknown) => Alert.alert('Request not sent', e instanceof Error ? e.message : 'Please try again.'))
              .finally(() => setDeleting(false));
          },
        },
      ],
    );

  const owed = penalties.filter((p) => p.status === 'Pending' || p.status === 'Acknowledged' || p.status === 'Disputed').reduce((s, p) => s + p.amount, 0);
  const docSub = driver.docStatus === 'Approved' ? 'All documents approved' : driver.docStatus === 'Rejected' ? 'Action needed: upload again' : 'Under review by NESAM';

  const left = (
    <NxPanel style={styles.overview}>
      <Avatar name={driver.name} photoUrl={driver.photoUrl} size={64} />
      <Text style={styles.name}>{driver.name}</Text>
      <Text style={styles.role}>{fleet ? `Fleet driver · ${driver.vendorName || 'Fleet operator'}` : 'Single vehicle owner / driver'}</Text>
      <NxBadge label={driver.approvalStatus === 'Approved' ? 'Verified driver' : driver.approvalStatus} tone="green" icon="shield" style={{ alignSelf: 'center' }} />
    </NxPanel>
  );

  const right = (
    <>
      <Text style={styles.group}>My profile</Text>
      <NxPanel style={styles.menu}>
        <ActionRow icon="user" title="Personal & vehicle" sub="Mobile, vehicle, registration, rating" onPress={() => open('details')} />
        <ActionRow icon="bank" title="Contact & payout account" sub="Email, address, emergency contact, bank, UPI" onPress={() => open('contact')} />
        <ActionRow icon="document" title="Document verification" sub={docSub} onPress={() => open('documents')} />
        <ActionRow icon="shield" title="Licence & ID" sub="Licence, Aadhaar and PAN details" onPress={() => open('licence')} />
        <ActionRow icon="alert" title="Penalties" sub={owed > 0 ? `${formatINR(owed)} open` : 'You have no open penalties'} onPress={() => open('penalties')} last />
      </NxPanel>

      <Text style={styles.group}>Help & account</Text>
      <NxPanel style={styles.menu}>
        <ActionRow icon="help" title="Help & SOS" sub="Call the NESAM office or the police" onPress={() => openSupport()} />
        {fleet ? null : <ActionRow icon="shield" title="Cancellation policy" sub="Charges and waivers for duty cancellations" onPress={() => setPolicyOpen(true)} />}
        <ActionRow icon="document" title="Email NESAM" sub={SUPPORT_EMAIL} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
        <ActionRow icon="trash" title={deleting ? 'Sending request…' : 'Delete my account'} sub="NESAM verifies and settles before deleting" onPress={confirmDeletion} />
        <ActionRow icon="logout" title="Sign out" onPress={confirmSignOut} danger last />
      </NxPanel>
      <Text style={styles.version}>
        NESAM Driver v{Constants.expoConfig?.version ?? '1.0.0'} · © {new Date().getFullYear()} {COMPANY_LEGAL_NAME}
      </Text>
    </>
  );

  return (
    <NxScreen>
      <NxTwoPane left={left} right={right} leftFlex={0.8} rightFlex={1.2} when={wide} />
      <PolicyDialog visible={policyOpen} onClose={() => setPolicyOpen(false)} policy={cancelPolicy} />
    </NxScreen>
  );
}

const styles = StyleSheet.create({
  overview: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 22 },
  name: { fontSize: 20, fontWeight: '700', letterSpacing: -0.6, color: nx.ink, marginTop: 12, textAlign: 'center' },
  role: { fontSize: 12, color: nx.muted, marginTop: 4, marginBottom: 12, textAlign: 'center' },
  group: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: nx.muted, marginTop: 4, marginBottom: 8, marginLeft: 4 },
  menu: { paddingVertical: 4, paddingHorizontal: 18, marginBottom: 18 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: nx.line },
  actionTitle: { fontSize: 13.5, fontWeight: '600', color: nx.ink },
  actionSub: { fontSize: 11.5, color: nx.muted, marginTop: 2 },
  version: { fontSize: 11, lineHeight: 17, color: nx.muted, marginTop: 2, textAlign: 'center' },
});
