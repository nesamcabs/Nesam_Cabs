import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Customer } from "../types";
import { subscribeCustomers } from "../services/adminFirestoreService";
import {
  COUNTRY_CODES, PAYMENT_METHODS, createAdminBooking, emailError, emptyManualBooking, newRequestId, normalizePhone, quoteAdminBooking, whatsappError,
  type CreatedAdminBooking, type ManualBookingForm,
} from "../services/adminBookingService";
import { ActionError } from "../services/callables";
import { markEnquiryConverted, isMulticityEnquiry, MULTICITY_CONVERSION_MESSAGE, type Enquiry } from "../services/enquiryService";
import { useCan, useStaffFlag } from "../components/AccessContext";
import { Toast, useToast } from "../components/Feedback";
import MapLocationPicker from "../components/MapLocationPicker";
import { Badge, Button, Icon, PageHeader } from "../components/ui";
import { FareBreakupCard } from "../components/booking/Enquiries";
import {
  EstimateList, ExtrasFields, SaveEnquiryDialog, TripFields, breakupLines, emptyTrip, estimateAll, estimateFacts, extrasNote, gstEntryOf, refPickupLabel,
  tripServiceLabel, tripToForm, useQuickData, validateTrip, type CategoryEstimate, type QuickTrip,
} from "../components/booking/QuickFare";
import { rupee } from "../domain/officeStage";
import { isoDateIST } from "../utils/time";

export interface NewBookingDraft {
  trip: QuickTrip;
  categoryId: string;
  estimates?: CategoryEstimate[];
  enquiry?: Enquiry;
}

type Step = "trip" | "estimate" | "customer" | "review";
type Source = "Phone" | "WhatsApp" | "Office" | "App";

interface CustomerForm {
  phone: string;
  name: string;
  customerId: string;
  whatsappSame: boolean;
  waCode: string;
  waNumber: string;
  email: string;
  source: Source;
  channel: ManualBookingForm["channel"];
  someoneElse: boolean;
  paxName: string;
  paxPhone: string;
  paxWhatsapp: string;
  pickupAddress: string;
  dropAddress: string;
}

const EMPTY_CUSTOMER: CustomerForm = {
  phone: "", name: "", customerId: "", whatsappSame: true, waCode: "+91", waNumber: "", email: "", source: "Phone", channel: "nesam",
  someoneElse: false, paxName: "", paxPhone: "", paxWhatsapp: "", pickupAddress: "", dropAddress: "",
};

/** Trip rebuilt from a saved quote so it can be converted without re-entering the route. */
function tripFromEnquiry(e: Enquiry): QuickTrip {
  const t = emptyTrip();
  const at = e.pickupAt?.toDate?.();
  const ist = at ? new Date(at.getTime() + 330 * 60000).toISOString() : "";
  return {
    ...t,
    serviceId: e.serviceId || "",
    tripType: e.tripType === "Round Trip" || e.tripType === "Local Rental" ? e.tripType : e.tripType === "Airport" ? "Airport Taxi" : "One Way",
    airportDirection: e.pickupPoint?.type === "airport" && e.dropPoint?.type !== "airport" ? "from" : "to",
    pickupText: e.pickup, dropText: e.drop,
    pickup: e.pickupPoint ? { ...e.pickupPoint, name: e.pickupPoint.name || e.pickup, type: e.pickupPoint.type === "airport" ? "airport" : "other", confirmed: true } : null,
    drop: e.dropPoint ? { ...e.dropPoint, name: e.dropPoint.name || e.drop, type: e.dropPoint.type === "airport" ? "airport" : "other", confirmed: true } : null,
    date: ist ? ist.slice(0, 10) : t.date,
    time: ist ? ist.slice(11, 16) : t.time,
  };
}

