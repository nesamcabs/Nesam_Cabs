// Automatic GST documents. For every trip and payment the server issues, once:
//   invoices/      tax invoice (completed trip, Local Taxi ride, retained cancellation charge) and debit note
//   gst_receipts/  receipt voucher (advance, Rule 50), payment receipt, refund voucher (Rule 51)
//   gst_review/    why a document could not be issued — nothing is ever issued on a guess
// Every step reads the stored records and is safe to repeat, so it runs from the Firestore trigger, from the HTTP API's
// reconcile step, from the periodic sweep and from the office's "Generate pending bills" button.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldPath, FieldValue, Timestamp, type DocumentData, type Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { derivedPaymentFields, txnsRef } from './bookingPayments';
import { requireAction, requirePermission } from './shared';
import { gstComponents, gstState } from './domain/gst';
import {
  ADDRESS_REQUIRED_FROM, buildInvoiceLines, companyFromSettings, companyProblems, counterKey, determineTax, documentId, documentNumber,
  extraItems, financialYear, istIsoDate, parseAmount, policyService, round2, splitInclusive, stateFromAddress, stateName,
  type Company, type Recipient, type Series, type Tax,
} from './domain/gstInvoice';

export const GST_RECEIPTS = 'gst_receipts';
export const GST_REVIEW = 'gst_review';
/** Rule 47: a service invoice is due within 30 days. Older trips are billed only when the office asks for them. */
const AUTO_WINDOW_MS = 30 * 86400000;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ms = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : 0);

export interface SyncResult { invoices: number; receipts: number; review: string }
interface Context { company: Company; policy: DocumentData | undefined }

async function loadContext(): Promise<Context> {
  const [config, policy] = await Promise.all([db.doc('settings/config').get(), db.doc('settings/tax_policy').get()]);
  return { company: companyFromSettings(config.data() ?? {}), policy: policy.data() };
}

/** Takes the next serial number of a series inside the caller's transaction; the returned function saves the counter. */
async function nextNumber(tx: Transaction, series: Series, isoDate: string) {
  const ref = db.doc('settings/invoice_sequence');
  const fy = financialYear(isoDate);
  const key = counterKey(series, fy);
  const seq = Number((await tx.get(ref)).data()?.[key] ?? 0) + 1;
  const number = documentNumber(series, fy, seq);
  return { number, id: documentId(number), save: () => tx.set(ref, { [key]: seq, updatedAt: FieldValue.serverTimestamp() }, { merge: true }) };
}

async function recipientOf(b: DocumentData): Promise<Recipient> {
  const customerId = str(b.customerId, 128);
  const businessId = str(b.businessAccountId, 128);
  const [customer, business] = await Promise.all([
    ID.test(customerId) ? db.doc(`customers/${customerId}`).get() : null,
    ID.test(businessId) && b.businessBilledTo !== 'Passenger pays' ? db.doc(`business_accounts/${businessId}`).get() : null,
  ]);
  const c = customer?.data() ?? {};
  const firm = business?.data();
  if (firm) {
    const gstin = str(firm.gstin, 15).toUpperCase();
    return { name: str(firm.name), phone: str(firm.phone), email: str(firm.email), address: str(firm.billingAddress), gstin, state: gstState(gstin.slice(0, 2)) };
  }
  const gstin = str(c.gstin || c.gstNumber || c.gst, 15).toUpperCase();
  const address = str(c.billingAddress || c.address);
  return {
    name: str(b.customerName || b.customer || c.name) || 'Customer', phone: str(b.customerPhone || b.phone || c.phone),
    email: str(b.customerEmail || c.email), address, gstin, state: gstState(c.billingState || c.state) || stateFromAddress(address),
  };
}

async function boardingStateOf(b: DocumentData): Promise<string> {
  const saved = gstState(b.fareBreakdown?.gstDetails?.boardingState);
  if (saved) return saved;
  let id = str(b.pickupLocationId, 150);
  const seen = new Set<string>();
  for (let hop = 0; hop < 5 && id && !id.includes('/') && !seen.has(id); hop++) {
    seen.add(id);
    const row = (await db.doc(`locations/${id}`).get()).data();
    if (!row) break;
    const state = gstState(row.state);
    if (state) return state;
    id = str(row.parentLocationId, 150);
  }
  return stateFromAddress(b.pickupAddress) || stateFromAddress(typeof b.pickup === 'string' ? b.pickup : '');
}

