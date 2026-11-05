import { gstSplit, splitGst, stateOfGstin, type GstSplit } from '../domain/gstStates';
import { doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS, describeDataError } from "./adminFirestoreService";
import { bookingGst, GST_RATE, parseAmount } from "../utils/analytics";
import type { Booking, CompanySnapshot, CustomerSnapshot, Invoice, InvoiceItem } from "../types";

export class InvoiceActionError extends Error {}

/** SAC for passenger transport by motor vehicle (rented / contract carriage). */
export const PASSENGER_TRANSPORT_SAC = "9964";
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const COUNTER_DOC = "invoice_sequence"; // settings/invoice_sequence

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Company identity from settings/config; null fields mean "not configured". */
export function companyFromSettings(s: Record<string, unknown>): CompanySnapshot {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    name: str(s.companyName),
    gstin: str(s.gst).toUpperCase(),
    address: str(s.address),
    phone: str(s.phone),
    email: str(s.email),
    sacCode: PASSENGER_TRANSPORT_SAC,
  };
}

/** What is missing before a legally valid tax invoice can be issued. */
export function companyProblems(c: CompanySnapshot): string[] {
  const out: string[] = [];
  if (!c.name) out.push("company name");
  if (!GSTIN_RE.test(c.gstin)) out.push("a valid GSTIN");
  if (!c.address) out.push("registered address");
  return out;
}

/** Only completed trips can be invoiced, once each. */
export function invoiceBlocker(b: Booking & { invoiceId?: string }, invoices: Invoice[]): string {
  if (b.status !== "Completed") return "Only completed trips can be invoiced.";
  if (!(parseAmount(b.fare) > 0)) return "The booking has no fare.";
  const active = invoices.find(
    (i) => i.invoiceStatus !== "Cancelled" && (i.bookingDocumentId === b.id || (!i.bookingDocumentId && i.bookingId === b.id)),
  );
  if (active) return `Invoice ${active.invoiceNumber} already exists for this trip.`;
  return "";
}

export interface InvoiceLines {
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  taxableAmount: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  utgst: number;
  totalTax: number;
  tolls: number;
  grandTotal: number;
}

/**
 * Invoice lines for a completed trip. The server's fare breakdown is used
 * exactly when present (it priced the booking); otherwise the GST-inclusive
 * fare is split at the standard rate. Tolls are reimbursements collected with
 * the fare and are shown as a separate non-taxable line.
 */
