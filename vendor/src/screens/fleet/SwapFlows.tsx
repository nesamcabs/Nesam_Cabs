// The two ways to bring something that is already on NESAM into this fleet:
//   • Swap vehicle: type the registration number, NESAM shows which vendor holds it, then the driver confirms with a code
//     (components/fleet/VehicleSwap.tsx).
//   • Swap driver: type the driver's mobile number, NESAM shows the driver, and a code goes to that driver.
// Entering the correct code moves the vehicle / driver to this vendor.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { TextField } from '../../components/ui';
import { ExistingVehiclePanel } from '../../components/fleet/ExistingVehicle';
import { Avatar, Badge, Between, Btn, Eyebrow, Feedback, H2, KV, Notice, Panel, Small } from '../../components/kit/core';
import { findDriver, findVehicle, requestDriverLink, type DriverLookup, type LinkRequestResult, type VehicleLookup } from '../../services/partnerLinks';
import { ActionError } from '../../services/callables';
import { isPlate, normalizePlate } from '../../utils/fleet';
import { describeDataError } from '../../utils/retry';
import { CodePanel } from './sheets';

export function SwapVehicle({ onSent }: { onSent: (linkId: string) => void }) {
  const navigation = useNavigation();
  const [reg, setReg] = useState('');
  const [found, setFound] = useState<(VehicleLookup & { key: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const find = async () => {
    if (!isPlate(reg)) { setError('Enter a valid registration number (e.g. TN 01 AB 1234).'); return; }
    setBusy(true); setError(''); setFound(null);
    try { setFound({ ...(await findVehicle(reg)), key: normalizePlate(reg) }); }
    catch (e) { setError(e instanceof ActionError ? e.message : describeDataError(e)); } finally { setBusy(false); }
  };
  const f = found && found.key === normalizePlate(reg) ? found : null;

  return (
    <View style={{ gap: 16 }}>
      <Panel>
        <TextField label="Vehicle registration number" value={reg} autoCapitalize="characters" editable={!busy}
          onChangeText={(t) => { setReg(t.toUpperCase()); setError(''); }} onSubmitEditing={() => void find()} placeholder="TN 01 AB 1234"
          hint="NESAM checks which vendor the vehicle is with." />
        <Btn title="Find vehicle" icon="search" busy={busy} full onPress={() => void find()} />
        {!f ? <Feedback tone="error" message={error} /> : null}
      </Panel>

      {f && !f.found ? (
        <Notice tone="blue" icon="add-circle-outline" title="This vehicle is not on NESAM yet" text="Nothing to swap. Register it as a new vehicle with its documents."
          action={<Btn kind="secondary" small icon="car-outline" title="Register vehicle" onPress={() => navigation.navigate('FleetAdd', { kind: 'vehicle' })} />} />
      ) : null}
      {f?.found ? (
        <ExistingVehiclePanel found={f} reg={reg} onSent={onSent}
          onOpenMine={f.mine && f.vehicleId ? () => navigation.navigate('Vehicle', { id: f.vehicleId! }) : undefined}
          onDifferent={() => { setFound(null); setReg(''); }} />
      ) : null}
    </View>
  );
}

export function SwapDriver({ onSent }: { onSent: (linkId: string) => void }) {
  const navigation = useNavigation();
  const { links } = useVendorData();
  const [mobile, setMobile] = useState('');
  const [found, setFound] = useState<DriverLookup | null>(null);
  const [result, setResult] = useState<LinkRequestResult | null>(null);
  const [busy, setBusy] = useState<'' | 'find' | 'send'>('');
  const [error, setError] = useState('');
  const link = result ? links.find((l) => l.id === result.linkId) : undefined;

  const find = async () => {
    if (!/^[6-9]\d{9}$/.test(mobile)) { setError('Enter the driver’s 10-digit mobile number.'); return; }
    setBusy('find'); setError(''); setFound(null); setResult(null);
    try { setFound(await findDriver(mobile)); }
    catch (e) { setError(e instanceof ActionError ? e.message : describeDataError(e)); } finally { setBusy(''); }
  };
  const send = async () => {
    setBusy('send'); setError('');
    try { const r = await requestDriverLink(mobile, false); setResult(r); onSent(r.linkId); }
    catch (e) { setError(e instanceof Error ? e.message : 'The request could not be sent.'); } finally { setBusy(''); }
  };
  const d = found;
  const blocked = !!d?.found && (d.mine || !d.approved || !!d.pendingLinkId);

  return (
    <View style={{ gap: 16 }}>
      <Panel>
        <TextField label="Driver’s mobile number" prefix="+91" value={mobile} keyboardType="phone-pad" editable={!busy}
          onChangeText={(t) => { const x = t.replace(/\D/g, ''); setMobile(x.length === 12 && x.startsWith('91') ? x.slice(2) : x.slice(0, 10)); setError(''); setFound(null); setResult(null); }}
          onSubmitEditing={() => void find()} placeholder="98765 43210" hint="NESAM checks the number and sends a code to the driver." />
        <Btn title="Find driver" icon="search" busy={busy === 'find'} full onPress={() => void find()} />
        {!d ? <Feedback tone="error" message={error} /> : null}
      </Panel>

      {d && !d.found ? (
        <Notice tone="blue" icon="person-add-outline" title="No NESAM driver uses this number" text="Nothing to swap. Invite the driver to join your fleet instead."
          action={<Btn kind="secondary" small icon="person-add-outline" title="Invite driver" onPress={() => navigation.navigate('FleetAdd', { kind: 'driver' })} />} />
      ) : null}

      {d?.found ? (
        <Panel>
          <Between><Eyebrow>DRIVER FOUND ON NESAM</Eyebrow><Badge label={d.approved ? 'Verified' : 'Not approved'} tone={d.approved ? 'green' : 'amber'} /></Between>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <Avatar name={d.name ?? 'Driver'} size={46} />
            <View style={{ flex: 1, minWidth: 0 }}><H2>{d.name}</H2><Small>{d.phoneMask}</Small></View>
          </View>
          <KV rows={[['Works for', d.mine ? 'Your fleet' : d.fleet || 'Owner-driver'], ['Type', d.kind === 'vendor_driver' ? 'Fleet driver' : 'Owner-driver']]} />
          {d.mine ? <Notice tone="green" title="Already in your fleet" text="This driver already works for your business." style={{ marginTop: 14 }} /> : null}
          {d.pendingLinkId && !d.mine ? <Notice tone="amber" title="Request already open" text="You already have an open request for this driver. It is listed below." style={{ marginTop: 14 }} /> : null}
          {!d.approved && !d.mine ? <Notice tone="amber" title="Driver not approved yet" text="NESAM has not approved this driver, so they cannot be moved yet." style={{ marginTop: 14 }} /> : null}
          {d.onHold && !d.mine ? <Notice tone="amber" title="Driver on hold" text="Only the NESAM office can move this driver." style={{ marginTop: 14 }} /> : null}
          {(d.openDuties ?? 0) > 0 && !d.mine ? <Notice tone="amber" title="Duties to resolve" text={`This driver has ${d.openDuties} booked ${d.openDuties === 1 ? 'duty' : 'duties'} that must be reassigned before they can move.`} style={{ marginTop: 14 }} /> : null}

          {!blocked && !result ? (
            <View style={{ marginTop: 14, gap: 10 }}>
              <Feedback tone="error" message={error} />
              <Btn title={`Send code to ${d.name}`} icon="shield-checkmark" busy={busy === 'send'} full onPress={() => void send()} />
              <Small>{d.name} gets a code by SMS. Enter it here and the driver moves to your fleet.</Small>
            </View>
          ) : null}
          {result ? <View style={{ marginTop: 16 }}>{link ? <CodePanel link={link} testCode={result.testCode} /> : <Notice tone="blue" title="Request sent" text="Loading its status…" />}</View> : null}
        </Panel>
      ) : null}
    </View>
  );
}