async function taxFor(ctx: Context, b: DocumentData, recipient: Recipient) {
  const saved = b.fareBreakdown?.gstDetails;
  return determineTax({
    company: ctx.company, policy: ctx.policy, service: b.service, recipient, boardingState: await boardingStateOf(b),
    saved: saved ? { supplierState: saved.supplierState, placeOfSupply: saved.placeOfSupply, split: saved.split } : undefined,
  });
}

const customerSnapshot = (r: Recipient) => ({ name: r.name, phone: r.phone, email: r.email, address: r.address, gstin: r.gstin });
const tripSnapshot = (b: DocumentData) => ({
  service: str(b.service), pickup: str(b.pickupAddress || b.pickup), drop: str(b.dropAddress || b.drop), travelDate: str(b.date), travelTime: str(b.time),
  vehicle: str(b.vehicle || b.vehicleCategory), vehicleCategory: str(b.vehicleCategory), vehicleNumber: str(b.assignedVehicleNumber),
  driverName: str(b.assignedDriverName || b.driver), distanceKm: Number(b.totalKm || b.distanceKm || 0),
});
const taxFields = (ctx: Context, tax: Tax) => ({
  companySnapshot: { ...ctx.company, sacCode: tax.sac }, documentType: tax.documentType, taxSplit: tax.split, sac: tax.sac, classification: tax.classification,
  placeOfSupply: stateName(tax.placeOfSupply), placeOfSupplyCode: tax.placeOfSupply, recipientState: stateName(tax.recipientState), boardingState: stateName(tax.boardingState),
  taxPolicyState: tax.taxPolicyState, taxPolicyReference: tax.taxPolicyReference, reverseCharge: 'No',
});
const automatic = () => ({ autoGenerated: true, createdBy: 'system', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
function paymentFields(total: number, paid: number) {
  const paidAmount = round2(Math.max(0, Math.min(total, paid)));
  const balanceAmount = round2(total - paidAmount);
  return { paidAmount, balanceAmount, paymentStatus: balanceAmount <= 0.005 ? 'Paid' : paidAmount > 0 ? 'Partially Paid' : 'Pending' };
}
const isTaxInvoice = (i: DocumentData) => i.documentType !== 'Debit note' && i.documentType !== 'Pro forma';
const live = (i: DocumentData) => i.invoiceStatus !== 'Cancelled';

// ── Trip invoices ────────────────────────────────────────────────────────────
async function issueTripInvoice(ctx: Context, bookingId: string, b: DocumentData, txns: DocumentData[], manual: boolean): Promise<{ issued: number; review: string }> {
  const completed = b.status === 'Completed';
  const charge = b.status === 'Cancelled' ? parseAmount(b.cancellation?.charge ?? b.cancellationFee) : 0;
  const nothing = { issued: 0, review: '' };
  if (!completed && !(charge > 0)) return nothing;
  const existing = (await db.collection('invoices').where('bookingDocumentId', '==', bookingId).get()).docs.map((d) => ({ ...d.data(), id: d.id }) as DocumentData);
  const current = existing.find((i) => isTaxInvoice(i) && live(i));
  if (current) return completed ? issueDebitNote(ctx, bookingId, b, current, existing) : nothing;
  const hold = (review: string) => ({ issued: 0, review });
  if (existing.some(isTaxInvoice)) return hold('The invoice for this trip was voided. Issue the replacement from Invoices → Create invoice.');
  if (b.invoiceId) return nothing; // an older invoice linked from the booking only

  const endedAt = ms(completed ? b.completedAt ?? b.tripEndedAt : b.cancellation?.at ?? b.cancelledAt);
  if (!manual && (!endedAt || Date.now() - endedAt > AUTO_WINDOW_MS)) return hold('The trip ended more than 30 days ago (or has no end date). Use "Generate pending bills" after checking it.');
  if (completed) {
    if (b.extraUsage?.status === 'submitted') return hold('Extra charges are waiting for approval; the invoice is issued after they are decided.');
    if (b.fareReview?.required === true && !b.fareOverride) return hold(`The fare needs office review: ${str(b.fareReview.reason) || 'check the final fare'}.`);
    if (!(parseAmount(b.fare) > 0)) return hold('The booking has no fare.');
  }
  if (typeof b.fareBreakdown?.gst !== 'number' || !(b.fareBreakdown.gst > 0)) return hold('The booking has no saved GST amount. Check the fare GST settings and issue it by hand.');
  const recipient = await recipientOf(b);
  const found = await taxFor(ctx, b, recipient);
  if (!found.ok) return hold(found.reason);
  const tax = found.tax;

  const trip = `${b.service || 'Taxi service'} — ${b.pickup || 'Pickup'} to ${b.drop || 'Drop'}`;
  const lines = completed
    ? buildInvoiceLines(b, tax.sac, tax.split)
    : (() => {
      const money = splitInclusive(charge, typeof b.fareBreakdown.gstRate === 'number' ? b.fareBreakdown.gstRate : 0.05, tax.split);
      return { ...money, items: [{ description: `Cancellation charge (${trip})`, sacCode: tax.sac, quantity: 1, rate: money.taxableAmount, amount: money.taxableAmount }], subtotal: money.taxableAmount, discount: 0, tolls: 0 };
    })();
  if (!recipient.gstin && lines.grandTotal >= ADDRESS_REQUIRED_FROM && !recipient.address) return hold('A bill of ₹50,000 or more needs the customer\'s address. Add it to the customer record.');

  const issued = await db.runTransaction(async (tx) => {
    const bookingRef = db.doc(`bookings/${bookingId}`);
    const [snap, again] = await Promise.all([tx.get(bookingRef), tx.get(db.collection('invoices').where('bookingDocumentId', '==', bookingId))]);
    const fresh = snap.data();
    if (!fresh || fresh.invoiceId || fresh.status !== b.status || fresh.fare !== b.fare || again.docs.some((d) => isTaxInvoice(d.data()))) return false;
    const today = istIsoDate(Date.now());
    const n = await nextNumber(tx, 'invoice', today);
    const { summary } = derivedPaymentFields(fresh, txns);
    const legacyPaid = !txns.length && (fresh.payment === 'Paid' || fresh.paymentStatus === 'Paid');
    tx.create(db.doc(`invoices/${n.id}`), {
      id: n.id, invoiceNumber: n.number, sourceType: completed ? 'trip' : 'cancellation',
      bookingId: str(fresh.bookingId) || bookingId, bookingDocumentId: bookingId, customerId: str(fresh.customerId),
      invoiceDate: today, dueDate: today, customerSnapshot: customerSnapshot(recipient), tripSnapshot: tripSnapshot(fresh),
      ...taxFields(ctx, tax), ...lines, ...paymentFields(lines.grandTotal, legacyPaid ? lines.grandTotal : summary.totalPaid - summary.refunded),
      invoiceStatus: 'Issued', terms: `Computer-generated tax invoice. ${tax.classification} under SAC ${tax.sac}.`, ...automatic(),
    });
    n.save();
    // updatedAt is left alone: this link must not send the booking round the reconcile sweep again.
    tx.update(bookingRef, { invoiceId: n.id, invoiceNumber: n.number });
    return true;
  });
  return { issued: issued ? 1 : 0, review: '' };
}

/** Extra charges approved after the invoice went out are billed on a debit note against it (CGST Act s.34(3)). */
async function issueDebitNote(ctx: Context, bookingId: string, b: DocumentData, original: DocumentData, existing: DocumentData[]): Promise<{ issued: number; review: string }> {
  const ec = b.extraCharges?.status === 'approved' ? b.extraCharges : null;
  const nothing = { issued: 0, review: '' };
  if (!ec || !(ec.customer?.subtotalPaise > 0)) return nothing;
  const billed = (original.items ?? []).some((i: DocumentData) => /approved extra charge/.test(String(i.description)));
  if (billed || existing.some((i) => i.documentType === 'Debit note' && i.extraRevision === ec.revision)) return nothing;
  const recipient = await recipientOf(b);
  const found = await taxFor(ctx, b, recipient);
  if (!found.ok) return { issued: 0, review: found.reason };
  const tax = { ...found.tax, documentType: 'Debit note' };
  const net = round2(ec.customer.subtotalPaise / 100), gst = round2(ec.customer.gstPaise / 100);
  const totals = {
    taxableAmount: ec.taxTreatment === 'tariff_gst' ? net : 0, gstRate: Number(ec.gstRate) || 0,
    ...gstComponents(gst, tax.split), totalTax: gst, grandTotal: round2(net + gst),
  };
  const created = await db.runTransaction(async (tx) => {
    const again = await tx.get(db.collection('invoices').where('bookingDocumentId', '==', bookingId));
    if (again.docs.some((d) => d.data().documentType === 'Debit note' && d.data().extraRevision === ec.revision)) return false;
    const today = istIsoDate(Date.now());
    const n = await nextNumber(tx, 'debit', today);
    tx.create(db.doc(`invoices/${n.id}`), {
      id: n.id, invoiceNumber: n.number, sourceType: 'debit_note', extraRevision: ec.revision,
      originalInvoiceNumber: original.invoiceNumber, originalInvoiceDate: original.invoiceDate,
      bookingId: original.bookingId, bookingDocumentId: bookingId, customerId: str(b.customerId), invoiceDate: today, dueDate: today,
      customerSnapshot: original.customerSnapshot ?? customerSnapshot(recipient), tripSnapshot: tripSnapshot(b),
      ...taxFields(ctx, tax), ...totals, items: extraItems(ec, tax.sac), subtotal: totals.taxableAmount, discount: 0, tolls: 0,
      ...paymentFields(totals.grandTotal, 0), invoiceStatus: 'Issued', terms: `Debit note against invoice ${original.invoiceNumber} dated ${original.invoiceDate}.`, ...automatic(),
    });
    n.save();
    return true;
  });
  return { issued: created ? 1 : 0, review: '' };
}
// ── Payments and refunds ─────────────────────────────────────────────────────
async function writeReceipt(id: string, series: Series, data: DocumentData): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`${GST_RECEIPTS}/${id}`);
    if ((await tx.get(ref)).exists) return false;
    const today = istIsoDate(Date.now());
    const n = await nextNumber(tx, series, today);
    tx.create(ref, { ...data, id, invoiceNumber: n.number, invoiceDate: today, invoiceStatus: 'Issued', ...automatic() });
    n.save();
    return true;
  });
}

