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
import { Button, Icon, PageHeader } from "../components/ui";
import { FareBreakupCard } from "../components/booking/Enquiries";
import {
  SaveEnquiryDialog, breakupLines, emptyTrip, estimateAll, estimateFacts, extrasNote, gstEntryOf, refPickupLabel,
  tripServiceLabel, tripToForm, useQuickData, validateTrip, type CategoryEstimate, type QuickTrip,
} from "../components/booking/QuickFare";
import CustomerTripForm from "../components/booking/CustomerTripForm";
import CustomerChooseStep from "../components/booking/CustomerChooseStep";
import { rupee } from "../domain/officeStage";
import { isoDateIST } from "../utils/time";

export interface NewBookingDraft {
  trip: QuickTrip;
  categoryId: string;
  estimates?: CategoryEstimate[];
  enquiry?: Enquiry;
}

/** Same three steps as the customer apps: Plan the trip, Choose the vehicle, Review & confirm. */
type Step = "trip" | "estimate" | "review";
type Source = "Phone" | "WhatsApp" | "Office" | "App";

/** The platform the booking is created for: it decides the pricing and where the booking shows up. */
const PLATFORMS: { id: ManualBookingForm["channel"]; label: string }[] = [
  { id: "nesam", label: "Nesam Cabs" },
  { id: "onewaycarrentals", label: "One Way Car Rentals" },
  { id: "people_taxi", label: "People Taxi" },
];

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
  const [step, setStep] = useState<Step>(draft?.estimates ? "review" : "trip");
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
  const [fareOpen, setFareOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  // Who the booking is for: someone already in the customer list, or a new customer.
  const [customerMode, setCustomerMode] = useState<"existing" | "new">(draft?.enquiry ? "new" : "existing");
  const [customerQuery, setCustomerQuery] = useState("");
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
      estimateAll(trip, data.categories, c.channel).then((list) => {
        setEstimates(list);
        if (!list.some((x) => x.category.id === selected && x.quote)) setSelected(list.find((x) => x.quote)?.category.id ?? "");
        setStep("review");
      });
    }
  }, [data.categories]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (p: Partial<QuickTrip>) => {
    setTrip((t) => ({ ...t, ...p }));
    if (p.pickup !== undefined || p.drop !== undefined || p.date || p.time || p.serviceId !== undefined || p.days !== undefined || p.stops !== undefined || p.airportDirection !== undefined) setEstimates(null);
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

  // The customer is chosen on the Plan step, before any estimate.
  const planCustomerError = (): string | null => {
    if (customerMode === "existing" && !c.customerId) return "Choose the customer, or switch to New customer.";
    if (c.name.trim().length < 2) return "Enter the customer name.";
    if (!normalizePhone(c.phone)) return "Enter a 10-digit mobile number.";
    return null;
  };

  const getEstimate = async (e?: FormEvent) => {
    e?.preventDefault();
    if (draft?.enquiry && isMulticityEnquiry(draft.enquiry)) return setError(MULTICITY_CONVERSION_MESSAGE);
    const who = planCustomerError();
    if (who) return setError(who);
    const why = validateTrip(trip);
    if (why) return setError(why);
    setBusy(true);
    setError(null);
    const list = await estimateAll(trip, data.categories, c.channel);
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
    if (!validateCustomer()) return;
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
  const wizard = (on: 1 | 2 | 3) => (
    <div className="ds-wizard-steps" aria-label="Booking steps">
      {(["Plan", "Choose", "Review"] as const).map((label, i) => (
        <span key={label} data-on={on === i + 1 ? "true" : undefined} data-done={on > i + 1 ? "true" : undefined}><b>{on > i + 1 ? <Icon name="check" size={12} /> : i + 1}</b>{label}</span>
      ))}
    </div>
  );

  if (draft?.enquiry && isMulticityEnquiry(draft.enquiry)) {
    return <div className="ds-page-body"><PageHeader title="Multicity enquiry" actions={<Button onClick={onCancel}>Back to enquiries</Button>} /><p role="alert">{MULTICITY_CONVERSION_MESSAGE}</p></div>;
  }

  // ── 1 Plan: platform, customer and the trip, drawn as the selected platform's own booking form ──
  if (step === "trip") {
    const query = customerQuery.trim().toLowerCase();
    const digits = query.replace(/\D/g, "");
    const found = query.length >= 2
      ? customers.filter((x) => x.name?.toLowerCase().includes(query) || (digits.length >= 3 && x.phone?.replace(/\D/g, "").includes(digits))).slice(0, 6)
      : [];
    const clearCustomer = () => setC((v) => ({ ...v, customerId: "", name: "", phone: "", email: "" }));
    const chooseMode = (m: "existing" | "new") => {
      if (m === customerMode) return;
      setCustomerMode(m);
      setCustomerQuery("");
      clearCustomer();
    };
    const pickCustomer = (x: Customer) => {
      setC((v) => ({ ...v, customerId: x.id, name: x.name, phone: (x.phone || "").replace(/\D/g, "").slice(-10), email: x.email || "" }));
      setCustomerQuery("");
      setError(null);
    };
    const side = (
      <aside className="cf-side" aria-label="Platform and customer">
        <h2 className="cf-side__title">{PLATFORMS.find((p) => p.id === c.channel)?.label}</h2>
        <div className="cf-side__group" role="radiogroup" aria-label="Platform">
          {PLATFORMS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={c.channel === p.id} className={`cf-pick ${c.channel === p.id ? "is-on" : ""}`} onClick={() => { setC((v) => ({ ...v, channel: p.id })); setEstimates(null); }}>{p.label}</button>
          ))}
        </div>
        <div className="tabs tabs--boxed" role="tablist" aria-label="Customer">
          <button type="button" role="tab" aria-selected={customerMode === "existing"} className={`tab ${customerMode === "existing" ? "is-active" : ""}`} onClick={() => chooseMode("existing")}><span>Existing</span></button>
          <button type="button" role="tab" aria-selected={customerMode === "new"} className={`tab ${customerMode === "new" ? "is-active" : ""}`} onClick={() => chooseMode("new")}><span>New</span></button>
        </div>
        {customerMode === "existing" ? (
          c.customerId ? (
            <div className="cf-chip">
              <span>{c.name} · {c.phone}</span>
              <button type="button" className="btn btn--secondary btn--sm" onClick={clearCustomer}>Change</button>
            </div>
          ) : (
            <div className="cf-place">
              <input className="input bf-input cf-sm" aria-label="Search customer" placeholder="Search by name or mobile" autoComplete="off" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} />
              {found.length > 0 && (
                <ul role="listbox" className="cf-list">
                  {found.map((x) => (
                    <li key={x.id} role="option" aria-selected={false} className="cf-opt" onClick={() => pickCustomer(x)}>
                      <strong>{x.name}</strong>
                      <small>{x.phone}</small>
                    </li>
                  ))}
                </ul>
              )}
              {query.length >= 2 && found.length === 0 && <p className="bf-hint">No customer found. Choose New.</p>}
            </div>
          )
        ) : (
          <>
            <input className="input bf-input cf-sm" aria-label="Customer name" placeholder="Customer name" maxLength={80} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
            <input className="input bf-input cf-sm" aria-label="Mobile number" placeholder="Mobile number" inputMode="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
            {match && <p className="bf-hint">Already a customer: {match.name}. The booking uses that account.</p>}
          </>
        )}
        {business && (
          <select className="input select bf-input cf-sm" aria-label="Billing" value={billedTo} onChange={(e) => setBilledTo(e.target.value as typeof billedTo)}><option>Company pays</option><option>Passenger pays</option></select>
        )}
      </aside>
    );
    return (
      <div className="ds-page-body">
        <Toast toast={toast} />
        <PageHeader title="New booking" />
        {wizard(1)}
        <div className={`cf cf--${c.channel} cf-split`}>
          {side}
          <CustomerTripForm
            trip={trip}
            set={set}
            data={data}
            error={error}
            onSubmit={getEstimate}
            action={<button type="submit" className="btn btn--primary btn--lg btn--block bf-submit" disabled={busy}>{busy ? "Calculating…" : "Get estimate"}</button>}
          />
        </div>
      </div>
    );
  }

  // The fare breakup of one vehicle, shown in the Fare details sheet.
  const breakupFor = (e: CategoryEstimate) => e.quote && (
    <FareBreakupCard vehicle={e.category.name} lines={breakupLines(e.quote)} total={e.quote.quote.total} gstRate={e.quote.quote.gstRate ?? 0} gstAmount={e.quote.quote.gst} extraKm={estimateFacts.extraKmRateOf(e.quote)} payout={canSeePayout ? estimateFacts.partnerPayoutOf(e.quote) : null} priceEntered={gstEntryOf(e.quote)} />
  );

  // ── 2 Choose the vehicle: the customer sites' vehicle list and Trip Summary card ──
  if (step === "estimate" && estimates) {
    return (
      <div className="ds-page-body">
        <Toast toast={toast} />
        <PageHeader title="New booking" />
        {wizard(2)}
        {errorLine}
        <div className={`cf cf--${c.channel}`}>
          <CustomerChooseStep
            trip={trip}
            set={set}
            estimates={estimates}
            selected={selected}
            onSelect={setSelected}
            renderBreakup={(e) => breakupFor(e)}
            onContinue={() => { setError(null); setStep("review"); }}
            onEdit={() => setStep("trip")}
            onSave={() => setSaving(true)}
            canSeePayout={canSeePayout}
          />
        </div>
        {saving && chosen && (
          <SaveEnquiryDialog trip={trip} estimate={chosen} serviceName={service?.name || tripServiceLabel(trip)} onClose={() => setSaving(false)} onSaved={(e) => { setSaving(false); onEnquirySaved(e); }} />
        )}
      </div>
    );
  }

  // ── 3 Review & confirm: passenger and contact, meeting points, payment and terms, as on the customer sites ──
  const payout = q ? estimateFacts.partnerPayoutOf(q) : null;
  const platform = PLATFORMS.find((p) => p.id === c.channel);
  const cfErr = (k: keyof CustomerForm) => errors[k] ? <p className="field__error" role="alert">{errors[k]}</p> : null;
  const pickupName = trip.pickup?.name || trip.pickupText;
  const dropName = trip.tripType === "Local Rental" ? "Within City Disposal" : trip.drop?.name || trip.dropText;
  return (
    <div className="ds-page-body">
      <Toast toast={toast} />
      <PageHeader title="New booking" />
      {wizard(3)}
      <div className={`cf cf--${c.channel}`}>
        <form className="flow-page flow-page--review" noValidate onSubmit={confirm}>
          <div className="wrap flow-page__wrap">
            {error ? <p className="bf-error bf-error--form" role="alert">{error}</p> : null}
            {!estimates && <p className="bf-hint">Pricing the saved route…</p>}
            <div className="review">
              <div className="review__main">
                <section className="trip-sum trip-sum--compact" aria-label="Trip summary">
                  <div className="trip-sum__body">
                    <p className="route-title"><span>{pickupName}</span><Icon name="arrow-right" size={14} /><span>{trip.tripType === "Round Trip" ? pickupName : dropName}</span></p>
                    <p className="trip-sum__meta">
                      <span><span className="badge badge--blue">{trip.tripType === "Airport Taxi" ? "Airport" : trip.tripType}</span></span>
                      {chosen && <span><span className="badge badge--neutral">{chosen.category.name}</span></span>}
                      {platform && <span><span className="badge badge--brand">{platform.label}</span></span>}
                      {business && <span><span className="badge badge--blue">{business.name} · {billedTo}</span></span>}
                      <span className="trip-sum__when">{refPickupLabel(trip)}</span>
                    </p>
                  </div>
                </section>

                <section className="card" aria-labelledby="rv-who-head">
                  <h2 id="rv-who-head">Passenger &amp; Contact Details</h2>
                  <div className="rv-grid">
                    <div className={`field ${errors.name ? "is-invalid" : ""}`}>
                      <label className="field__label" htmlFor="rv-name">Contact name</label>
                      <input id="rv-name" className="input" maxLength={80} value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
                      {cfErr("name")}
                    </div>
                    <div className={`field ${errors.phone ? "is-invalid" : ""}`}>
                      <label className="field__label" htmlFor="rv-phone">Mobile number</label>
                      <input id="rv-phone" className="input" inputMode="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
                      {cfErr("phone")}
                      {match && <p className="field__hint">Existing customer · {match.name}</p>}
                      <div className="rv-fold">
                        <label className="check"><input type="checkbox" className="check__input" checked={c.whatsappSame} onChange={(e) => setC({ ...c, whatsappSame: e.target.checked })} /><span className="check__label"><strong>Is this also your WhatsApp number?</strong></span></label>
                        {!c.whatsappSame && (
                          <div className={`field ${errors.waNumber ? "is-invalid" : ""}`} style={{ marginTop: 10 }}>
                            <label className="field__label" htmlFor="rv-wa">WhatsApp number</label>
                            <div style={{ display: "flex", gap: 8 }}>
                              <select className="input select" style={{ width: 110, flex: "none" }} aria-label="Country code" value={c.waCode} onChange={(e) => setC({ ...c, waCode: e.target.value })}>{COUNTRY_CODES.map((x) => <option key={x}>{x}</option>)}</select>
                              <input id="rv-wa" className="input" inputMode="tel" value={c.waNumber} onChange={(e) => setC({ ...c, waNumber: e.target.value })} />
                            </div>
                            {cfErr("waNumber")}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className={`field ${errors.email ? "is-invalid" : ""}`}>
                      <label className="field__label" htmlFor="rv-email">Email Address<span className="field__opt">Optional</span></label>
                      <input id="rv-email" className="input" type="email" placeholder="name@example.com" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
                      {cfErr("email")}
                    </div>
                    <div className="field">
                      <span className="field__label">Booking source</span>
                      <div className="tabs tabs--boxed" role="tablist" aria-label="Booking source">
                        {(["Phone", "WhatsApp", "Office", "App"] as const).map((s) => (
                          <button key={s} type="button" role="tab" aria-selected={c.source === s} className={`tab ${c.source === s ? "is-active" : ""}`} onClick={() => setC({ ...c, source: s })}><span>{s}</span></button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rv-fold">
                    <label className="check"><input type="checkbox" className="check__input" checked={c.someoneElse} onChange={(e) => setC({ ...c, someoneElse: e.target.checked })} /><span className="check__label"><strong>Booking this ride for someone else?</strong></span></label>
                    {c.someoneElse && (
                      <div className="rv-grid" style={{ marginTop: 10 }}>
                        <div className={`field ${errors.paxName ? "is-invalid" : ""}`}>
                          <label className="field__label" htmlFor="rv-pax">Passenger Name</label>
                          <input id="rv-pax" className="input" placeholder="Full name" value={c.paxName} onChange={(e) => setC({ ...c, paxName: e.target.value })} />
                          {cfErr("paxName")}
                        </div>
                        <div className={`field ${errors.paxPhone ? "is-invalid" : ""}`}>
                          <label className="field__label" htmlFor="rv-paxphone">Passenger 10-digit Mobile</label>
                          <input id="rv-paxphone" className="input" inputMode="tel" placeholder="9876543210" value={c.paxPhone} onChange={(e) => setC({ ...c, paxPhone: e.target.value })} />
                          {cfErr("paxPhone")}
                        </div>
                        <div className="field">
                          <label className="field__label" htmlFor="rv-paxwa">Passenger WhatsApp<span className="field__opt">Optional</span></label>
                          <input id="rv-paxwa" className="input" inputMode="tel" value={c.paxWhatsapp} onChange={(e) => setC({ ...c, paxWhatsapp: e.target.value })} />
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <section className="card" aria-labelledby="rv-where-head">
                  <h2 id="rv-where-head">Pickup &amp; Drop Points</h2>
                  <div className="rv-grid">
                    <div className={`field ${errors.pickupAddress ? "is-invalid" : ""}`}>
                      <label className="field__label" htmlFor="rv-pickup">Pickup address / meeting point</label>
                      <input id="rv-pickup" className="input" maxLength={200} value={c.pickupAddress} onChange={(e) => setC({ ...c, pickupAddress: e.target.value })} />
                      {cfErr("pickupAddress")}
                    </div>
                    <div className={`field ${errors.dropAddress ? "is-invalid" : ""}`}>
                      <label className="field__label" htmlFor="rv-drop">Drop address / meeting point</label>
                      <input id="rv-drop" className="input" maxLength={200} value={c.dropAddress} onChange={(e) => setC({ ...c, dropAddress: e.target.value })} />
                      {cfErr("dropAddress")}
                    </div>
                  </div>
                  <details className="rv-fold">
                    <summary>Confirm on map</summary>
                    <div className="grid gap-4 lg:grid-cols-2 mt-3">
                      <MapLocationPicker label={trip.pickup?.name || trip.pickupText || "Pickup"} tone="pickup" value={trip.pickup} onChange={(p) => set({ pickup: p })} />
                      <MapLocationPicker label={trip.drop?.name || trip.dropText || "Drop"} tone="drop" value={trip.drop} startNear={trip.pickup} onChange={(p) => set({ drop: p })} />
                    </div>
                    {!estimates && <button type="button" className="btn btn--secondary btn--sm cf-gap" onClick={() => void getEstimate()}>Re-calculate estimate</button>}
                  </details>
                  <div className="field" style={{ marginTop: 12 }}>
                    <label className="field__label" htmlFor="rv-notes">Office notes<span className="field__opt">Optional</span></label>
                    <input id="rv-notes" className="input" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                </section>

                <section className="card rv-policy rv-policy--page">
                  <label className="check"><input type="checkbox" className="check__input" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /><span className="check__label"><strong>I accept the fare, extra charges and cancellation policy.</strong></span></label>
                </section>
              </div>

              <aside className="review__sticky">
                <section className="card" aria-labelledby="rv-pay-head">
                  <h2 id="rv-pay-head">Payment Method</h2>
                  <div className="pay-opts" role="radiogroup" aria-label="Balance payment method">
                    {PAYMENT_METHODS.map((m) => (
                      <label key={m} className={`pay-opt ${payMethod === m ? "is-selected" : ""}`}>
                        <input type="radio" name="pay" value={m} checked={payMethod === m} onChange={() => setPayMethod(m)} />
                        <div className="pay-opt__text"><strong>{m}</strong><small>Balance payment</small></div>
                      </label>
                    ))}
                  </div>

                  <div className="rv-fold">
                    <label className="check"><input type="checkbox" className="check__input" checked={advanceOn} onChange={(e) => setAdvanceOn(e.target.checked)} /><span className="check__label"><strong>Customer has paid an advance</strong></span></label>
                    {advanceOn && (
                      <div className="rv-grid" style={{ marginTop: 10 }}>
                        <div className="field"><label className="field__label" htmlFor="rv-adv">Amount ₹</label><input id="rv-adv" className="input" inputMode="decimal" value={advance.amount} onChange={(e) => setAdvance({ ...advance, amount: e.target.value })} /></div>
                        <div className="field"><label className="field__label" htmlFor="rv-advm">Method</label><select id="rv-advm" className="input select" value={advance.method} onChange={(e) => setAdvance({ ...advance, method: e.target.value })}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
                        {advance.method !== "Cash" && <div className="field"><label className="field__label" htmlFor="rv-advr">{advance.method === "UPI" ? "UPI transaction reference" : "Transfer reference"}</label><input id="rv-advr" className="input" value={advance.reference} onChange={(e) => setAdvance({ ...advance, reference: e.target.value })} /></div>}
                      </div>
                    )}
                  </div>

                  <details className="rv-fold" open={discountOpen} onToggle={(e) => setDiscountOpen((e.target as HTMLDetailsElement).open)}>
                    <summary>Discount / special fare</summary>
                    {canDiscount ? (
                      <div className="rv-grid" style={{ marginTop: 10 }}>
                        <div className="field"><label className="field__label" htmlFor="rv-dt">Discount</label><select id="rv-dt" className="input select" value={discountType} onChange={(e) => setDiscountType(e.target.value as typeof discountType)}><option value="none">No discount</option><option value="percentage">Percentage</option><option value="fixed">Fixed ₹</option></select></div>
                        {discountType !== "none" && <div className="field"><label className="field__label" htmlFor="rv-dv">{discountType === "percentage" ? "Percent" : "Amount ₹"}</label><input id="rv-dv" className="input" inputMode="decimal" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} /></div>}
                        {discountType !== "none" && <div className="field"><label className="field__label" htmlFor="rv-dr">Reason</label><input id="rv-dr" className="input" maxLength={200} value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} /></div>}
                        {canOverride && (
                          <>
                            <label className="check"><input type="checkbox" className="check__input" checked={overrideOn} onChange={(e) => setOverrideOn(e.target.checked)} /><span className="check__label"><strong>Special fare (finance override)</strong></span></label>
                            {overrideOn && <div className="field"><label className="field__label" htmlFor="rv-of">Special fare ₹</label><input id="rv-of" className="input" inputMode="numeric" value={overrideFare} onChange={(e) => setOverrideFare(e.target.value.replace(/\D/g, ""))} /></div>}
                            {overrideOn && <div className="field"><label className="field__label" htmlFor="rv-or">Reason (10+ characters)</label><input id="rv-or" className="input" maxLength={300} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} /></div>}
                          </>
                        )}
                      </div>
                    ) : <p className="field__hint">Discounts and special fares need pricing or finance access.</p>}
                  </details>

                  {canApplyCoupon && (
                    <div className="rv-pay-promo">
                      <div className="promo">
                        <div className="promo-form" style={{ display: "flex", gap: 8 }}>
                          <input className="input" placeholder="Coupon code" aria-label="Coupon code" value={coupon} onChange={(e) => { setCoupon(e.target.value.toUpperCase()); setAppliedCoupon(null); setCouponMsg(null); }} />
                          <button type="button" className="btn btn--secondary" disabled={checkingCoupon} onClick={() => void applyCoupon()}>{checkingCoupon ? "…" : "Apply"}</button>
                        </div>
                        {couponMsg && <p className={couponMsg.ok ? "field__hint" : "field__error"}>{couponMsg.text}</p>}
                      </div>
                    </div>
                  )}
                </section>

                <div className="card sel-card sel-card--sum">
                  <div className="sel-card__total">
                    <span className="rv-total-label">
                      Total Payable
                      <button type="button" className="rv-info-btn" onClick={() => setFareOpen(true)} aria-label="Fare details" title="Fare details"><Icon name="info" size={18} /></button>
                    </span>
                    <strong className="num">{q ? rupee(q.quote.total) : "—"}</strong>
                  </div>
                  <ul className="rv-sum__notes">
                    <li>Includes base fare, driver bata &amp; discounts</li>
                    <li>Toll, State Tax &amp; Parking extra (as per actuals)</li>
                    {canSeePayout && <li>Partner payout {rupee(payout)}</li>}
                  </ul>
                  <div className="rv-act">
                    <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy}>{busy ? "Booking…" : "Confirm & Book Ride"} {busy ? null : <Icon name="check" size={18} />}</button>
                    <button type="button" className="btn btn--text cf-gap" disabled={busy} onClick={() => setStep(estimates ? "estimate" : "trip")}>Back to vehicles</button>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </form>

        {fareOpen && chosen && (
          <div className="overlay overlay--dialog" onMouseDown={(e) => e.target === e.currentTarget && setFareOpen(false)} onKeyDown={(e) => e.key === "Escape" && setFareOpen(false)}>
            <div className="dialog dialog--dialog dialog--wide" role="dialog" aria-modal="true" aria-label="Fare details">
              <div className="dialog__head">
                <div><h2>Fare Breakup &amp; Exclusions</h2></div>
                <button type="button" className="btn btn--ghost btn--sm" aria-label="Close" onClick={() => setFareOpen(false)}><Icon name="x" size={18} /></button>
              </div>
              <div className="dialog__body">{breakupFor(chosen)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const todayIst = () => isoDateIST(new Date());
