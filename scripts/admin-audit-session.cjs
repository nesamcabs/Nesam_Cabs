// Disposable local Firebase session. Never connects to production.
const fs = require('fs'), path = require('path');
const H = require('../functions/test/helpers.e2e');
const { db, admin, TS } = H;
if (process.env.GCLOUD_PROJECT !== 'demo-nesam' || !process.env.FIRESTORE_EMULATOR_HOST) throw Error('Run through demo-nesam emulators:exec only');
async function main() {
  const stop = path.resolve(__dirname,'../output/admin-audit/stop-session');
  // This marker belongs solely to this disposable test session.
  if(fs.existsSync(stop))fs.unlinkSync(stop);
  const uid = 'admin-control-audit';
  try { await admin.auth().createUser({uid,email:'admin-audit@example.test',password:'LocalAudit123!',displayName:'Local Audit Admin'}); } catch(e) { if(e.code!=='auth/uid-already-exists')throw e; }
  await db.doc(`admins/${uid}`).set({role:'admin',status:'active',staffRole:'super_admin',name:'Local Audit Admin',email:'admin-audit@example.test'});
  await db.doc('customers/audit-customer').set({uid:'audit-customer',name:'Audit Customer',phone:'+910000000001',email:'customer@example.test',status:'Approved',walletBalance:0,createdAt:TS.now()});
  await db.doc('vendors/audit-vendor').set({uid:'audit-vendor',role:'vendor',companyName:'Audit Fleet',name:'Audit Vendor',phone:'+910000000002',email:'vendor@example.test',status:'APPROVED',createdAt:TS.now()});
  await db.doc('drivers/audit-driver').set({uid:'audit-driver',role:'driver',name:'Audit Driver',phone:'+910000000003',email:'driver@example.test',status:'Approved',docStatus:'Approved',presenceStatus:'Online',fleetStatus:'Active',vendorId:'',assignedVehicleId:'audit-vehicle',assignedVehicleNumber:'TN00AA0001',createdAt:TS.now()});
  await db.doc('vehicles/audit-vehicle').set({vendorId:'',assignedDriverId:'audit-driver',vehicleNumber:'TN00AA0001',make:'Maruti',model:'Dzire',category:'Sedan',seatingCapacity:4,docStatus:'Approved',status:'Active',createdAt:TS.now()});
  await db.doc('vehicle_categories/audit-sedan').set({name:'Sedan',code:'sedan',seatingCapacity:4,status:'Active',displayOrder:1,fare:{baseFare:70,baseKm:2,perKmRate:16,minimumFare:100}});
  await db.doc('services/audit-service').set({name:'Audit One Way',code:'AUDIT_ONEWAY',slug:'audit-one-way',serviceType:'One Way Taxi',status:'Active',onlineBookingEnabled:true,adminBookingEnabled:true,displayOrder:1});
  await db.doc('locations/audit-city').set({name:'Theni',state:'Tamil Nadu',type:'City',status:'Active',latitude:10.0104,longitude:77.4768});
  await db.doc('b2b_partners/audit-b2b').set({name:'Audit Corporate',category:'Corporate',status:'Active'});
  await db.doc('support_tickets/audit-ticket').set({userId:'audit-customer',userType:'customer',name:'Audit Customer',subject:'Test trip enquiry',message:'Local test support request',status:'Open',createdAt:TS.now()});
  const routing = await H.startRoutingStub();
  const start = Date.now();
  console.log('ADMIN_AUDIT_READY (local emulator only; admin-audit@example.test / LocalAudit123!)');
  const tick = setInterval(async()=>{
    if (fs.existsSync(stop)||Date.now()-start>3600000) { clearInterval(tick);routing.close();await db.terminate(); }
  },1000);
}
main().catch(e=>{console.error(e);process.exit(1);});
