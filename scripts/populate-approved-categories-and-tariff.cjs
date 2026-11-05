// Migration script to populate approved vehicle categories and tariff configuration
// Source: Nesam_Vehicle_Category_and_Vendor_Duty_Rules.pdf & Nesam_Developer_Tariff_and_Operations_v2_0.pdf
//
// Usage:
//   node scripts/populate-approved-categories-and-tariff.js [--apply]
//
// Defaults to dry-run preview mode.

const path = require('path');
const admin = require(path.resolve(__dirname, '../functions/node_modules/firebase-admin'));

const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || 'C:\\Users\\User\\Downloads\\nesamtoursandtravels-202f5-firebase-adminsdk-fbsvc-292e301f9a.json';
const sa = require(keyPath);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(sa),
  });
}

const db = admin.firestore();

// ── Approved Vehicle Categories (Vehicle Category & Vendor Duty Rules, 08 Oct 2026) ────
const APPROVED_CATEGORIES = [
  {
    id: 'sedan',
    name: 'Sedan',
    code: 'SEDAN',
    description: 'Comfortable AC sedans for everyday & outstation travel (Dzire, Etios, Aura)',
    imageUrl: '',
    icon: '🚘',
    seatingCapacity: 4,
    recommendedPassengers: 4,
    luggageCapacity: '2 Bags',
    acSupported: 'Both',
    displayOrder: 1,
    status: 'Active',
    dutyClass: 'sedan',
    tariffClass: 'sedan',
    fare: {
      baseFare: 800,
      baseKm: 20,
      perKmRate: 15,
      minimumFare: 800,
      driverAllowance: 400,
      nightAllowance: 50,
      waitingChargePerHour: 150,
      extraHourCharge: 350,
      extraKmCharge: 35,
      tollIncluded: false,
      parkingIncluded: false,
      permitCharge: 0,
      carrierCharge: 0,
      outstationPerKmRate: 15,
      outstationDriverBattaPerDay: 400,
      outstationMinKmPerDay: 250,
    },
  },
  {
    id: 'suv-6-1',
    name: 'SUV 6+1',
    code: 'SUV_6_1',
    description: 'Spacious 6-passenger SUVs for family & group travel (Ertiga, Carens, XL6)',
    imageUrl: '',
    icon: '🚙',
    seatingCapacity: 6,
    recommendedPassengers: 6,
    luggageCapacity: '3 Bags',
    acSupported: 'Both',
    displayOrder: 2,
    status: 'Active',
    dutyClass: 'suv6',
    tariffClass: 'suv',
    fare: {
      baseFare: 1200,
      baseKm: 20,
      perKmRate: 20,
      minimumFare: 1200,
      driverAllowance: 400,
      nightAllowance: 75,
      waitingChargePerHour: 150,
      extraHourCharge: 450,
      extraKmCharge: 50,
      tollIncluded: false,
      parkingIncluded: false,
      permitCharge: 0,
      carrierCharge: 400,
      outstationPerKmRate: 20,
      outstationDriverBattaPerDay: 400,
      outstationMinKmPerDay: 250,
    },
  },
  {
    id: 'suv-7-1',
    name: 'SUV 7+1',
    code: 'SUV_7_1',
    description: 'Large 7-passenger SUVs with maximum passenger seating (Scorpio, XUV700)',
    imageUrl: '',
    icon: '🚙',
    seatingCapacity: 7,
    recommendedPassengers: 7,
    luggageCapacity: '4 Bags',
    acSupported: 'Both',
    displayOrder: 3,
    status: 'Active',
    dutyClass: 'suv7',
    tariffClass: 'suv',
    fare: {
      baseFare: 1200,
      baseKm: 20,
      perKmRate: 20,
      minimumFare: 1200,
      driverAllowance: 400,
      nightAllowance: 75,
      waitingChargePerHour: 150,
      extraHourCharge: 450,
      extraKmCharge: 50,
      tollIncluded: false,
      parkingIncluded: false,
      permitCharge: 0,
      carrierCharge: 400,
      outstationPerKmRate: 20,
      outstationDriverBattaPerDay: 400,
      outstationMinKmPerDay: 250,
    },
  },
  {
    id: 'innova',
    name: 'Innova',
    code: 'INNOVA',
    description: 'Comfortable, spacious and reliable Toyota Innova (Standard 6-7 Seater)',
    imageUrl: '',
    icon: '🚐',
    seatingCapacity: 7,
    recommendedPassengers: 6,
    luggageCapacity: '4 Bags',
    acSupported: 'Both',
    displayOrder: 4,
    status: 'Active',
    dutyClass: 'innova',
    tariffClass: 'suv',
    fare: {
      baseFare: 1200,
      baseKm: 20,
      perKmRate: 20,
      minimumFare: 1200,
      driverAllowance: 400,
      nightAllowance: 75,
      waitingChargePerHour: 150,
      extraHourCharge: 450,
      extraKmCharge: 50,
      tollIncluded: false,
      parkingIncluded: false,
      permitCharge: 0,
      carrierCharge: 400,
      outstationPerKmRate: 20,
      outstationDriverBattaPerDay: 400,
      outstationMinKmPerDay: 250,
    },
  },
  {
    id: 'innova-crysta',
    name: 'Innova Crysta',
    code: 'INNOVA_CRYSTA',
    description: 'Executive Luxury MPV, Premium Highway Driver (Top of the Line)',
    imageUrl: '',
    icon: '⭐',
    seatingCapacity: 7,
    recommendedPassengers: 7,
    luggageCapacity: '4 Bags',
    acSupported: 'Both',
    displayOrder: 5,
    status: 'Active',
    dutyClass: 'crysta',
    tariffClass: 'crysta',
    fare: {
      baseFare: 2000,
      baseKm: 20,
      perKmRate: 26,
      minimumFare: 2000,
      driverAllowance: 600,
      nightAllowance: 100,
      waitingChargePerHour: 150,
      extraHourCharge: 600,
      extraKmCharge: 70,
      tollIncluded: false,
      parkingIncluded: false,
      permitCharge: 0,
      carrierCharge: 400,
      outstationPerKmRate: 26,
      outstationDriverBattaPerDay: 500,
      outstationMinKmPerDay: 300,
    },
  },
];