export default function NewBooking({ draft, onCreated, onCancel, onEnquirySaved }: {
  draft?: NewBookingDraft | null;
  onCreated: (b: CreatedAdminBooking) => void;
  onCancel: () => void;
  onEnquirySaved: (e: Enquiry) => void;
}) {
  const data = useQuickData();
  const [trip, setTrip] = useState<QuickTrip>(() => draft?.trip ?? (draft?.enquiry ? tripFromEnquiry(draft.enquiry) : emptyTrip()));
  const [estimates, setEstimates] = useState<CategoryEstimate[] | null>(draft?.estimates ?? null);
  const [selected, setSelected] = useState(draft?.categoryId ?? draft?.enquiry?.categoryId ?? "");
  const [step, setStep] = useState<Step>(draft?.estimates ? "customer" : "trip");
  const [billedTo, setBilledTo] = useState<"Company pays" | "Passenger pays">("Company pays");
  const [c, setC] = useState<CustomerForm>(() => ({
    ...EMPTY_CUSTOMER,
    phone: draft?.enquiry?.phone?.replace(/^\+91/, "") ?? "",
    name: draft?.enquiry?.customerName ?? "",
  }));
  const [errors, setErrors] = useState<Partial<Record<keyof CustomerForm, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  // Review step
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountType, setDiscountType] = useState<ManualBookingForm["discountType"]>("none");
  const [discountValue, setDiscountValue] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [overrideOn, setOverrideOn] = useState(false);
  const [overrideFare, setOverrideFare] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [advanceOn, setAdvanceOn] = useState(false);
  const [advance, setAdvance] = useState({ amount: "", method: "UPI", reference: "" });
  const [payMethod, setPayMethod] = useState<string>("Cash");
  const [notes, setNotes] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [couponMsg, setCouponMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // The coupon the server accepted for the current quote, with its server-calculated discount.
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const canApplyCoupon = useStaffFlag("partnerRights", "applyCoupon");
  const canSeePayout = useStaffFlag("sensitive", "vendorPayout");
  const requestId = useRef(newRequestId());
  const canOverride = useCan("finance");
  const canDiscount = useCan("finance") || useCan("pricing");
  const { toast, show } = useToast(7000);

  useEffect(() => {
    const u = [subscribeCustomers(setCustomers)];
    return () => u.forEach((x) => x());
  }, []);
  // A converted enquiry re-prices the saved route as soon as the categories load.
  useEffect(() => {
    if (draft?.enquiry && !isMulticityEnquiry(draft.enquiry) && !estimates && data.categories.length && trip.pickup && trip.drop && !validateTrip(trip)) {
      estimateAll(trip, data.categories).then((list) => {
        setEstimates(list);
        if (!list.some((x) => x.category.id === selected && x.quote)) setSelected(list.find((x) => x.quote)?.category.id ?? "");
        setStep("customer");
      });
    }
  }, [data.categories]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (p: Partial<QuickTrip>) => {
    setTrip((t) => ({ ...t, ...p }));
    if (p.pickup !== undefined || p.drop !== undefined || p.date || p.time || p.serviceId !== undefined || p.endDate !== undefined) setEstimates(null);
  };
  const chosen = estimates?.find((x) => x.category.id === selected && x.quote) ?? null;
  const q = chosen?.quote ?? null;
  const business = data.business.find((b) => b.id === trip.businessId);
  const service = data.services.find((s) => s.id === trip.serviceId);
  const waitingRate = Number((chosen?.category.fare as { waitingChargePerHour?: number } | undefined)?.waitingChargePerHour) || 0;

  // Existing customer by mobile number.
  const match = useMemo(() => {
    const d = c.phone.replace(/\D/g, "").slice(-10);
    return d.length === 10 ? customers.find((x) => x.phone.replace(/\D/g, "").slice(-10) === d) : undefined;
  }, [c.phone, customers]);
  useEffect(() => {
    if (match && !c.customerId) setC((v) => ({ ...v, customerId: match.id, name: v.name || match.name, email: v.email || match.email || "" }));
    if (!match && c.customerId) setC((v) => ({ ...v, customerId: "" }));
  }, [match]); // eslint-disable-line react-hooks/exhaustive-deps

  const getEstimate = async (e?: FormEvent) => {
    e?.preventDefault();
    if (draft?.enquiry && isMulticityEnquiry(draft.enquiry)) return setError(MULTICITY_CONVERSION_MESSAGE);
    const why = validateTrip(trip);
    if (why) return setError(why);
    setBusy(true);
    setError(null);
    const list = await estimateAll(trip, data.categories);
    setEstimates(list);
    const keep = list.find((x) => x.category.id === selected && x.quote) ?? list.find((x) => x.quote);
    setSelected(keep?.category.id ?? "");
    setBusy(false);
    if (!keep) return setError(list[0]?.error ?? "No vehicle category could be priced for this route.");
    setStep("estimate");
  };

  const validateCustomer = (): boolean => {
    const e: Partial<Record<keyof CustomerForm, string>> = {};
    if (!normalizePhone(c.phone)) e.phone = "Enter a 10-digit mobile number.";
    if (c.name.trim().length < 2) e.name = "Enter the booking contact name.";
    const wa = whatsappError({ whatsappSame: c.whatsappSame, whatsappCountryCode: c.waCode, whatsappNumber: c.waNumber });
    if (wa) e.waNumber = wa;
    const em = emailError(c.email);
    if (em) e.email = em;
    if (c.someoneElse) {
      if (c.paxName.trim().length < 2) e.paxName = "Enter the passenger name.";
      if (!normalizePhone(c.paxPhone)) e.paxPhone = "Enter the passenger's 10-digit mobile.";
    }
    if (c.pickupAddress.trim().length < 3) e.pickupAddress = "Add the pickup address or meeting point.";
    if (c.dropAddress.trim().length < 3) e.dropAddress = "Add the drop address or meeting point.";
    setErrors(e);
    if (Object.keys(e).length) setError("Check the highlighted details below.");
    else setError(null);
    return !Object.keys(e).length;
  };

  const bookingForm = (): ManualBookingForm => ({
    ...tripToForm(trip, selected, emptyManualBooking()),
    customerId: c.customerId,
    customerName: c.name.trim(),
    customerPhone: c.phone,
    whatsappSame: c.whatsappSame,
    whatsappCountryCode: c.waCode,
    whatsappNumber: c.waNumber,
    email: c.email,
    pickupAddress: c.pickupAddress,
    dropAddress: c.dropAddress,
    paymentMethod: payMethod,
    advanceEnabled: advanceOn,
    advanceAmount: advance.amount,
    advanceMethod: advance.method,
    advanceReference: advance.reference,
    discountType,
    discountValue,
    discountReason,
    notes: [notes.trim(), extrasNote(trip)].filter(Boolean).join(" · "),
    couponCode: appliedCoupon?.code ?? "",
    overrideEnabled: overrideOn,
    overrideFare,
    overrideReason,
    channel: c.channel,
  });

  // The server validates the code (validity, limits, minimum fare, category, customer) and prices it.
  const applyCoupon = async () => {
    if (!q || !chosen || checkingCoupon) return;
    if (!canApplyCoupon) return setCouponMsg({ ok: false, text: "Your access does not include applying coupons." });
    if (discountType !== "none") return setCouponMsg({ ok: false, text: "Remove the manual discount first: a booking takes one coupon or one discount." });
    const code = coupon.trim();
    if (!code) return setCouponMsg({ ok: false, text: "Enter a coupon code." });
    setCheckingCoupon(true);
    try {
      const fresh = await quoteAdminBooking({ ...bookingForm(), couponCode: code }, newRequestId(), {businessAccountId:trip.businessId,businessBilledTo:billedTo});
      const discount = fresh.couponDiscount ?? 0;
      setAppliedCoupon({ code: fresh.couponCode ?? code, discount });
      setCouponMsg({ ok: true, text: `${fresh.couponCode ?? code} applied · ${rupee(discount)} off · new total ${rupee(fresh.quote.total)}. The fare is re-checked on confirmation.` });
    } catch (e) {
      setAppliedCoupon(null);
      setCouponMsg({ ok: false, text: e instanceof ActionError ? e.message : "The coupon could not be checked. Try again." });
    } finally {
      setCheckingCoupon(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    if (draft?.enquiry && isMulticityEnquiry(draft.enquiry)) return setError(MULTICITY_CONVERSION_MESSAGE);
    if (!accepted) return setError("Confirm the customer’s acceptance before booking.");
    if (!chosen || !q) return setError("Choose a vehicle category.");
    setBusy(true);
    setError(null);
    const form = bookingForm();
    try {
      // The server prices again; a changed discount needs a fresh quote first.
      let expected = q.quote.total;
      if (discountType !== "none" || appliedCoupon) {
        const fresh = await quoteAdminBooking(form, newRequestId(), {businessAccountId:trip.businessId,businessBilledTo:billedTo});
        expected = fresh.quote.total;
      }
      const created = await createAdminBooking(form, requestId.current, expected, {
        passenger: c.someoneElse ? { name: c.paxName.trim(), phone: c.paxPhone, whatsapp: c.paxWhatsapp.trim() } : null,
        enquirySource: c.source,
        ...(business ? { businessAccountId: business.id, businessBilledTo: billedTo } : {}),
        tripExtras: { hillTravel: trip.hill, roofCarrier: trip.carrier, waitingMinutes: Number(trip.waitingMin) || 0 },
        ...(draft?.enquiry ? { enquiryId: draft.enquiry.code } : {}),
        termsAccepted: true,
      });
      if (draft?.enquiry) await markEnquiryConverted(draft.enquiry.id, created.bookingId).catch(() => undefined);
      onCreated(created);
    } catch (err) {
      setError(err instanceof ActionError ? err.message : "The booking was not created. Please try again.");
      setBusy(false);
    }
  };

  const err = (k: keyof CustomerForm) => errors[k] ? <span role="alert" className="text-[11px] font-semibold text-bad">{errors[k]}</span> : null;
  const breakupCard = chosen && q && (
    <FareBreakupCard vehicle={chosen.category.name} lines={breakupLines(q)} total={q.quote.total} gstRate={q.quote.gstRate ?? 0} gstAmount={q.quote.gst} extraKm={estimateFacts.extraKmRateOf(q)} payout={canSeePayout ? estimateFacts.partnerPayoutOf(q) : null} priceEntered={gstEntryOf(q)} />
  );
  const errorLine = error && <div className="ds-error" role="alert" style={{ marginBottom: 14 }}><Icon name="circle-alert" />{error}</div>;
  const wizard = (on: 2 | 3) => (
    <div className="ds-wizard-steps" aria-label="Booking steps">
      <span data-done="true"><b><Icon name="check" size={12} /></b>Trip</span>
      <span data-on={on === 2 ? "true" : undefined} data-done={on > 2 ? "true" : undefined}><b>{on > 2 ? <Icon name="check" size={12} /> : 2}</b>Customer</span>
      <span data-on={on === 3 ? "true" : undefined}><b>3</b>Review</span>
    </div>
  );

  if (draft?.enquiry && isMulticityEnquiry(draft.enquiry)) {
    return <div className="ds-page-body"><PageHeader title="Multicity enquiry" subtitle={draft.enquiry.code} actions={<Button onClick={onCancel}>Back to enquiries</Button>} /><p role="alert">{MULTICITY_CONVERSION_MESSAGE}</p></div>;
  }

  // ── 01 Trip ──
  if (step === "trip") {
    return (
      <div className="ds-page-body">
        <Toast toast={toast} />
        <PageHeader eyebrow="NESAM OPERATIONS" title="Quick fare" subtitle="Route first. Give the estimate before collecting customer details." actions={<Button variant="ghost" icon="arrow-left" onClick={onCancel}>Back to bookings</Button>} />
        <form onSubmit={getEstimate} noValidate className="ds-panel ds-panel-pad" style={{ maxWidth: 1040 }}>
          {errorLine}
          <div className="flex flex-wrap items-center gap-3 mb-5 text-[12px]">
            <label className="flex items-center gap-2 text-muted">Booking for
              <select className="ds-select" value={trip.businessId} onChange={(e) => set({ businessId: e.target.value })}>
                <option value="">Direct customer</option>
                {data.business.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            {business ? (
              <label className="flex items-center gap-2 text-muted">Billing
                <select className="ds-select" value={billedTo} onChange={(e) => setBilledTo(e.target.value as typeof billedTo)}><option>Company pays</option><option>Passenger pays</option></select>
              </label>
            ) : null}
            <span className="text-[11px] text-info">{business ? "Contract rate first · passenger details follow" : "Existing direct-customer pricing and booking flow"}</span>
          </div>
          <h2 className="ds-step-title"><span className="ds-step-num">01</span>Trip details</h2>
          <TripFields trip={trip} set={set} data={data} idPrefix="nb" />
          <p className="text-[11px] text-faint mt-4">Confirm the road distance with the customer. All pickup times are IST.</p>
          <div className="flex flex-wrap items-center justify-between gap-3 mt-5 pt-4 border-t border-line">
            <span className="text-[11px] text-faint">Customer name / mobile comes after the estimate.</span>
            <Button variant="primary" icon="calculator" type="submit" loading={busy}>Get estimate</Button>
          </div>
        </form>
      </div>
    );
  }

  // ── 02 Fare estimate ──
  if (step === "estimate" && estimates) {
    return (
      <div className="ds-page-body">
        <Toast toast={toast} />
        <PageHeader eyebrow="NESAM OPERATIONS" title="Fare estimate" subtitle={`${trip.pickup?.name || trip.pickupText} → ${trip.drop?.name || trip.dropText} · ${refPickupLabel(trip)}`} actions={<Button icon="pencil" onClick={() => setStep("trip")}>Edit trip</Button>} />
        {errorLine}
        <h2 className="ds-step-title"><span className="ds-step-num">02</span>Choose vehicle category</h2>
        <div className="flex flex-wrap items-center gap-3 mb-3 text-[12px] text-muted">
          {/* GST included / excluded comes from the brand GST policy or the package / route fare saved in Service & Fare Settings. */}
          <span>GST {Math.round((q?.quote.gstRate ?? 0) * 10000) / 100}% · {q ? (gstEntryOf(q) === "Including GST" ? "Configured fare already includes GST" : "GST added on top of the configured fare") + " · " : ""}All totals below include GST.</span>
        </div>
        <EstimateList estimates={estimates} selected={selected} onSelect={setSelected} priceEntered={trip.priceEntered} />
        <section className="ds-panel ds-panel-pad mt-5">
          <h2 className="ds-step-title"><span className="ds-step-num">03</span>Extras &amp; terms</h2>
          <ExtrasFields trip={trip} set={set} />
          <p className="text-[11px] text-muted mt-2">Waiting {rupee(waitingRate)} / hour · 0 min allowance.</p>
          <details className="ds-disclosure">
            <summary>Fare inclusions &amp; cancellation terms</summary>
            <p className="text-[12px] text-body leading-relaxed">Toll, parking and state tax are extra at actuals. Waiting, hill and carrier charges follow the saved estimate and verified usage. Direct cancellation until one hour before pickup; later cancellation through the office. A verified arrival cancellation may carry ₹300.</p>
          </details>
        </section>
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <Button variant="primary" icon="circle-check" disabled={!chosen} onClick={() => { setError(null); setStep("customer"); }}>Proceed to booking</Button>
          <Button icon="phone-forwarded" disabled={!chosen} onClick={() => setSaving(true)}>Save for follow-up</Button>
          <span className="text-[11px] text-muted ml-auto">Advance payment is optional.</span>
        </div>
        {saving && chosen && (
          <SaveEnquiryDialog trip={trip} estimate={chosen} serviceName={service?.name || tripServiceLabel(trip)} onClose={() => setSaving(false)} onSaved={(e) => { setSaving(false); onEnquirySaved(e); }} />
        )}
      </div>
    );
  }

  // ── 02 Customer & pickup details ──
  if (step === "customer" || !estimates) {
    return (
      <div className="ds-page-body">
        <Toast toast={toast} />
        <PageHeader eyebrow="NESAM OPERATIONS" title="New booking" subtitle="Phone, WhatsApp and office bookings in the same system." />
        {wizard(2)}
        <div className="ds-wizard">
          <form className="ds-panel ds-panel-pad" noValidate onSubmit={(e) => { e.preventDefault(); if (validateCustomer()) setStep("review"); }}>
            {errorLine}
            {!estimates && <p className="ds-note mb-4">Pricing the saved route…</p>}
            <h2 className="ds-step-title"><span className="ds-step-num">02</span>Customer &amp; pickup details</h2>
            <p className="text-[12px] text-muted -mt-2 mb-4">Use the mobile number to find an existing customer.</p>
            <div className="ds-form-grid">
              <label className="ds-field"><span>Booking contact mobile *</span><input className="ds-input" inputMode="tel" value={c.phone} aria-invalid={!!errors.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />{err("phone")}{match && <span className="text-[11px] text-ok">Existing customer · {match.name}</span>}</label>
              <label className="ds-field"><span>Booking contact name *</span><input className="ds-input" maxLength={80} value={c.name} aria-invalid={!!errors.name} onChange={(e) => setC({ ...c, name: e.target.value })} />{err("name")}</label>
              <label className="ds-check" data-span="2"><input type="checkbox" checked={c.whatsappSame} onChange={(e) => setC({ ...c, whatsappSame: e.target.checked })} />WhatsApp number is the same as mobile</label>
              {!c.whatsappSame && (
                <div className="ds-field" data-span="2">
                  <span>WhatsApp number</span>
                  <div className="flex gap-2">
                    <select className="ds-select" value={c.waCode} onChange={(e) => setC({ ...c, waCode: e.target.value })}>{COUNTRY_CODES.map((x) => <option key={x}>{x}</option>)}</select>
                    <input className="ds-input flex-1" inputMode="tel" value={c.waNumber} onChange={(e) => setC({ ...c, waNumber: e.target.value })} />
                  </div>
                  {err("waNumber")}
                </div>
              )}
              <label className="ds-field" data-span="2"><span>Email · optional</span><input className="ds-input" type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />{err("email")}</label>
              <div className="ds-field" data-span="2">
                <span>Enquiry / booking source</span>
                <div className="ds-seg" style={{ "--ds-seg": 4 } as React.CSSProperties}>
                  {(["Phone", "WhatsApp", "Office", "App"] as const).map((s) => <button key={s} type="button" aria-pressed={c.source === s} onClick={() => setC({ ...c, source: s })}>{s}</button>)}
                </div>
              </div>
              <label className="ds-field" data-span="2">
                <span>Website / portal</span>
                <select className="ds-select" value={c.channel} onChange={(e) => setC({ ...c, channel: e.target.value as CustomerForm["channel"] })}>
                  <option value="nesam">Nesam Travels</option><option value="onewaycarrentals">One Way Car Rentals</option><option value="people_taxi">People Taxi</option>
                </select>
              </label>
              <label className="ds-check" data-span="2"><input type="checkbox" checked={c.someoneElse} onChange={(e) => setC({ ...c, someoneElse: e.target.checked })} />Booking for someone else</label>
              {c.someoneElse && (
                <>
                  <h3 className="text-[13px] font-bold text-ink" data-span="2">Passenger contact</h3>
                  <label className="ds-field"><span>Passenger name *</span><input className="ds-input" value={c.paxName} onChange={(e) => setC({ ...c, paxName: e.target.value })} />{err("paxName")}</label>
                  <label className="ds-field"><span>Passenger mobile *</span><input className="ds-input" inputMode="tel" value={c.paxPhone} onChange={(e) => setC({ ...c, paxPhone: e.target.value })} />{err("paxPhone")}</label>
                  <label className="ds-field" data-span="2"><span>Passenger WhatsApp · optional</span><input className="ds-input" inputMode="tel" value={c.paxWhatsapp} onChange={(e) => setC({ ...c, paxWhatsapp: e.target.value })} /></label>
                </>
              )}
            </div>
            <h3 className="text-[14px] font-bold text-ink mt-6">Pickup &amp; drop meeting points</h3>
            <p className="text-[12px] text-muted mb-3">Required before confirming the booking.</p>
            <div className="ds-form-grid">
              <label className="ds-field"><span>Pickup address / meeting point *</span><input className="ds-input" maxLength={200} value={c.pickupAddress} onChange={(e) => setC({ ...c, pickupAddress: e.target.value })} />{err("pickupAddress")}</label>
              <label className="ds-field"><span>Drop address / meeting point *</span><input className="ds-input" maxLength={200} value={c.dropAddress} onChange={(e) => setC({ ...c, dropAddress: e.target.value })} />{err("dropAddress")}</label>
            </div>
            <details className="ds-disclosure">
              <summary>Location confirmation</summary>
              <p className="text-[12px] text-muted mb-3">Confirm the exact address or meeting point with the customer. Drag the pin to the exact spot when it differs from the saved location.</p>
              <div className="grid gap-4 lg:grid-cols-2">
                <MapLocationPicker label={trip.pickup?.name || trip.pickupText || "Pickup"} tone="pickup" value={trip.pickup} onChange={(p) => set({ pickup: p })} />
                <MapLocationPicker label={trip.drop?.name || trip.dropText || "Drop"} tone="drop" value={trip.drop} startNear={trip.pickup} onChange={(p) => set({ drop: p })} />
              </div>
              {!estimates && <Button className="mt-3" icon="calculator" onClick={() => getEstimate()}>Re-calculate estimate</Button>}
            </details>
            <div className="flex justify-between gap-3 mt-6 pt-4 border-t border-line">
              <Button icon="arrow-left" onClick={() => setStep(estimates ? "estimate" : "trip")}>Back</Button>
              <Button variant="primary" icon="arrow-right" type="submit" disabled={!estimates || !chosen}>Review</Button>
            </div>
          </form>
          <aside>{breakupCard}</aside>
        </div>
      </div>
    );
  }

  // ── 03 Review & confirm ──
  const at = refPickupLabel(trip);
  const payout = q ? estimateFacts.partnerPayoutOf(q) : null;
  return (
    <div className="ds-page-body">
      <Toast toast={toast} />
      <PageHeader eyebrow="NESAM OPERATIONS" title="New booking" subtitle="Phone, WhatsApp and office bookings in the same system." />
      {wizard(3)}
      <div className="ds-wizard">
        <form className="ds-panel ds-panel-pad" noValidate onSubmit={confirm}>
          {errorLine}
          <h2 className="ds-step-title"><span className="ds-step-num">03</span>Review &amp; confirm</h2>
          <p className="text-[12px] text-muted -mt-2 mb-4">Confirm the booking with or without an advance.</p>
          <div className="ds-sheet-card">
            <div className="flex gap-2 mb-2"><Badge tone="red">{trip.tripType === "Airport Taxi" ? "Airport" : trip.tripType}</Badge><Badge>{chosen?.category.name}</Badge>{business && <Badge tone="blue">{business.name} · {billedTo}</Badge>}</div>
            <strong>{trip.pickup?.name || trip.pickupText} → {trip.drop?.name || trip.dropText}</strong>
            <small>{at}</small>
            <dl className="ds-facts mt-3" data-cols={1}>
              <div><dt>Booked by</dt><dd>{c.name} · {c.phone}</dd></div>
              <div><dt>Passenger</dt><dd>{c.someoneElse ? `${c.paxName} · ${c.paxPhone}` : `${c.name} · ${c.phone}`}</dd></div>
              <div><dt>WhatsApp</dt><dd>{c.whatsappSame ? c.phone : `${c.waCode} ${c.waNumber}`}</dd></div>
            </dl>
          </div>
          <details className="ds-panel ds-panel-pad mb-4" open={discountOpen} onToggle={(e) => setDiscountOpen((e.target as HTMLDetailsElement).open)}>
            <summary className="cursor-pointer text-[12px] font-semibold text-body"><Icon name="badge-indian-rupee" size={14} /> Discount / special fare</summary>
            {canDiscount ? (
              <div className="ds-form-grid mt-3">
                <label className="ds-field"><span>Discount</span><select className="ds-select" value={discountType} onChange={(e) => setDiscountType(e.target.value as typeof discountType)}><option value="none">No discount</option><option value="percentage">Percentage</option><option value="fixed">Fixed ₹</option></select></label>
                {discountType !== "none" && <label className="ds-field"><span>{discountType === "percentage" ? "Percent" : "Amount ₹"}</span><input className="ds-input" inputMode="decimal" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} /></label>}
                {discountType !== "none" && <label className="ds-field" data-span="2"><span>Reason</span><input className="ds-input" maxLength={200} value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} /></label>}
                {canOverride && (
                  <>
                    <label className="ds-check" data-span="2"><input type="checkbox" checked={overrideOn} onChange={(e) => setOverrideOn(e.target.checked)} />Special fare (finance override)</label>
                    {overrideOn && <label className="ds-field"><span>Special fare ₹</span><input className="ds-input" inputMode="numeric" value={overrideFare} onChange={(e) => setOverrideFare(e.target.value.replace(/\D/g, ""))} /></label>}
                    {overrideOn && <label className="ds-field"><span>Reason (10+ characters)</span><input className="ds-input" maxLength={300} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} /></label>}
                  </>
                )}
              </div>
            ) : <p className="text-[12px] text-muted mt-2">Discounts and special fares need pricing or finance access.</p>}
          </details>
          <section className="ds-panel ds-panel-pad mb-4">
            <h3 className="text-[14px] font-bold text-ink mb-2">Advance payment</h3>
            <label className="ds-check"><input type="checkbox" checked={advanceOn} onChange={(e) => setAdvanceOn(e.target.checked)} />Customer has already paid an advance</label>
            {advanceOn ? (
              <div className="ds-form-grid mt-3">
                <label className="ds-field"><span>Amount ₹</span><input className="ds-input" inputMode="decimal" value={advance.amount} onChange={(e) => setAdvance({ ...advance, amount: e.target.value })} /></label>
                <label className="ds-field"><span>Method</span><select className="ds-select" value={advance.method} onChange={(e) => setAdvance({ ...advance, method: e.target.value })}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
                {advance.method !== "Cash" && <label className="ds-field" data-span="2"><span>{advance.method === "UPI" ? "UPI transaction reference" : "Transfer reference"}</span><input className="ds-input" value={advance.reference} onChange={(e) => setAdvance({ ...advance, reference: e.target.value })} /></label>}
              </div>
            ) : <p className="text-[11px] text-faint mt-3">No advance recorded. The booking can still be confirmed.</p>}
            <label className="ds-field mt-3" style={{ maxWidth: 260 }}><span>Balance payment method</span><select className="ds-select" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
          </section>
          <label className="ds-field mb-4"><span>Office notes · optional</span><input className="ds-input" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          <div className="ds-panel ds-panel-pad mb-4">
            <label className="ds-check"><input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />Customer agreed to the fare, included usage and cancellation terms.</label>
            <p className="text-[10px] text-faint mt-2 ml-6">Direct cancellation is available until one hour before pickup. Later cancellations go through the office. A verified driver-arrival cancellation may carry a ₹300 charge.</p>
          </div>
          {canApplyCoupon && <div className="mb-4 p-4 rounded-lg" style={{ border: "1px dashed #efb4b8", background: "#fffafa" }}>
            <div className="flex justify-between items-center mb-2"><strong className="text-[13px] text-ink flex items-center gap-2"><Icon name="ticket-percent" size={15} />Apply coupon</strong><span className="text-[10px] text-faint">One coupon per booking</span></div>
            <div className="flex gap-2">
              <input className="ds-input flex-1" placeholder="ENTER COUPON CODE" value={coupon} onChange={(e) => { setCoupon(e.target.value.toUpperCase()); setAppliedCoupon(null); setCouponMsg(null); }} />
              <Button icon="check" loading={checkingCoupon} onClick={() => void applyCoupon()}>Apply</Button>
            </div>
            {couponMsg && <p className={`text-[11px] mt-2 ${couponMsg.ok ? "text-ok" : "text-bad"}`}>{couponMsg.text}</p>}
            <p className="text-[10px] text-muted mt-2">Customer mobile is checked here; Quick Fare remains contact-free.</p>
            {canSeePayout && <p className="text-[10px] text-muted mt-1">Partner payout {rupee(payout)} · Actual expenses remain separate.</p>}
          </div>}
          <div className="flex justify-between gap-3 pt-4 border-t border-line">
            <Button icon="arrow-left" onClick={() => setStep("customer")} disabled={busy}>Back</Button>
            <Button variant="primary" icon="circle-check" type="submit" loading={busy}>Confirm booking</Button>
          </div>
        </form>
        <aside>{breakupCard}</aside>
      </div>
    </div>
  );
}

export const todayIst = () => isoDateIST(new Date());
