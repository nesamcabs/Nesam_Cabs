// Verification status (Pending / Rejected / Suspended), "no account" and load-error screens, in the NESAM Driver design.
// The status screen updates by itself: App.tsx listens to drivers/{uid} and opens the workspace once an admin approves.
import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Text } from '../../components/nx/Text';
import { NxIcon, type NxIconName } from '../../components/nx/Icon';
import { AuthCard, AuthFrame } from '../../components/AuthFrame';
import { NxBadge, NxButton, NxInfo } from '../../components/nx/primitives';
import type { DriverAccount } from '../../types/driver';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../../config/constants';
import { nx } from '../../theme/nx';

function Actions({ onSignOut, children }: { onSignOut: () => void; children?: React.ReactNode }) {
  return (
    <View style={styles.actions}>
      {children}
      <NxButton title={`Call support · ${SUPPORT_PHONE_DISPLAY}`} icon="phone" variant="secondary" onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} />
      <NxButton title="Sign out" icon="logout" variant="ghost" onPress={onSignOut} />
    </View>
  );
}

function Hero({ icon, tone, badge }: { icon: NxIconName; tone: 'red' | 'amber' | 'neutral' | 'green'; badge: string }) {
  const bg = tone === 'red' ? nx.redSoft : tone === 'amber' ? nx.amberSoft : tone === 'green' ? nx.greenSoft : nx.page;
  const fg = tone === 'red' ? nx.red : tone === 'amber' ? nx.amber : tone === 'green' ? nx.green : nx.muted;
  return (
    <View style={styles.hero}>
      <View style={[styles.heroIcon, { backgroundColor: bg }]}>
        <NxIcon name={icon} size={28} color={fg} strokeWidth={1.7} />
      </View>
      <NxBadge label={badge} tone={tone} />
    </View>
  );
}

export function VerificationStatusScreen({ account, onSignOut, onResubmit }: { account: DriverAccount; onSignOut: () => void; onResubmit: () => void }) {
  const { driver } = account;
  const first = driver.name.split(' ')[0] || 'there';

  if (driver.approvalStatus === 'Rejected') {
    return (
      <AuthFrame>
        <AuthCard>
          <Hero icon="alert" tone="red" badge="Not approved" />
          <Text style={styles.title}>Application not approved</Text>
          <Text style={styles.body}>Hi {first}, our team could not verify your application. Correct the details below and resubmit — it goes straight back to review.</Text>
          <NxInfo tone="red">Reason: {driver.rejectionReason || 'One or more documents were unclear or invalid. Please re-upload clear photos.'}</NxInfo>
          <Actions onSignOut={onSignOut}>
            <NxButton title="Correct details & resubmit" trailingIcon="arrow" onPress={onResubmit} />
          </Actions>
        </AuthCard>
      </AuthFrame>
    );
  }

  if (driver.approvalStatus === 'Suspended') {
    return (
      <AuthFrame>
        <AuthCard>
          <Hero icon="shield" tone="neutral" badge={driver.holdLabel || 'Suspended'} />
          <Text style={styles.title}>{driver.holdLabel === 'Permanent block' ? 'Account blocked' : driver.holdLabel === 'Inactive' ? 'Account inactive' : driver.holdLabel === 'Dispute hold' ? 'Account on hold' : 'Account suspended'}</Text>
          <Text style={styles.body}>
            {driver.holdLabel === 'Permanent block'
              ? 'Your driver account has been blocked by NESAM. Contact the NESAM office if you think this is a mistake.'
              : `Your driver account is on hold${driver.holdUntil ? ` until ${driver.holdUntil.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}. You will not receive duties meanwhile. Please contact the NESAM office to resolve this.`}
          </Text>
          {driver.holdReason || driver.rejectionReason ? <NxInfo tone="amber">Reason: {driver.holdReason || driver.rejectionReason}</NxInfo> : null}
          <Actions onSignOut={onSignOut} />
        </AuthCard>
      </AuthFrame>
    );
  }

  // Selfie, licence and — for an owner-driver — the vehicle documents.
  const checklist = [
    { label: 'Live selfie', done: !!account.profile.photoUrl },
    { label: `Driving licence${account.license.number ? ` · ${account.license.number}` : ''}`, done: !!account.license.frontPhotoUrl },
    ...(driver.vendorId ? [] : [{ label: `Vehicle papers${account.vehicle.vehicleNumber ? ` · ${account.vehicle.vehicleNumber}` : ''}`, done: !!account.vehicle.rcDocUrl && !!account.vehicle.insuranceDocUrl && !!account.vehicle.statePermitDocUrl }]),
  ];
  return (
    <AuthFrame>
      <AuthCard>
        <Hero icon="clock" tone="amber" badge="Under review" />
        <Text style={styles.title}>Verification pending</Text>
        <Text style={styles.body}>Thanks {first}! The NESAM team is verifying your documents — usually within 24–48 hours. This screen opens your workspace automatically once you are approved.</Text>
        <View style={styles.list}>
          {checklist.map((c, i) => (
            <View key={c.label} style={[styles.item, i === checklist.length - 1 && { borderBottomWidth: 0 }]}>
              <NxIcon name={c.done ? 'check' : 'alert'} size={17} color={c.done ? nx.green : nx.amber} />
              <Text style={styles.itemLabel} numberOfLines={1}>
                {c.label}
              </Text>
              <NxBadge label={c.done ? 'Submitted' : 'Missing'} tone={c.done ? 'green' : 'amber'} />
            </View>
          ))}
        </View>
        <Actions onSignOut={onSignOut} />
      </AuthCard>
    </AuthFrame>
  );
}

export function NoAccountScreen({ phone, onRegister, onSignOut }: { phone: string; onRegister: () => void; onSignOut: () => void }) {
  return (
    <AuthFrame>
      <AuthCard>
        <Hero icon="user" tone="neutral" badge="Not registered" />
        <Text style={styles.title}>No driver account found</Text>
        <Text style={styles.body}>{phone} is not registered as a NESAM driver partner yet. Register in a few minutes with your licence and vehicle papers.</Text>
        <Actions onSignOut={onSignOut}>
          <NxButton title="Register as a new driver" trailingIcon="arrow" onPress={onRegister} />
        </Actions>
      </AuthCard>
    </AuthFrame>
  );
}

export function LoadErrorScreen({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut: () => void }) {
  return (
    <AuthFrame>
      <AuthCard>
        <Hero icon="refresh" tone="red" badge="Connection problem" />
        <Text style={styles.title}>Couldn’t load your driver profile</Text>
        <NxInfo tone="red">{message}</NxInfo>
        <View style={styles.actions}>
          <NxButton title="Try again" icon="refresh" onPress={onRetry} />
          <NxButton title="Sign out" icon="logout" variant="ghost" onPress={onSignOut} />
        </View>
      </AuthCard>
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  heroIcon: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.6, color: nx.ink },
  body: { fontSize: 13, lineHeight: 21, color: nx.muted, marginTop: 8 },
  list: { marginTop: 18, borderWidth: 1, borderColor: nx.line, borderRadius: 12, paddingHorizontal: 14 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: nx.line },
  itemLabel: { flex: 1, fontSize: 12.5, color: nx.ink },
  actions: { gap: 10, marginTop: 22 },
});
