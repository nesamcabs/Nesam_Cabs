// Verification status (Pending / Rejected / Suspended), "no account" and load
// error screens. Native port of driver/web/src/screens/VerificationStatusScreen.tsx
// (uses the configured support number; the Web file had a stale one).
import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Text } from '../../components/nx/Text';
import { NxIcon, type NxIconName } from '../../components/nx/Icon';
import type { DriverAccount } from '../../types/driver';
import { Button, Card, Notice, Screen } from '../../components/ui';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '../../config/constants';
import { colors, space, type } from '../../theme';

function Shell({ children, onSignOut }: { children: React.ReactNode; onSignOut: () => void }) {
  return (
    <Screen>
      <Card style={{ marginTop: space.xl }}>
        {children}
        <View style={styles.footer}>
          <Button title={`Call support (${SUPPORT_PHONE_DISPLAY})`} variant="secondary" onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} />
          <Button title="Sign out" variant="ghost" onPress={onSignOut} style={{ marginTop: space.sm }} />
        </View>
      </Card>
      <Text style={[type.tiny, { textAlign: 'center' }]}>NESAM Tours & Travels • Driver Partner</Text>
    </Screen>
  );
}

function Hero({ icon, color, title, body }: { icon: NxIconName; color: string; title: string; body: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={[styles.iconWrap, { backgroundColor: `${color}22` }]}>
        <NxIcon name={icon} size={36} color={color} strokeWidth={1.6} />
      </View>
      <Text style={[type.h1, { textAlign: 'center' }]}>{title}</Text>
      <Text style={[type.small, { textAlign: 'center', marginTop: space.sm }]}>{body}</Text>
    </View>
  );
}

export function VerificationStatusScreen({ account, onSignOut, onResubmit }: { account: DriverAccount; onSignOut: () => void; onResubmit: () => void }) {
  const { driver } = account;
  const first = driver.name.split(' ')[0] || 'there';

  if (driver.approvalStatus === 'Rejected') {
    return (
      <Shell onSignOut={onSignOut}>
        <Hero icon="alert" color={colors.danger} title="Application not approved" body={`Hi ${first}, our team could not verify your application.`} />
        <Notice
          style={{ marginTop: space.lg }}
          message={`Reason: ${driver.rejectionReason || 'One or more documents were unclear or invalid. Please re-upload clear photos.'}`}
        />
        <Button title="Correct details & resubmit" onPress={onResubmit} />
      </Shell>
    );
  }

  if (driver.approvalStatus === 'Suspended') {
    return (
      <Shell onSignOut={onSignOut}>
        <Hero icon="shield" color={colors.muted} title="Account suspended" body="Your driver account has been temporarily suspended. Please contact NESAM support to resolve this." />
        {driver.rejectionReason ? <Notice tone="warning" message={driver.rejectionReason} style={{ marginTop: space.lg }} /> : null}
      </Shell>
    );
  }

  // Spec page 13: selfie, licence and — for an owner-driver — the vehicle documents.
  const checklist = [
    { label: 'Selfie', done: !!account.profile.photoUrl },
    { label: `Driving licence ${account.license.number}`, done: !!account.license.frontPhotoUrl },
    ...(driver.vendorId ? [] : [{ label: `Vehicle ${account.vehicle.vehicleNumber}`, done: !!account.vehicle.rcDocUrl && !!account.vehicle.insuranceDocUrl && !!account.vehicle.statePermitDocUrl }]),
  ];
  return (
    <Shell onSignOut={onSignOut}>
      <Hero
        icon="clock"
        color={colors.warning}
        title="Verification pending"
        body={`Thanks ${first}! The NESAM team is verifying your documents — usually 24–48 hours. This screen updates automatically once you are approved.`}
      />
      <View style={styles.list}>
        {checklist.map((c) => (
          <View key={c.label} style={styles.item}>
            <NxIcon name={c.done ? 'check' : 'alert'} size={18} color={c.done ? colors.success : colors.warning} />
            <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>
              {c.label}
            </Text>
            <Text style={[type.tiny, { color: c.done ? colors.success : colors.warning }]}>{c.done ? 'Submitted' : 'Missing'}</Text>
          </View>
        ))}
      </View>
    </Shell>
  );
}

export function NoAccountScreen({ phone, onRegister, onSignOut }: { phone: string; onRegister: () => void; onSignOut: () => void }) {
  return (
    <Shell onSignOut={onSignOut}>
      <Hero icon="user" color={colors.muted} title="No driver account found" body={`${phone} is not registered as a NESAM driver partner yet.`} />
      <Button title="Register as a new driver" onPress={onRegister} style={{ marginTop: space.lg }} />
    </Shell>
  );
}

export function LoadErrorScreen({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut: () => void }) {
  return (
    <Screen>
      <Card style={{ marginTop: space.xxl }}>
        <Text style={type.h2}>Couldn’t load your driver profile</Text>
        <Notice message={message} style={{ marginTop: space.md }} />
        <Button title="Try again" onPress={onRetry} />
        <Button title="Sign out" variant="secondary" onPress={onSignOut} style={{ marginTop: space.sm }} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  iconWrap: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: space.md },
  footer: { marginTop: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  list: { marginTop: space.lg, backgroundColor: colors.bg, borderRadius: 12, padding: space.md, gap: space.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