async function syncReceipts(ctx: Context, bookingId: string, b: DocumentData, txns: DocumentData[]): Promise<{ issued: number; review: string }> {
  let issued = 0, review = '';
  const have = new Map((await db.collection(GST_RECEIPTS).where('bookingDocumentId', '==', bookingId).get()).docs.map((d) => [d.id, d.data()]));
  const missingCompany = companyProblems(ctx.company);
  const endedAt = b.status === 'Completed' ? ms(b.completedAt ?? b.tripEndedAt) : 0;
  let recipient: Recipient | null = null;
  const party = async () => (recipient ??= await recipientOf(b));
  const base = async () => ({
    bookingId: str(b.bookingId) || bookingId, bookingDocumentId: bookingId, customerId: str(b.customerId),
    customerSnapshot: customerSnapshot(await party()), tripSnapshot: tripSnapshot(b), companySnapshot: ctx.company, reverseCharge: 'No',
  });
  /** An amount taken before the supply, or returned without it, shows the GST inside it. */
  const taxed = async (amount: number, description: string) => {
    const found = await taxFor(ctx, b, await party());
    if (!found.ok) { review ||= found.reason; return null; }
    const rate = b.fareBreakdown?.gstRate;
    if (typeof rate !== 'number' || !(rate > 0)) { review ||= 'The booking has no saved GST rate, so a voucher cannot be issued.'; return null; }
    const money = splitInclusive(amount, rate, found.tax.split);
    return { ...taxFields(ctx, found.tax), ...money, subtotal: money.taxableAmount, discount: 0, items: [{ description, sacCode: found.tax.sac, quantity: 1, rate: money.taxableAmount, amount: money.taxableAmount }] };
  };

  for (const t of txns) {
    const id = documentId(`${bookingId}_${t.id}`);
    const old = have.get(id);
    if (t.status === 'Voided') {
      if (old && old.invoiceStatus !== 'Cancelled') await db.doc(`${GST_RECEIPTS}/${id}`).update({ invoiceStatus: 'Cancelled', voidReason: str(t.voidReason) || 'The payment was voided.', updatedAt: FieldValue.serverTimestamp() });
      continue;
    }
    if (old || (t.status && t.status !== 'Success') || !(Number(t.amount) > 0)) continue;
    if (missingCompany.length) { review ||= `Add ${missingCompany.join(', ')} in Settings → Company.`; continue; }
    const paidAt = ms(t.paymentDate) || ms(t.createdAt);
    // Received before the service was supplied → receipt voucher; afterwards → an ordinary receipt against the bill.
    const advance = !endedAt || (paidAt > 0 && paidAt < endedAt);
    const description = `${advance ? 'Advance' : 'Payment'} received — ${b.service || 'Taxi service'}, booking ${str(b.bookingId) || bookingId}`;
    const body = advance ? await taxed(Number(t.amount), description) : {
      documentType: 'Payment receipt', items: [{ description, quantity: 1, rate: Number(t.amount), amount: Number(t.amount) }],
      subtotal: Number(t.amount), discount: 0, taxableAmount: 0, gstRate: 0, cgst: 0, sgst: 0, utgst: 0, igst: 0, totalTax: 0, grandTotal: round2(Number(t.amount)),
      ...(str(b.invoiceNumber) ? { originalInvoiceNumber: str(b.invoiceNumber) } : {}),
    };
    if (!body) continue;
    if (await writeReceipt(id, advance ? 'receipt' : 'payment', {
      ...(await base()), ...body, documentType: advance ? 'Receipt voucher' : 'Payment receipt', sourceType: advance ? 'advance' : 'payment', paymentId: t.id,
      payment: { method: str(t.method), reference: str(t.reference), date: paidAt ? istIsoDate(paidAt) : '', collectedBy: str(t.collectorName) },
      paidAmount: round2(Number(t.amount)), balanceAmount: 0, paymentStatus: 'Paid',
    })) issued++;
  }

  const refund = b.refund;
  const refundId = documentId(`${bookingId}_refund`);
  if (refund?.status === 'Completed' && Number(refund.amount) > 0 && !have.has(refundId)) {
    if (missingCompany.length) return { issued, review: review || `Add ${missingCompany.join(', ')} in Settings → Company.` };
    const body = await taxed(Number(refund.amount), `Refund — ${b.service || 'Taxi service'}, booking ${str(b.bookingId) || bookingId}`);
    if (body) {
      const against = [...(await db.collection(GST_RECEIPTS).where('bookingDocumentId', '==', bookingId).get()).docs.map((d) => d.data())]
        .filter((r) => r.sourceType === 'advance' && live(r)).map((r) => r.invoiceNumber).join(', ');
      if (await writeReceipt(refundId, 'refund', {
        ...(await base()), ...body, documentType: 'Refund voucher', sourceType: 'refund', ...(against ? { originalInvoiceNumber: against } : {}),
        payment: { method: str(refund.method), reference: str(refund.reference), date: istIsoDate(ms(refund.processedAt) || Date.now()), collectedBy: '' },
        paidAmount: round2(Number(refund.amount)), balanceAmount: 0, paymentStatus: 'Paid',
      })) issued++;
    }
  }
  return { issued, review };
}

