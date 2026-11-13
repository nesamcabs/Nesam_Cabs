// Assign driver (reference sAssignment): Driver → Vehicle → Review & confirm, with the agreed payout beside it on wide
// screens. The server (vendorAssignDriver) re-checks driver approval, vehicle documents and schedule clashes before assigning.
import React, { useState } from 'react';
import { View } from 'react-native';
import { Text } from '../../components/kit/Text';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { DetailGrid, Page } from '../../components/shell/Page';
import { Avatar, BigAmount, Btn, CarImage, Check, Choice, Empty, Eyebrow, Feedback, KV, Notice, Panel, RouteTitle, Small, Steps, s as kit } from '../../components/kit/core';
import { dayTime, firstPart, plate, rupees, tripTypeLabel } from '../../components/kit/format';
import { flash } from '../../components/kit/flash';
import { defaultVehicleForDriver, dispatchBlocker, dispatchDriver, dispatchNote, isEligibleVehicle, resolveAssignedVehicle, VendorActionError } from '../../services/vendorService';
import { assignDeadline } from '../../services/partnerOps';
import { describeDataError } from '../../utils/retry';
import { goSection } from '../../navigation/navigationRef';
import type { RootStackParamList } from '../../navigation/types';
import { canChange, payoutOf } from './logic';
import { colors, fontFamily } from '../../theme';

