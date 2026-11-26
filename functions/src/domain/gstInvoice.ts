// GST document rules (pure: no database). Used by gstDocuments.ts.
// buildInvoiceLines mirrors admin/src/services/invoiceService.ts so an automatic and a hand-issued invoice for the same
// trip read the same (test/gstDocuments.test.js compares the two).
import { GST_STATES, gstSplit, gstState, gstComponents, type GstSnapshot } from './gst';

export const PASSENGER_TRANSPORT_SAC = '9964';
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** Rule 46(b) / 50(b): a serial number of at most 16 characters, consecutive and unique within a financial year. */
export const MAX_DOCUMENT_NUMBER = 16;
/** Rule 46(e): an unregistered recipient's name and address are mandatory from this value. */
export const ADDRESS_REQUIRED_FROM = 50000;

export const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
type Doc = Record<string, any>;

// ── Dates and numbers ────────────────────────────────────────────────────────
/** Calendar date in India, "YYYY-MM-DD". */
export const istIsoDate = (ms: number) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
/** "26-27" for any date from 1 Apr 2026 to 31 Mar 2027. */
export function financialYear(isoDate: string): string {
  const y = Number(isoDate.slice(0, 4)), m = Number(isoDate.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export type Series = 'invoice' | 'debit' | 'receipt' | 'payment' | 'refund';
const PREFIX: Record<Series, string> = { invoice: 'NES', debit: 'NDN', receipt: 'NRV', payment: 'NPR', refund: 'NRF' };
/** The field of settings/invoice_sequence that counts one series in one financial year. */
export const counterKey = (series: Series, fy: string) => (series === 'invoice' ? fy : `${PREFIX[series]}_${fy}`);
export function documentNumber(series: Series, fy: string, seq: number): string {
  const out = `${PREFIX[series]}/${fy}/${String(seq).padStart(6, '0')}`;
  if (out.length > MAX_DOCUMENT_NUMBER) throw new Error('The document number series is full for this financial year.');
  return out;
}
export const documentId = (number: string) => number.replace(/\//g, '-');

// ── Supplier, service, place ─────────────────────────────────────────────────
export interface Company { name: string; gstin: string; address: string; phone: string; email: string; sacCode: string }
export function companyFromSettings(s: Doc): Company {
  return { name: str(s.companyName), gstin: str(s.gst).toUpperCase(), address: str(s.address), phone: str(s.phone), email: str(s.email), sacCode: PASSENGER_TRANSPORT_SAC };
}
export function companyProblems(c: Company): string[] {
  const out: string[] = [];
  if (!c.name) out.push('company name');
  if (!GSTIN_RE.test(c.gstin) || !gstState(c.gstin.slice(0, 2))) out.push('a valid GSTIN');
  if (!c.address) out.push('registered address');
  return out;
}

export const POLICY_SERVICES = ['One Way', 'Round Trip', 'Airport', 'Multicity', 'Local Rental', 'Local Pickup & Drop'] as const;
export type PolicyService = (typeof POLICY_SERVICES)[number];
export function policyService(service: unknown): PolicyService | undefined {
  const s = str(service).toLowerCase();
  return POLICY_SERVICES.find((x) => x.toLowerCase() === s)
    ?? (s === 'airport taxi' ? 'Airport' : s === 'one way drop' ? 'One Way' : s === 'hourly rental' ? 'Local Rental' : undefined);
}

export const stateName = (code: string) => GST_STATES.find(([c]) => c === code)?.[1] ?? '';

const STATE_ALIASES: [string, string][] = [
  ...GST_STATES.map(([code, name]) => [name, code] as [string, string]),
  ['Pondicherry', '34'], ['Tamilnadu', '33'], ['Orissa', '21'], ['Jammu & Kashmir', '01'], ['Andaman & Nicobar', '35'],
];
/** The state written in a postal address ("…, Erode, Tamil Nadu 638001, India"): the last one named; '' when none is. */
export function stateFromAddress(address: unknown): string {
  const text = str(address);
  let found = '', at = -1;
  for (const [name, code] of STATE_ALIASES) {
    // A name followed by "Road" / "Street" … is a street, not the state.
    const re = new RegExp(`(?<![A-Za-z])${name.replace(/ /g, '\\s+')}(?![A-Za-z])(?!\\s+(?:road|rd|street|st|salai|highway|nagar)\\b)`, 'gi');
    for (let m = re.exec(text); m; m = re.exec(text)) if (m.index + m[0].length > at) { at = m.index + m[0].length; found = code; }
  }
  return found;
}

// ── Tax determination ────────────────────────────────────────────────────────
export interface Recipient { name: string; phone: string; email: string; address: string; gstin: string; state: string }
export interface Tax {
  documentType: string; supplierState: string; placeOfSupply: string; boardingState: string; recipientState: string;
  split: GstSnapshot['split']; sac: string; classification: string; taxPolicyState: string; taxPolicyReference: string;
}
export type Determined = { ok: true; tax: Tax } | { ok: false; reason: string };

/** Everything that decides how GST is shown. It never guesses: anything it cannot prove is returned as a reason. */
export function determineTax(args: {
  company: Company; policy: Doc | undefined; service: unknown; recipient: Recipient; boardingState: string;
  saved?: { supplierState?: string; placeOfSupply?: string; split?: string };
}): Determined {
  const { company, policy, recipient, saved } = args;
  const missing = companyProblems(company);
  if (missing.length) return { ok: false, reason: `Add ${missing.join(', ')} in Settings → Company.` };
  const supplierState = company.gstin.slice(0, 2);
  const override = policy?.stateOverrides?.[supplierState];
  const entry = override ?? policy;
  if (entry?.approved !== true) return { ok: false, reason: 'Approve the service classification and SAC codes in Invoices → Tax automation.' };
  const service = policyService(args.service);
  if (!service) return { ok: false, reason: `The service "${str(args.service) || 'unknown'}" has no tax classification.` };
  // An approval saved without a row for this service falls back to the defaults the approval screen showed.
  const rule = entry.services?.[service] ?? { classification: service === 'Local Rental' ? 'Vehicle rental' : 'Passenger transportation', sac: service === 'Local Rental' ? '996601' : '996412' };
  if (!/^\d{6,8}$/.test(str(rule.sac))) return { ok: false, reason: `Review the approved SAC for ${service} in Tax automation.` };
  if (saved?.supplierState && saved.supplierState !== supplierState) return { ok: false, reason: 'The company GSTIN state differs from the GST registration saved on this booking.' };
  if (recipient.gstin && !GSTIN_RE.test(recipient.gstin)) return { ok: false, reason: 'The customer GSTIN saved for this booking is not valid.' };
  const registered = !!recipient.gstin;
  const recipientState = registered ? gstState(recipient.gstin.slice(0, 2)) : recipient.state;
  const rental = rule.classification === 'Vehicle rental';
  // Passenger transport (IGST Act 12(9)): a registered recipient's state, otherwise where the passenger boards.
  const placeOfSupply = saved?.placeOfSupply || (rental ? recipientState || supplierState : registered ? recipientState : args.boardingState);
  if (!placeOfSupply || !stateName(placeOfSupply)) return { ok: false, reason: 'The pickup state could not be confirmed from the booking, so the place of supply is unknown.' };
  const split = gstSplit(supplierState, placeOfSupply);
  if (saved?.split && saved.split !== 'Pending verification' && saved.split !== split) return { ok: false, reason: 'The tax split saved on the booking differs from the place of supply.' };
  return {
    ok: true,
    tax: {
      documentType: 'Tax invoice', supplierState, placeOfSupply, boardingState: args.boardingState, recipientState, split,
      sac: str(rule.sac), classification: str(rule.classification), taxPolicyState: override ? supplierState : 'common', taxPolicyReference: str(entry.reference),
    },
  };
}

// ── Invoice lines ────────────────────────────────────────────────────────────
export interface Item { description: string; sacCode?: string; quantity: number; rate: number; amount: number }
export interface Lines {
  items: Item[]; subtotal: number; discount: number; taxableAmount: number; gstRate: number;
  cgst: number; sgst: number; igst: number; utgst: number; totalTax: number; tolls: number; grandTotal: number;
}
export const parseAmount = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** The trip's lines from the server's own fare breakdown. Call only when fareBreakdown.gst is present. */
export function buildInvoiceLines(b: Doc, sac: string, split: GstSnapshot['split']): Lines {
  const fare = parseAmount(b.fare);
  const fb = (b.fareBreakdown ?? {}) as Doc;
  const addons = (fb.addOns && typeof fb.addOns === 'object' ? fb.addOns : {}) as Doc;
  const gst = round2(num(fb.gst));
  const taxable = round2(fare - gst);
  const discount = round2(num(fb.discount) || Number(b.discount || 0));
  const subtotal = round2(taxable + discount);
  const trip = `${b.service || 'Taxi service'} — ${b.pickup || 'Pickup'} to ${b.drop || 'Drop'}`;
  const components: [string, unknown][] = [
    ['Base fare', fb.baseFare], ['Roof carrier', addons.carrierCharge], ['Pet travel', addons.petCharge], ['Distance charge', fb.distanceFare],
    ['Time charge', fb.timeFare], ['Night charge', fb.nightCharge], ['Driver allowance', fb.driverAllowance], ['Minimum fare adjustment', fb.minimumFareAdjustment],
    ['Peak-hour charge', fb.peakCharge], ['Route toll', fb.routeToll], ['Airport entry charge', fb.airportEntry],
    [b.globalAdjustmentApplied?.name || 'Fare adjustment', b.globalAdjustmentApplied?.amount], ['Agreed fare adjustment', fb.adminAdjustment],
  ];
  const detailed = components.filter(([, v]) => num(v) !== 0);
  const detailedSum = round2(detailed.reduce((s, [, v]) => s + num(v), 0));
  const items: Item[] = detailed.length && Math.abs(detailedSum - subtotal) < 1
    ? detailed.map(([label, v]) => ({ description: `${label} (${trip})`, sacCode: sac, quantity: 1, rate: num(v), amount: num(v) }))
    : [{ description: trip, sacCode: sac, quantity: 1, rate: subtotal, amount: subtotal }];
  const tolls = round2(Number(b.tollCharges || 0) > 0 ? Number(b.tollCharges) : 0);
  if (tolls > 0) items.push({ description: 'Toll charges (reimbursement, not taxable)', quantity: 1, rate: tolls, amount: tolls });
  const ec = b.extraCharges?.status === 'approved' ? b.extraCharges : null;
  const extraNet = ec ? round2(ec.customer.subtotalPaise / 100) : 0;
  const extraGst = ec ? round2(ec.customer.gstPaise / 100) : 0;
  const taxableExtra = ec?.taxTreatment === 'tariff_gst';
  if (ec && extraNet > 0) items.push(...extraItems(ec, sac));
  const extras = ((b.fareBreakup?.lines ?? []) as Doc[]).filter((l) => l.treatment === 'extra' && !(ec && ['waiting', 'hill', 'carrier', 'extraGst'].includes(l.key)));
  if (extras.length) {
    const list = extras.map((l) => l.label + (l.amount ? ' ₹' + l.amount : ' (at actuals)')).join(', ');
    items.push({ description: 'Not included in this invoice — payable separately: ' + list, quantity: 1, rate: 0, amount: 0 });
  }
  const taxableExtras = taxableExtra ? extraNet : 0;
  const totalGst = round2(gst + extraGst);
  return {
    items,
    subtotal: round2(subtotal + taxableExtras),
    discount,
    taxableAmount: round2(taxable + taxableExtras),
    gstRate: typeof fb.gstRate === 'number' ? fb.gstRate : 0.05,
    ...gstComponents(totalGst, split),
    totalTax: totalGst,
    tolls,
    grandTotal: round2(fare + tolls + taxableExtras + extraGst + (taxableExtra ? 0 : extraNet)),
  };
}

/** The approved extra charges as invoice lines (used on the trip invoice, or alone on a debit note). */
export function extraItems(ec: Doc, sac: string): Item[] {
  const taxable = ec.taxTreatment === 'tariff_gst';
  const parts = [['Waiting', ec.customer.waitingPaise], ['Hill travel', ec.customer.hillPaise], ['Roof carrier', ec.customer.carrierPaise]] as const;
  return parts.filter(([, paise]) => paise > 0).map(([label, paise]) => ({
    description: `${label} — approved extra charge${taxable ? '' : ' (not taxable)'}`, ...(taxable ? { sacCode: sac } : {}), quantity: 1, rate: round2(paise / 100), amount: round2(paise / 100),
  }));
}

/** A GST-inclusive amount (an advance, a refund, a retained cancellation charge) split into taxable value and tax. */
export function splitInclusive(amount: number, rate: number, split: GstSnapshot['split']) {
  const taxableAmount = round2(amount / (1 + rate));
  const totalTax = round2(amount - taxableAmount);
  return { taxableAmount, gstRate: rate, ...gstComponents(totalTax, split), totalTax, grandTotal: round2(amount) };
}
