import { useEffect, useRef, useState } from "react";
import { CircleCheck, Copy, ExternalLink, LoaderCircle } from "lucide-react";
import DeskDialog from "./DeskDialog";
import {
  DESK_BRANDS,
  bookingConfirmationText,
  clock12,
  ddmmyyyy,
  deskAddOnLabels,
  deskExtrasLabel,
  deskFuelLabel,
  formatINR,
  maskPhone,
  mobileInputValue,
  normalizeIndianMobile,
  phoneDigits,
  type DeskQuoteLine,
  type DeskTripSnapshot,
} from "../../domain/quickFareDesk";
import { advanceAmount, type PayOptionId } from "../../domain/paymentChoices";
import { createAdminBooking, emptyManualBooking, newRequestId } from "../../services/adminBookingService";
import { createBookingPaymentLink } from "../../services/enquiryService";
import { getTripPaymentOptions, type TripPaymentOptions } from "../../services/bookingOpsService";
import { copyText } from "../../services/customerDirectoryService";
import { tripPickupAt, tripToForm, type QuickTrip } from "../booking/QuickFare";
import { callerBadgeText, useCallerLookup } from "../../hooks/useCallerLookup";
import type { Customer } from "../../types";

export interface BookTarget {
  trip: QuickTrip;
  snapshot: DeskTripSnapshot;
  line: DeskQuoteLine;
  /** Booking from a saved follow-up: its enquiry, the caller's saved number (never shown in full) and name. */
  enquiry: { id: string; code: string; phone: string; name: string; customerId: string | null } | null;
}

export interface BookedResult {
  id: string;
  bookingId: string;
  fare: number;
  link: { url: string; amount: number } | null;
  linkError: string | null;
  /** The mobile the booking was made on (10 digits), for the "same caller, same trip" follow-up check. */
  digits: string;
}

const LABEL = "block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1";
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * "Fare OK" → a real booking through the office booking server (createAdminBooking: the server re-prices it and refuses a
 * changed fare). Advance and full payment are offered only when the trip's payment rules allow them and Razorpay is
 * configured; the link is the one the server created. Nothing here invents an ID, a payment or a delivery.
 */
