import { AUTO_VEHICLE_DETECTION, ageOn, isFutureDate, isPlate, isValidAadhaar, localDateISO, maskAadhaar, maskAccount, normalizePlate, validateStep } from '../src/validation/kyc';
import { buildNewDriverDoc, emptyRegistration, fallbackName, registrationFields } from '../src/services/driverService';
import { manualSnapshot, snapshotFrom, vehiclePatchFrom } from '../src/services/vehicleLookup';
import type { DetectedVehicle, RegistrationData, VehicleLookupResult } from '../src/types/driver';

const TODAY = '2026-10-13';

const found: DetectedVehicle = {
  registrationNumber: 'TN01AB1234', make: 'Toyota', model: 'Innova Crysta', variant: '2.4 Gx', fuelType: 'Diesel', seatingCapacity: 8, passengerSeats: 7,
  seatClass: '7+1', manufactureYear: '2021', colour: 'White', vehicleClass: 'LMV', usage: 'commercial', registrationStatus: 'ACTIVE', registrationActive: true,
  registeredAt: 'Chennai', ownerNameMasked: 'R••• K•••', category: 'Premium SUV', specClass: 'Crysta',
  validity: { fitnessUpto: '2027-06-30', insuranceUpto: '2026-12-31', permitUpto: '2027-03-31', taxUpto: '', pucUpto: '' },
};
const foundResult: VehicleLookupResult = { status: 'found', registrationNumber: 'TN01AB1234', vehicle: found, issues: [], duplicate: false, fetchedAtMs: 1, source: 'surepass' };

/** A complete owner-driver application — exactly the spec page 13 inputs. */
function filled(): RegistrationData {
  const d = emptyRegistration('+91 98765 43210');
  d.profile = { ...d.profile, photoUrl: 'https://x/selfie.jpg' };
  d.license = { number: 'TN01 20190012345', expiryDate: '2099-01-01', frontPhotoUrl: 'u', backPhotoUrl: 'u' };
  d.vehicle = {
    ...d.vehicle,
    vehicleNumber: 'TN 01 AB 1234',
    rcNumber: 'TN01AB1234',
    rcDocUrl: 'u',
    insuranceDocUrl: 'u',
    insuranceExpiry: '2099-01-01',
    fitnessDocUrl: 'u',
    fitnessExpiry: '2099-01-01',
    statePermitDocUrl: 'u',
    permitExpiry: '2099-01-01',
    frontPhotoUrl: 'u',
    vahan: snapshotFrom(foundResult, false),
  };
  return d;
}

