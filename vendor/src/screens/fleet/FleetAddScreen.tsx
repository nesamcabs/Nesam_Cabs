// Add driver / Add vehicle (reference wAddFleet): look up an existing NESAM ID first. An existing ID is linked by a code the
// driver confirms (or by the office); a new driver is invited by mobile number; a new vehicle is registered with documents.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { Page } from '../../components/shell/Page';
import { TextField } from '../../components/ui';
import { VehicleForm } from '../../components/fleet/VehicleForm';
import { Avatar, Badge, Between, Btn, CarImage, Check, Choice, Eyebrow, Feedback, H2, KV, Notice, Panel, Small } from '../../components/kit/core';
import { plate } from '../../components/kit/format';
import { flash } from '../../components/kit/flash';
import { findDriver, findVehicle, requestDriverLink, requestVehicleLink, type DriverLookup, type LinkRequestResult, type VehicleLookup } from '../../services/partnerLinks';
import { inviteDriver, VendorActionError } from '../../services/vendorService';
import { ActionError } from '../../services/callables';
import { isPlate, normalizePlate } from '../../utils/fleet';
import { formatPhone } from '../../utils/format';
import { describeDataError } from '../../utils/retry';
import { goSection } from '../../navigation/navigationRef';
import type { RootStackParamList } from '../../navigation/types';
import { CodePanel } from './sheets';

export function FleetAddScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'FleetAdd'>>();
  const driver = params.kind === 'driver';
  return driver ? <AddDriver /> : <AddVehicle />;
}

