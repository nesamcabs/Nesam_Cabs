const test = require('node:test'), assert = require('node:assert/strict');
const H = require('./helpers.e2e');
const { db, call, rid, TS, place, istInstant } = H;
const A = 'fare-controls-master', brands = ['nesam','people_taxi','onewaycarrentals'];
const services = ['One Way','Round Trip','Airport Taxi','Local Rental','Multicity'];
let routing, serial = 0;
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
const pickup = { ...place('Controls Theni',10.0104,77.4768), id:'control-pickup' };
const drop = { ...place('Controls Airport',9.9252,78.1198), id:'control-drop', type:'airport' };
const stop = { ...place('Controls Trichy',10.7905,78.7047), id:'control-stop' };
const scheduledAt = istInstant(4,'08:00'), tripEndAt = istInstant(4,'18:00');
async function quote(brand, service, saveTour = false) {
  if (service === 'Multicity') {
    const enquiryId = `NSM-QT-${String(980000 + serial++)}`;
    await db.doc(`enquiries/${enquiryId}`).set({code:enquiryId,status:'New',brand,customerId:'control-customer',tripType:'Multicity',serviceId:'multicity',pickupPoint:pickup,dropPoint:drop,stops:[stop],itinerary:[pickup,stop,drop],pickupAt:TS.fromDate(new Date(scheduledAt)),tripEndAt:TS.fromDate(new Date(tripEndAt))});
    const r = await call(A,'priceMulticityEnquiry',{enquiryId,categoryId:'control-sedan',save:saveTour});
    const revision=saveTour&&r.ok?(await db.doc(`enquiries/${enquiryId}`).get()).data().quoteRevision:null;
    return r.ok ? {ok:true,data:{total:r.data.estimate,payout:r.data.payout,enquiryId,revision}} : r;
  }
  const r = await call(A,'createAdminBooking',{requestId:rid('controls'),quoteOnly:true,brand,categoryId:'control-sedan',tripType:service,pickupLocationId:pickup.id,dropLocationId:drop.id,scheduledAt,tripEndAt,rentalHours:12}); // master locations only: a map pin is never GST-verified
  return r.ok ? {ok:true,data:{total:r.data.quote.total,payout:r.data.pricing.partner.basePaise/100}} : r;
}
async function rule(brand,service,kind,patch={}) {
  return ok(await call(A,'saveServiceRule',{reason:'Synthetic controls audit',rule:{brand,fareService:service,kind,name:'Synthetic scoped '+kind,priority:20,scope:{state:'',city:'',area:'',side:'Pickup or drop'},service:'',schedule:{mode:'Always'},...patch}}));
}
async function remove(r) { ok(await call(A,'setServiceRuleStatus',{id:r.id,expectedVersion:r.version,status:'Removed',reason:'Finish isolated control check'})); }
test.before(async()=>{
  routing=await H.startRoutingStub();
  await db.doc(`admins/${A}`).set({role:'admin',status:'active',staffRole:'super_admin',name:'Controls master'});
  await db.doc('settings/config').set({smsEnabled:false,emailEnabled:false,whatsappEnabled:false,pushEnabled:false});
  await db.doc('settings/operations').set({bookingMinLeadMinutes:0,bookingMaxAdvanceDays:365});
  await db.doc('customers/control-customer').set({status:'Active',name:'Synthetic rider',phone:'+919000000001'});
  for (const [id,p] of [['control-pickup',pickup],['control-drop',drop],['control-stop',stop]]) await db.doc('locations/'+id).set({...p,type:id==='control-drop'?'Airport':'City',city:p.name,state:'33',status:'Active'});
  for (const [id,name,cls] of [['control-sedan','Sedan','sedan'],['control-suv','SUV 7+1','suv']]) await db.doc('vehicle_categories/'+id).set({name,status:'Active',tariffClass:cls,dutyClass:cls,seats:4,seatingCapacity:4,fare:{baseFare:70,baseKm:2,perKmRate:16,minimumFare:100}});
  ok(await call(A,'saveTariffConfig',{useConfirmedDefaults:true,enabled:true,reason:'Controls emulator setup'}));
  const rentalVersion=(await db.doc('business_config/tariff_v2').get()).data().version;
  ok(await call(A,'saveTariffSection',{section:'rentalPackage',class:'sedan',hours:12,expectedVersion:rentalVersion,reason:'Synthetic explicit rental fixture',data:{customerFare:1800,partnerPayout:1200,includedKm:120,extraKmRate:25,extraHourRate:180,gstMode:'excluded',enabled:true}}));
  // Airport requires an explicit complete transfer rate; all values are synthetic.
  for (const brand of brands) {
    const version=(await db.doc('business_config/tariff_v2').get()).data().version;
    ok(await call(A,'saveTariffSection',{section:'brandOverride',brand,service:'Airport Taxi',class:'sedan',expectedVersion:version,reason:'Synthetic airport controls fixture',data:{customerBase:1000,partnerBase:700,minKm:20,extraKmRate:20,partnerRate:12}}));
  }
});
test.after(async()=>{if(routing)await new Promise(r=>routing.close(r));});