export default function ConfirmBookingDialog({ target, customers, onBooked, onFullForm, onClose }: {
  target: BookTarget;
  customers: Customer[];
  /** After the booking exists: mark the follow-up converted. Resolves to a problem to show, or null. */
  onBooked: (r: BookedResult) => Promise<string | null>;
  /** The New booking form with this trip and vehicle (flight, passenger, discount, terms). */
  onFullForm?: () => void;
  onClose: () => void;
}) {
  const { trip, snapshot: s, line, enquiry } = target;
  const brandName = DESK_BRANDS[s.source].name;
  const date = ddmmyyyy(s.date);
  const time = clock12(s.time);
  const [useSaved, setUseSaved] = useState(!!enquiry?.phone);
  const [mobile, setMobile] = useState("");
  const [name, setName] = useState(enquiry?.name ?? "");
  const nameAuto = useRef(false);
  const [plan, setPlan] = useState<PayOptionId>("later");
  const [options, setOptions] = useState<{ loading: boolean; data: TripPaymentOptions | null; error: string | null }>({ loading: true, data: null, error: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<(BookedResult & { warning: string | null }) | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // One request id per dialog: a retry after a lost answer returns the booking already created, never a second one.
  const requestId = useRef(newRequestId());
  const mobileRef = useRef<HTMLInputElement>(null);

  const lookup = useCallerLookup(mobile, customers, !useSaved);
  const norm = normalizeIndianMobile(mobile);
  const foundId = lookup.state === "found" ? lookup.id : "";
  const foundName = lookup.state === "found" ? lookup.customer?.name ?? "" : "";
  useEffect(() => {
    if (foundName && (!name.trim() || nameAuto.current)) { setName(foundName); nameAuto.current = true; }
    else if (!foundId && nameAuto.current) { setName(""); nameAuto.current = false; }
  }, [foundId, foundName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    const at = tripPickupAt(trip);
    getTripPaymentOptions(trip.pickup, at ? new Date(Date.parse(`${at}:00+05:30`)).toISOString() : "")
      .then((d) => { if (live) setOptions({ loading: false, data: d, error: null }); })
      .catch((e) => { if (live) setOptions({ loading: false, data: null, error: errText(e, "unavailable") }); });
    return () => { live = false; };
  }, [trip]);

  const choice = (id: PayOptionId) => options.data?.choices.find((c) => c.id === id) ?? null;
  const offered = (id: PayOptionId) => id === "later" || (!!options.data?.online && !!choice(id));
  const amountOf = (id: PayOptionId) => (id === "later" ? 0 : advanceAmount(line.fare, choice(id)?.percent ?? (id === "full" ? 100 : 0)));
  const partPct = choice("part")?.percent ?? null;
  const payNow = amountOf(plan);

  const confirm = async () => {
    if (busy) return;
    const phone = useSaved ? enquiry?.phone ?? "" : norm.ok ? norm.e164 : "";
    if (!phone) return setError(norm.ok ? "Enter the customer's mobile number." : norm.reason);
    if (name.trim().length < 2) return setError("Enter the customer name.");
    if (!offered(plan)) return setError("Choose a payment mode that is available for this trip.");
    setBusy(true);
    setError(null);
    let created: { id: string; bookingId: string; fare: number };
    try {
      const form = tripToForm(trip, line.categoryId, {
        ...emptyManualBooking(),
        channel: s.source,
        customerId: useSaved ? enquiry?.customerId ?? "" : foundId,
        customerName: name.trim(),
        customerPhone: phone,
        whatsappSame: true,
        paymentMethod: plan === "later" ? "Cash" : "UPI",
      });
      created = await createAdminBooking(form, requestId.current, line.fare, {
        enquirySource: "Phone",
        ...(enquiry && /^NSM-QT-\d{6}$/.test(enquiry.code) ? { enquiryId: enquiry.code } : {}),
        tripExtras: { hillTravel: false, roofCarrier: s.addOns.carrier, pets: s.addOns.pets, waitingMinutes: 0 },
      });
    } catch (e) {
      const m = errText(e, "The booking was not created. Try again.");
      setError(/calculated fare is/i.test(m) ? `${m} The fare settings changed since this quote: close this and Get Fare again.` : m);
      setBusy(false);
      return;
    }
    let link: BookedResult["link"] = null;
    let linkError: string | null = null;
    if (plan !== "later") {
      try {
        const r = await createBookingPaymentLink(created.id, payNow, plan === "full" ? "full" : "advance");
        if (r?.shortUrl) link = { url: r.shortUrl, amount: r.amount || payNow };
        else linkError = "The server did not return a payment link.";
      } catch (e) {
        linkError = errText(e, "The payment link could not be created.");
      }
    }
    const result: BookedResult = { id: created.id, bookingId: created.bookingId, fare: created.fare, link, linkError, digits: phoneDigits(phone) };
    const warning = await onBooked(result).catch((e) => errText(e, "The follow-up could not be marked as converted."));
    setDone({ ...result, warning });
    setBusy(false);
  };

  const shownPhone = useSaved ? maskPhone(enquiry?.phone) : norm.ok ? maskPhone(norm.e164) : "";
  const copyConfirmation = async () => {
    if (!done) return;
    const ok = await copyText(bookingConfirmationText({
      brandName, bookingId: done.bookingId, customer: name.trim(), maskedPhone: shownPhone, route: s.route, date, time,
      vehicle: line.vehicle, fuel: s.fuel, addOns: deskAddOnLabels(s.addOns), fare: done.fare, paymentLink: done.link,
    }));
    setCopied(ok ? "Copied!" : "Copy failed");
    window.setTimeout(() => setCopied(null), 2000);
  };

  const subtitle = `${brandName} • ${date} at ${time}`;
  if (done) {
    const payText = plan === "later" ? "Pay Later to Driver" : done.link ? `Razorpay link created (${formatINR(done.link.amount)})` : `Payment link not created: ${done.linkError}`;
    return (
      <DeskDialog title="Confirm Booking (Fare Approved)" subtitle={subtitle} icon={<CircleCheck className="w-4 h-4" />} tone="emerald" size="lg" onClose={onClose}>
        <div className="p-6 text-center space-y-4" role="status">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto" aria-hidden="true"><CircleCheck className="w-7 h-7" /></div>
          <div>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700">{done.bookingId}</span>
            <h4 className="text-base font-bold text-slate-900 mt-2">Booking Created!</h4>
            <p className="text-xs text-slate-500 mt-1">{name.trim()} • {s.route} • {line.vehicle} [{deskExtrasLabel(s)}] ({formatINR(done.fare)}) — {payText}</p>
            <p className="text-[11px] text-slate-400 mt-1">Status: Pending — approve and publish it in Bookings to assign a cab.</p>
          </div>
          {done.link && (
            <div className="flex items-center justify-center gap-2 text-xs">
              <a href={done.link.url} target="_blank" rel="noreferrer" className="font-semibold text-[#2563EB] hover:underline inline-flex items-center gap-1 break-all">{done.link.url}<ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" /></a>
            </div>
          )}
          {done.link && <p className="text-[11px] text-slate-400">Razorpay was asked to notify the customer; delivery is not confirmed here. Share the link if needed.</p>}
          {done.warning && <p role="alert" className="text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">{done.warning}</p>}
          <div className="flex flex-col sm:flex-row gap-2.5 justify-center pt-1">
            <button type="button" onClick={copyConfirmation} className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 flex items-center justify-center gap-1.5">
              <Copy className="w-3.5 h-3.5" aria-hidden="true" /><span aria-live="polite">{copied ?? "Copy WhatsApp Confirmation"}</span>
            </button>
            <button type="button" data-autofocus onClick={onClose} className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-[#991B1B] text-white hover:bg-[#7F1D1D]">Done</button>
          </div>
        </div>
      </DeskDialog>
    );
  }

  const planButton = (id: PayOptionId, title: string) => {
    const on = plan === id;
    const ok = offered(id);
    const sub = id === "later" ? "₹0 Now" : options.loading ? "Checking…" : ok ? `${formatINR(amountOf(id))} Link` : options.error ? "Unavailable" : !options.data?.online ? "Online payment off" : "Not offered";
    return (
      <button key={id} type="button" role="radio" aria-checked={on} disabled={!ok || busy} onClick={() => { setPlan(id); setError(null); }}
        className={`p-2.5 rounded-xl text-left disabled:opacity-60 disabled:cursor-not-allowed ${on ? "border-2 border-[#2563EB] bg-blue-50/30" : "border border-slate-200 bg-white hover:bg-slate-50"}`}>
        <span className="block text-xs font-bold text-slate-900">{title}</span>
        <span className={`block text-[10px] mt-0.5 ${id === "later" ? "text-slate-500" : ok ? "text-[#2563EB] font-semibold" : "text-slate-400"}`}>{sub}</span>
      </button>
    );
  };

  return (
    <DeskDialog title="Confirm Booking (Fare Approved)" subtitle={subtitle} icon={<CircleCheck className="w-4 h-4" />} tone="emerald" size="lg" busy={busy} onClose={onClose}>
      <div className="p-5 space-y-4">
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-bold text-slate-900 truncate" title={s.route}>{s.route}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{line.vehicle}{line.classBadge ? ` (${line.classBadge})` : ""}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700">Fuel: {deskFuelLabel(s.fuel)}</span>
              {deskAddOnLabels(s.addOns).map((a) => <span key={a} className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-crimson-50 border border-crimson-200 text-[#991B1B]">{a}</span>)}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-base font-bold text-[#991B1B] tabular-nums">{formatINR(line.fare)}</p>
            <span className="text-[10px] font-medium text-slate-400">+ Toll/Permit</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="cbMobileInput" className={LABEL}>Customer Mobile *</label>
            <div className="flex items-center h-10 bg-white border border-slate-200 rounded-xl overflow-hidden focus-within:border-[#991B1B]">
              <span className="px-2.5 text-xs font-semibold text-slate-500 bg-slate-50 h-full flex items-center border-r border-slate-200" aria-hidden="true">+91</span>
              {useSaved ? (
                <div className="w-full h-full px-2.5 flex items-center justify-between gap-2 min-w-0">
                  <span id="cbMobileInput" className="text-sm font-medium text-slate-800 truncate">{maskPhone(enquiry?.phone).replace(/^\+91 /, "")} <span className="text-[10px] font-medium text-slate-400">saved</span></span>
                  <button type="button" disabled={busy} onClick={() => { setUseSaved(false); window.setTimeout(() => mobileRef.current?.focus(), 0); }}
                    className="text-[11px] font-semibold text-[#991B1B] hover:underline shrink-0">Change</button>
                </div>
              ) : (
                <input ref={mobileRef} id="cbMobileInput" data-autofocus type="tel" inputMode="tel" autoComplete="off" placeholder="10-digit mobile" value={mobile} disabled={busy}
                  onChange={(e) => { setMobile(mobileInputValue(e.target.value)); setError(null); }}
                  className="w-full h-full px-2.5 text-sm font-medium text-slate-800 focus:outline-none" />
              )}
            </div>
          </div>
          <div>
            <label htmlFor="cbNameInput" className={LABEL}>Customer Name *</label>
            <input id="cbNameInput" data-autofocus={useSaved || undefined} placeholder="Enter customer name" maxLength={80} autoComplete="off" value={name} disabled={busy}
              onChange={(e) => { setName(e.target.value); nameAuto.current = false; setError(null); }}
              className="w-full h-10 px-3 text-sm font-medium text-slate-800 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]" />
          </div>
        </div>
        {!useSaved && callerBadgeText(lookup) && <p className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/70 px-3 py-1.5 rounded-lg">{callerBadgeText(lookup)}</p>}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500" id="cbPayLabel">Payment Mode</span>
            {options.data?.online ? <span className="text-[11px] font-semibold text-[#2563EB]">Powered by Razorpay</span> : !options.loading && <span className="text-[11px] font-medium text-slate-400">{options.error ? "Payment options unavailable" : "Online payment is not available"}</span>}
          </div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="cbPayLabel">
            {planButton("later", "Pay Later")}
            {planButton("part", partPct ? `${partPct}% Advance` : "Advance")}
            {planButton("full", "100% Online")}
          </div>
        </div>

        {error && <div role="alert" className="px-3 py-2 rounded-xl text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">{error}</div>}

        <button type="button" onClick={confirm} disabled={busy} aria-busy={busy || undefined}
          className={`w-full text-white font-semibold text-sm py-3.5 rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 disabled:opacity-80 disabled:cursor-progress ${plan === "later" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-[#2563EB] hover:bg-blue-700"}`}>
          {busy ? <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" /> : <CircleCheck className="w-4 h-4" aria-hidden="true" />}
          <span>{busy ? "Creating Booking…" : plan === "later" ? "Confirm Booking (Pay Later)" : `Confirm & Create Razorpay Link (${formatINR(payNow)})`}</span>
        </button>
        {onFullForm && (
          <p className="text-center text-[11px] text-slate-500">
            Need a flight number, another passenger or a discount?{" "}
            <button type="button" disabled={busy} onClick={onFullForm} className="font-semibold text-[#991B1B] hover:underline">Open the full booking form</button>
          </p>
        )}
      </div>
    </DeskDialog>
  );
}