function AddDriver() {
  const navigation = useNavigation();
  const { identity, vehicles, links, profile } = useVendorData();
  const [mobile, setMobile] = useState('');
  const [found, setFound] = useState<DriverLookup | null>(null);
  const [vehicle, setVehicle] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [result, setResult] = useState<LinkRequestResult | null>(null);
  const [invited, setInvited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const link = result ? links.find((l) => l.id === result.linkId) : undefined;

  const lookup = async () => {
    if (!/^[6-9]\d{9}$/.test(mobile)) { setError('Enter the driver’s 10-digit mobile number.'); return; }
    setBusy(true); setError(''); setFound(null); setResult(null); setInvited(false);
    try { setFound(await findDriver(mobile)); }
    catch (e) { setError(e instanceof ActionError ? e.message : describeDataError(e)); } finally { setBusy(false); }
  };
  const invite = async () => {
    setBusy(true); setError('');
    try { await inviteDriver(identity, mobile, vehicle); setInvited(true); flash(`Invitation saved for ${formatPhone(mobile)}.`); }
    catch (e) { setError(e instanceof VendorActionError ? e.message : describeDataError(e)); } finally { setBusy(false); }
  };
  const request = async () => {
    if (!authorized) { setError(`Confirm you are authorised to link this driver to ${profile.companyName || 'your business'}.`); return; }
    setBusy(true); setError('');
    try { setResult(await requestDriverLink(mobile, false)); }
    catch (e) { setError(e instanceof Error ? e.message : 'The request could not be sent.'); } finally { setBusy(false); }
  };
  const f = found;
  const blocked = !!f?.found && (f.mine || !f.approved || !!f.pendingLinkId);

  return (
    <Page title="Add driver" subtitle="Search an existing ID before creating a new one." maxWidth={700}>
      <Panel>
        <TextField label="Driver mobile number" prefix="+91" value={mobile} keyboardType="phone-pad" editable={!busy}
          onChangeText={(t) => { const digits = t.replace(/\D/g, ''); setMobile(digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.slice(0, 10)); setError(''); }}
          onSubmitEditing={() => void lookup()} placeholder="98765 43210" />
        <Btn title="Find driver" icon="search" busy={busy && !f} full onPress={() => void lookup()} />
        {!f ? <Feedback tone="error" message={error} /> : null}
      </Panel>

      {f && !f.found && !invited ? (
        <Panel style={{ marginTop: 16 }}>
          <Notice tone="blue" icon="add-circle-outline" title="No existing Driver ID found" text={`Send an invitation. The driver signs up in the NESAM Driver app with +91 ${mobile}; NESAM verifies their licence before duties can be assigned.`} />
          {vehicles.length ? (
            <>
              <Small style={{ marginTop: 16, marginBottom: 8, fontWeight: '600' }}>Pair with a vehicle (optional)</Small>
              <Choice title="No vehicle" selected={!vehicle} onPress={() => setVehicle('')} />
              {vehicles.map((v) => <Choice key={v.id} title={plate(v.vehicleNumber)} sub={[v.model, v.category].filter(Boolean).join(' · ')} selected={vehicle === v.vehicleNumber} onPress={() => setVehicle(v.vehicleNumber)} left={<CarImage category={v.category} model={v.model} width={54} height={34} />} />)}
            </>
          ) : null}
          <Feedback tone="error" message={error} />
          <Btn title="Send invitation" icon="paper-plane-outline" busy={busy} full onPress={() => void invite()} style={{ marginTop: 12 }} />
        </Panel>
      ) : null}

      {invited ? (
        <Panel style={{ marginTop: 16 }}>
          <Notice tone="green" title="Invitation sent" text={`${formatPhone(mobile)} can now sign in to the NESAM Driver app with a mobile OTP. They appear in your fleet once they register.`} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <Btn kind="secondary" icon="people-outline" title="View drivers" onPress={() => goSection('Fleet', { tab: 'Drivers' })} style={{ flex: 1 }} />
            <Btn kind="secondary" icon="add" title="Add another" onPress={() => { setMobile(''); setFound(null); setInvited(false); }} style={{ flex: 1 }} />
          </View>
        </Panel>
      ) : null}

      {f?.found ? (
        <Panel style={{ marginTop: 16 }}>
          <Between><Eyebrow>{f.kind === 'owner_driver' ? 'OWNER DRIVER' : 'VENDOR DRIVER'}</Eyebrow><Badge label={f.mine ? 'Already in your fleet' : 'Existing ID'} tone="green" /></Between>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 }}>
            <Avatar name={f.name ?? ''} size={46} />
            <View style={{ flex: 1 }}><H2>{f.name}</H2><Small>{f.phoneMask}</Small></View>
          </View>
          <KV rows={[['Account role', f.kind === 'owner_driver' ? 'Owner-driver (works for themselves)' : 'Driver of another fleet'], f.kind === 'vendor_driver' ? ['Current fleet', f.mine ? 'Your fleet' : f.fleet || 'Another vendor'] : null, ['NESAM account', f.approved ? 'Approved' : 'Not approved yet']]} />
          {f.mine ? <Btn kind="secondary" icon="open-outline" title="View in fleet" onPress={() => f.driverId ? navigation.navigate('Driver', { id: f.driverId }) : goSection('Fleet', { tab: 'Drivers' })} style={{ marginTop: 14, alignSelf: 'flex-start' }} /> : null}
          {!f.mine && !f.approved ? <Notice tone="amber" title="Not approved yet" text="NESAM has not approved this driver, so they cannot be linked." style={{ marginTop: 14 }} /> : null}
          {f.pendingLinkId ? <Notice tone="amber" title="Request already open" text="You already have an open request for this driver." style={{ marginTop: 14 }} action={<Btn kind="secondary" small title="Open linking requests" onPress={() => navigation.navigate('Linking')} />} /> : null}
          {!blocked && !result ? (
            <>
              {f.onHold ? <Notice tone="amber" title="Driver on hold" text="The office will review the move." style={{ marginTop: 14 }} /> : null}
              {(f.openDuties ?? 0) > 0 ? <Notice tone="amber" title="Duties to resolve" text={`${f.name} has ${f.openDuties} booked ${f.openDuties === 1 ? 'duty' : 'duties'} that must be reassigned before the move finishes. The old attachment stays active until then.`} style={{ marginTop: 14 }} /> : null}
              <Notice tone="blue" icon="chatbubble-ellipses-outline" title="Verification by OTP" style={{ marginTop: 14 }}
                text={f.kind === 'owner_driver' ? `${f.name} will stop taking duties directly and work for your fleet. We send a code to their phone; they read it to you, and the office confirms the role change.` : `We send a code to ${f.name}’s phone. Once they read it to you and you enter it, they move to your fleet. Earlier trips and payouts stay with their previous fleet.`} />
              <Check checked={authorized} onChange={setAuthorized} label={`I am authorised to link this driver to ${profile.companyName || 'my business'}. Verification keeps the same ID and previous records.`} />
              <Feedback tone="error" message={error} />
              <Btn title="Send code to driver" icon="shield-checkmark" busy={busy} full onPress={() => void request()} style={{ marginTop: 8 }} />
            </>
          ) : null}
          {result ? (
            <View style={{ marginTop: 16 }}>
              {link ? <CodePanel link={link} testCode={result.testCode} /> : <Notice tone="blue" title="Request sent" text="Loading its status…" />}
            </View>
          ) : null}
        </Panel>
      ) : null}
    </Page>
  );
}