describe('onboarding validation (spec page 13)', () => {
  it('accepts a complete owner-driver application', () => {
    const d = filled();
    expect(validateStep(1, d, { today: TODAY, autoDetect: true })).toEqual({});
    expect(validateStep(2, d, { today: TODAY, autoDetect: true })).toEqual({});
  });

  it('asks for nothing but the page-13 inputs', () => {
    const d = emptyRegistration('+91 98765 43210');
    expect(Object.keys(validateStep(1, d, { today: TODAY, autoDetect: true })).sort()).toEqual(['dlBack', 'dlFront', 'licenseExpiry', 'licenseNumber', 'photoUrl']);
    // No name, date of birth, address, Aadhaar, PAN, emergency contact or bank is ever required.
    const all = { ...validateStep(1, d, { today: TODAY, autoDetect: true }), ...validateStep(2, d, { today: TODAY, autoDetect: true }) };
    for (const k of ['name', 'dob', 'gender', 'address', 'city', 'pincode', 'emergencyContact', 'aadhaarNumber', 'panNumber', 'accountNumber', 'ifsc', 'make', 'model', 'color', 'year', 'insuranceNumber', 'statePermitNumber']) {
      expect(all).not.toHaveProperty(k);
    }
  });

  it('vendor employee drivers have no vehicle step', () => {
    expect(validateStep(2, emptyRegistration('+91 98765 43210'), { fleetDriver: true, today: TODAY })).toEqual({});
  });

  it('a selfie, licence number, validity and both sides are required; an expired licence is refused', () => {
    const d = filled();
    d.license.expiryDate = '2026-10-12';
    d.license.number = 'TN01';
    d.profile.photoUrl = '';
    const e = validateStep(1, d, { today: TODAY, autoDetect: true });
    expect(e.licenseExpiry).toMatch(/expired/i);
    expect(e.licenseNumber).toBeTruthy();
    expect(e.photoUrl).toBeTruthy();
  });

  it('RC, insurance, FC and permit each need a document and an unexpired validity', () => {
    const d = filled();
    d.vehicle.insuranceExpiry = '2026-10-13';
    d.vehicle.fitnessExpiry = '';
    d.vehicle.permitExpiry = '2026-01-01';
    d.vehicle.rcDocUrl = '';
    d.vehicle.frontPhotoUrl = '';
    const e = validateStep(2, d, { today: TODAY, autoDetect: true });
    expect(e.insuranceExpiry).toMatch(/expired/i);
    expect(e.fitnessExpiry).toBeTruthy();
    expect(e.permitExpiry).toMatch(/expired/i);
    expect(e.rcDocUrl).toBeTruthy();
    expect(e.frontPhotoUrl).toBeTruthy();
  });

  it('the vehicle must be detected before the application can continue', () => {
    const d = filled();
    d.vehicle.vahan = undefined;
    expect(validateStep(2, d, { today: TODAY, autoDetect: true }).vehicleNumber).toMatch(/detect/i);
    // A detection for a different plate does not count.
    d.vehicle.vahan = snapshotFrom({ ...foundResult, registrationNumber: 'TN09ZZ0001' }, false);
    expect(validateStep(2, d, { today: TODAY, autoDetect: true }).vehicleNumber).toMatch(/detect/i);
    d.vehicle.vahan = snapshotFrom({ status: 'not_found', registrationNumber: 'TN01AB1234' }, false);
    expect(validateStep(2, d, { today: TODAY, autoDetect: true }).vehicleNumber).toMatch(/not found/i);
    d.vehicle.vahan = snapshotFrom({ ...foundResult, duplicate: true }, false);
    expect(validateStep(2, d, { today: TODAY, autoDetect: true }).vehicleNumber).toMatch(/already registered/i);
  });

  it('when the register is unreachable the partner picks the type; otherwise the application is held', () => {
    const d = filled();
    d.vehicle.vahan = snapshotFrom({ status: 'unavailable', registrationNumber: 'TN01AB1234' }, false);
    expect(validateStep(2, d, { today: TODAY, autoDetect: true }).vehicleType).toBeTruthy();
    d.vehicle.vahan = snapshotFrom({ status: 'not_configured', registrationNumber: 'TN01AB1234' }, true);
    expect(validateStep(2, d, { today: TODAY, autoDetect: true })).toEqual({});
  });

  it('manual entry (detection off): a valid plate and a chosen vehicle type are enough, no register lookup', () => {
    const d = filled();
    d.vehicle.vahan = undefined;
    expect(validateStep(2, d, { today: TODAY, autoDetect: false }).vehicleType).toMatch(/choose/i);
    expect(validateStep(2, d, { today: TODAY, autoDetect: false }).vehicleNumber).toBeUndefined();
    d.vehicle.vahan = manualSnapshot('TN01AB1234');
    expect(validateStep(2, d, { today: TODAY, autoDetect: false })).toEqual({});
    d.vehicle.vehicleNumber = 'NOTAPLATE';
    expect(validateStep(2, d, { today: TODAY, autoDetect: false }).vehicleNumber).toMatch(/valid registration/i);
  });

  it('the shipped default is manual entry while the register key is unavailable', () => {
    expect(AUTO_VEHICLE_DETECTION).toBe(false);
  });

  it('plates are compared without spaces or hyphens', () => {
    expect(normalizePlate('tn 01-ab 1234')).toBe('TN01AB1234');
    expect(isPlate('TN 01 AB 1234')).toBe(true);
    expect(isPlate('22BH1234AA')).toBe(true);
    expect(isPlate('NOTAPLATE')).toBe(false);
    expect(isPlate('TN01')).toBe(false);
  });
});