for(const brand of brands)for(const service of services)test(`${brand}/${service}: availability, categories, customer/partner rules, schedule, limits, scope isolation`,async()=>{
  const baseline=ok(await quote(brand,service));
  const other=brands.find(x=>x!==brand), otherBefore=ok(await quote(other,service));
  let r=await rule(brand,service,'availability',{availability:'Paused'});
  const paused=await quote(brand,service);assert.equal(paused.ok,false);assert.match(paused.message,/paused/i);
  assert.equal(ok(await quote(other,service)).total,otherBefore.total,'another brand unaffected');await remove(r);
  r=await rule(brand,service,'categories',{categories:['SUV 7+1']});
  assert.equal((await quote(brand,service)).ok,false,'hidden cab cannot be quoted');await remove(r);
  r=await rule(brand,service,'pricing',{customer:{mode:'Increase',percent:10},partner:{mode:'Decrease',percent:5}});
  const adjusted=ok(await quote(brand,service));
  assert.ok(Math.abs(adjusted.total-baseline.total*1.1)<=.02,'customer adjustment applied once');
  assert.ok(Math.abs(adjusted.payout-baseline.payout*.95)<=.01,'partner payout adjustment');await remove(r);
  r=await rule(brand,service,'availability',{availability:'Paused',schedule:{mode:'Range',from:istInstant(20,'08:00'),to:istInstant(21,'08:00')}});
  assert.equal(ok(await quote(brand,service)).total,baseline.total,'future pause not applied early');await remove(r);
  for(const target of ['Customer fare','Partner payout']){
    r=await rule(brand,service,'limit',{limit:{target,category:'Sedan',min:0,max:1,reference:'Synthetic limit'}});
    assert.equal((await quote(brand,service)).ok,false,target+' limit enforced');await remove(r);
  }
  if(service==='Multicity'){
    r=await rule(brand,service,'availability',{availability:'Paused',scope:{state:'33',city:'Controls Trichy',area:'',side:'Pickup or drop'}});
    assert.equal((await quote(brand,service)).ok,false,'intermediate stop pause enforced');await remove(r);
  }
});

test('public Multicity cannot silently quote a One Way fare; nonstaff cannot change rates; stale saves refused',async()=>{
  const q=await call('control-customer','quoteBooking',{brand:'nesam',tripType:'Multicity',pickup,drop,scheduledAt});
  assert.equal(q.ok,false);assert.match(q.message,/Multicity/i);
  const booking=await call('control-customer','createBooking',{requestId:rid('invalid_direct_tour'),brand:'nesam',tripType:'Multicity',paymentMethod:'UPI'});
  assert.equal(booking.ok,false);assert.match(booking.message,/Multicity/i);
  const version=(await db.doc('business_config/tariff_v2').get()).data().version;
  const i={section:'brandOverride',brand:'nesam',service:'One Way',class:'sedan',expectedVersion:version,reason:'Synthetic guarded write',data:{customerRate:30}};
  assert.equal((await call('control-customer','saveTariffSection',i)).ok,false);
  ok(await call(A,'saveTariffSection',i));assert.equal((await call(A,'saveTariffSection',i)).ok,false);
});