export function AssignScreen() {
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'Assign'>>();
  const d = useVendorData();
  const b = d.bookings.find((x) => x.id === params.id);
  const [step, setStep] = useState(1);
  const [driverId, setDriverId] = useState(b?.driverId ?? '');
  const [vehicleId, setVehicleId] = useState(() => (b ? resolveAssignedVehicle(b, d.vehicles)?.id ?? '' : ''));
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!b || !canChange(b)) {
    return (
      <Page title="Assign driver">
        <Empty icon="person-add-outline" title="Assignment unavailable" text="Open an accepted or upcoming booking that has not started." action={<Btn kind="secondary" icon="arrow-back" title="Bookings" onPress={() => goSection('Bookings')} />} />
      </Page>
    );
  }

  const driver = d.drivers.find((x) => x.id === driverId) ?? null;
  const usable = d.vehicles.filter(isEligibleVehicle);
  const vehicle = usable.find((v) => v.id === vehicleId) ?? null;
  const deadline = assignDeadline(b.acceptedAt, b.pickupAt, d.ops, b.assignBy);
  const replacing = !!b.driverId;
  const matches = (category: string) => !b.vehicleCategory || !category || category.toLowerCase() === b.vehicleCategory.toLowerCase();

  const next = () => {
    setError('');
    if (step === 1) {
      if (!driver) { setError('Choose a driver.'); return; }
      if (!vehicleId) { const v = defaultVehicleForDriver(driver, usable); if (v) setVehicleId(v.id); }
      setStep(2);
    } else if (step === 2) {
      if (!vehicle) { setError('Choose an active, approved vehicle for this duty.'); return; }
      setStep(3);
    }
  };

  const confirm = async () => {
    if (!driver || !vehicle) return;
    if (!agree) { setError('Confirm you checked the driver, vehicle, payout and duty terms.'); return; }
    if (driver.id === b.driverId && vehicle.id === b.vehicleId) { setError('That driver and vehicle are already assigned to this duty.'); return; }
    setBusy(true); setError('');
    try {
      await dispatchDriver(b, driver, vehicle, d.bookings);
      flash(`${driver.name} and ${plate(vehicle.vehicleNumber)} confirmed for ${b.bookingId}. The driver has been notified.`);
      navigation.goBack();
    } catch (e) {
      setError(e instanceof VendorActionError ? e.message : describeDataError(e));
    } finally { setBusy(false); }
  };

  const heading = (
    <View style={{ marginBottom: 18 }}>
      <Small>{b.pickupAt ? dayTime(b.pickupAt) : [b.date, b.time].filter(Boolean).join(' · ')} · {b.vehicleCategory || 'Vehicle'}</Small>
      <View style={{ marginTop: 6 }}><RouteTitle from={firstPart(b.pickupAddress)} to={firstPart(b.dropAddress)} size={18} /></View>
    </View>
  );

  const main = (
    <View>
      <Steps steps={['Driver', 'Vehicle', 'Confirm']} current={step} />
      {heading}
      <Panel style={{ padding: 24 }}>
        <Eyebrow>STEP {step} OF 3</Eyebrow>
        {step === 1 ? (
          <>
            <Text style={[kit.h2, { fontSize: 19, marginTop: 10 }]}>Choose your driver</Text>
            <Small style={{ marginTop: 8, marginBottom: 16 }}>Only drivers linked to your business are listed. Suspended or unapproved drivers cannot be chosen; a driver whose other duty overlaps this one is refused on confirmation.</Small>
            {d.drivers.length === 0 ? (
              <Notice tone="blue" title="No drivers in your fleet yet" text="Add or link a driver first." action={<Btn kind="secondary" small icon="person-add-outline" title="Add driver" onPress={() => navigation.navigate('FleetAdd', { kind: 'driver' })} />} />
            ) : d.drivers.map((x) => {
              const blocker = dispatchBlocker(x, d.bookings, b.id);
              return (
                <Choice key={x.id} title={x.name} selected={driverId === x.id} disabled={!!blocker} reason={blocker}
                  sub={blocker ? undefined : [dispatchNote(x, d.bookings, b.id), x.presenceStatus, x.rating ? `★ ${x.rating.toFixed(1)}` : '', x.assignedVehicleNumber ? `Paired ${plate(x.assignedVehicleNumber)}` : ''].filter(Boolean).join(' · ')}
                  left={<Avatar name={x.name} size={38} />} onPress={() => { setDriverId(x.id); setError(''); }} />
              );
            })}
          </>
        ) : step === 2 ? (
          <>
            <Text style={[kit.h2, { fontSize: 19, marginTop: 10 }]}>Choose the vehicle</Text>
            <Small style={{ marginTop: 8, marginBottom: 16 }}>Choose an approved, in-service {b.vehicleCategory || 'vehicle'} for this duty.</Small>
            {driver ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 9, backgroundColor: '#F6F7F9', marginBottom: 14 }}>
                <Avatar name={driver.name} size={30} tone="blue" />
                <Text style={{ fontFamily, fontSize: 12.5, color: '#4D6A89', flex: 1 }}>{driver.name}</Text>
                <Btn kind="text" title="Change" onPress={() => setStep(1)} />
              </View>
            ) : null}
            {usable.length === 0 ? (
              <Notice tone="amber" title="No approved vehicles in service" text="Vehicles become assignable once NESAM approves their documents and they are marked In service." action={<Btn kind="secondary" small icon="car-outline" title="Open Fleet" onPress={() => goSection('Fleet')} />} />
            ) : usable.map((v) => (
              <Choice key={v.id} title={plate(v.vehicleNumber)} selected={vehicleId === v.id} onPress={() => { setVehicleId(v.id); setError(''); }}
                sub={[[v.make, v.model].filter(Boolean).join(' '), v.category, v.assignedDriverName ? `Paired with ${v.assignedDriverName}` : ''].filter(Boolean).join(' · ')}
                reason={matches(v.category) ? undefined : `Booked category is ${b.vehicleCategory}`}
                left={<CarImage category={v.category} model={v.model} width={58} height={36} />} />
            ))}
            {vehicleId && !vehicle ? <Notice tone="amber" title="The previously selected vehicle is no longer active or approved" text="Select another vehicle." /> : null}
          </>
        ) : (
          <>
            <Text style={[kit.h2, { fontSize: 19, marginTop: 10 }]}>Review & confirm</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 18 }}>
              <PairBox icon={<Avatar name={driver?.name ?? '?'} size={34} tone="blue" />} label="Driver" title={driver?.name ?? 'Not selected'} sub={driver ? driver.phone : ''} />
              <PairBox icon={<CarImage category={vehicle?.category ?? ''} model={vehicle?.model} width={48} height={30} />} label="Vehicle" title={vehicle ? plate(vehicle.vehicleNumber) : 'Not selected'} sub={vehicle ? [vehicle.model, vehicle.category].filter(Boolean).join(' · ') : ''} />
            </View>
            <View style={{ marginTop: 18, padding: 16, borderWidth: 1, borderColor: '#E0E7EF', borderRadius: 10, backgroundColor: '#F6F7F9' }}>
              <Text style={[kit.h2, { fontSize: 13.5 }]}>Duty terms & penalty details</Text>
              <KV rows={[
                ['Agreed vendor payout', rupees(payoutOf(b))],
                b.includedKm ? ['Included distance', `${b.includedKm} km`] : null,
                deadline ? ['Assignment deadline', dayTime(deadline)] : null,
                ['Missed assignment deadline', rupees(d.ops.missedAssignmentPenalty)],
                [`Cancellation within ${d.ops.cancellation.lastMinuteHours} h of pickup`, rupees(d.ops.cancellation.lastMinuteCharge)],
              ]} />
              <Small style={{ marginTop: 8 }}>The driver collects toll, parking, state tax and hill charges from the customer and gives the customer a receipt for each. Only the confirmed driver and vehicle can operate this duty.</Small>
            </View>
            {replacing ? <Notice tone="amber" title="Replacing the current assignment" text={`${b.driverName || 'The current driver'} stays assigned until you confirm. The new driver is notified on confirmation.`} style={{ marginTop: 14 }} /> : null}
            <View style={{ marginTop: 10 }}>
              <Check checked={agree} onChange={setAgree} label="I have checked the driver, vehicle, payout, duty terms and penalty details, and accept this assignment." />
            </View>
          </>
        )}
        <Feedback tone="error" message={error} />
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18, borderTopWidth: 1, borderTopColor: '#F1F2F5', paddingTop: 18 }}>
          {step > 1 ? <Btn kind="secondary" icon="arrow-back" title="Back" onPress={() => { setError(''); setStep(step - 1); }} /> : null}
          {step < 3
            ? <Btn title={step === 1 ? 'Continue to vehicle' : 'Review assignment'} iconRight="arrow-forward" onPress={next} style={{ flex: 1 }} />
            : <Btn title="Confirm assignment" icon="shield-checkmark" busy={busy} onPress={() => void confirm()} style={{ flex: 1 }} />}
        </View>
      </Panel>
    </View>
  );

  const side = (
    <Panel>
      <Eyebrow>AGREED VENDOR PAYOUT</Eyebrow>
      <BigAmount value={rupees(payoutOf(b))} />
      <Small>{b.includedKm ? `${b.includedKm} km included · ` : ''}{tripTypeLabel(b.tripType)}</Small>
      <View style={{ height: 1, backgroundColor: '#E7EDF5', marginVertical: 16 }} />
      {deadline ? <KV rows={[['Assign by', dayTime(deadline)]]} style={{ marginTop: 0 }} /> : null}
      <Small style={{ marginTop: 10 }}>{replacing ? 'The current assignment remains active until the replacement is confirmed.' : 'Driver and vehicle details are shared with the customer after final confirmation.'}</Small>
    </Panel>
  );

  return (
    <Page title={replacing ? 'Change driver or vehicle' : 'Assign driver'} subtitle={b.bookingId}>
      <DetailGrid main={main} side={side} sideWidth={290} />
    </Page>
  );
}

function PairBox({ icon, label, title, sub }: { icon: React.ReactNode; label: string; title: string; sub: string }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 220, flexDirection: 'row', alignItems: 'flex-start', gap: 11, backgroundColor: '#F6F7F9', borderWidth: 1, borderColor: '#E6ECF4', borderRadius: 10, padding: 15 }}>
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily, fontSize: 11, color: '#6F7785' }}>{label}</Text>
        <Text style={{ fontFamily, fontSize: 14, fontWeight: '600', color: '#424B5A', marginTop: 4 }} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={{ fontFamily, fontSize: 11, color: colors.muted, marginTop: 2 }} numberOfLines={1}>{sub}</Text> : null}
      </View>
    </View>
  );
}
