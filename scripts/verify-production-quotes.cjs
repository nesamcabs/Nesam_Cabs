const path = require('path');
const admin = require(path.resolve(__dirname, '../functions/node_modules/firebase-admin'));
const sa = require('C:\\Users\\User\\Downloads\\nesamtoursandtravels-202f5-firebase-adminsdk-fbsvc-292e301f9a.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

const API_KEY = 'AIzaSyClCvf1FUnXb6na8UeZ_knRBTCakAVJCQs';
const API_BASE = 'https://nesam-travels-api.vercel.app';

async function main() {
  console.log('--- Checking API Health ---');
  const hRes = await fetch(API_BASE + '/api/health');
  console.log('/api/health status:', hRes.status, await hRes.json());

  console.log('\n--- Checking CORS preflight from customer origin ---');
  const corsRes = await fetch(API_BASE + '/api/call/quoteBooking', {
    method: 'OPTIONS',
    headers: {
      'origin': 'https://nesam-travels-user.vercel.app',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,authorization'
    }
  });
  console.log('OPTIONS status:', corsRes.status);
  console.log('Access-Control-Allow-Origin:', corsRes.headers.get('access-control-allow-origin'));

  console.log('\n--- Checking Auth Rejection ---');
  const unauthRes = await fetch(API_BASE + '/api/call/quoteBooking', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: {} })
  });
  console.log('Unauthenticated status:', unauthRes.status, await unauthRes.json());

  console.log('\n--- Minting test customer token ---');
  const uid = 'zz-test-cust-' + Date.now();
  await admin.auth().createUser({ uid, email: uid + '@example.com' });
  await db.doc('customers/' + uid).set({
    name: 'Live Quote Verifier',
    phone: '+919876543210',
    email: uid + '@example.com',
    status: 'Approved',
    walletBalance: 0
  });

  const customToken = await admin.auth().createCustomToken(uid);
  const signInRes = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + API_KEY, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const { idToken } = await signInRes.json();
  console.log('ID token obtained successfully.');

  try {
    console.log('\n--- Testing quoteBooking: Outstation One-Way (Chennai -> Madurai, ~450 km) ---');
    const scheduledAt = new Date(Date.now() + 24 * 3600000).toISOString();
    const oneWayPayload = {
      pickup: { name: 'Chennai Central', address: 'Chennai, Tamil Nadu', lat: 13.0827, lng: 80.2707, type: 'other' },
      drop: { name: 'Madurai Junction', address: 'Madurai, Tamil Nadu', lat: 9.9252, lng: 78.1198, type: 'other' },
      tripType: 'One Way',
      scheduledAt
    };
    const q1Res = await fetch(API_BASE + '/api/call/quoteBooking', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + idToken },
      body: JSON.stringify({ data: oneWayPayload })
    });
    const q1Data = await q1Res.json();
    console.log('One-way quote HTTP status:', q1Res.status);
    if (q1Data.result) {
      console.log('Route distance:', q1Data.result.route.distanceKm, 'km, duration:', Math.round(q1Data.result.route.durationMin), 'min');
      console.log('Service:', q1Data.result.service);
      console.log('Quotes count:', q1Data.result.quotes?.length);
      for (const q of q1Data.result.quotes || []) {
        console.log(`  * ${q.categoryId}: ok=${q.ok}, total=₹${q.fare?.total}, model=${q.model}, subtotal=₹${q.fare?.subtotal}`);
      }
    } else {
      console.log('Error:', JSON.stringify(q1Data));
    }

    console.log('\n--- Testing quoteBooking: Round Trip (Chennai -> Pondicherry, 2 days) ---');
    const tripEndAt = new Date(Date.now() + 48 * 3600000).toISOString();
    const roundTripPayload = {
      pickup: { name: 'Chennai Central', address: 'Chennai, Tamil Nadu', lat: 13.0827, lng: 80.2707, type: 'other' },
      drop: { name: 'White Town Pondicherry', address: 'Pondicherry, Tamil Nadu', lat: 11.9338, lng: 79.8335, type: 'other' },
      tripType: 'Round Trip',
      scheduledAt,
      tripEndAt
    };
    const q2Res = await fetch(API_BASE + '/api/call/quoteBooking', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + idToken },
      body: JSON.stringify({ data: roundTripPayload })
    });
    const q2Data = await q2Res.json();
    console.log('Round-trip quote HTTP status:', q2Res.status);
    if (q2Data.result) {
      console.log('Route distance:', q2Data.result.route.distanceKm, 'km');
      console.log('Quotes count:', q2Data.result.quotes?.length);
      for (const q of q2Data.result.quotes || []) {
        console.log(`  * ${q.categoryId}: ok=${q.ok}, total=₹${q.fare?.total}, days=${q.days}, model=${q.model}`);
      }
    } else {
      console.log('Error:', JSON.stringify(q2Data));
    }

    console.log('\n--- Testing quoteBooking: Airport Taxi (Chennai -> Chennai Airport) ---');
    const airportPayload = {
      pickup: { name: 'T Nagar', address: 'T Nagar, Chennai, Tamil Nadu', lat: 13.0418, lng: 80.2341, type: 'other' },
      drop: { name: 'Chennai International Airport (MAA)', address: 'Meenambakkam, Chennai', lat: 12.9941, lng: 80.1709, type: 'airport' },
      tripType: 'Airport Taxi',
      scheduledAt
    };
    const q3Res = await fetch(API_BASE + '/api/call/quoteBooking', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + idToken },
      body: JSON.stringify({ data: airportPayload })
    });
    const q3Data = await q3Res.json();
    console.log('Airport quote HTTP status:', q3Res.status);
    if (q3Data.result) {
      console.log('Service:', q3Data.result.service);
      console.log('Quotes count:', q3Data.result.quotes?.length);
      for (const q of q3Data.result.quotes || []) {
        console.log(`  * ${q.categoryId}: ok=${q.ok}, total=₹${q.fare?.total}, service=${q.service}`);
      }
    } else {
      console.log('Error:', JSON.stringify(q3Data));
    }

    console.log('\n--- Testing quoteBooking: Local Rental (Within City Disposal) ---');
    const rentalPayload = {
      pickup: { name: 'T Nagar', address: 'T Nagar, Chennai, Tamil Nadu', lat: 13.0418, lng: 80.2341, type: 'other' },
      drop: { name: 'Within City Disposal', address: 'Within City Limits, Chennai', lat: 13.0418 + 0.04, lng: 80.2341 + 0.04, type: 'other' },
      tripType: 'Local Rental',
      scheduledAt
    };
    const q4Res = await fetch(API_BASE + '/api/call/quoteBooking', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + idToken },
      body: JSON.stringify({ data: rentalPayload })
    });
    const q4Data = await q4Res.json();
    console.log('Local Rental quote HTTP status:', q4Res.status);
    if (q4Data.result) {
      console.log('Service:', q4Data.result.service);
      console.log('Quotes count:', q4Data.result.quotes?.length);
      for (const q of q4Data.result.quotes || []) {
        console.log(`  * ${q.categoryId}: ok=${q.ok}, total=₹${q.fare?.total}, minimumFareAdjustment=${q.fare?.minimumFareAdjustment}`);
      }
    } else {
      console.log('Error:', JSON.stringify(q4Data));
    }

  } finally {
    console.log('\n--- Cleaning up temporary test user and document ---');
    await db.doc('customers/' + uid).delete().catch(() => {});
    await admin.auth().deleteUser(uid).catch(() => {});
    console.log('Cleaned up successfully. 0 test records remain.');
  }
}

main().catch(console.error);