test('every GST brand/service supports included/excluded, pickup-state override, removal and inheritance',async()=>{
  for(const brand of brands)for(const service of services){ try {
    const baseline=ok(await quote(brand,service));
    const save=async(state,rate,mode,clearOverride=false)=>{
      const version=(await db.doc('business_config/tariff_v2').get()).data().version;
      return ok(await call(A,'saveTariffSection',{section:'fareGst',brand,service,expectedVersion:version,reason:'Synthetic approved GST control check',clearOverride,data:{state,rule:{supplierState:'33',rate,mode,classification:service==='Local Rental'?'rental':'passenger',reference:'Synthetic tax fixture only'}}}));
    };
    await save('',.12,'excluded'); const excluded=ok(await quote(brand,service));
    // Default (no rule): the entered rates already include 5% GST. A saved 12% 'excluded' rule adds 12% on top of the same rates.
    assert.ok(Math.abs(excluded.total-baseline.total*1.12)<.03);
    await save('33',.12,'included');const included=ok(await quote(brand,service));
    assert.ok(Math.abs(included.total-baseline.total)<.03,'12% included keeps the entered amount as the total');
    assert.equal(included.payout,baseline.payout,'tax never changes agreed partner rate');
    const pricing=await rule(brand,service,'pricing',{customer:{mode:'Increase',percent:10},partner:{mode:'Normal',percent:0}});
    assert.ok(Math.abs(ok(await quote(brand,service)).total-included.total*1.1)<.03,'included GST plus scheduled adjustment applied once');
    await remove(pricing);
    await save('33',.12,'included',true);assert.equal(ok(await quote(brand,service)).total,excluded.total);
    await save('',.12,'excluded',true);assert.equal(ok(await quote(brand,service)).total,baseline.total);
  } finally {
      // Never leave a saved GST rule behind for the tests that follow, even when an assertion above failed.
      for (const [state, clear] of [['33', true], ['', true]]) {
        const version = (await db.doc('business_config/tariff_v2').get()).data().version;
        await call(A,'saveTariffSection',{section:'fareGst',brand,service,expectedVersion:version,reason:'Synthetic GST cleanup',clearOverride:clear,data:{state,rule:{supplierState:'33',rate:.12,mode:'excluded',classification:'passenger',reference:'Synthetic tax fixture only'}}});
      }
    } }
});

test('fixed-route editor save/edit/status reaches only the selected brand and direction',async()=>{
  const before=ok(await quote('people_taxi','One Way'));
  const data={brand:'nesam',fareService:'One Way',originLocationId:pickup.id,destinationLocationId:drop.id,vehicleCategoryId:'control-sedan',serviceId:'',customerFare:1500,partnerPayout:900,gstMode:'excluded',peakAdjustment:'exclude',reverseDirection:false,status:'Active',priority:1,effectiveFrom:'',effectiveUntil:'',name:'Synthetic fixed route'};
  let saved=ok(await call(A,'saveFixedRouteFare',{reason:'Synthetic fixed route save',data}));
  assert.equal(ok(await quote('nesam','One Way')).total,1575);
  assert.equal(ok(await quote('nesam','One Way')).payout,900);
  assert.equal(ok(await quote('people_taxi','One Way')).total,before.total);
  saved=ok(await call(A,'saveFixedRouteFare',{ruleId:saved.id,expectedVersion:saved.version,reason:'Synthetic fixed route edit',data:{...data,customerFare:1700,partnerPayout:1000}}));
  assert.equal(ok(await quote('nesam','One Way')).total,1785);
  ok(await call(A,'saveFixedRouteFare',{action:'status',ruleId:saved.id,expectedVersion:saved.version,status:'Inactive',reason:'Finish fixed route check'}));
  assert.notEqual(ok(await quote('nesam','One Way')).total,1785);
});

test('shared city fare editor and rental package controls reach saved calculation inputs',async()=>{
  const {priceBooking,loadTariffConfig}=require('../lib/quote');
  const {mapCategory}=require('../lib/domain/pricing');
  const save=async(section,data,extra={})=>{
    const version=(await db.doc('business_config/tariff_v2').get()).data().version;
    return ok(await call(A,'saveTariffSection',{section,data,expectedVersion:version,reason:'Synthetic shared editor check',...extra}));
  };
  await save('localPickupDrop',{minKm:5,customerRate:25,partnerRate:15,extraKmRate:27,waitingPerHour:200,enabled:true},{cityId:pickup.id,class:'sedan'});
  const tariff=await loadTariffConfig(), category=mapCategory('control-sedan',(await db.doc('vehicle_categories/control-sedan').get()).data());
  for(const brand of brands){
    const p=priceBooking({tariff,category,boardingState:'33',route:{distanceKm:8,durationMin:20,polyline:[]},tripType:'One Way',pickup,drop,pickupAt:new Date(scheduledAt),localCityId:pickup.id,brand});
    assert.equal(p.fare.total,210);assert.equal(p.pricing.partner.basePaise,12000);assert.equal(p.pricing.extraKmRatePaise,2700);
  }
  await save('rentalMinimum',{}, {class:'sedan',minHours:6});
  const pkg={customerFare:1500,partnerPayout:900,includedKm:60,extraKmRate:25,extraHourRate:180,gstMode:'excluded',enabled:true};
  await save('rentalPackage',pkg,{class:'sedan',hours:6});
  assert.equal((await loadTariffConfig()).rentalPackages.sedan.packages['6'].customerFare,1500);
  const q=await call(A,'createAdminBooking',{requestId:rid('shared_rental'),quoteOnly:true,brand:'nesam',categoryId:'control-sedan',tripType:'Local Rental',pickupLocationId:pickup.id,dropLocationId:drop.id,scheduledAt,rentalHours:6});
  assert.equal(ok(q).quote.total,1575);
  await save('rentalPackage',{...pkg,enabled:false},{class:'sedan',hours:6});
  assert.equal((await call(A,'createAdminBooking',{requestId:rid('shared_rental_disabled'),quoteOnly:true,brand:'nesam',categoryId:'control-sedan',tripType:'Local Rental',pickupLocationId:pickup.id,dropLocationId:drop.id,scheduledAt,rentalHours:6})).ok,false);
});