describe('vehicle detection mapping', () => {
  it('fills the form from the register: seats exclude the driver', () => {
    expect(vehiclePatchFrom(found)).toEqual({ make: 'Toyota', model: 'Innova Crysta 2.4 Gx', year: '2021', color: 'White', fuelType: 'Diesel', capacity: 7, vehicleType: 'Premium SUV' });
  });

  it('keeps what the app needs to resume, never the owner', () => {
    const s = snapshotFrom(foundResult, false);
    expect(s).toMatchObject({ status: 'found', lookupId: 'TN01AB1234', seatClass: '7+1', specClass: 'Crysta', duplicate: false });
    expect(JSON.stringify(s)).not.toMatch(/R•••/);
  });
});

describe('what onboarding writes', () => {
  it('writes the licence, selfie and vehicle documents — and nothing else', () => {
    const f = registrationFields(filled());
    expect(Object.keys(f).sort()).toEqual(
      ['docStatus', 'license', 'licenseExpiry', 'licenseInfo', 'licenseNumber', 'photoUrl', 'submittedAt', 'updatedAt', 'vehicle', 'vehicleInfo', 'vehicleNumber', 'vehicleType', 'updatedAt'].filter((k, i, a) => a.indexOf(k) === i).sort(),
    );
    expect(f).not.toHaveProperty('bank');
    expect(f).not.toHaveProperty('identity');
    expect(f).not.toHaveProperty('address');
    expect(f.vehicleNumber).toBe('TN01AB1234');
  });

  it('a resubmission cannot wipe contact or payout details saved later', () => {
    const f = registrationFields(filled());
    for (const k of ['bank', 'identity', 'email', 'dob', 'gender', 'address', 'city', 'pincode', 'emergencyContact', 'emergencyContactName', 'name']) expect(f).not.toHaveProperty(k);
  });

  it("a vendor's employee is registered without a vehicle", () => {
    const d = buildNewDriverDoc('drv1', '+919876543210', emptyRegistration('+91 98765 43210'), { vendorId: 'v1', vendorName: 'Fleet', preApproved: false });
    expect(d).toMatchObject({ vendorId: 'v1', status: 'Pending', role: 'driver' });
    expect(d).not.toHaveProperty('vehicleInfo');
    expect(d).not.toHaveProperty('vehicleNumber');
  });

  it('shows a readable name until staff record it from the licence', () => {
    expect(fallbackName('+91 98765 43210')).toBe('Driver ••3210');
    expect(fallbackName('')).toBe('NESAM Driver');
  });
});

describe('shared format helpers', () => {
  it('checks the Aadhaar Verhoeff checksum', () => {
    expect(isValidAadhaar('234567890124')).toBe(true);
    expect(isValidAadhaar('234567890123')).toBe(false);
  });

  it('computes age and compares dates as local calendar days', () => {
    expect(ageOn('2000-09-29', new Date(2018, 8, 28))).toBe(17);
    expect(ageOn('2000-09-28', new Date(2018, 8, 28))).toBe(18);
    expect(isFutureDate('2026-09-29', '2026-09-28')).toBe(true);
    expect(isFutureDate('2026-09-28', '2026-09-28')).toBe(false);
    expect(localDateISO(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('masks sensitive numbers', () => {
    expect(maskAadhaar('234567890124')).toBe('XXXX XXXX 0124');
    expect(maskAccount('123456789012')).toBe('••••••••9012');
  });
});