// ── Review queue ─────────────────────────────────────────────────────────────
async function setReview(key: string, reason: string, info: DocumentData): Promise<void> {
  const ref = db.doc(`${GST_REVIEW}/${key}`);
  const old = (await ref.get()).data();
  if (!reason) { if (old) await ref.delete(); return; }
  if (old?.reason === reason) return;
  await ref.set({ ...info, reason, updatedAt: FieldValue.serverTimestamp() });
}

/** Issues whatever this booking is still owed. `manual` (the office's button) also covers trips older than 30 days. */
export async function syncGstDocuments(bookingId: string, options: { manual?: boolean; context?: Context } = {}): Promise<SyncResult> {
  const snap = await db.doc(`bookings/${bookingId}`).get();
  const b = snap.data();
  if (!b) return { invoices: 0, receipts: 0, review: '' };
  const txns = (await txnsRef(bookingId).get()).docs.map((d) => ({ ...d.data(), id: d.id }) as DocumentData);
  const billable = b.status === 'Completed' || (b.status === 'Cancelled' && parseAmount(b.cancellation?.charge ?? b.cancellationFee) > 0);
  if (!billable && !txns.length && b.refund?.status !== 'Completed') {
    await setReview(bookingId, '', {});
    return { invoices: 0, receipts: 0, review: '' };
  }
  const context = options.context ?? await loadContext();
  // Invoice first, so a receipt taken after the trip can quote its number.
  const invoice = await issueTripInvoice(context, bookingId, b, txns, !!options.manual);
  const latest = invoice.issued ? (await db.doc(`bookings/${bookingId}`).get()).data() ?? b : b;
  const receipts = await syncReceipts(context, bookingId, latest, txns);
  const review = invoice.review || receipts.review;
  await setReview(bookingId, review, { sourceType: 'booking', bookingDocumentId: bookingId, bookingId: str(b.bookingId) || bookingId, customer: str(b.customerName || b.customer), status: str(b.status), amount: parseAmount(b.fare) });
  return { invoices: invoice.issued, receipts: receipts.issued, review };
}