test('business contract editor rates override normal tariffs without leaking across accounts',async()=>{
  const data={requestId:rid('contract_quote'),quoteOnly:true,brand:'nesam',categoryId:'control-sedan',tripType:'One Way',pickupLocationId:pickup.id,dropLocationId:drop.id,scheduledAt,businessAccountId:'control-company',businessBilledTo:'Company pays'};
  const rate={id:'control-contract',pickupZone:pickup.name,dropZone:drop.name,service:'One Way',category:'Sedan',contractType:'Fixed fare',priceEntered:'Excluding GST',customerRate:1000,partnerPayout:700,active:true,peak:false};
  await db.doc('business_accounts/control-company').set({name:'Synthetic Company',status:'Active',paymentTerms:'Credit',creditLimit:10000,contractRates:[rate]});
  let q=ok(await call(A,'createAdminBooking',data));assert.equal(q.quote.total,1050);assert.equal(q.pricing.partner.basePaise,70000);
  await db.doc('business_accounts/control-company').update({contractRates:[{...rate,customerRate:1200,partnerPayout:800}]});
  q=ok(await call(A,'createAdminBooking',data));assert.equal(q.quote.total,1260);assert.equal(q.pricing.partner.basePaise,80000);
  await db.doc('business_accounts/control-company').update({status:'On hold'});
  assert.equal((await call(A,'createAdminBooking',data)).ok,false);
});

test('all brands/services carry tariff payout into independent-driver marketplace assignment',async()=>{
  for(const brand of brands)for(const service of services){
    const suffix=brand+'-'+services.indexOf(service), driverId='control-owner-'+suffix, vehicleId='control-car-'+suffix;
    await db.doc('drivers/'+driverId).set({status:'Approved',vendorId:'',name:'Synthetic owner',phone:'+919000000003',presenceStatus:'Online',fleetStatus:'Active',vehicleType:'sedan',assignedVehicleId:vehicleId});
    await db.doc('vehicles/'+vehicleId).set({vendorId:'',assignedDriverId:driverId,docStatus:'Approved',status:'Active',vehicleNumber:'TN01AA1234',vehicleClass:'sedan',category:'Sedan',seatingCapacity:4});
    const q=ok(await quote(brand,service,true));let id;
    if(service==='Multicity') id=ok(await call(A,'convertMulticityEnquiry',{enquiryId:q.enquiryId,expectedRevision:q.revision,customerName:'Synthetic rider',phone:'+919000000001',paymentMethod:'UPI',customerAccepted:true,acceptanceReference:'Synthetic owner flow agreement'})).id;
    else {
      id=rid('control_owner_booking');
      ok(await call('control-customer','createBooking',{requestId:id,brand,categoryId:'control-sedan',tripType:service,pickup,drop,scheduledAt,tripEndAt,rentalHours:12,expectedFare:q.total,paymentMethod:'UPI',termsAccepted:true}));
    }
    ok(await call(A,'approveBooking',{bookingId:id}));
    ok(await call(A,'postBookingToMarketplace',{booking:id,mode:'accept_offer',note:'Synthetic owner price audit'}));
    assert.equal((await db.doc('marketplace_trips/'+id).get()).data().offeredPayout,q.payout);
    ok(await call(A,'assignIndependentDriver',{tripId:id,driverId}));
    assert.equal((await db.doc('bookings/'+id).get()).data().driverPayout,q.payout);
    assert.equal((await H.rest(driverId,'bookings/'+id)).status,200);
  }
});

