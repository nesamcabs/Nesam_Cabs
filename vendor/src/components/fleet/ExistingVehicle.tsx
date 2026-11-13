// A registration number that is already on NESAM. A car keeps one permanent Car ID, so instead of registering it again the
// partner sees everything on record (the car, who registered it, its documents) and swaps it into their fleet (VehicleSwap):
// either an OTP to the driver who ran it most recently, or a call to the NESAM office.
// Used inline in the Add vehicle form as soon as the number is typed, and on the Add vehicle page when a save finds it taken.
import React from 'react';
import { View } from 'react-native';
import { Badge, Between, Btn, CarImage, Eyebrow, H2, KV, Notice, Panel, Small } from '../kit/core';
import { plate as spaced } from '../kit/format';
import type { VehicleLookup } from '../../services/partnerLinks';
import { VehicleSwap } from './VehicleSwap';

const dateText = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** The facts on record about a vehicle that is already on NESAM (no driver details: the partner has to know the driver). */
export function vehicleFacts(f: VehicleLookup, reg: string): [string, string][] {
  const car = [f.make, f.modelName].filter(Boolean).join(' ') || f.model || '';
  const contact = [f.registeredByContact, f.registeredByPhoneMask].filter(Boolean).join(' · ');
  return [
    car ? ['Vehicle', car] : null,
    f.category ? ['Category', f.category] : null,
    f.year ? ['Year', f.year] : null,
    f.fuelType ? ['Fuel', f.fuelType] : null,
    f.color ? ['Colour', f.color] : null,
    f.seats ? ['Passenger seats', `${f.seats} · driver excluded`] : null,
    ['Registered by', f.mine ? 'Your fleet' : f.registeredBy || f.owner || 'Another owner'],
    contact ? ['Contact', contact] : null,
    f.registeredOn ? ['Registered on NESAM', dateText(f.registeredOn)] : null,
    f.insuranceExpiry ? ['Insurance valid till', dateText(f.insuranceExpiry)] : null,
    f.permitExpiry ? ['Permit valid till', dateText(f.permitExpiry)] : null,
    f.fitnessExpiry ? ['Fitness valid till', dateText(f.fitnessExpiry)] : null,
  ].filter(Boolean) as [string, string][];
}

export function ExistingVehiclePanel({
  found: f,
  reg,
  onOpenMine,
  onDifferent,
  onSent,
}: {
  found: VehicleLookup;
  reg: string;
  /** Open the vehicle when it is already in this partner's own fleet. */
  onOpenMine?: () => void;
  /** Start over with another registration number. */
  onDifferent?: () => void;
  /** A code was sent (the request id), so the caller can avoid listing it twice. */
  onSent?: (linkId: string) => void;
}) {
  const car = [f.make, f.modelName].filter(Boolean).join(' ') || f.model || '';
  return (
    <Panel>
      <Between><Eyebrow>ALREADY ON NESAM</Eyebrow><Badge label={f.verified ? 'Verified' : 'Not verified'} tone={f.verified ? 'green' : 'amber'} /></Between>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <H2>{spaced(f.plate ?? reg)}</H2>
          <Small>{[car, f.category].filter(Boolean).join(' · ') || 'Registered with NESAM'}</Small>
        </View>
        <CarImage category={f.category ?? ''} model={car} width={96} height={60} />
      </View>
      <KV rows={vehicleFacts(f, reg)} />

      {f.mine ? (
        <Notice tone="green" title="Already in your fleet" text="This vehicle is registered under your business." style={{ marginTop: 14 }}
          action={onOpenMine ? <Btn kind="secondary" small title="Open vehicle" onPress={onOpenMine} /> : undefined} />
      ) : (
        <Notice tone="blue" icon="swap-horizontal-outline" style={{ marginTop: 14 }} title="One car, one Car ID"
          text="This vehicle is already on NESAM, so it cannot be registered twice. Swap it into your fleet with an OTP to its last driver, or by calling NESAM. Its documents and trip history stay valid." />
      )}
      {f.pendingLinkId && !f.mine ? <Notice tone="amber" title="Request already open" text="You already have an open request for this vehicle. Follow it under Fleet › Swap." style={{ marginTop: 12 }} /> : null}

      {!f.mine && !f.pendingLinkId ? <View style={{ marginTop: 14 }}><VehicleSwap found={f} reg={reg} onSent={onSent} /></View> : null}
      {onDifferent ? <Btn kind="secondary" icon="car-sport-outline" title="Use a different registration number" full onPress={onDifferent} style={{ marginTop: 14 }} /> : null}
    </Panel>
  );
}