// ── Approved Confirmed Tariff (Tariff & Operations v2.0, 09 Oct 2026) ──────────
const APPROVED_TARIFF_V2 = {
  version: 1,
  enabled: true,
  gstRate: 0.05,
  oneWay: {
    minKm: 130,
    classes: {
      sedan: { customerRate: 15, customerBata: 400, partnerRate: 13.5, partnerBata: 300 },
      suv: { customerRate: 20, customerBata: 400, partnerRate: 18, partnerBata: 300 },
      crysta: { customerRate: 26, customerBata: 600, partnerRate: 24, partnerBata: 400 },
    },
  },
  roundTrip: {
    maxDays: 30,
    classes: {
      sedan: { customerRate: 14, customerBata: 400, partnerRate: 12.6, partnerBata: 300, minKmPerDay: 250 },
      suv: { customerRate: 19, customerBata: 400, partnerRate: 17.1, partnerBata: 300, minKmPerDay: 250 },
      crysta: { customerRate: 22, customerBata: 500, partnerRate: 20, partnerBata: 400, minKmPerDay: 300 },
    },
  },
  rental: {
    classes: {
      sedan: { firstHour: 500, laterHour: 350, minHours: 4, minTimeFare: 1550, partnerPerHour: 250 },
      suv: { firstHour: 700, laterHour: 450, minHours: 5, minTimeFare: 2500, partnerPerHour: 400 },
      crysta: { firstHour: 800, laterHour: 600, minHours: 10, minTimeFare: 6200, partnerPerHour: 500 },
    },
  },
  cityDrop: {
    baseKm: 20,
    zones: [],
    classes: {
      sedan: { customerBase: 800, customerExtraKm: 35, partnerBase: 500, partnerExtraKm: 25 },
      suv: { customerBase: 1200, customerExtraKm: 50, partnerBase: 700, partnerExtraKm: 35 },
      crysta: { customerBase: 2000, customerExtraKm: 70, partnerBase: 1200, partnerExtraKm: 50 },
    },
  },
};

async function main() {
  const isApply = process.argv.includes('--apply');
  console.log('='.repeat(70));
  console.log(`MODE: ${isApply ? 'APPLY (WRITING TO FIRESTORE)' : 'DRY-RUN (PREVIEW ONLY)'}`);
  console.log('='.repeat(70));

  console.log('\n[1] Checking current state in Firestore...');
  const catSnaps = await db.collection('vehicle_categories').get();
  console.log(`Existing vehicle_categories count: ${catSnaps.size}`);

  const tariffDoc = await db.doc('business_config/tariff_v2').get();
  console.log(`Existing business_config/tariff_v2 exists: ${tariffDoc.exists}`);

  console.log('\n[2] Prepared actions:');
  const batch = db.batch();
  const stamp = admin.firestore.FieldValue.serverTimestamp();

  for (const cat of APPROVED_CATEGORIES) {
    const docRef = db.collection('vehicle_categories').doc(cat.id);
    const existing = catSnaps.docs.find((d) => d.id === cat.id);

    console.log(`  -> Path: vehicle_categories/${cat.id}`);
    console.log(`     Action: ${existing ? 'UPDATE (Preserve valid history)' : 'CREATE'}`);
    console.log(`     Category Name: "${cat.name}", Code: "${cat.code}", Capacity: ${cat.seatingCapacity}`);
    console.log(`     Duty Class: "${cat.dutyClass}", Tariff Class: "${cat.tariffClass}"`);
    console.log(`     One-Way /km: Rs ${cat.fare.perKmRate}, Driver Allowance: Rs ${cat.fare.driverAllowance}`);

    if (isApply) {
      const data = {
        ...cat,
        createdAt: existing?.data()?.createdAt || stamp,
        updatedAt: stamp,
        updatedBy: 'system_migration_approved_specs',
      };
      batch.set(docRef, data, { merge: true });
    }
  }

  const tariffRef = db.doc('business_config/tariff_v2');
  console.log(`  -> Path: business_config/tariff_v2`);
  console.log(`     Action: ${tariffDoc.exists ? 'UPDATE' : 'CREATE'}`);
  console.log(`     Tariff Version: 1, Enabled: true, GST: 5%`);

  if (isApply) {
    const tariffData = {
      ...APPROVED_TARIFF_V2,
      createdAt: tariffDoc.exists ? tariffDoc.data()?.createdAt || stamp : stamp,
      updatedAt: stamp,
      updatedBy: 'system_migration_approved_specs',
      reason: 'Initial production activation of confirmed tariff v2 (Tariff & Operations v2.0)',
    };
    batch.set(tariffRef, tariffData, { merge: true });
  }

  if (isApply) {
    console.log('\n[3] Committing batch write to Firestore...');
    await batch.commit();
    console.log('SUCCESS: All 5 approved vehicle categories and tariff_v2 successfully written!');
  } else {
    console.log('\n[3] DRY-RUN COMPLETE: No changes written to database. Run with --apply to commit.');
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