test('extra rates are frozen, per-stop usage is approved once, and partner extras stay private',async()=>{
  const version=(await db.doc('business_config/tariff_v2').get()).data().version;
  const data={freeWaitingMinutes:10,waitingRoundingMinutes:5,waitingRoundingScope:'per_stop',taxTreatment:'tariff_gst',categories:{'control-sedan':{customer:{waitingPerHour:200,hill:300,carrier:200},partner:{waitingPerHour:100,hill:150,carrier:90}}}};
  ok(await call(A,'saveTariffSection',{section:'extraCharges',expectedVersion:version,reason:'Synthetic extra usage fixture',data}));
  const q=ok(await quote('nesam','One Way')), id=rid('control_extras');
  ok(await call('control-customer','createBooking',{requestId:id,brand:'nesam',categoryId:'control-sedan',tripType:'One Way',pickup,drop,scheduledAt,expectedFare:q.total,paymentMethod:'UPI',termsAccepted:true}));
  const nextVersion=(await db.doc('business_config/tariff_v2').get()).data().version;
  ok(await call(A,'saveTariffSection',{section:'extraCharges',expectedVersion:nextVersion,reason:'Synthetic rates changed after booking',data:{...data,categories:{'control-sedan':{customer:{waitingPerHour:900,hill:900,carrier:900},partner:{waitingPerHour:800,hill:800,carrier:800}}}}}));
  // Only the lifecycle fixture is seeded; usage recording/approval are the real authenticated callables.
  await db.doc('bookings/'+id).update({status:'Completed',assignedDriverId:'control-extra-driver'});
  const saved=ok(await call('control-extra-driver','recordExtraUsage',{bookingId:id,expectedRevision:0,usage:{stops:[{stopId:'a',waitedMinutes:5},{stopId:'b',waitedMinutes:25}],hill:true,carrier:true}}));
  const approved=ok(await call(A,'reviewExtraUsage',{bookingId:id,revision:saved.revision,decision:'approve',note:'Synthetic usage reviewed'}));
  assert.equal(approved.customerTotalPaise,57750); // 15 minutes × ₹200/hour + ₹300 + ₹200, plus 5% GST.
  const b=(await db.doc('bookings/'+id).get()).data(), priv=(await db.doc('booking_pricing_private/'+id).get()).data();
  assert.equal(b.extraCharges.waiting.billedMinutes,15);assert.equal(priv.extraApproved.partner.subtotalPaise,26500);
  assert.equal(require('../lib/domain/bookingFlow').amountDueFor(b),b.fare+577.5,'customer billing includes approved extras');
  assert.equal(require('../lib/pricingPrivate').approvedPartnerExtraPaise(b,priv),26500,'settlement/ledger receives approved partner credit');
  assert.equal(JSON.stringify(b.pricing.extraCharges).includes('partner'),false);
  assert.equal((await call(A,'reviewExtraUsage',{bookingId:id,revision:saved.revision,decision:'approve'})).ok,false);
  assert.equal((await H.rest('control-customer','booking_pricing_private/'+id)).status,403);
});

test('shared engine toggle preserves saved scopes and category availability is global',async()=>{
  const before=(await db.doc('business_config/tariff_v2').get()).data();
  ok(await call(A,'saveTariffConfig',{keepSavedRates:true,enabled:false,expectedVersion:before.version,reason:'Synthetic engine switch off'}));
  const disabled=(await db.doc('business_config/tariff_v2').get()).data();
  assert.equal(disabled.enabled,false);assert.deepEqual(disabled.brandOverrides,before.brandOverrides);assert.deepEqual(disabled.fareGst,before.fareGst);
  ok(await call(A,'saveTariffConfig',{keepSavedRates:true,enabled:true,expectedVersion:disabled.version,reason:'Restore synthetic engine switch'}));
  await db.doc('vehicle_categories/control-sedan').update({status:'Inactive'});
  for(const brand of brands)assert.equal((await quote(brand,'One Way')).ok,false);
  await db.doc('vehicle_categories/control-sedan').update({status:'Active'});
  const logs=await db.collection('audit_logs').where('performedBy','==',A).get();
  assert.ok(logs.size>100,'scoped saves, statuses, GST and pricing operations have server audit history');
});



