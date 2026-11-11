// Drivers of this fleet. Adding a driver starts with their mobile number: a driver who is new to NESAM is invited (driver_invites,
// never pre-approved); one who already drives on NESAM — an owner-driver or another vendor's driver — is linked by a request the
// driver confirms with a code sent to their own phone (see components/links).
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useVendorData } from '../context/VendorData';
import { Avatar, Badge, Button, Card, Chip, EmptyState, Notice, PillTabs, Row, Screen, Sheet, TextField } from '../components/ui';
import { CodePanel } from '../components/links/LinkParts';
import { assignVehicle, inviteDriver, revokeInvite, setDriverFleetStatus, VendorActionError } from '../services/vendorService';
import { findDriver, requestDriverLink, type DriverLookup, type LinkRequestResult } from '../services/partnerLinks';
import { ActionError } from '../services/callables';
import type { FleetDriver } from '../types/operations';
import type { TabParamList } from '../navigation/types';
import { displayDate } from '../components/fields';
import { formatPhone } from '../utils/format';
import { daysUntil } from '../utils/wallet';
import { describeDataError } from '../utils/retry';
import { colors, radius, space, type } from '../theme';

export function DriversScreen() {
  const route = useRoute<RouteProp<TabParamList, 'Fleet'>>();
  const { drivers, invites, vehicles } = useVendorData();
  const [tab, setTab] = useState<'fleet' | 'invites'>('fleet');
  const [assignFor, setAssignFor] = useState<FleetDriver | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  // "Add driver" from another screen arrives as a route param.
  // "Add …" from another screen arrives as a fresh timestamp param; open the sheet once per value.
  const addRequest = route.params?.add;
  const [seenAdd, setSeenAdd] = useState(addRequest);
  if (addRequest !== seenAdd) {
    setSeenAdd(addRequest);
    if (addRequest) setAdding(true);
  }

  const toggleFleetStatus = (d: FleetDriver) => {
    const next = d.fleetStatus === 'Suspended' ? 'Active' : 'Suspended';
    Alert.alert(
      next === 'Suspended' ? `Suspend ${d.name}?` : `Reactivate ${d.name}?`,
      next === 'Suspended' ? 'They will not be dispatched on your trips until reactivated.' : 'They can be dispatched on your trips again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: next === 'Suspended' ? 'Suspend' : 'Reactivate',
          style: next === 'Suspended' ? 'destructive' : 'default',
          onPress: () => {
            setDriverFleetStatus(d.id, next).catch((e: unknown) => setMessage({ tone: 'error', text: describeDataError(e) }));
          },
        },
      ],
    );
  };

  const revoke = (phone: string) =>
    Alert.alert('Withdraw invitation?', `${formatPhone(phone)} will no longer be linked to your fleet when they register.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: () => {
          revokeInvite(phone).catch((e: unknown) => setMessage({ tone: 'error', text: describeDataError(e) }));
        },
      },
    ]);

  return (
    <View style={styles.root}>
      {assignFor ? (
        <AssignSheet
          key={assignFor.id}
          driver={assignFor}
          onClose={() => setAssignFor(null)}
          onDone={(text) => {
            setAssignFor(null);
            setMessage({ tone: 'success', text });
          }}
        />
      ) : null}
      {adding ? (
        <AddDriverSheet
          onClose={() => setAdding(false)}
          onMessage={(text, tone = 'success') => setMessage({ tone, text })}
          onInvited={() => setTab('invites')}
        />
      ) : null}
      <Screen edges={[]}>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={type.h1}>Drivers</Text>
            <Text style={type.small}>Invite, link and manage the drivers of your fleet.</Text>
          </View>
          <Button small title="+ Add driver" onPress={() => setAdding(true)} />
        </View>
        {message ? <Notice tone={message.tone} message={message.text} /> : null}
        <View style={{ marginHorizontal: -space.lg }}>
          <PillTabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'fleet', label: 'My drivers', count: drivers.length },
              { id: 'invites', label: 'Invitations', count: invites.length },
            ]}
          />
        </View>

        {tab === 'fleet' ? (
          drivers.length === 0 ? (
            <EmptyState
              title="No drivers in your fleet yet"
              message="Enter a driver’s mobile number. If they already drive on NESAM you can link them; otherwise we send an invitation."
              action={<Button title="Add your first driver" onPress={() => setAdding(true)} />}
            />
          ) : (
            drivers.map((d) => {
              const licenceDays = daysUntil(d.licenseExpiry);
              return (
                <Card key={d.id}>
                  <View style={styles.head}>
                    <Avatar name={d.name} photoUrl={d.photoUrl} size={48} />
                    <View style={{ flex: 1 }}>
                      <Text style={type.h3}>{d.name}</Text>
                      <Text style={type.small}>
                        {formatPhone(d.phone)} · ★ {d.rating.toFixed(1)}
                      </Text>
                    </View>
                    {d.fleetStatus === 'Suspended' ? (
                      <Badge label="Suspended" tone="danger" />
                    ) : (
                      <Badge label={d.presenceStatus} tone={d.presenceStatus === 'Online' ? 'success' : d.presenceStatus === 'On Trip' ? 'brand' : 'neutral'} />
                    )}
                  </View>
                  <View style={styles.badges}>
                    <Badge
                      label={d.approvalStatus === 'Approved' ? 'Approved by NESAM' : d.approvalStatus === 'Rejected' ? 'Rejected' : 'Awaiting NESAM review'}
                      tone={d.approvalStatus === 'Approved' ? 'success' : d.approvalStatus === 'Rejected' ? 'danger' : 'warning'}
                    />
                    {licenceDays != null && licenceDays < 0 ? <Badge label="Licence expired" tone="danger" /> : null}
                  </View>
                  <Row label="Paired vehicle" value={d.assignedVehicleNumber || 'None'} />
                  <Row label="Licence" value={d.licenseNumber ? `${d.licenseNumber} · till ${displayDate(d.licenseExpiry) || '—'}` : '—'} />
                  <Row label="Documents" value={d.docStatus} />
                  <View style={styles.actions}>
                    <Button
                      small
                      variant="secondary"
                      title="Pair vehicle"
                      onPress={() => setAssignFor(d)}
                      style={{ flex: 1 }}
                      disabled={vehicles.length === 0}
                    />
                    <Button
                      small
                      variant={d.fleetStatus === 'Suspended' ? 'primary' : 'ghost'}
                      title={d.fleetStatus === 'Suspended' ? 'Resume duties' : 'Suspend'}
                      onPress={() => toggleFleetStatus(d)}
                    />
                  </View>
                </Card>
              );
            })
          )
        ) : invites.length === 0 ? (
          <EmptyState
            title="No pending invitations"
            message="Drivers you invite appear here until they sign up in the NESAM Driver app with the same number."
          />
        ) : (
          invites.map((i) => (
            <View key={i.phone} style={styles.invite}>
              <Ionicons name="call-outline" size={20} color={colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={type.body}>{formatPhone(i.phone)}</Text>
                <Text style={type.tiny}>{i.vehicleAssignment ? `Vehicle ${i.vehicleAssignment}` : 'No vehicle suggested'}</Text>
              </View>
              <Pressable onPress={() => revoke(i.phone)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Withdraw invitation for ${i.phone}`}>
                <Text style={styles.revoke}>Withdraw</Text>
              </Pressable>
            </View>
          ))
        )}
      </Screen>
    </View>
  );
}

