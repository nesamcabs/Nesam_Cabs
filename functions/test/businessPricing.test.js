const test=require('node:test'),assert=require('node:assert/strict');
const {businessContract}=require('../lib/domain/business');
const {priceBooking}=require('../lib/quote');
const {mapCategory}=require('../lib/domain/pricing');
const {finalizeFare}=require('../lib/domain/tariff');
const pickup={id:'p',name:'Theni',address:'Theni',lat:10.0104,lng:77.4768,type:'other'};
const drop={id:'d',name:'Madurai',address:'Madurai',lat:9.9195,lng:78.1193,type:'other'};
const category=mapCategory('sedan',{name:'Sedan',status:'Active',seatingCapacity:4,fare:{baseFare:70,baseKm:2,perKmRate:16,minimumFare:100}});
for(const mode of ['Including GST','Excluding GST'])test(`business per-km ${mode}: quote/final paise and partner payout stay consistent`,()=>{
  const rate={id:'R1',pickupZone:'Theni',dropZone:'Madurai',service:'One Way',category:'Sedan',contractType:'Per km',priceEntered:mode,customerRate:15,partnerPayout:12,active:true,peak:false};
  const contract=businessContract({contractRates:[rate]},{pickup,drop,service:'One Way',tripType:'One Way',category:'Sedan',km:80});
  const q=priceBooking({category,route:{distanceKm:80,durationMin:90},tripType:'One Way',pickup,drop,pickupAt:new Date('2026-11-01T10:00:00+05:30'),tripEndAt:null,tariff:null,adjustment:null,businessContract:contract});
  assert.equal(q.fare.total,mode==='Including GST'?1200:1260);
  const final=finalizeFare({pricing:q.pricing,totalKm:100,endMs:Date.now()});
  assert.equal(final.fare.total,mode==='Including GST'?1500:1575);
  assert.equal(final.partnerPaise,120000);
  assert.throws(()=>businessContract({contractRates:[{...rate,customerRate:1.333}]},{pickup,drop,service:'One Way',tripType:'One Way',category:'Sedan',km:80}),/invalid rates/);
});