function AddVehicle() {
  const navigation = useNavigation();
  const { vehicles, links, profile } = useVendorData();
  const [reg, setReg] = useState('');
  const [found, setFound] = useState<VehicleLookup | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [result, setResult] = useState<LinkRequestResult | null>(null);
  const [register, setRegister] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = normalizePlate(reg);
  const link = result ? links.find((l) => l.id === result.linkId) : undefined;

  const lookup = async () => {
    if (!isPlate(reg)) { setError('Enter the registration as printed on the plate, e.g. TN 60 AB 1234.'); return; }
    const mine = vehicles.find((v) => normalizePlate(v.vehicleNumber) === key);
    if (mine) { setError(''); navigation.navigate('Vehicle', { id: mine.id }); return; }
    setBusy(true); setError(''); setFound(null); setResult(null);
    try { setFound(await findVehicle(reg)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not check that number.'); } finally { setBusy(false); }
  };
  const request = async (office: boolean) => {
    if (!authorized) { setError(`Confirm you are authorised to link this vehicle to ${profile.companyName || 'your business'}.`); return; }
    setBusy(true); setError('');
    try { setResult(await requestVehicleLink(reg, office)); } catch (e) { setError(e instanceof Error ? e.message : 'The request could not be sent.'); } finally { setBusy(false); }
  };
  const f = found;
  const blocked = !!f?.found && (f.mine || !!f.pendingLinkId);

  return (
    <Page title="Add vehicle" subtitle="Registration stays linked to one permanent Car ID." maxWidth={700}>
      <Panel>
        <TextField label="Vehicle registration number" value={reg} autoCapitalize="characters" placeholder="TN 60 AB 1234" editable={!busy}
          onChangeText={(t) => { setReg(t.toUpperCase().slice(0, 14)); setError(''); }} onSubmitEditing={() => void lookup()} />
        <Btn title="Find vehicle" icon="search" busy={busy && !f} full onPress={() => void lookup()} />
        {!f ? <Feedback tone="error" message={error} /> : null}
      </Panel>

      {f && !f.found ? (
        <Panel style={{ marginTop: 16 }}>
          <Notice tone="blue" icon="add-circle-outline" title="No existing Car ID found" text="Register this vehicle with its RC, insurance, permit and fitness documents. The office reviews them before it can be assigned." />
          <Btn title="Register new vehicle" icon="car-sport-outline" full onPress={() => setRegister(key)} style={{ marginTop: 14 }} />
        </Panel>
      ) : null}

      {f?.found ? (
        <Panel style={{ marginTop: 16 }}>
          <Between><Eyebrow>EXISTING CAR ID</Eyebrow><Badge label={f.verified ? 'Verified' : 'Not verified'} tone={f.verified ? 'green' : 'amber'} /></Between>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <View style={{ flex: 1 }}><H2>{plate(f.plate ?? reg)}</H2><Small>{[f.model, f.category].filter(Boolean).join(' · ') || 'Already on NESAM'}</Small></View>
            <CarImage category={f.category ?? ''} model={f.model} width={110} height={68} />
          </View>
          <KV rows={[['Currently with', f.mine ? 'Your fleet' : f.owner || 'Another owner'], ['Last-trip driver', f.otpReceiver ? `${f.otpReceiver.name} (${f.otpReceiver.phoneMask})` : 'No recent trip']]} />
          {f.pendingLinkId ? <Notice tone="amber" title="Request already open" text="You already have an open request for this vehicle." style={{ marginTop: 14 }} action={<Btn kind="secondary" small title="Open linking requests" onPress={() => navigation.navigate('Linking')} />} /> : null}
          {!blocked && !result ? (
            <>
              {f.onHold ? <Notice tone="amber" title="Vehicle on hold" text="Only the NESAM office can move it." style={{ marginTop: 14 }} /> : null}
              {(f.openDuties ?? 0) > 0 ? <Notice tone="amber" title="Duties to resolve" text={`It has ${f.openDuties} booked ${f.openDuties === 1 ? 'duty' : 'duties'} that must be reassigned before it can move.`} style={{ marginTop: 14 }} /> : null}
              <Notice tone="blue" icon="chatbubble-ellipses-outline" style={{ marginTop: 14 }}
                title={f.otpReceiver ? 'Verification by the last-trip driver' : 'Office verification'}
                text={f.otpReceiver ? `We send a code to ${f.otpReceiver.name} (${f.otpReceiver.phoneMask}), who drove this car last. They read it to you and you enter it. Verified documents stay valid.` : 'No driver has completed a trip in this car recently. The NESAM office will verify the change with you.'} />
              <Check checked={authorized} onChange={setAuthorized} label={`I am authorised to link this vehicle to ${profile.companyName || 'my business'}. Verification keeps the same Car ID and previous records.`} />
              <Feedback tone="error" message={error} />
              {f.otpReceiver
                ? <Btn title={`Send code to ${f.otpReceiver.name}`} icon="shield-checkmark" busy={busy} full onPress={() => void request(false)} style={{ marginTop: 8 }} />
                : <Btn title="Request office verification" icon="headset-outline" busy={busy} full onPress={() => void request(true)} style={{ marginTop: 8 }} />}
            </>
          ) : null}
          {result ? <View style={{ marginTop: 16 }}>{link ? <CodePanel link={link} testCode={result.testCode} /> : <Notice tone="blue" title="Request sent" text="Loading its status…" />}</View> : null}
        </Panel>
      ) : null}

      {register !== null ? (
        <VehicleForm existing={null} initialPlate={register} onClose={() => setRegister(null)}
          onSaved={(m) => { setRegister(null); flash(m); goSection('Fleet', { tab: 'Vehicles' }); }} />
      ) : null}
    </Page>
  );
}
