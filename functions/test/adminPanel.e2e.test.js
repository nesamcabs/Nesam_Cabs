const test = require('node:test'), assert = require('node:assert/strict');
if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.GCLOUD_PROJECT !== 'demo-nesam') throw Error('Run with demo-nesam emulators only');
const path = require('path'), { createRequire } = require('module');
const requireAdmin = createRequire(path.resolve(__dirname,'../../admin/package.json'));
const appSdk = requireAdmin('firebase/app'), authSdk = requireAdmin('firebase/auth'), fsSdk = requireAdmin('firebase/firestore'), fnSdk = requireAdmin('firebase/functions');
const H = require('./helpers.e2e');
const app = appSdk.initializeApp({projectId:'demo-nesam',apiKey:'fake',authDomain:'demo-nesam.firebaseapp.com'});
const auth = authSdk.getAuth(app), db = fsSdk.getFirestore(app), functions = fnSdk.getFunctions(app);
authSdk.connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
fsSdk.connectFirestoreEmulator(db,'127.0.0.1',8080);
fnSdk.connectFunctionsEmulator(functions,'127.0.0.1',5001);
const load = require('./adminServiceLoader.cjs')({app,auth,db,functions,storage:{}});
const F = load('src/services/adminFirestoreService.ts');
const uid = 'admin-control-audit';
test.before(async()=>{
  await H.db.doc(`admins/${uid}`).set({role:'admin',status:'active',staffRole:'super_admin',name:'Admin audit'});
  await H.db.doc('customers/audit-customer').set({uid:'audit-customer',name:'Audit Customer',phone:'+910000000001',status:'Approved'});
  try { await H.admin.auth().createUser({uid}); } catch(e) { if(e.code!=='auth/uid-already-exists')throw e; }
  await authSdk.signInWithCustomToken(auth,await H.admin.auth().createCustomToken(uid));
});
test('35 primary admin root collections can be queried by the master account', async()=>{
  const roots = ['bookings','marketplace_trips','partner_requests','customers','business_accounts','drivers','vendors','vehicles','vehicle_categories','accounts_register','penalties','invoices','payout_requests','settlement_dues','wallet_ledger','partner_deposits','business_config','notice_campaigns','notifications','notification_deliveries','support_tickets','admins','staff_roles','staff_sessions','staff_activity','security_events','settings','coupons','services','tour_packages','locations','reviews','b2b_partners','legal_documents','partner_links'];
  const failures=[];
  for(const name of roots) try { await fsSdk.getDocs(fsSdk.query(fsSdk.collection(db,name),fsSdk.limit(1))); } catch(e){failures.push(`${name}: ${e.code}`);}
  assert.deepEqual(failures,[]);
});
test('content, pricing, support, review, finance and settings writes enforce success/failure',async()=>{
  for(const [name,data] of [['services',{name:'Audit',status:'Inactive'}],['tour_packages',{name:'Audit package',status:'Draft'}],['locations',{name:'Audit City',status:'Active'}],['coupons',{code:'AUDIT',status:'Active'}],['reviews',{status:'Pending',overallRating:4,customerId:'audit-customer'}]]) {
    const id=`control-audit-${name}`;
    assert.equal(await F.setFirestoreDocument(name,id,data),true,name+' create');
    assert.equal(await F.updateFirestoreDocument(name,id,{auditChecked:true}),true,name+' update');
    const saved = await fsSdk.getDoc(fsSdk.doc(db,name,id));
    assert.equal(saved.data().auditChecked,true);
  }
  assert.equal(await F.updateFirestoreDocument('reviews','missing-audit-record',{status:'Published'}),false);
  await H.db.doc('support_tickets/control-audit-ticket').set({customerId:'audit-customer',status:'Open'});
  assert.equal(await F.updateFirestoreDocument('support_tickets','control-audit-ticket',{status:'Resolved'}),true);
  assert.equal(await F.saveSettings({companyName:'Local audit company',currency:'INR'}),true);
  const originalOperations=(await H.db.doc('settings/operations').get()).data();
  assert.equal(await F.saveSettings({advanceBookingLimit:'45',minBookingNotice:'1.5'}),true);
  const operations=(await H.db.doc('settings/operations').get()).data();
  assert.equal(operations.bookingMaxAdvanceDays,45);assert.equal(operations.bookingMinLeadMinutes,90);
  assert.equal(await F.saveSettings({advanceBookingLimit:'-1'}),false);
  if(originalOperations)await H.db.doc('settings/operations').set(originalOperations);else await H.db.doc('settings/operations').delete();
  const accounts = load('src/services/accountsService.ts');
  const entry = await accounts.addRegisterEntry({type:'Expense',amount:100,status:'Pending',description:'Local audit expense'});
  await accounts.markRegister(entry,{status:'Verified'});
  assert.equal((await fsSdk.getDoc(fsSdk.doc(db,'accounts_register',entry))).data().status,'Verified');
});
test('business receipts are atomic, retry-safe and reject invalid amounts',async()=>{
  const B = load('src/services/businessService.ts');
  const id = 'audit-business-receipts-'+Date.now();
  await H.db.doc(`business_accounts/${id}`).set({name:'Audit company',status:'Active',balance:0});
  await Promise.all([B.recordBusinessPayment(id,500,'UPI','AUDIT-REF-1'),B.recordBusinessPayment(id,500,'UPI','AUDIT-REF-1')]);
  assert.equal((await H.db.doc(`business_accounts/${id}`).get()).data().balance,500);
  assert.equal((await H.db.collection(`business_accounts/${id}/payments`).get()).size,1);
  await assert.rejects(B.recordBusinessPayment(id,600,'UPI','AUDIT-REF-1'));
  await assert.rejects(B.recordBusinessPayment(id,-500,'Cash','AUDIT-NEGATIVE'));
  await assert.rejects(B.recordBusinessPayment('audit-missing-business',500,'UPI','AUDIT-MISSING'));
  assert.equal((await H.db.collection('business_accounts/audit-missing-business/payments').get()).size,0);
});
test('invoice issuance is linked to its booking and duplicate issuance is refused',async()=>{
  const I = load('src/services/invoiceService.ts');
  const id='audit-invoice-'+Date.now();
  const b={id,bookingId:id,status:'Completed',fare:1000,tollCharges:0,customerId:'audit-customer',customerName:'Audit Customer',pickup:'Theni',drop:'Madurai',payment:'Paid',vehicle:'Sedan',distanceKm:80};
  await H.db.doc(`bookings/${id}`).set(b);
  const company=I.companyFromSettings({companyName:'Audit Company',gst:'33ABCDE1234F1Z5',address:'Test address, Tamil Nadu',phone:'9000000000',email:'audit@example.test'});
  const params={booking:b,company,billing:{name:'Audit Customer',gstin:'',address:'Test address',email:''},actorId:uid};
  const inv=await I.createInvoice(params);
  assert.equal((await H.db.doc(`bookings/${id}`).get()).data().invoiceId,inv.id);
  assert.equal((await H.db.doc(`invoices/${inv.id}`).get()).data().bookingDocumentId,id);
  await assert.rejects(I.createInvoice(params),/already exists/);
});
test('Communication sends a real in-app record and logs its delivery',async()=>{
  const N=load('src/services/adminNotificationService.ts');
  const title='Audit notice '+Date.now();
  const r=await N.sendAdminNotification({target:'single_user',recipientId:'audit-customer',recipientType:'customer',channel:'In-App',type:'bookings',title,message:'Local delivery test only'});
  assert.equal(r.success,true,JSON.stringify(r));
  const notifications=await H.db.collection('notifications').where('title','==',title).get();
  assert.equal(notifications.size,1);
  assert.equal(notifications.docs[0].data().recipientId,'audit-customer');
  const deliveries=await H.db.collection('notification_deliveries').where('notificationId','==',notifications.docs[0].id).get();
  assert.ok(deliveries.size>0);
});
test('limited staff may moderate reviews but cannot change finance or pricing',async()=>{
  const limited='audit-engagement-only';
  await H.db.doc(`admins/${limited}`).set({role:'admin',status:'active',staffRole:'audit_engagement',permissions:['engagement'],name:'Limited audit staff'});
  try {await H.admin.auth().createUser({uid:limited});} catch(e){if(e.code!=='auth/uid-already-exists')throw e;}
  await authSdk.signInWithCustomToken(auth,await H.admin.auth().createCustomToken(limited));
  assert.equal(await F.updateFirestoreDocument('reviews','control-audit-reviews',{status:'Hidden'}),true);
  assert.equal(await F.setFirestoreDocument('coupons','forbidden-audit-coupon',{code:'FORBIDDEN'}),false);
  assert.equal(await F.setFirestoreDocument('accounts_register','forbidden-audit-money',{amount:1}),false);
  await authSdk.signInWithCustomToken(auth,await H.admin.auth().createCustomToken(uid));
});
test.after(async()=>{await authSdk.signOut(auth);await fsSdk.terminate(db);await H.db.terminate();await appSdk.deleteApp(app);});
