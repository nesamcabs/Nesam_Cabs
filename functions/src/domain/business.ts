import type { FixedRouteFare } from './tariff';
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
export interface BusinessContract { rule: FixedRouteFare; perKm: boolean; customerRate: number; partnerRate: number }
/** Exact canonical place/city matches only; a partial address never selects a contract. */
export function businessContract(account: Record<string, any>, i: { pickup: Record<string, any>; drop: Record<string, any>; service: string; tripType: string; category: string; km: number }): BusinessContract | null {
  const aliases = [i.service, i.tripType, ...(i.tripType === 'Airport Taxi' ? ['Airport'] : []), ...(i.tripType === 'One Way' ? ['One Way Taxi'] : [])].map(norm);
  const matches = (Array.isArray(account.contractRates) ? account.contractRates : []).filter((r: any) => r.active === true &&
    [i.pickup.name, i.pickup.city, i.pickup.id].map(norm).includes(norm(r.pickupZone)) &&
    [i.drop.name, i.drop.city, i.drop.id].map(norm).includes(norm(r.dropZone)) && aliases.includes(norm(r.service)) && norm(r.category) === norm(i.category));
  if (!matches.length) return null;
  if (matches.length !== 1) throw Error('More than one active business contract matches this trip. Resolve duplicate rates first.');
  const r = matches[0];
  if (typeof r.id!=='string'||!r.id.trim()||!['Fixed fare','Per km'].includes(r.contractType) || !['Including GST','Excluding GST'].includes(r.priceEntered) || ![r.customerRate,r.partnerPayout].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1000000 && Math.abs(Math.round(v*100)/100-v)<0.000001)) throw Error('The matching business contract has invalid rates. Correct the contract first.');
  const perKm = r.contractType === 'Per km', km = perKm ? i.km : 1;
  return { perKm, customerRate:r.customerRate, partnerRate:r.partnerPayout, rule:{id:`business:${r.id}`,name:`Business contract ${r.id}`,originId:'',destinationId:'',categoryId:'',serviceId:'',customerFare:Math.round(r.customerRate*km*100)/100,partnerPayout:Math.round(r.partnerPayout*km*100)/100,gstMode:r.priceEntered==='Including GST'?'included':'excluded',peakAdjustment:r.peak?'apply':'exclude',reverseDirection:false,priority:0,effectiveFrom:'',effectiveUntil:'',version:1} };
}
/** Posted charges plus open reservations, less verified business receipts. */
export function availableBusinessCredit(account: Record<string, any>, bookings: Record<string, any>[], receipts: Record<string, any>[]): number {
  const money=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?Math.max(0,v):0;
  const charges=bookings.filter(b=>b.businessBilledTo!=='Passenger pays').reduce((sum,b)=>sum+(b.status==='Completed'||['Pending','Approved','Confirmed','Assigned','Ongoing'].includes(b.status)?money(b.fare)+money(b.tollCharges):b.status==='Cancelled'?money(b.cancellation?.charge ?? b.cancellationFee):0),0);
  const paid=receipts.reduce((sum,r)=>sum+money(r.amount),0);
  return Math.round(((account.paymentTerms==='Credit'?money(account.creditLimit):0)+paid-charges)*100)/100;
}
