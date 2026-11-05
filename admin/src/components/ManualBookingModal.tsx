import { useEffect, useMemo, useRef, useState } from "react";
import { categoryTitle } from "../domain/categoryLabel";
import type { Customer, FareRule, MasterLocation, TravelService, VehicleCategory } from "../types";
import { Modal } from "./Feedback";
import MapLocationPicker from "./MapLocationPicker";
import DateTime12Input from "./DateTime12Input";
import FareBreakupView from "./FareBreakupView";
import { Field, Notice, Section, inputCls, inputErrCls, primaryBtn, secondaryBtn } from "./FormKit";
import {
  AdminBookingError,
  COUNTRY_CODES,
  PAYMENT_METHODS,
  bookableCategories,
  bookableLocations,
  createAdminBooking,
  discountOf,
  emptyManualBooking,
  newRequestId,
  pickupTimeError,
  pointFromLocation,
  quoteAdminBooking,
  quoteKey,
  readyToQuote,
  validateManualBooking,
  validateOverride,
  type CreatedAdminBooking,
  type FareQuote,
  type ManualBookingField,
  type ManualBookingForm,
} from "../services/adminBookingService";
import { calculateCentralFare } from "../services/fareEngine";
import { useCan } from "./AccessContext";

const rupees = (n: number) => { const v = Math.round(n * 100) / 100; return `₹${v.toLocaleString("en-IN", Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };

interface Props {
  customers: Customer[];
  services: TravelService[];
  locations: MasterLocation[];
  categories: VehicleCategory[];
  fareRules: FareRule[];
  onClose: () => void;
  onCreated: (booking: CreatedAdminBooking) => void;
}

/**
 * Admin phone / walk-in booking.
 *  • Pickup and drop are chosen on a map (search, click, drag, confirm).
 *  • The fare is calculated by the booking server and refreshed automatically
 *    whenever the vehicle, route, time or discount changes — it is never typed.
 *  • An exceptional override exists only for finance, with a recorded reason.
 */
export default function ManualBookingModal({ customers, services, locations, categories, fareRules, onClose, onCreated }: Props) {
  const [form, setForm] = useState<ManualBookingForm>(emptyManualBooking);
  const canOverride = useCan("finance");
  const canDiscount = useCan("finance") || useCan("pricing");
  const [errors, setErrors] = useState<Partial<Record<ManualBookingField, string>>>({});
  const [quote, setQuote] = useState<{ key: string; data: FareQuote } | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOverride, setShowOverride] = useState(false);
  // One idempotency key per booking attempt: a retried "Create" never books twice.
  const requestId = useRef(newRequestId());

  const pickups = useMemo(() => bookableLocations(locations, "pickup"), [locations]);
  const drops = useMemo(() => bookableLocations(locations, "drop"), [locations]);
  const cats = useMemo(() => bookableCategories(categories), [categories]);
  const activeServices = useMemo(() => services.filter((s) => s.status === "Active" && s.adminBookingEnabled !== false), [services]);
  const activeCustomers = useMemo(() => customers.filter((c) => c.status !== "Suspended" && c.status !== "Blocked"), [customers]);

  const key = quoteKey(form);
  const liveQuote = quote && quote.key === key ? quote.data : null;
  const calculated = liveQuote?.quote.total ?? null;
  const busy = creating;
  // Shown as soon as a date is picked: an out-of-window pickup silently blocks the fare quote otherwise.
  const pickupError = errors.pickupAt ?? (form.pickupAt ? pickupTimeError(form.pickupAt) : null);

  // Re-price automatically whenever something that affects the fare changes.
  useEffect(() => {
    if (!readyToQuote(form)) {
      setQuoteBusy(false);
      setQuoteError(null);
      return;
    }
    let cancelled = false;
    setQuoteBusy(true);
    setQuoteError(null);
    const t = setTimeout(async () => {
      try {
        const data = await quoteAdminBooking(form, requestId.current);
        if (!cancelled) setQuote({ key, data });
      } catch (ex) {
        if (!cancelled) setQuoteError(ex instanceof AdminBookingError ? ex.message : "Could not calculate the fare. Please try again.");
      } finally {
        if (!cancelled) setQuoteBusy(false);
      }
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // The key captures every price input; `retry` lets the operator re-run after an error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retry]);

  // Rate-card quotation for the same trip (Pricing → fare rules), offered inside the override.
  const rateCard = useMemo(() => {
    if (!liveQuote) return null;
    const hhmm = form.pickupAt ? form.pickupAt.slice(11, 16) : "12:00";
    const r = calculateCentralFare({ serviceId: form.serviceId, vehicleCategoryId: form.categoryId, distanceKm: liveQuote.quote.distanceKm, pickupTime: hhmm }, fareRules, []);
    return r?.matchedRule ? { total: r.grandTotal, name: r.matchedRule.name } : null;
  }, [liveQuote, form.serviceId, form.categoryId, form.pickupAt, fareRules]);

  const set = <K extends ManualBookingField>(k: K, v: ManualBookingForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
    setError(null);
  };

  const pickCustomer = (id: string) => {
    const c = customers.find((x) => x.id === id);
    setForm((f) => ({ ...f, customerId: id, customerName: c ? c.name : f.customerName, customerPhone: c ? c.phone : f.customerPhone, email: c?.email && !f.email ? c.email : f.email }));
    setErrors((e) => ({ ...e, customerName: undefined, customerPhone: undefined }));
  };

  const create = async () => {
    if (busy || !liveQuote) return;
    const e = { ...validateManualBooking(form), ...validateOverride(form, calculated) };
    setErrors(e);
    if (Object.keys(e).length) {
      setError("Some details need attention — they are marked in red.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      onCreated(await createAdminBooking(form, requestId.current, liveQuote.quote.total));
    } catch (ex) {
      setError(ex instanceof AdminBookingError ? ex.message : "The booking was not created. Please try again.");
      // The server re-prices on every attempt; a changed price needs a fresh quote.
      if (ex instanceof AdminBookingError && /calculated fare is/.test(ex.message)) setRetry((n) => n + 1);
    } finally {
      setCreating(false);
    }
  };

  const notConfigured = [cats.length === 0 && "No vehicle category has fares configured (Fleet → Vehicle Categories)."].filter(Boolean) as string[];
  const payable = form.overrideEnabled && Number(form.overrideFare) > 0 ? Number(form.overrideFare) : liveQuote?.quote.total ?? 0;
  const d = discountOf(form);

  const footer = (
    <>
      <div className="mr-auto text-sm text-body">
        {quoteBusy ? "Calculating fare…" : liveQuote ? <>Payable <strong className="text-base text-ink">{rupees(payable)}</strong></> : "Fare appears once pickup, drop and vehicle are set."}
      </div>
      <button onClick={onClose} disabled={busy} className={secondaryBtn}>Cancel</button>
      <button onClick={create} disabled={busy || quoteBusy || !liveQuote} className={primaryBtn}>
        {creating ? "Creating…" : "Create booking"}
      </button>
    </>
  );

  return (
    <Modal title="Create New Booking" subtitle="Phone / walk-in booking — the fare is calculated by the booking server" onClose={onClose} busy={busy} size="xl" footer={footer}>
      <div className="space-y-6 text-sm">
        {notConfigured.length > 0 && (
          <Notice tone="warn">
            <div className="font-bold">Booking is not configured yet</div>
            {notConfigured.map((m) => <div key={m}>• {m}</div>)}
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}

        <Section title="Customer">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Registered customer" hint="Optional — leave empty for a walk-in." className="sm:col-span-2">
              <select value={form.customerId} onChange={(e) => pickCustomer(e.target.value)} className={inputCls}>
                <option value="">Not registered / walk-in</option>
                {activeCustomers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
              </select>
            </Field>
            <Field label="Customer name" required error={errors.customerName}>
              <input value={form.customerName} onChange={(e) => set("customerName", e.target.value)} maxLength={80} className={`${inputCls} ${errors.customerName ? inputErrCls : ""}`} />
            </Field>
            <Field label="Mobile number" required error={errors.customerPhone}>
              <input value={form.customerPhone} onChange={(e) => set("customerPhone", e.target.value)} inputMode="tel" placeholder="10-digit mobile" className={`${inputCls} ${errors.customerPhone ? inputErrCls : ""}`} />
            </Field>
            <div className="sm:col-span-2 space-y-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-body">
                <input type="checkbox" checked={form.whatsappSame} onChange={(e) => set("whatsappSame", e.target.checked)} className="w-4 h-4 accent-brand" />
                WhatsApp number is same as mobile number
              </label>
              {!form.whatsappSame && (
                <div className="grid grid-cols-[7rem_1fr] gap-2">
                  <Field label="Country code" error={null}>
                    <input list="country-codes" value={form.whatsappCountryCode} onChange={(e) => set("whatsappCountryCode", e.target.value)} className={inputCls} />
                    <datalist id="country-codes">{COUNTRY_CODES.map((c) => <option key={c} value={c} />)}</datalist>
                  </Field>
                  <Field label="WhatsApp number" required error={errors.whatsappNumber}>
                    <input value={form.whatsappNumber} onChange={(e) => set("whatsappNumber", e.target.value)} inputMode="tel" className={`${inputCls} ${errors.whatsappNumber ? inputErrCls : ""}`} />
                  </Field>
                </div>
              )}
            </div>
            <Field label="Email address" hint="Optional — used for confirmation, receipt and trip updates." error={errors.email} className="sm:col-span-2">
              <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={120} placeholder="name@example.com" className={`${inputCls} ${errors.email ? inputErrCls : ""}`} />
            </Field>
          </div>
        </Section>

        <Section title="Trip">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Booking Website / Channel" hint="Website origin attribution">
              <select value={form.channel} onChange={(e) => set("channel", e.target.value as ManualBookingForm["channel"])} className={inputCls}>
                <option value="nesam">Nesam Travels (Default)</option>
                <option value="onewaycarrentals">🟢 One Way Car Rentals</option>
                <option value="people_taxi">🔵 People Taxi</option>
              </select>
            </Field>
            <Field label="Service">
              <select value={form.serviceId} onChange={(e) => set("serviceId", e.target.value)} className={inputCls}>
                <option value="">Auto (Airport / Local / Outstation)</option>
                {activeServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Vehicle category" required error={errors.categoryId} hint="The fare updates when you change this.">
              <select value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)} className={`${inputCls} ${errors.categoryId ? inputErrCls : ""}`}>
                <option value="">Choose</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{categoryTitle(c)} ({c.seatingCapacity} seats)</option>)}
              </select>
            </Field>
            <Field label="Trip type">
              <select value={form.tripType} onChange={(e) => set("tripType", e.target.value as ManualBookingForm["tripType"])} className={inputCls}>
                <option>One Way</option>
                <option>Round Trip</option>
              </select>
            </Field>
            <Field label="Pickup date & time" required hint="Advance bookings only — up to 180 days ahead, at least 30 minutes from now." error={pickupError}>
              <DateTime12Input value={form.pickupAt} onChange={(v) => set("pickupAt", v)} hasError={!!pickupError} min={new Date().toISOString().slice(0, 10)} />
            </Field>
            {form.tripType === "Round Trip" && (
              <Field label="Return date & time" required hint="Billed by Indian calendar date from pickup to return, with a daily minimum km and bata." error={errors.tripEndAt}>
                <DateTime12Input value={form.tripEndAt} onChange={(v) => set("tripEndAt", v)} hasError={!!errors.tripEndAt} min={(form.pickupAt || new Date().toISOString()).slice(0, 10)} />
              </Field>
            )}
          </div>
        </Section>

        <Section title="Pickup" subtitle="Search or click the map, adjust the pin if needed, then confirm.">
          {pickups.length > 0 && (
            <Field label="Start from a saved location" hint="Optional shortcut — you can still move the pin.">
              <select value="" onChange={(e) => { const l = pickups.find((x) => x.id === e.target.value); if (l) set("pickup", pointFromLocation(l)); }} className={inputCls}>
                <option value="">Choose a saved location…</option>
                {pickups.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.city}</option>)}
              </select>
            </Field>
          )}
          <MapLocationPicker label="Pickup location" tone="pickup" value={form.pickup} onChange={(p) => set("pickup", p)} error={errors.pickup} disabled={busy} />
          <Field label="Pickup address details" hint="Door number, street, landmark — added to the address above.">
            <input value={form.pickupAddress} onChange={(e) => set("pickupAddress", e.target.value)} maxLength={150} className={inputCls} />
          </Field>
        </Section>

        <Section title="Drop" subtitle="Same map selection as pickup.">
          {drops.length > 0 && (
            <Field label="Start from a saved location">
              <select value="" onChange={(e) => { const l = drops.find((x) => x.id === e.target.value); if (l) set("drop", pointFromLocation(l)); }} className={inputCls}>
                <option value="">Choose a saved location…</option>
                {drops.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.city}</option>)}
              </select>
            </Field>
          )}
          <MapLocationPicker label="Drop location" tone="drop" value={form.drop} onChange={(p) => set("drop", p)} error={errors.drop} startNear={form.pickup} disabled={busy} />
          <Field label="Drop address details">
            <input value={form.dropAddress} onChange={(e) => set("dropAddress", e.target.value)} maxLength={150} className={inputCls} />
          </Field>
        </Section>

        <Section title="Fare" subtitle="Calculated automatically from the vehicle category, route and pricing rules.">
          {!readyToQuote(form) && <Notice tone="info">Set the pickup, drop (confirmed on the map) and vehicle category to see the fare.</Notice>}
          {quoteBusy && <Notice tone="info">Calculating the fare…</Notice>}
          {quoteError && (
            <Notice tone="error">
              <div className="flex items-center justify-between gap-3"><span>{quoteError}</span><button type="button" onClick={() => setRetry((n) => n + 1)} className="underline font-semibold shrink-0">Retry</button></div>
            </Notice>
          )}
          {liveQuote && (
            <div className="space-y-3">
              <div className="flex flex-wrap justify-between gap-2 text-sm text-body">
                <span>{liveQuote.categoryName} · {liveQuote.service} · {liveQuote.quote.distanceKm} km · {liveQuote.quote.durationMin} min</span>
              </div>
              {liveQuote.quote.globalAdjustment && (
                <Notice tone="info">
                  <strong>{liveQuote.quote.globalAdjustment.name}</strong> is applied: {liveQuote.quote.globalAdjustment.direction === "increase" ? "+" : "−"}{liveQuote.quote.globalAdjustment.percent}% on the package ({liveQuote.quote.globalAdjustment.amount >= 0 ? "+" : "−"}{rupees(Math.abs(liveQuote.quote.globalAdjustment.amount))}).
                </Notice>
              )}
              <FareBreakupView breakup={liveQuote.breakup} total={liveQuote.quote.total} />
              <div className="rounded-lg border border-line bg-gray-50 p-3 text-sm space-y-1">
                <div className="flex justify-between"><span>Original fare (before discount)</span><span className="font-semibold">{rupees(liveQuote.quote.subtotal + Math.round(liveQuote.quote.subtotal * liveQuote.quote.gstRate))}</span></div>
                {liveQuote.quote.discount > 0 && <div className="flex justify-between text-green-700"><span>Discount{liveQuote.quote.discountDetail?.type === "percentage" ? ` (${liveQuote.quote.discountDetail.value}%)` : ""}</span><span className="font-semibold">− {rupees(liveQuote.quote.discount)} <span className="font-normal text-xs">(before GST)</span></span></div>}
                <div className="flex justify-between text-base font-bold border-t pt-1"><span>Final payable</span><span>{rupees(liveQuote.quote.total)}</span></div>
              </div>
            </div>
          )}
        </Section>

        {canDiscount && (
          <Section title="Discount" subtitle="One discount per booking. It is stored separately — the base fare is never rewritten.">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Discount type">
                <select value={form.discountType} onChange={(e) => set("discountType", e.target.value as ManualBookingForm["discountType"])} className={inputCls}>
                  <option value="none">No discount</option>
                  <option value="percentage">Percentage (%)</option>
                  <option value="fixed">Fixed amount (₹)</option>
                </select>
              </Field>
              {form.discountType !== "none" && (
                <>
                  <Field label={form.discountType === "percentage" ? "Percent off" : "Amount off (₹)"} required error={errors.discountValue ?? d.error}>
                    <input value={form.discountValue} onChange={(e) => set("discountValue", e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className={`${inputCls} ${errors.discountValue ? inputErrCls : ""}`} />
                  </Field>
                  <Field label="Reason" error={errors.discountReason}>
                    <input value={form.discountReason} onChange={(e) => set("discountReason", e.target.value)} maxLength={200} placeholder="e.g. Regular customer" className={inputCls} />
                  </Field>
                </>
              )}
            </div>
          </Section>
        )}

        <Section title="Payment">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Expected payment method">
              <select value={form.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)} className={inputCls}>
                {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm font-semibold text-body self-end pb-2.5">
              <input type="checkbox" checked={form.advanceEnabled} onChange={(e) => set("advanceEnabled", e.target.checked)} className="w-4 h-4 accent-brand" />
              Customer paid an advance now
            </label>
          </div>
          {form.advanceEnabled && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-lg border border-line bg-gray-50">
              <Field label="Advance amount (₹)" required error={errors.advanceAmount}>
                <input value={form.advanceAmount} onChange={(e) => set("advanceAmount", e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className={`${inputCls} ${errors.advanceAmount ? inputErrCls : ""}`} />
              </Field>
              <Field label="Received by">
                <select value={form.advanceMethod} onChange={(e) => set("advanceMethod", e.target.value)} className={inputCls}>
                  {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </Field>
              {form.advanceMethod !== "Cash" && (
                <Field label={form.advanceMethod === "UPI" ? "UPI transaction ID" : "Transfer reference"} required error={errors.advanceReference}>
                  <input value={form.advanceReference} onChange={(e) => set("advanceReference", e.target.value)} maxLength={120} className={`${inputCls} ${errors.advanceReference ? inputErrCls : ""}`} />
                </Field>
              )}
              <p className="sm:col-span-3 text-xs text-muted">Recorded as collected by you ({`admin`}). More payments can be added from the booking later.</p>
            </div>
          )}
          <Field label="Notes">
            <input value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={300} className={inputCls} />
          </Field>
        </Section>

        {canOverride && liveQuote && (
          <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-3">
            <button type="button" onClick={() => setShowOverride((v) => !v)} className="text-sm font-bold text-amber-900 flex items-center gap-2" aria-expanded={showOverride}>
              {showOverride ? "▾" : "▸"} Exceptional fare override (finance only)
            </button>
            {showOverride && (
              <div className="space-y-3">
                <p className="text-xs text-amber-900">The calculated fare is the normal price. Overriding it is recorded with your name, the old and new fare and your reason, and cannot be done silently.</p>
                <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <input type="checkbox" checked={form.overrideEnabled} onChange={(e) => set("overrideEnabled", e.target.checked)} className="w-4 h-4 accent-brand" />
                  Charge a different fare
                </label>
                {rateCard && rateCard.total !== liveQuote.quote.total && (
                  <button type="button" onClick={() => setForm((f) => ({ ...f, overrideEnabled: true, overrideFare: String(rateCard.total), overrideReason: `Rate card quotation: ${rateCard.name}` }))} className="text-xs text-blue-800 font-semibold hover:underline">
                    Use rate card “{rateCard.name}”: {rupees(rateCard.total)}
                  </button>
                )}
                {form.overrideEnabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Fare to charge (₹, incl. GST)" required error={errors.overrideFare}>
                      <input value={form.overrideFare} onChange={(e) => set("overrideFare", e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={inputCls} />
                    </Field>
                    <Field label="Reason" required error={errors.overrideReason} className="sm:col-span-2">
                      <input value={form.overrideReason} onChange={(e) => set("overrideReason", e.target.value)} maxLength={300} placeholder="e.g. Corporate contract rate, quote Q-17" className={inputCls} />
                    </Field>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
        {quote && !liveQuote && !quoteBusy && readyToQuote(form) && !quoteError && <Notice tone="info">Trip details changed — recalculating the fare.</Notice>}
      </div>
    </Modal>
  );
}
