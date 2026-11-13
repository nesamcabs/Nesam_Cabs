import { readFileSync } from 'fs';
import { join } from 'path';
import { buildFleetDetails, displayPlate, emptyVehicle, fleetIsComplete, isPlate, normalizePlate, validateVehicle, vehicleFromPlate } from '../src/utils/fleet';
import { buildVendorSignupRecord, missingSections, vehicleDocsMissing, vendorDocsComplete } from '../src/services/onboardingService';
import type { FleetVehicleDoc, VendorRecord } from '../src/types/vendor';

const vehicle = (plate = 'TN01AB1234'): FleetVehicleDoc => vehicleFromPlate(plate);

describe('fleet: a vehicle needs only its registration number', () => {
  it('accepts a vehicle known only by its plate', () => {
    expect(validateVehicle(vehicle(), { others: [] })).toEqual({});
    expect(vehicle()).toMatchObject({ registrationNumber: 'TN01AB1234', source: 'manual', rcFiles: [], insuranceUpto: '' });
  });

  it('refuses a malformed plate and a plate already in the application', () => {
    expect(validateVehicle({ registrationNumber: 'NOTAPLATE' }, { others: [] }).registrationNumber).toBeTruthy();
    expect(validateVehicle({ registrationNumber: '' }, { others: [] }).registrationNumber).toBeTruthy();
    expect(validateVehicle(vehicle(), { others: ['TN01AB1234'] }).registrationNumber).toMatch(/already in your application/i);
  });

  it('plates ignore case, spaces and hyphens', () => {
    expect(normalizePlate('tn-01 ab 1234')).toBe('TN01AB1234');
    expect(isPlate('TN 01 AB 1234')).toBe(true);
    expect(isPlate('22 BH 1234 AA')).toBe(true);
    expect(isPlate('TN01')).toBe(false);
    expect(displayPlate('tn01ab1234')).toBe('TN 01 AB 1234');
  });

  it('builds the stored fleet with per-document aggregates', () => {
    const f = buildFleetDetails([vehicle('TN01AB1234'), { ...vehicle('TN02CD5678'), category: 'SUV' }]);
    expect(f.fleetSize).toBe(2);
    expect(f.plates).toEqual(['TN01AB1234', 'TN02CD5678']);
    expect(f.vehicleTypes).toEqual(['SUV']);
    expect(f.rcFiles).toHaveLength(0);
  });

  it('a stored fleet is complete when it lists valid, unique plates', () => {
    expect(fleetIsComplete(null)).toBe(false);
    expect(fleetIsComplete(buildFleetDetails([]))).toBe(false);
    expect(fleetIsComplete(buildFleetDetails([vehicle()]))).toBe(true);
    expect(fleetIsComplete(buildFleetDetails([vehicle(), vehicle()]))).toBe(false);
    expect(fleetIsComplete(buildFleetDetails([{ ...emptyVehicle(), registrationNumber: 'BAD' }]))).toBe(false);
  });

  it('missing sections: business, account details, business documents and vehicle documents', () => {
    const base: VendorRecord = { uid: 'v1', phone: '+919800000001', status: 'INCOMPLETE', onboardingStep: 0, business: null, documents: null, fleet: null, payoutSummary: null, review: null, submittedAt: null };
    expect(missingSections(base).sort()).toEqual(['business', 'documents', 'fleet', 'payout']);
    const file = (path: string) => ({ path, name: path, contentType: 'application/pdf', size: 1 }) as never;
    const documented = { ...vehicle(), rcFiles: [file('rc')], insuranceFiles: [file('ins')], fitnessFiles: [file('fc')], permitFiles: [file('permit')], frontPhotoFiles: [file('photo')] };
    const done: VendorRecord = {
      ...base,
      business: { vendorName: 'Ravi', businessName: 'Sri Balaji', email: '', altPhone: '', address: { line1: '', line2: '', city: '', state: '', pincode: '' } },
      payoutSummary: { accountHolderName: 'Ravi', bankLast4: '9012', ifsc: 'SBIN0001234', upiId: '' },
      documents: { businessRegistration: { type: 'GST', number: '33ABCDE1234F1Z5', files: [file('gst')] }, identityProof: { type: 'PAN', maskedNumber: '••••234F', files: [file('pan')] } },
      fleet: buildFleetDetails([vehicle()]),
    };
    // A vehicle known only by its plate is not enough: RC, insurance, FC, permit and a photo are required.
    expect(missingSections(done)).toEqual(['fleet']);
    expect(vehicleDocsMissing(vehicle())).toEqual(['RC', 'Insurance', 'Fitness (FC)', 'Permit', 'Vehicle photo']);
    const complete = { ...done, fleet: buildFleetDetails([documented]) };
    expect(missingSections(complete)).toEqual([]);
    expect(vendorDocsComplete(complete)).toBe(true);
    expect(vendorDocsComplete(done)).toBe(false);
  });
});

describe('sign-up with a vehicle number', () => {
  const record = buildVendorSignupRecord('uid1', '+919876543210', 'tn 01 ab 1234');

  it('creates a draft application with the one vehicle; documents are uploaded before review', () => {
    expect(record).toMatchObject({ uid: 'uid1', role: 'vendor', phone: '+919876543210', status: 'INCOMPLETE', fleetSize: 1, totalFleetSize: 1 });
    expect('submittedAt' in record).toBe(false);
    expect(record.fleet.plates).toEqual(['TN01AB1234']);
    expect(record.fleet.vehicles).toHaveLength(1);
    expect(record.fleet.vehicles[0]).toMatchObject({ registrationNumber: 'TN01AB1234', source: 'manual' });
    expect(record.companyName).toBe('Partner TN 01 AB 1234');
  });

  it('only writes keys the Firestore rules let a vendor own (vendorOwnerKeys)', () => {
    const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8');
    const block = /function vendorOwnerKeys\(\) \{\s*return \[([^\]]*)\]/.exec(rules);
    expect(block).not.toBeNull();
    const allowed = new Set([...block![1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]));
    const extra = Object.keys(record).filter((k) => !allowed.has(k));
    expect(extra).toEqual([]);
  });
});