function AssignSheet({ driver, onClose, onDone }: { driver: FleetDriver; onClose: () => void; onDone: (text: string) => void }) {
  const { vehicles } = useVendorData();
  const [vehicleId, setVehicleId] = useState(driver.assignedVehicleId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const approved = vehicles.filter((v) => v.docStatus === 'Approved' && v.status !== 'Inactive');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null;
      await assignVehicle(driver, vehicle, vehicles);
      onDone(vehicle ? `${vehicle.vehicleNumber} paired with ${driver.name}.` : `Vehicle unpaired from ${driver.name}.`);
    } catch (e) {
      setError(e instanceof VendorActionError ? e.message : describeDataError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={`Pair vehicle · ${driver.name}`} dismissible={!busy}>
      {approved.length === 0 ? (
        <Notice tone="info" message="No approved vehicles yet. Vehicles become assignable once NESAM approves their documents." />
      ) : null}
      <View style={styles.chips}>
        <Chip label="None" active={!vehicleId} onPress={() => setVehicleId('')} />
        {approved.map((v) => (
          <Chip
            key={v.id}
            label={`${v.vehicleNumber}${v.assignedDriverId && v.assignedDriverId !== driver.id ? ` (${v.assignedDriverName})` : ''}`}
            active={vehicleId === v.id}
            onPress={() => setVehicleId(v.id)}
          />
        ))}
      </View>
      <Text style={[type.tiny, { marginBottom: space.md }]}>Choosing a vehicle already paired with someone else moves it to {driver.name}.</Text>
      <Notice message={error} />
      <Button title={busy ? 'Saving…' : 'Save'} loading={busy} disabled={vehicleId === driver.assignedVehicleId} onPress={() => void save()} />
    </Sheet>
  );
}

type Step = 'phone' | 'found' | 'code' | 'invited';

function AddDriverSheet({
  onClose,
  onMessage,
  onInvited,
}: {
  onClose: () => void;
  onMessage: (text: string, tone?: 'success' | 'error') => void;
  onInvited: () => void;
}) {
  const { identity, vehicles, links } = useVendorData();
  const navigation = useNavigation();
  const [step, setStep] = useState<Step>('phone');
  const [mobile, setMobile] = useState('');
  const [plate, setPlate] = useState('');
  const [found, setFound] = useState<DriverLookup | null>(null);
  const [result, setResult] = useState<LinkRequestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const link = result ? links.find((l) => l.id === result.linkId) : undefined;

  const check = async () => {
    if (!/^[6-9]\d{9}$/.test(mobile)) return setError('Enter the driver’s 10-digit mobile number.');
    setBusy(true);
    setError('');
    try {
      setFound(await findDriver(mobile));
      setStep('found');
    } catch (e) {
      // The callable wrapper already provides a safe, specific message; do not turn it into a generic data error.
      setError(e instanceof ActionError ? e.message : describeDataError(e));
    } finally {
      setBusy(false);
    }
  };
  const invite = async () => {
    setBusy(true);
    setError('');
    try {
      await inviteDriver(identity, mobile, plate);
      setStep('invited');
      onInvited();
    } catch (e) {
      setError(e instanceof VendorActionError ? e.message : describeDataError(e));
    } finally {
      setBusy(false);
    }
  };
  const request = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await requestDriverLink(mobile, false));
      setStep('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request could not be sent.');
    } finally {
      setBusy(false);
    }
  };

  const f = found;
  const blocked = !!f && f.found && (f.mine || !f.approved || !!f.pendingLinkId);
  const title =
    step === 'phone'
      ? 'Add a driver'
      : step === 'invited'
        ? 'Invitation sent'
        : step === 'code'
          ? 'Confirm with the driver'
          : f?.found
            ? (f.name ?? 'Driver')
            : 'New to NESAM';

  return (
    <Sheet visible onClose={onClose} title={title} dismissible={!busy}>
      {step === 'phone' ? (
        <>
          <Text style={[type.small, { marginBottom: space.md }]}>
            Enter the driver’s own mobile number. We will tell you whether they already drive on NESAM.
          </Text>
          <TextField
            label="Driver mobile number"
            prefix="+91"
            value={mobile}
            onChangeText={(t) => {
              const digits = t.replace(/\D/g, '');
              // Pasting +91 must not silently turn it into a different 10-digit number.
              setMobile(digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits);
              setError('');
            }}
            keyboardType="phone-pad"
            editable={!busy}
            error={error}
          />
          <Button title="Check number" loading={busy} onPress={() => void check()} />
        </>
      ) : null}

      {step === 'found' && f ? (
        <>
          {!f.found ? (
            <>
              <Notice
                tone="info"
                message={`This number is not on NESAM yet. Send an invitation: the driver signs up in the NESAM Driver app with +91 ${mobile}, and NESAM reviews their documents.`}
              />
              {vehicles.length ? (
                <>
                  <Text style={[type.label, { marginBottom: 6 }]}>Pair with a vehicle (optional)</Text>
                  <View style={styles.chips}>
                    <Chip label="None" active={!plate} onPress={() => setPlate('')} />
                    {vehicles.map((v) => (
                      <Chip key={v.id} label={v.vehicleNumber} active={plate === v.vehicleNumber} onPress={() => setPlate(v.vehicleNumber)} />
                    ))}
                  </View>
                </>
              ) : null}
              <Notice message={error} />
              <Button title="Send invitation" loading={busy} onPress={() => void invite()} />
            </>
          ) : (
            <>
              <Card style={{ marginBottom: space.md }}>
                <View style={styles.head}>
                  <Avatar name={f.name ?? ''} size={48} />
                  <View style={{ flex: 1 }}>
                    <Text style={type.h3}>{f.name}</Text>
                    <Text style={type.small}>{f.phoneMask}</Text>
                  </View>
                </View>
                <Row label="Type" value={f.kind === 'owner_driver' ? 'Owner-driver (works for themselves)' : 'Driver of another fleet'} />
                {f.kind === 'vendor_driver' ? <Row label="Current fleet" value={f.mine ? 'Your fleet' : f.fleet || 'Another vendor'} /> : null}
                <Row label="NESAM account" value={f.approved ? 'Approved' : 'Not approved yet'} />
              </Card>
              {f.mine ? <Notice tone="info" message={`${f.name} is already in your fleet.`} /> : null}
              {!f.mine && !f.approved ? <Notice tone="warning" message="NESAM has not approved this driver yet, so they cannot be linked." /> : null}
              {f.pendingLinkId ? <Notice tone="warning" message="You already have an open request for this driver." /> : null}
              {!blocked && f.onHold ? <Notice tone="warning" message="This driver is on hold. The office will have to review the move." /> : null}
              {!blocked && (f.openDuties ?? 0) > 0 ? (
                <Notice
                  tone="warning"
                  message={`${f.name} has ${f.openDuties} booked ${f.openDuties === 1 ? 'duty' : 'duties'}. Those must be reassigned before the move can finish.`}
                />
              ) : null}
              {!blocked ? (
                <Notice
                  tone="info"
                  message={
                    f.kind === 'owner_driver'
                      ? `As an owner-driver, ${f.name} will stop taking duties directly and work for your fleet. We send a code to their own phone; they read it to you, and the NESAM office then confirms the change.`
                      : `We send a code to ${f.name}’s own phone. Once they read it to you and you enter it, they move to your fleet. Their old trips and payouts stay with their previous fleet.`
                  }
                />
              ) : null}
              <Notice message={error} />
              {!blocked ? <Button title="Send code to driver" loading={busy} onPress={() => void request()} /> : null}
              {f.pendingLinkId ? (
                <Button
                  title="Open requests"
                  onPress={() => {
                    onClose();
                    navigation.navigate('Requests');
                  }}
                />
              ) : null}
            </>
          )}
          <Button
            variant="ghost"
            title="Back"
            disabled={busy}
            onPress={() => {
              setStep('phone');
              setError('');
            }}
            style={{ marginTop: space.sm }}
          />
        </>
      ) : null}

      {step === 'code' && result ? (
        link ? (
          <>
            <CodePanel link={link} testCode={result.testCode} say={onMessage} />
            <Button title={link.status === 'Completed' ? 'Done' : 'Close'} variant="secondary" onPress={onClose} style={{ marginTop: space.md }} />
          </>
        ) : (
          <Notice tone="info" message="Request sent. Loading its status…" />
        )
      ) : null}

      {step === 'invited' ? (
        <>
          <Notice tone="success" message={`Invitation saved for ${formatPhone(mobile)}.`} />
          <Text style={type.small}>
            The driver joins your fleet by signing up in the NESAM Driver app with this number. You will see them under My drivers once they do.
          </Text>
          <Button title="Close" onPress={onClose} style={{ marginTop: space.md }} />
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    marginVertical: space.sm,
  },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.sm },
  invite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    marginBottom: space.sm,
  },
  revoke: { color: colors.danger, fontWeight: '600' },
});
