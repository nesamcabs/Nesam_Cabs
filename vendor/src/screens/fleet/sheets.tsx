// Fleet dialogs: vehicle availability, document renewal, pairing a driver with a vehicle, and the linking-code panel.
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useVendorData } from '../../context/VendorData';
import { Sheet, TextField } from '../../components/ui';
import { DateField, SingleDocField, displayDate } from '../../components/fields';
import { Avatar, Btn, CarImage, Choice, Feedback, Notice, Small } from '../../components/kit/core';
import { plate } from '../../components/kit/format';
import { flash } from '../../components/kit/flash';
import { setVehicleAvailability, submitVehicleRenewal } from '../../services/partnerOps';
import { assignVehicle, VendorActionError } from '../../services/vendorService';
import { askOfficeForHelp, cancelLink, resendLinkCode, verifyLinkCode, type LinkStatus, type PartnerLink } from '../../services/partnerLinks';
import type { FleetDriver, FleetVehicle } from '../../types/operations';
import { describeDataError } from '../../utils/retry';
import { colors, fontFamily } from '../../theme';

/** When (and where) the vehicle is free for new duties — the record the office and the vendor website read. */
export function AvailabilitySheet({ vehicle, onClose }: { vehicle: FleetVehicle; onClose: () => void }) {
  const [at, setAt] = useState(() => new Date());
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pick = (mode: 'date' | 'time') =>
    DateTimePickerAndroid.open({
      value: at, mode, is24Hour: false, minimumDate: mode === 'date' ? new Date() : undefined,
      onChange: (event, d) => {
        if (event.type !== 'set' || !d) return;
        const next = new Date(at);
        if (mode === 'date') next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
        else next.setHours(d.getHours(), d.getMinutes(), 0, 0);
        setAt(next);
      },
    });
  const save = async () => {
    setBusy(true); setError('');
    try {
      await setVehicleAvailability(vehicle.id, at, location);
      flash(`${plate(vehicle.vehicleNumber)} is available from ${at.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.`);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Availability was not saved.'); } finally { setBusy(false); }
  };
  return (
    <Sheet visible onClose={onClose} title="Update availability" dismissible={!busy}>
      <Small style={{ marginBottom: 14 }}>Tell the office when {plate(vehicle.vehicleNumber)} is free for new duties, and where it will be.</Small>
      <View style={styles.row}>
        <Pressable onPress={() => pick('date')} style={styles.pick} accessibilityRole="button" accessibilityLabel="Available from date">
          <Ionicons name="calendar-outline" size={18} color={colors.muted} />
          <Text style={styles.pickText}>{at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
        </Pressable>
        <Pressable onPress={() => pick('time')} style={styles.pick} accessibilityRole="button" accessibilityLabel="Available from time">
          <Ionicons name="time-outline" size={18} color={colors.muted} />
          <Text style={styles.pickText}>{at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</Text>
        </Pressable>
      </View>
      <TextField label="Vehicle location (optional)" value={location} onChangeText={setLocation} placeholder="e.g. Theni bus stand" maxLength={120} />
      <Feedback tone="error" message={error} />
      <Btn title="Update availability" icon="checkmark" busy={busy} full onPress={() => void save()} />
    </Sheet>
  );
}

const RENEWABLE: { key: 'rc' | 'insurance' | 'fitness' | 'permit' | 'puc'; label: string }[] = [
  { key: 'insurance', label: 'Insurance' }, { key: 'permit', label: 'Permit' }, { key: 'fitness', label: 'Fitness (FC)' }, { key: 'rc', label: 'RC' }, { key: 'puc', label: 'PUC' },
];

/** A renewed document for office approval; the vehicle stays in service on its current documents until approved. */
export function RenewSheet({ vehicle, onClose }: { vehicle: FleetVehicle; onClose: () => void }) {
  const { requests } = useVendorData();
  const [docKey, setDocKey] = useState<(typeof RENEWABLE)[number]['key']>('insurance');
  const [fileUrl, setFileUrl] = useState('');
  const [expiry, setExpiry] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tomorrow] = useState(() => new Date(Date.now() + 86400000));
  const pending = requests.filter((r) => r.type === 'document_renewal' && r.status === 'Pending' && r.entityName === vehicle.vehicleNumber);
  const save = async () => {
    if (!fileUrl) { setError('Upload the renewed document first.'); return; }
    if (!expiry) { setError('Choose the new expiry date.'); return; }
    setBusy(true); setError('');
    try {
      await submitVehicleRenewal(vehicle.id, docKey, expiry, fileUrl);
      flash(`${RENEWABLE.find((d) => d.key === docKey)?.label} renewal sent for ${plate(vehicle.vehicleNumber)}. The office reviews it.`);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'The renewal was not sent.'); } finally { setBusy(false); }
  };
  return (
    <Sheet visible onClose={onClose} title="Renew a document" dismissible={!busy && !uploading}>
      <Notice tone="amber" icon="document-text-outline" title="Renewal restores only this vehicle" text="Upload the renewed document. The office approves it before the new expiry applies." style={{ marginBottom: 14 }} />
      {pending.map((r) => <Notice key={r.id} tone="blue" title={`${r.documentLabel} renewal under review`} text={`New expiry ${displayDate(r.expiry)}`} style={{ marginBottom: 10 }} />)}
      <Small style={{ marginBottom: 8, fontWeight: '600' }}>Document</Small>
      <View style={styles.chips}>
        {RENEWABLE.map((d) => {
          const on = docKey === d.key;
          return (
            <Pressable key={d.key} onPress={() => { setDocKey(d.key); setFileUrl(''); }} accessibilityRole="radio" accessibilityState={{ selected: on }} style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && { color: colors.primary, fontWeight: '600' }]}>{d.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <SingleDocField label="Renewed document" vehicleId={vehicle.id} kind={`renewal-${docKey}`} value={fileUrl} onChange={setFileUrl} required onBusyChange={setUploading} />
      <DateField label="New expiry date" value={expiry} onChange={setExpiry} minimumDate={tomorrow} required />
      <Feedback tone="error" message={error} />
      <Btn title={uploading ? 'Uploading…' : 'Send for approval'} icon="send-outline" busy={busy} disabled={uploading} full onPress={() => void save()} />
    </Sheet>
  );
}

/** Pair a driver with a vehicle (their default car for dispatch). Choosing a car paired with someone else moves it. */
export function PairSheet({ driver, vehicle, onClose }: { driver?: FleetDriver; vehicle?: FleetVehicle; onClose: () => void }) {
  const { drivers, vehicles } = useVendorData();
  const [driverId, setDriverId] = useState(driver?.id ?? vehicle?.assignedDriverId ?? '');
  const [vehicleId, setVehicleId] = useState(vehicle?.id ?? driver?.assignedVehicleId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const forDriver = !!driver;
  const usableDrivers = drivers.filter((x) => x.approvalStatus === 'Approved' && x.fleetStatus !== 'Suspended');
  const usableVehicles = vehicles.filter((v) => v.docStatus === 'Approved' && v.status !== 'Inactive');
  const unchanged = forDriver ? vehicleId === driver!.assignedVehicleId : driverId === vehicle!.assignedDriverId;

  const save = async () => {
    setBusy(true); setError('');
    try {
      if (forDriver) {
        const v = vehicles.find((x) => x.id === vehicleId) ?? null;
        await assignVehicle(driver!, v, vehicles);
        flash(v ? `${plate(v.vehicleNumber)} paired with ${driver!.name}.` : `Vehicle unpaired from ${driver!.name}.`);
      } else {
        const target = drivers.find((x) => x.id === driverId);
        if (target) await assignVehicle(target, vehicle!, vehicles);
        else { const current = drivers.find((x) => x.id === vehicle!.assignedDriverId); if (current) await assignVehicle(current, null, vehicles); }
        flash(target ? `${target.name} paired with ${plate(vehicle!.vehicleNumber)}.` : `${plate(vehicle!.vehicleNumber)} unpaired.`);
      }
      onClose();
    } catch (e) { setError(e instanceof VendorActionError ? e.message : describeDataError(e)); } finally { setBusy(false); }
  };

  return (
    <Sheet visible onClose={onClose} title={forDriver ? `Pair vehicle · ${driver!.name}` : `Pair driver · ${plate(vehicle!.vehicleNumber)}`} dismissible={!busy}>
      <Small style={{ marginBottom: 14 }}>The paired vehicle is suggested first when you assign this driver. You can still choose another approved vehicle per duty.</Small>
      {forDriver ? (
        <>
          <Choice title="No paired vehicle" selected={!vehicleId} onPress={() => setVehicleId('')} />
          {usableVehicles.length === 0 ? <Notice tone="blue" title="No approved vehicles yet" text="Vehicles become pairable once NESAM approves their documents." /> : null}
          {usableVehicles.map((v) => (
            <Choice key={v.id} title={plate(v.vehicleNumber)} selected={vehicleId === v.id} onPress={() => setVehicleId(v.id)}
              sub={[v.model, v.category, v.assignedDriverId && v.assignedDriverId !== driver!.id ? `Now with ${v.assignedDriverName}` : ''].filter(Boolean).join(' · ')}
              left={<CarImage category={v.category} model={v.model} width={54} height={34} />} />
          ))}
        </>
      ) : (
        <>
          <Choice title="No paired driver" selected={!driverId} onPress={() => setDriverId('')} />
          {usableDrivers.length === 0 ? <Notice tone="blue" title="No approved drivers yet" text="Add a driver from Fleet → Drivers." /> : null}
          {usableDrivers.map((x) => (
            <Choice key={x.id} title={x.name} selected={driverId === x.id} onPress={() => setDriverId(x.id)} sub={x.assignedVehicleNumber ? `Now paired with ${plate(x.assignedVehicleNumber)}` : x.phone} left={<Avatar name={x.name} size={36} />} />
          ))}
        </>
      )}
      <Feedback tone="error" message={error} />
      <Btn title="Save pairing" icon="checkmark" busy={busy} disabled={unchanged} full onPress={() => void save()} style={{ marginTop: 10 }} />
    </Sheet>
  );
}

// ── Linking requests ───────────────────────────────────────────────────────

export const linkTone: Record<LinkStatus, 'blue' | 'amber' | 'green' | 'red' | 'neutral'> = {
  'Awaiting OTP': 'blue', 'Office review': 'amber', Completed: 'green', Rejected: 'red', Cancelled: 'neutral',
};
export const linkText: Record<LinkStatus, string> = {
  'Awaiting OTP': 'Waiting for the code', 'Office review': 'With the NESAM office', Completed: 'Linked', Rejected: 'Declined', Cancelled: 'Cancelled',
};
export const fromLabel = (l: PartnerLink): string => l.fromVendorName || (l.fromType === 'owner_driver' ? 'Owner-driver' : l.fromType === 'unattached' ? 'Not attached' : '—');
const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** Enter the code the driver reads out, ask for a new one, or hand the request to the office. */
export function CodePanel({ link, testCode }: { link: PartnerLink; testCode?: string }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'' | 'verify' | 'resend' | 'help' | 'cancel'>('');
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
  const run = async (kind: 'verify' | 'resend' | 'help' | 'cancel', fn: () => Promise<void>) => {
    setBusy(kind); setError('');
    try { await fn(); } catch (e) { setError(errMsg(e, 'That did not go through. Please try again.')); } finally { setBusy(''); }
  };
  const verify = () => run('verify', async () => { const r = await verifyLinkCode(link.id, code); flash(r.message || 'Verified.'); setCode(''); });
  const resend = () => run('resend', async () => {
    const r = await resendLinkCode(link.id);
    setShownCode(r.testCode); setCool(60);
    flash(r.delivered ? 'A new code was sent.' : 'The code could not be delivered. Ask the office to help.', r.delivered ? 'ok' : 'error');
  });
  const help = () => run('help', async () => { await askOfficeForHelp(link.id, 'Could not get the code'); flash('The NESAM office will help you finish this.'); });
  const cancel = () => Alert.alert('Cancel this request?', 'Any code already sent stops working.', [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Yes, cancel', style: 'destructive', onPress: () => void run('cancel', async () => { await cancelLink(link.id); flash('Request cancelled.'); }) },
  ]);

  if (link.status === 'Completed') return <Notice tone="green" title="Linked successfully" text={`${link.subjectLabel} is now part of your fleet. The permanent ID and previous records are unchanged.`} />;
  if (link.status === 'Rejected') return <Notice tone="red" title="Request declined" text={link.rejectedReason || 'Contact the office for the next step.'} />;
  if (link.status === 'Cancelled') return <Notice tone="neutral" title="This request was cancelled" />;

  const entry = (
    <View style={{ marginTop: 12 }}>
      <TextField label="6-digit verification code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" maxLength={6} textContentType="oneTimeCode" placeholder="••••••" />
      {shownCode ? <Small style={{ marginTop: -6, marginBottom: 8 }}>Local test only — code {shownCode}</Small> : null}
      <Btn title="Verify & link" icon="shield-checkmark" busy={busy === 'verify'} disabled={code.length !== 6} full onPress={() => void verify()} />
    </View>
  );

  return (
    <View>
      {link.status === 'Office review' ? (
        <Notice tone="amber" title="Office verification pending" text={`${link.blockedReason || 'The NESAM office is checking this request.'} You will get a notification when it is decided.`} />
      ) : (
        <Notice tone="blue" icon="chatbubble-ellipses-outline" title={link.codeDelivered ? `Code sent to ${who}${link.receiverPhoneMask ? ` (${link.receiverPhoneMask})` : ''}` : `The code could not be delivered to ${who}`}
          text={link.codeDelivered ? `Ask ${driverKind ? 'them' : 'the driver'} to read the 6-digit code to you and enter it below. It works for 5 minutes.` : 'Send it again, or ask the NESAM office to help.'} />
      )}
      {link.status === 'Awaiting OTP' || (!link.consent && !link.otpVerified && link.hasReceiver) ? entry : null}
      <View style={styles.linkActions}>
        {link.status === 'Awaiting OTP' ? <Btn kind="secondary" small icon="refresh" title={cool > 0 ? `Send again in ${cool}s` : 'Resend code'} busy={busy === 'resend'} disabled={cool > 0 || !!busy} onPress={() => void resend()} /> : null}
        {!link.officeHelp ? <Btn kind="secondary" small icon="headset-outline" title="Office assistance" busy={busy === 'help'} disabled={!!busy} onPress={() => void help()} /> : null}
        <Btn kind="text" title="Cancel request" disabled={!!busy} onPress={cancel} />
      </View>
      <Feedback tone="error" message={error} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  pick: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: '#D9E2ED', borderRadius: 10, backgroundColor: colors.white },
  pickText: { fontFamily, fontSize: 14, color: colors.ink },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  chipOn: { borderColor: colors.primaryBorder, backgroundColor: colors.primarySoft },
  chipText: { fontFamily, fontSize: 13, color: colors.text },
  linkActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 12 },
});
