/** Configured fare GST, separate from permit taxes and partner payouts. */
export interface FareGstRule {
  supplierState: string;
  rate: number;
  mode: 'included' | 'excluded';
  classification: 'passenger' | 'rental';
  reference: string;
}
export interface FareGstPolicy { default?: FareGstRule; states?: Record<string, FareGstRule> }
export type FareGstPolicies = Record<string, Record<string, FareGstPolicy>>;
export interface GstSnapshot extends Omit<FareGstRule, 'reference'> {
  boardingState: string; placeOfSupply: string; split: 'CGST + SGST' | 'CGST + UTGST' | 'IGST' | 'Pending verification';
}
export const GST_STATES: ReadonlyArray<readonly [string, string]> = [
  ['01','Jammu and Kashmir'],['02','Himachal Pradesh'],['03','Punjab'],['04','Chandigarh'],['05','Uttarakhand'],['06','Haryana'],['07','Delhi'],['08','Rajasthan'],['09','Uttar Pradesh'],['10','Bihar'],['11','Sikkim'],['12','Arunachal Pradesh'],['13','Nagaland'],['14','Manipur'],['15','Mizoram'],['16','Tripura'],['17','Meghalaya'],['18','Assam'],['19','West Bengal'],['20','Jharkhand'],['21','Odisha'],['22','Chhattisgarh'],['23','Madhya Pradesh'],['24','Gujarat'],['26','Dadra and Nagar Haveli and Daman and Diu'],['27','Maharashtra'],['29','Karnataka'],['30','Goa'],['31','Lakshadweep'],['32','Kerala'],['33','Tamil Nadu'],['34','Puducherry'],['35','Andaman and Nicobar Islands'],['36','Telangana'],['37','Andhra Pradesh'],['38','Ladakh'],
];
export function gstState(value: unknown): string {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return GST_STATES.find(([code, name]) => code === key || name.toLowerCase() === key)?.[0] ?? '';
}
export function gstSplit(supplier: string, place: string): GstSnapshot['split'] {
  return !supplier || !place ? 'Pending verification' : supplier !== place ? 'IGST' : ['04','26','31','35','38'].includes(supplier) ? 'CGST + UTGST' : 'CGST + SGST';
}
export function gstComponents(total: number, split: GstSnapshot['split']) {
  const paise = Math.round(total * 100), half = Math.round(paise / 2);
  return { cgst: split.startsWith('CGST') ? half / 100 : 0, sgst: split === 'CGST + SGST' ? (paise - half) / 100 : 0,
    utgst: split === 'CGST + UTGST' ? (paise - half) / 100 : 0, igst: split === 'IGST' ? paise / 100 : 0 };
}
export function validGstRule(v: unknown): v is FareGstRule {
  const r = v as FareGstRule | null;
  return !!r && !!gstState(r.supplierState) && typeof r.rate === 'number' && Number.isFinite(r.rate) && r.rate >= 0 && r.rate <= 0.4
    && ['included','excluded'].includes(r.mode) && ['passenger','rental'].includes(r.classification) && typeof r.reference === 'string' && r.reference.trim().length >= 5;
}

/** Extract inclusive tax in paise; both quote and final kilometre billing use this once. */
export function inclusiveTaxable(paise: number, rate: number): number {
  let net = Math.round(paise / (1 + rate));
  const gross = (n: number) => n + Math.round(n * rate);
  while (gross(net) < paise) net++;
  while (net > 0 && gross(net) > paise) net--;
  return net;
}
export function withFareGst(source: import('./types').FareBreakdown, tax: GstSnapshot, included: boolean): import('./types').FareBreakdown {
  const round = (n: number) => Math.round(n * 100) / 100;
  const net = (v: number) => included ? Math.sign(v) * inclusiveTaxable(Math.round(Math.abs(v) * 100), tax.rate) / 100 : round(v);
  const fare = { ...source };
  for (const key of ['baseFare','distanceFare','timeFare','nightCharge','driverAllowance','minimumFareAdjustment','subtotalBeforeAdjustment','subtotal','discount','adminAdjustment','perKmRate','perMinuteRate'] as const) {
    const value = fare[key];
    if (typeof value === 'number') fare[key] = net(value);
  }
  fare.taxableAmount = net(source.taxableAmount);
  fare.discount = round(fare.subtotal - fare.taxableAmount);
  fare.gstRate = tax.rate;
  fare.gst = Math.round(Math.round(fare.taxableAmount * 100) * tax.rate) / 100;
  fare.total = round(fare.taxableAmount + fare.gst);
  if (fare.globalAdjustment) fare.globalAdjustment = { ...fare.globalAdjustment, amount: net(fare.globalAdjustment.amount) };
  if (fare.discountDetail) fare.discountDetail = { ...fare.discountDetail, amount: fare.discount,
    value: fare.discountDetail.type === 'coupon' ? fare.discount : included && fare.discountDetail.type === 'fixed' ? net(fare.discountDetail.value) : fare.discountDetail.value };
  fare.gstDetails = { ...tax, ...gstComponents(fare.gst, tax.split) };
  return fare;
}