export function buildInvoiceLines(b: Booking): InvoiceLines {
  const fare = parseAmount(b.fare);
  const fb = (b.fareBreakdown ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const gst = round2(bookingGst(b));
  const taxable = round2(fare - gst);
  const discount = round2(num(fb.discount) || Number(b.discount || 0));
  const subtotal = round2(taxable + discount);
  const trip = `${b.service || "Taxi service"} — ${b.pickup || "Pickup"} to ${b.drop || "Drop"}`;

  const components: [string, unknown][] = [
    ["Base fare", fb.baseFare],
    ["Distance charge", fb.distanceFare],
    ["Time charge", fb.timeFare],
    ["Night charge", fb.nightCharge],
    ["Driver allowance", fb.driverAllowance],
    ["Minimum fare adjustment", fb.minimumFareAdjustment],
    // A global % adjustment can be negative; an agreed adjustment is the override's difference.
    [b.globalAdjustmentApplied?.name || "Fare adjustment", b.globalAdjustmentApplied?.amount],
    ["Agreed fare adjustment", fb.adminAdjustment],
  ];
  const detailed = components.filter(([, v]) => num(v) !== 0);
  const detailedSum = round2(detailed.reduce((s, [, v]) => s + num(v), 0));
  const items: InvoiceItem[] =
    detailed.length && Math.abs(detailedSum - subtotal) < 1
      ? detailed.map(([label, v]) => ({
          description: `${label} (${trip})`,
          sacCode: PASSENGER_TRANSPORT_SAC,
          quantity: 1,
          rate: num(v),
          amount: num(v),
        }))
      : [{ description: trip, sacCode: PASSENGER_TRANSPORT_SAC, quantity: 1, rate: subtotal, amount: subtotal }];

  const tolls = round2(Number(b.tollCharges || 0) > 0 ? Number(b.tollCharges) : 0);
  if (tolls > 0) {
    items.push({ description: "Toll charges (reimbursement, not taxable)", quantity: 1, rate: tolls, amount: tolls });
  }
  // Extra usage the office approved (waiting / hill / roof carrier): the amounts are the server's, from the rates saved on this booking.
  // With GST the extras join the taxable value and the tax; without, they are a separate non-taxable line.
  const ec = b.extraCharges?.status === "approved" ? b.extraCharges : null;
  const extraNet = ec ? round2(ec.customer.subtotalPaise / 100) : 0;
  const extraGst = ec ? round2(ec.customer.gstPaise / 100) : 0;
  const taxableExtra = ec?.taxTreatment === 'tariff_gst';
  if (ec && extraNet > 0) {
    const parts = [["Waiting", ec.customer.waitingPaise], ["Hill travel", ec.customer.hillPaise], ["Roof carrier", ec.customer.carrierPaise]] as const;
    for (const [label, paise] of parts) if (paise > 0) items.push({ description: `${label} — approved extra charge${taxableExtra ? "" : " (not taxable)"}`, quantity: 1, rate: round2(paise / 100), amount: round2(paise / 100) });
  }
  // Charges outside the package are never hidden: say which ones are payable separately (approved extras are billed above).
  const extras = (b.fareBreakup?.lines ?? []).filter((l) => l.treatment === "extra" && !(ec && ["waiting", "hill", "carrier", "extraGst"].includes(l.key)));
  if (extras.length) {
    const list = extras.map((l) => l.label + (l.amount ? " ₹" + l.amount : " (at actuals)")).join(", ");
    items.push({ description: "Not included in this invoice — payable separately: " + list, quantity: 1, rate: 0, amount: 0 });
  }
  const taxableExtras = taxableExtra ? extraNet : 0;
  const nonTaxableExtras = taxableExtra ? 0 : extraNet;
  const totalGst = round2(gst + extraGst);
  const details = fb.gstDetails as { split?: GstSplit } | undefined;
  const taxes = splitGst(totalGst, details?.split === 'IGST' || details?.split === 'CGST + UTGST' ? details.split : 'CGST + SGST');
  return {
    items,
    subtotal: round2(subtotal + taxableExtras),
    discount,
    taxableAmount: round2(taxable + taxableExtras),
    gstRate: typeof fb.gstRate === "number" ? fb.gstRate : GST_RATE,
    ...taxes,
    totalTax: totalGst,
    tolls,
    grandTotal: round2(fare + tolls + taxableExtras + extraGst + nonTaxableExtras),
  };
}

export const isBookingPaid = (b?: Booking) => !!b && (b.payment === "Paid" || b.paymentStatus === "Paid");

/** Payment status of an invoice, read live from its booking when available. */
export function livePaymentStatus(inv: Invoice, booking?: Booking): Invoice["paymentStatus"] {
  if (booking) return isBookingPaid(booking) ? "Paid" : "Pending";
  return inv.paymentStatus;
}

export interface BillingDetails {
  name: string;
  gstin: string;
  address: string;
  email: string;
}

export function validateBilling(d: BillingDetails): string {
  if (d.gstin && !GSTIN_RE.test(d.gstin.trim().toUpperCase())) return "Customer GSTIN is not valid (15 characters, e.g. 33ABCDE1234F1Z5).";
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return "Customer email is not valid.";
  return "";
}

/**
 * Issues a GST invoice for a completed booking in one transaction:
 * the yearly sequence gives a unique gap-free number, and the booking's
 * `invoiceId` guarantees at most one active invoice per trip.
 */
export async function createInvoice(params: {
  booking: Booking;
  company: CompanySnapshot;
  billing: BillingDetails;
  actorId: string;
  /** Document type, place of supply and tax split chosen in the Master Admin "Create invoice" sheet. */
  extra?: { documentType?: string; recipientState?: string; boardingState?: string; placeOfSupply?: string; taxSplit?: GstSplit; sac?: string; classification?: string; taxPolicyState?: string; taxPolicyReference?: string };
}): Promise<{ id: string; invoiceNumber: string }> {
  const { booking, company, billing, actorId, extra } = params;
  const missing = companyProblems(company);
  if (missing.length) throw new InvoiceActionError(`Add ${missing.join(", ")} in Settings → Company before issuing invoices.`);
  const billingError = validateBilling(billing);
  if (billingError) throw new InvoiceActionError(billingError);
  const year = new Date().getFullYear();
  try {
    return await runTransaction(db, async (tx) => {
      const bookingRef = doc(db, COLLECTIONS.BOOKINGS, booking.id);
      const counterRef = doc(db, "settings", COUNTER_DOC);
      const [bSnap, counter] = await Promise.all([tx.get(bookingRef), tx.get(counterRef)]);
      if (!bSnap.exists()) throw new InvoiceActionError("This booking no longer exists.");
      const b = { ...(bSnap.data() as Booking), id: booking.id } as Booking & { invoiceId?: string; customerEmail?: string };
      if (b.status !== "Completed") throw new InvoiceActionError("Only completed trips can be invoiced.");
      if (b.invoiceId) {
        const prior = await tx.get(doc(db, COLLECTIONS.INVOICES, b.invoiceId));
        if (prior.exists() && prior.data().invoiceStatus !== "Cancelled") {
          throw new InvoiceActionError(`Invoice ${prior.data().invoiceNumber} already exists for this trip.`);
        }
      }
      const last = counter.exists() && counter.data()[String(year)] ? Number(counter.data()[String(year)]) : 0;
      const seq = last + 1;
      const invoiceNumber = `NES-INV-${year}-${String(seq).padStart(5, "0")}`;
      const invoiceRef = doc(db, COLLECTIONS.INVOICES, `${year}-${String(seq).padStart(5, "0")}`);
      const lines = buildInvoiceLines(b);
      const gstDetails = (b.fareBreakdown as { gstDetails?: { supplierState?: string; placeOfSupply?: string } } | undefined)?.gstDetails;
      if (gstDetails?.supplierState && gstDetails.supplierState !== stateOfGstin(company.gstin)) throw new InvoiceActionError('Supplier GSTIN state differs from the booked GST registration. Review the booking before invoicing.');
      const savedPlace = gstDetails?.placeOfSupply;
      const invoiceSplit = savedPlace ? gstSplit(stateOfGstin(company.gstin) ?? '', savedPlace) : extra?.taxSplit;
      if (extra?.taxSplit && invoiceSplit && extra.taxSplit !== invoiceSplit) throw new InvoiceActionError('Invoice tax jurisdiction differs from the booked GST. Review the recipient and boarding state.');
      if (gstDetails && !savedPlace && !extra?.taxSplit) throw new InvoiceActionError('Verify the place of supply in Invoices before issuing this GST invoice.');
      if (invoiceSplit) Object.assign(lines, splitGst(lines.totalTax, invoiceSplit));
        if (extra?.sac) {
          if (!/^\d{6,8}$/.test(extra.sac)) throw new InvoiceActionError("Review the approved service SAC before issuing this invoice.");
          lines.items = lines.items.map(item => item.sacCode ? { ...item, sacCode: extra.sac } : item);
        }
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const paid = isBookingPaid(b);
      const customer: CustomerSnapshot = {
        name: billing.name.trim() || b.customerName || b.customer || "Customer",
        phone: b.customerPhone || b.phone || "",
        email: billing.email.trim() || b.customerEmail || "",
        address: billing.address.trim(),
        gstin: billing.gstin.trim().toUpperCase(),
      };
      const invoice: Omit<Invoice, "id"> & Record<string, unknown> = {
        invoiceNumber,
        bookingId: b.bookingId || booking.id,
        bookingDocumentId: booking.id,
        customerId: b.customerId || "",
        invoiceDate: iso,
        dueDate: iso,
        companySnapshot: extra?.sac ? { ...company, sacCode: extra.sac } : company,
        customerSnapshot: customer,
        tripSnapshot: {
          service: b.service || "",
          pickup: b.pickupAddress || b.pickup || "",
          drop: b.dropAddress || b.drop || "",
          travelDate: b.date || "",
          travelTime: b.time || "",
          vehicle: b.vehicle || b.vehicleCategory || "",
          vehicleCategory: b.vehicleCategory || "",
          vehicleNumber: b.assignedVehicleNumber || "",
          driverName: b.assignedDriverName || b.driver || "",
          distanceKm: Number(b.distanceKm || 0),
        },
        ...lines,
        ...(invoiceSplit ? { taxSplit: invoiceSplit } : {}),
        paidAmount: paid ? lines.grandTotal : 0,
        balanceAmount: paid ? 0 : lines.grandTotal,
        paymentStatus: paid ? "Paid" : "Pending",
        invoiceStatus: "Issued",
        terms: extra?.sac ? `Computer-generated tax invoice. ${extra.classification || "Service"} under SAC ${extra.sac}.` : "Computer-generated tax invoice. GST on passenger transport under SAC 9964.",
        createdBy: actorId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (extra) {
        Object.assign(invoice, Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined && v !== "")));
        // Inter-state supply: the whole GST is IGST.
        if (extra.taxSplit) Object.assign(invoice, splitGst(lines.totalTax, extra.taxSplit));
      }
      tx.set(invoiceRef, { ...invoice, id: invoiceRef.id });
      tx.set(counterRef, { [String(year)]: seq, updatedAt: serverTimestamp() }, { merge: true });
      tx.update(bookingRef, { invoiceId: invoiceRef.id, invoiceNumber, updatedAt: serverTimestamp() });
      return { id: invoiceRef.id, invoiceNumber };
    });
  } catch (err) {
    if (err instanceof InvoiceActionError) throw err;
    throw new InvoiceActionError(describeDataError(err));
  }
}