/** Never lets a billing problem undo the payment or trip step that triggered it; the sweep tries again. */
export const syncGstSafely = (bookingId: string) => syncGstDocuments(bookingId).catch((err) => console.warn('gst documents failed', bookingId, err));

/** Periodic safety net: tries the oldest held items again (company details or the tax approval may have been added since). */
export async function sweepGstReview(limit = 40): Promise<{ checked: number; issued: number; failed: number }> {
  const held = await db.collection(GST_REVIEW).orderBy('updatedAt').limit(limit).get();
  let issued = 0, failed = 0;
  const context = held.empty ? undefined : await loadContext();
  for (const d of held.docs) {
    try {
      // Local Taxi is retired: a held ride entry has nothing left to bill, so it is dropped instead of retried.
      if (d.data().sourceType === 'local_taxi') { await d.ref.delete(); continue; }
      const r = await syncGstDocuments(d.id, { context });
      issued += r.invoices + r.receipts;
      if (r.review) await d.ref.update({ updatedAt: FieldValue.serverTimestamp() }); // to the back of the queue
    } catch (err) {
      failed++;
      console.warn('gst review retry failed', d.id, err);
    }
  }
  return { checked: held.size, issued, failed };
}

/**
 * "Generate pending bills": walks every booking and issues what is missing. The caller
 * repeats with the returned cursor until `done`.
 */
