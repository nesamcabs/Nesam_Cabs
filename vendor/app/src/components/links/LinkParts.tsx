// The pieces of a driver / vehicle linking request: the one-time-code panel and the request card.
import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { askOfficeForHelp, cancelLink, resendLinkCode, verifyLinkCode, type LinkStatus, type PartnerLink } from '../../services/partnerLinks';
import { Avatar, Badge, Button, Card, Notice, Row, TextField } from '../ui';
import { formatDateTime12 } from '../../utils/time';
import { space, type } from '../../theme';

export type Say = (text: string, tone?: 'success' | 'error') => void;

export const statusTone: Record<LinkStatus, 'info' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  'Awaiting OTP': 'info',
  'Office review': 'warning',
  Completed: 'success',
  Rejected: 'danger',
  Cancelled: 'neutral',
};

export const statusText: Record<LinkStatus, string> = {
  'Awaiting OTP': 'Waiting for the code',
  'Office review': 'With the NESAM office',
  Completed: 'Done',
  Rejected: 'Declined',
  Cancelled: 'Cancelled',
};

export const fromLabel = (l: PartnerLink): string => l.fromVendorName || (l.fromType === 'owner_driver' ? 'Owner-driver' : l.fromType === 'unattached' ? 'Not attached' : '—');

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * Enter the code the driver read out, ask for a new one, or hand the request to the office.
 * Used inside the Add sheets and on the Requests screen, so a vendor can always pick up where they left off.
 */