/** Issues an invoice from anywhere (e.g. booking details) using the saved company settings. */
export async function issueInvoiceForBooking(booking: Booking, actorId: string) {
  let settings: Record<string, unknown> = {};
  try {
    const snap = await getDoc(doc(db, "settings", "config"));
    settings = snap.exists() ? snap.data() : {};
  } catch (err) {
    throw new InvoiceActionError(describeDataError(err));
  }
  return createInvoice({
    booking,
    company: companyFromSettings(settings),
    billing: { name: "", gstin: "", address: "", email: "" },
    actorId,
  });
}

/** Voids an invoice (never deleted — tax records are kept) and frees the trip for re-issue. */
export async function voidInvoice(inv: Invoice, reason: string, actorId: string): Promise<void> {
  if (!reason.trim()) throw new InvoiceActionError("Enter the reason for voiding this invoice.");
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, COLLECTIONS.INVOICES, inv.id);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new InvoiceActionError("This invoice no longer exists.");
      if (snap.data().invoiceStatus === "Cancelled") throw new InvoiceActionError("This invoice is already void.");
      const bookingId = snap.data().bookingDocumentId as string | undefined;
      const bookingRef = bookingId ? doc(db, COLLECTIONS.BOOKINGS, bookingId) : null;
      const bSnap = bookingRef ? await tx.get(bookingRef) : null;
      tx.update(ref, {
        invoiceStatus: "Cancelled",
        voidReason: reason.trim().slice(0, 300),
        voidedBy: actorId,
        voidedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (bookingRef && bSnap?.exists() && bSnap.data().invoiceId === inv.id) {
        tx.update(bookingRef, { invoiceId: "", invoiceNumber: "", updatedAt: serverTimestamp() });
      }
    });
  } catch (err) {
    if (err instanceof InvoiceActionError) throw err;
    throw new InvoiceActionError(describeDataError(err));
  }
}

/** Indian-English amount in words, e.g. "Rupees One Thousand Two Hundred Only". */
export function amountInWords(amount: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n: number) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ""}`);
  const words = (n: number): string => {
    if (n === 0) return "";
    const parts: string[] = [];
    const crore = Math.floor(n / 10000000);
    const lakh = Math.floor((n % 10000000) / 100000);
    const thousand = Math.floor((n % 100000) / 1000);
    const hundred = Math.floor((n % 1000) / 100);
    const rest = n % 100;
    if (crore) parts.push(`${words(crore)} Crore`);
    if (lakh) parts.push(`${two(lakh)} Lakh`);
    if (thousand) parts.push(`${two(thousand)} Thousand`);
    if (hundred) parts.push(`${ones[hundred]} Hundred`);
    if (rest) parts.push(`${parts.length ? "and " : ""}${two(rest)}`);
    return parts.join(" ");
  };
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  const r = words(rupees) || "Zero";
  return `Rupees ${r}${paise ? ` and ${two(paise)} Paise` : ""} Only`;
}