export const generateGstDocuments = onCall({ timeoutSeconds: 60 }, async (request) => {
  const admin = await requirePermission(request.auth, 'finance');
  requireAction(admin, 'Invoices', 'create');
  const input = (request.data ?? {}) as { phase?: unknown; after?: unknown };
  let after = typeof input.after === 'string' && ID.test(input.after) ? input.after : '';
  if (input.after && !after) throw new HttpsError('invalid-argument', 'Invalid position.');
  const context = await loadContext();
  const missing = companyProblems(context.company);
  if (missing.length) throw new HttpsError('failed-precondition', `Add ${missing.join(', ')} in Settings → Company before generating bills.`);
  const started = Date.now();
  const report = { checked: 0, invoices: 0, receipts: 0, review: 0, failed: 0 };
  while (Date.now() - started < 35000) {
    let q = db.collection('bookings').orderBy(FieldPath.documentId()).limit(25);
    if (after) q = q.startAfter(after);
    const page = await q.get();
    for (const d of page.docs) {
      if (Date.now() - started >= 35000) return { ...report, done: false, phase: 'bookings', after };
      try {
        const r = await syncGstDocuments(d.id, { manual: true, context });
        report.invoices += r.invoices;
        report.receipts += r.receipts;
        if (r.review) report.review++;
      } catch (err) {
        report.failed++;
        console.warn('gst backfill failed', d.id, err);
      }
      report.checked++;
      after = d.id;
    }
    if (page.size < 25) return { ...report, done: true, phase: 'bookings', after: '' };
  }
  return { ...report, done: false, phase: 'bookings', after };
});

/** Firebase hosting of the functions: the same step as a trigger (the HTTP API runs it from reconcile instead). */
export const onBookingGstDocuments = onDocumentWritten('bookings/{bookingId}', async (event) => {
  if (!event.data?.after.exists) return;
  const before = event.data.before.data(), after = event.data.after.data()!;
  const keys = ['status', 'fare', 'tollCharges', 'extraCharges', 'extraUsage', 'refund', 'paymentSummary', 'cancellation'];
  if (before && keys.every((k) => JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null))) return;
  await syncGstDocuments(event.params.bookingId);
});