export function CodePanel({ link, testCode, say }: { link: PartnerLink; /** Only the local emulator ever supplies this. */ testCode?: string; say: Say }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'' | 'verify' | 'resend' | 'help'>('');
  const [error, setError] = useState('');
  const [shownCode, setShownCode] = useState(testCode);
  const [cool, setCool] = useState(0);

  useEffect(() => {
    if (cool <= 0) return undefined;
    const t = setTimeout(() => setCool((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cool]);

  const driverKind = link.kind === 'driver';
  const who = driverKind ? link.subjectLabel.split(' ')[0] || 'the driver' : link.receiverName || 'the last-trip driver';

  const verify = async () => {
    if (code.length !== 6 || busy) return;
    setBusy('verify');
    setError('');
    try {
      const r = await verifyLinkCode(link.id, code);
      say(r.message);
      setCode('');
    } catch (e) {
      setError(errMsg(e, 'That code did not work.'));
    } finally {
      setBusy('');
    }
  };
  const resend = async () => {
    setBusy('resend');
    setError('');
    try {
      const r = await resendLinkCode(link.id);
      setShownCode(r.testCode);
      setCool(60);
      say(r.delivered ? 'A new code was sent.' : 'The code could not be delivered. Ask the office to help.', r.delivered ? 'success' : 'error');
    } catch (e) {
      setError(errMsg(e, 'Could not send a new code.'));
    } finally {
      setBusy('');
    }
  };
  const help = async () => {
    setBusy('help');
    setError('');
    try {
      await askOfficeForHelp(link.id, 'Could not get the code');
      say('The NESAM office will help you finish this.');
    } catch (e) {
      setError(errMsg(e, 'Could not reach the office.'));
    } finally {
      setBusy('');
    }
  };

  if (link.status === 'Completed') return <Notice tone="success" message={`Done. ${link.subjectLabel} is now part of your fleet.`} />;
  if (link.status === 'Rejected') return <Notice tone="error" message={`Declined by the NESAM office${link.rejectedReason ? `: ${link.rejectedReason}` : '.'}`} />;
  if (link.status === 'Cancelled') return <Notice tone="info" message="This request was cancelled." />;

  const entry = (
    <View>
      <TextField label="6-digit code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} textContentType="oneTimeCode" placeholder="••••••" error={error} style={{ marginBottom: space.sm }} />
      {shownCode ? <Text style={[type.tiny, { marginBottom: space.sm }]}>Local test only — code {shownCode}</Text> : null}
      <Button title="Verify & add to my fleet" loading={busy === 'verify'} disabled={code.length !== 6} onPress={() => void verify()} />
    </View>
  );

  if (link.status === 'Office review') {
    return (
      <View>
        <Notice tone="warning" message={`${link.blockedReason || 'The NESAM office is checking this request.'} You will get a notification as soon as it is decided.`} />
        {!link.consent && !link.otpVerified && link.hasReceiver ? (
          <>
            <Text style={[type.small, { marginBottom: space.sm }]}>If {who} has the code, you can still enter it here.</Text>
            {entry}
          </>
        ) : null}
      </View>
    );
  }

  return (
    <View>
      <Notice
        tone="info"
        message={
          link.codeDelivered
            ? `A 6-digit code was sent to ${who}${link.receiverPhoneMask ? ` (${link.receiverPhoneMask})` : ''}. Ask ${driverKind ? 'them' : 'the driver'} to read it out, and enter it below. It works for 5 minutes.`
            : `The code could not be delivered to ${who}${link.receiverPhoneMask ? ` (${link.receiverPhoneMask})` : ''}. Try sending it again, or ask the NESAM office to help.`
        }
      />
      {entry}
      <View style={styles.links}>
        <Button small variant="ghost" title={cool > 0 ? `Send again in ${cool}s` : 'Send a new code'} loading={busy === 'resend'} disabled={cool > 0 || !!busy} onPress={() => void resend()} />
        <Button small variant="ghost" title="Code not coming — ask the office" loading={busy === 'help'} disabled={!!busy} onPress={() => void help()} />
      </View>
    </View>
  );
}

/** One request as a card: what moves, from where to where, and where it stands. */
export function LinkCard({ link, mine, say }: { link: PartnerLink; mine: boolean; say: Say }) {
  const [open, setOpen] = useState(link.status === 'Awaiting OTP');
  const [busy, setBusy] = useState(false);
  const outgoing = !mine;
  const isOpen = link.status === 'Awaiting OTP' || link.status === 'Office review';

  const cancel = () =>
    Alert.alert('Cancel this request?', 'Any code already sent stops working.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Yes, cancel',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          cancelLink(link.id)
            .then(() => say('Request cancelled.'))
            .catch((e: unknown) => say(errMsg(e, 'Could not cancel.'), 'error'))
            .finally(() => setBusy(false));
        },
      },
    ]);

  return (
    <Card>
      <View style={styles.head}>
        <Avatar name={link.subjectLabel} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={type.h3}>{link.subjectLabel}</Text>
          <Text style={type.small}>{link.kind === 'driver' ? (link.subjectKind === 'owner_driver' ? 'Owner-driver joins a fleet' : 'Driver changes fleet') : 'Vehicle attachment'}</Text>
        </View>
        <Badge label={statusText[link.status]} tone={statusTone[link.status]} />
      </View>
      <View style={{ marginTop: space.sm }}>
        <Row label="From" value={fromLabel(link)} />
        <Row label="To" value={link.toVendorName} />
        <Row label="Asked" value={link.createdAt ? formatDateTime12(link.createdAt) : '—'} />
        {link.method ? <Row label="Finished by" value={link.method} /> : null}
      </View>
      {outgoing && link.status !== 'Completed' ? <Notice tone="warning" message={`${link.toVendorName} asked to take this from your fleet. The office will check with you if anything is open.`} /> : null}
      {outgoing && link.status === 'Completed' ? <Notice tone="info" message={`This ${link.kind} has moved to ${link.toVendorName}.`} /> : null}
      {mine && isOpen ? (
        <>
          <View style={styles.actions}>
            <Button small variant={open ? 'secondary' : 'primary'} title={open ? 'Hide' : link.status === 'Awaiting OTP' ? 'Enter code' : 'See details'} onPress={() => setOpen((o) => !o)} style={{ flex: 1 }} />
            <Button small variant="ghost" title="Cancel request" loading={busy} onPress={cancel} />
          </View>
          {open ? <View style={{ marginTop: space.md }}><CodePanel link={link} say={say} /></View> : null}
        </>
      ) : null}
      {mine && (link.status === 'Completed' || link.status === 'Rejected') ? <View style={{ marginTop: space.sm }}><CodePanel link={link} say={say} /></View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.sm },
});

