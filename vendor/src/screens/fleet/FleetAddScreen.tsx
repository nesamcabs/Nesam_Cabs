// Add driver / Add vehicle (reference wAddFleet). Each opens its form as a bottom sheet. The driver form checks the mobile number
// as it is typed: an existing ID gets a swap request, a new driver is invited. The vehicle form does the same with the plate, and a
// plate that already has a Car ID goes to the swap request instead of getting a second ID.
import React, { useState } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useVendorData } from '../../context/VendorData';
import { Page } from '../../components/shell/Page';
import { VehicleForm } from '../../components/fleet/VehicleForm';
import { DriverForm } from '../../components/fleet/DriverForm';
import { ExistingVehiclePanel } from '../../components/fleet/ExistingVehicle';
import { flash } from '../../components/kit/flash';
import { findVehicle, type VehicleLookup } from '../../services/partnerLinks';
import { normalizePlate } from '../../utils/fleet';
import { goSection } from '../../navigation/navigationRef';
import type { RootStackParamList } from '../../navigation/types';

export function FleetAddScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'FleetAdd'>>();
  const driver = params.kind === 'driver';
  return driver ? <AddDriver /> : <AddVehicle />;
}

function AddDriver() {
  const navigation = useNavigation();
  // The form is a bottom sheet over this page; closing it goes back to the Fleet list.
  return (
    <Page title="Add driver" subtitle="Register a new driver or link one already on NESAM." maxWidth={700}>
      <DriverForm onClose={() => navigation.goBack()} />
    </Page>
  );
}

function AddVehicle() {
  const navigation = useNavigation();
  const { vehicles } = useVendorData();
  const [reg, setReg] = useState('');
  const [found, setFound] = useState<VehicleLookup | null>(null);
  // The register form opens straight away; it closes only if the plate turns out to have a Car ID already.
  const [registering, setRegistering] = useState(true);

  // Runs when the vendor saves (the form also checks while the number is typed): a plate already in their fleet opens that
  // vehicle, a plate another owner holds goes to the swap-request panel (so a car never gets a second Car ID), and a new plate
  // carries on to be registered.
  const beforeAdd = async (plateText: string): Promise<boolean> => {
    const key = normalizePlate(plateText);
    const mine = vehicles.find((v) => normalizePlate(v.vehicleNumber) === key);
    if (mine) { setRegistering(false); navigation.navigate('Vehicle', { id: mine.id }); return false; }
    const lookup = await findVehicle(plateText);
    if (!lookup.found) return true;
    setReg(plateText); setFound(lookup); setRegistering(false);
    return false;
  };
  const f = found;

  return (
    <Page title="Add vehicle" subtitle={f ? 'This registration already has a permanent Car ID.' : 'Register a vehicle with its documents.'} maxWidth={700}>
      {f?.found ? (
        <ExistingVehiclePanel found={f} reg={reg}
          onOpenMine={f.mine && f.vehicleId ? () => navigation.navigate('Vehicle', { id: f.vehicleId! }) : undefined}
          onDifferent={() => { setFound(null); setRegistering(true); }} />
      ) : null}

      {registering ? (
        <VehicleForm existing={null} beforeAdd={beforeAdd} onClose={() => navigation.goBack()}
          onSaved={(m) => { setRegistering(false); flash(m); goSection('Fleet', { tab: 'Vehicles' }); }} />
      ) : null}
    </Page>
  );
}
