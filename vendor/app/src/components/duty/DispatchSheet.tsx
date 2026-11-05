// Pick a driver and a vehicle for an awarded trip. The server (vendorAssignDriver) re-checks the driver, the vehicle's
// documents and any clash with another duty before it assigns.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVendorData } from '../../context/VendorData';
import { Button, Chip, Notice, Sheet } from '../ui';
import { defaultVehicleForDriver, dispatchBlocker, dispatchDriver, isEligibleVehicle, resolveAssignedVehicle, VendorActionError } from '../../services/vendorService';
import type { FleetDriver, VendorBooking } from '../../types/operations';
import { describeDataError } from '../../utils/retry';
import { colors, radius, space, type } from '../../theme';

export function DispatchSheet({ booking, onClose, onDone, onAddDriver }: { booking: VendorBooking; onClose: () => void; onDone: (driverName: string) => void; onAddDriver?: () => void }) {
  const { drivers, vehicles, bookings } = useVendorData();
  const [driverId, setDriverId] = useState(booking.driverId);
  const driver = drivers.find((d) => d.id === driverId) ?? null;
  const usableVehicles = vehicles.filter(isEligibleVehicle);

  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(() => {
    const resolved = resolveAssignedVehicle(booking, vehicles);
    if (resolved) return resolved.id;
    const fromDriver = defaultVehicleForDriver(driver, vehicles);
    return fromDriver?.id ?? '';
  });
  const selectedVehicle = usableVehicles.find((v) => v.id === selectedVehicleId) ?? null;
  const isSelectionStale = Boolean(selectedVehicleId && !selectedVehicle);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pickDriver = (d: FleetDriver) => {
    setDriverId(d.id);
    const fromDriver = defaultVehicleForDriver(d, usableVehicles);
    if (fromDriver) setSelectedVehicleId(fromDriver.id);
    setError('');
  };

  const submit = async () => {
    if (busy) return;
    if (!driver) return setError('Choose a driver.');
    if (!selectedVehicle) return setError('Choose an active, approved vehicle for this trip.');
    setBusy(true);
    setError('');
    try {
      await dispatchDriver(booking, driver, selectedVehicle, bookings);
      onDone(driver.name);
    } catch (e) {
      setError(e instanceof VendorActionError ? e.message : describeDataError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title={`Dispatch · ${booking.bookingId}`} dismissible={!busy}>
      <Text style={[type.small, { marginBottom: space.md }]}>
        {booking.pickupAddress} → {booking.dropAddress} · {booking.date} {booking.time}
      </Text>
      <Text style={[type.label, { marginBottom: space.sm }]}>Driver</Text>
      {drivers.length === 0 ? (
        <Notice tone="info" message="No drivers are linked to your fleet yet." onRetry={onAddDriver ? () => { onClose(); onAddDriver(); } : undefined} />
      ) : null}
      {drivers.map((d) => {
        const blocker = dispatchBlocker(d, bookings, booking.id);
        const on = d.id === driverId;
        return (
          <Pressable
            key={d.id}
            onPress={() => !blocker && !busy && pickDriver(d)}
            disabled={!!blocker || busy}
            style={[styles.option, on && styles.optionOn, !!blocker && { opacity: 0.5 }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled: !!blocker || busy }}
          >
            <View style={{ flex: 1 }}>
              <Text style={type.h3}>{d.name}</Text>
              <Text style={type.small}>{blocker || `${d.presenceStatus} · ★ ${d.rating.toFixed(1)}${d.assignedVehicleNumber ? ` · ${d.assignedVehicleNumber}` : ''}`}</Text>
            </View>
            {on ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
          </Pressable>
        );
      })}
      {driver ? (
        <>
          <Text style={[type.label, { marginVertical: space.sm }]}>Vehicle for this trip</Text>
          {usableVehicles.length === 0 ? (
            <Notice tone="warning" message="No approved active vehicles found in your fleet. Add or link a vehicle in the Vehicles tab." />
          ) : (
            <View style={styles.chips}>
              {usableVehicles.map((v) => (
                <Chip
                  key={v.id}
                  label={v.vehicleNumber}
                  active={selectedVehicle?.id === v.id}
                  onPress={() => {
                    if (busy) return;
                    setSelectedVehicleId(v.id);
                    setError('');
                  }}
                />
              ))}
            </View>
          )}
          {isSelectionStale ? (
            <Notice tone="warning" message="The previously selected vehicle is no longer active or approved. Please select another vehicle." style={{ marginTop: space.xs }} />
          ) : !selectedVehicle && usableVehicles.length > 0 ? (
            <Text style={type.small}>Select an approved vehicle from your fleet above.</Text>
          ) : null}
        </>
      ) : null}
      <Notice message={error} />
      <Button title={busy ? 'Dispatching…' : 'Dispatch driver'} loading={busy} disabled={!driver || !selectedVehicle || busy || isSelectionStale} onPress={() => void submit()} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, marginBottom: space.sm },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.sm },
});
