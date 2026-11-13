// A mobile number that already has a NESAM Driver ID. A driver keeps one permanent ID, so instead of creating another the partner
// sees who is on record and can send a swap request: the driver confirms with a code sent to their phone, which moves them into
// this fleet with the same ID and records. Used inline in the Add driver form as soon as the number is entered.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { Avatar, Badge, Between, Btn, Check, Eyebrow, Feedback, H2, KV, Notice, Panel, Small } from '../kit/core';
import { requestDriverLink, type DriverLookup, type LinkRequestResult } from '../../services/partnerLinks';
import { CodePanel } from '../../screens/fleet/sheets';
import { goSection } from '../../navigation/navigationRef';

export function ExistingDriverPanel({
  found: f,
  mobile,
  onClose,
  onDifferent,
}: {
  found: DriverLookup;
  mobile: string;
  /** Close the form (before opening the driver or the linking requests). */
  onClose: () => void;
  /** Start over with another mobile number. */
  onDifferent?: () => void;
}) {
  const navigation = useNavigation();
  const { links, profile } = useVendorData();
  const [authorized, setAuthorized] = useState(false);
  const [result, setResult] = useState<LinkRequestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const link = result ? links.find((l) => l.id === result.linkId) : undefined;
  const blocked = !!f.mine || !f.approved || !!f.pendingLinkId;
  const name = profile.companyName || 'my business';

  const send = async () => {
    if (!authorized) { setError(`Confirm you are authorised to move this driver to ${name}.`); return; }
    setBusy(true); setError('');
    try { setResult(await requestDriverLink(mobile, false)); }
    catch (e) { setError(e instanceof Error ? e.message : 'The request could not be sent.'); }
    finally { setBusy(false); }
  };

  return (
    <Panel>
      <Between><Eyebrow>ALREADY ON NESAM</Eyebrow><Badge label={f.mine ? 'In your fleet' : f.approved ? 'Verified' : 'Not approved yet'} tone={f.mine || f.approved ? 'green' : 'amber'} /></Between>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <Avatar name={f.name ?? ''} size={46} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <H2>{f.name}</H2>
          <Small>{f.phoneMask}</Small>
        </View>
      </View>
      <KV rows={[
        ['Account role', f.kind === 'owner_driver' ? 'Owner-driver (works for themselves)' : 'Driver of a fleet'],
        f.kind === 'vendor_driver' ? ['Current fleet', f.mine ? 'Your fleet' : f.fleet || 'Another vendor'] : null,
        ['NESAM account', f.approved ? 'Approved' : 'Not approved yet'],
      ]} />

      {f.mine ? (
        <Notice tone="green" title="Already in your fleet" text="This driver is registered under your business." style={{ marginTop: 14 }}
          action={<Btn kind="secondary" small title="Open driver" onPress={() => { onClose(); if (f.driverId) navigation.navigate('Driver', { id: f.driverId }); else goSection('Fleet', { tab: 'Drivers' }); }} />} />
      ) : (
        <Notice tone="blue" icon="swap-horizontal-outline" style={{ marginTop: 14 }} title="One driver, one Driver ID"
          text="A driver keeps a single permanent ID, so they cannot be created twice. Send a swap request to move them to your fleet; their ID and records stay the same." />
      )}
      {!f.mine && !f.approved ? <Notice tone="amber" title="Not approved yet" text="NESAM has not approved this driver, so they cannot be linked." style={{ marginTop: 12 }} /> : null}
      {f.pendingLinkId && !f.mine ? (
        <Notice tone="amber" title="Request already open" text="You already have an open request for this driver." style={{ marginTop: 12 }}
          action={<Btn kind="secondary" small title="Open linking requests" onPress={() => { onClose(); goSection('Fleet', { tab: 'Drivers', swap: Date.now() }); }} />} />
      ) : null}

      {!blocked && !result ? (
        <>
          {f.onHold ? <Notice tone="amber" title="Driver on hold" text="The office will review the move." style={{ marginTop: 12 }} /> : null}
          {(f.openDuties ?? 0) > 0 ? <Notice tone="amber" title="Duties to resolve" text={`${f.name} has ${f.openDuties} booked ${f.openDuties === 1 ? 'duty' : 'duties'} that must be reassigned before the move finishes. The old attachment stays active until then.`} style={{ marginTop: 12 }} /> : null}
          <Notice tone="neutral" icon="chatbubble-ellipses-outline" style={{ marginTop: 12 }} title="Confirmed by the driver"
            text={f.kind === 'owner_driver'
              ? `${f.name} will stop taking duties directly and work for your fleet. We send a code to their phone; they read it to you, and the office confirms the role change.`
              : `We send a code to ${f.name}’s phone. They read it to you and you enter it. Earlier trips and payouts stay with their previous fleet.`} />
          <Check checked={authorized} onChange={(v) => { setAuthorized(v); setError(''); }} label={`I am authorised to move this driver to ${name}.`} />
          <Feedback tone="error" message={error} />
          <Btn title="Send swap request" icon="swap-horizontal-outline" busy={busy} full onPress={() => void send()} style={{ marginTop: 8 }} />
        </>
      ) : null}

      {result ? <View style={{ marginTop: 16 }}>{link ? <CodePanel link={link} testCode={result.testCode} /> : <Notice tone="blue" title="Request sent" text="Loading its status…" />}</View> : null}
      {onDifferent ? <Btn kind="secondary" icon="call-outline" title="Use a different mobile number" full onPress={onDifferent} style={{ marginTop: 14 }} /> : null}
    </Panel>
  );
}
