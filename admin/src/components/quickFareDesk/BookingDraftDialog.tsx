import { useMemo, useRef, useState } from "react";
import Icon from "../ui/Icon";
import DeskDialog from "./DeskDialog";
import { deskAddOnLabels, deskExtrasLabel, deskFuelLabel, formatINR, normalizeIndianMobile, type DeskBookingDraft, type DeskPayChoice, type DeskQuoteLine, type DeskTripSnapshot } from "../../domain/quickFareDesk";
import { advanceAmount, type PaymentChoices } from "../../domain/paymentChoices";
import type { Customer } from "../../types";

export interface PaySettingsState {
  loading: boolean;
  choices: PaymentChoices | null;
  error: string | null;
}

export interface DraftSubmit {
  customerId: string | null;
  mobile: string;
  name: string;
  payment: DeskPayChoice;
  partPercent: number | null;
  amountNow: number | null;
}

const PAY_LABEL: Record<DeskPayChoice, string> = { later: "Pay later", part: "Part payment", full: "Full payment" };

export default function BookingDraftDialog({ trip, line, sourceName, customers, initial, pay, onSave, onContinue, onClose }: {
  trip: DeskTripSnapshot;
  line: DeskQuoteLine;
  sourceName: string;
  customers: Customer[];
  initial?: { mobile?: string; name?: string };
  pay: PaySettingsState;
  onSave: (v: DraftSubmit) => { kind: "created" | "existing"; draft: DeskBookingDraft };
  /** Existing New booking flow, offered after the draft is saved (server-priced quotes only). */
  onContinue?: (draft: DeskBookingDraft) => void;
  onClose: () => void;
}) {
  const [mobile, setMobile] = useState(initial?.mobile?.replace(/^\+91/, "") ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [nameAuto, setNameAuto] = useState(false);
  const [payment, setPayment] = useState<DeskPayChoice>("later");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ kind: "created" | "existing"; draft: DeskBookingDraft } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const saving = useRef(false);

  const byMobile = useMemo(() => {
    const m = new Map<string, Customer>();
    for (const c of customers) { const n = normalizeIndianMobile(c.phone || ""); if (n.ok && !m.has(n.digits)) m.set(n.digits, c); }
    return m;
  }, [customers]);
  const norm = normalizeIndianMobile(mobile);
  const match = norm.ok ? byMobile.get(norm.digits) ?? null : null;

  const onMobile = (v: string) => {
    setMobile(v);
    setError(null);
    const n = normalizeIndianMobile(v);
    const m = n.ok ? byMobile.get(n.digits) : undefined;
    if (m && (!name.trim() || nameAuto)) { setName(m.name); setNameAuto(true); }
    else if (nameAuto) { setName(""); setNameAuto(false); }
  };

  // Options and the part-payment share come from Payment options (Service & Fare Settings). Nothing is assumed.
  const pct = pay.choices?.partPercent ?? null;
  const visible = (id: DeskPayChoice) => (pay.choices ? pay.choices.options[id]?.visible !== false : id !== "part");
  const amountNow = (id: DeskPayChoice) => (id === "later" ? 0 : id === "full" ? line.fare : pct ? advanceAmount(line.fare, pct) : null);

  const save = () => {
    if (saving.current || saved) return;
    if (!norm.ok) return setError(norm.reason);
    if (!name.trim()) return setError("Enter the customer name.");
    if (!visible(payment)) return setError("Choose a payment preference that is switched on in Payment options.");
    saving.current = true;
    const res = onSave({ customerId: match?.id ?? null, mobile: norm.e164, name: name.trim(), payment, partPercent: payment === "part" ? pct : null, amountNow: amountNow(payment) });
    setSaved(res);
    saving.current = false;
  };

  const copyDetails = async (d: DeskBookingDraft) => {
    const text = [
      `${sourceName} — Booking Draft ${d.ref}`,
      `Customer: ${d.name} (${d.mobile})`,
      `Trip: ${d.trip.tripLabel} · ${d.trip.route}`,
      `Pickup: ${d.trip.pickupLabel}`,
      `Vehicle: ${d.quote.vehicle}`,
      ...(d.quote.manual ? [] : [`Fuel & add-ons: ${deskExtrasLabel(d.trip)}`]),
      `Fare: ${formatINR(d.quote.fare)}${d.quote.manual ? " (draft quote)" : ""}`,
      `Payment preference: ${PAY_LABEL[d.payment]}${d.payment === "part" && d.partPercent ? ` (${d.partPercent}%)` : ""}`,
      "Status: draft — not yet a confirmed booking.",
    ].join("\n");
    try { await navigator.clipboard.writeText(text); setCopied("Copied"); } catch { setCopied("Copy failed"); }
    setTimeout(() => setCopied(null), 2000);
  };

  if (saved) {
    const d = saved.draft;
    return (
      <DeskDialog title="Booking Draft saved" icon="file-check-2" tone="emerald" subtitle={`${sourceName} · saved on this browser`} onClose={onClose}>
        <div className="p-5 space-y-4" role="status">
          <div className="text-center space-y-2">
            <span className="inline-block px-3 py-1 rounded-full text-xs font-extrabold bg-slate-100 text-slate-700 tracking-wide">{d.ref}</span>
            <p className="text-sm font-bold text-slate-900">{saved.kind === "existing" ? "This draft was already saved." : "Draft details saved."}</p>
            <p className="text-xs text-slate-500">Not yet a confirmed booking. No payment link or message has been sent.</p>
          </div>
          <dl className="dk-summary">
            <div><dt>Customer</dt><dd>{d.name} · {d.mobile}</dd></div>
            <div><dt>Trip</dt><dd>{d.trip.tripLabel} · {d.trip.route}</dd></div>
            <div><dt>Pickup</dt><dd>{d.trip.pickupLabel}</dd></div>
            <div><dt>Vehicle</dt><dd>{d.quote.vehicle} · {formatINR(d.quote.fare)}{d.quote.manual ? " (draft quote)" : ""}</dd></div>
            {!d.quote.manual && <div><dt>Fuel &amp; add-ons</dt><dd>{deskExtrasLabel(d.trip)}</dd></div>}
            <div><dt>Payment</dt><dd>{PAY_LABEL[d.payment]}{d.payment === "part" && d.partPercent ? ` · ${d.partPercent}% (${formatINR(d.amountNow)})` : ""}</dd></div>
          </dl>
          <div className="flex flex-col sm:flex-row gap-2">
            <button type="button" onClick={() => copyDetails(d)} className="flex-1 h-11 rounded-xl text-xs font-bold bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 flex items-center justify-center gap-1.5">
              <Icon name="copy" size={14} />{copied ?? "Copy draft details"}
            </button>
            {onContinue && !d.quote.manual && (
              <button type="button" onClick={() => onContinue(d)} className="flex-1 h-11 rounded-xl text-xs font-bold bg-white text-[#991B1B] border border-red-200 hover:bg-red-50 flex items-center justify-center gap-1.5">
                <Icon name="arrow-right" size={14} />Continue in New booking
              </button>
            )}
            <button type="button" data-autofocus onClick={onClose} className="flex-1 h-11 rounded-xl text-xs font-bold bg-[#991B1B] text-white hover:bg-[#7F1D1D]">Done</button>
          </div>
        </div>
      </DeskDialog>
    );
  }

  return (
    <DeskDialog title="Booking draft" icon="file-check-2" tone="emerald" subtitle={`${sourceName} · ${trip.tripLabel}`} size="lg" onClose={onClose}>
      <div className="p-5 space-y-4">
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-slate-900 truncate" title={trip.route}>{trip.route}</p>
            <p className="text-[11.5px] font-semibold text-slate-500 mt-0.5">{trip.pickupLabel} · {line.vehicle}{line.classBadge ? ` (${line.classBadge})` : ""}</p>
            {!line.manual && (
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700">Fuel: {deskFuelLabel(trip.fuel)}</span>
                {deskAddOnLabels(trip.addOns).map((a) => (
                  <span key={a} className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-red-50 border border-red-200 text-[#991B1B]">{a}</span>
                ))}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-base font-extrabold text-[#991B1B] tabular-nums">{formatINR(line.fare)}</p>
            {line.manual && <span className="dk-draftbadge">Draft quote</span>}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="dk-ff">
            <label htmlFor="bdMobile">Customer mobile *</label>
            <div className="dk-in dk-in--pre">
              <span>+91</span>
              <input id="bdMobile" data-autofocus={!initial?.mobile || undefined} type="tel" inputMode="tel" autoComplete="off" value={mobile} onChange={(e) => onMobile(e.target.value)} />
            </div>
          </div>
          <div className="dk-ff">
            <label htmlFor="bdName">Customer name *</label>
            <input id="bdName" className="dk-in" maxLength={80} autoComplete="off" value={name} onChange={(e) => { setName(e.target.value); setNameAuto(false); setError(null); }} />
          </div>
        </div>
        {match && <p className="text-[11.5px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/70 px-3 py-1.5 rounded-lg">Existing customer: {match.name}{match.city ? ` · ${match.city}` : ""}</p>}

        <fieldset className="dk-ff">
          <legend className="dk-ff__label">Payment preference</legend>
          {pay.loading && <p className="text-[11px] text-slate-500">Loading payment options…</p>}
          {!pay.loading && !pay.choices && <p className="text-[11px] text-amber-700">Payment options could not be read{pay.error ? ` (${pay.error})` : ""}. Part payment needs that setting, so it is not offered.</p>}
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Payment preference">
            {(["later", "part", "full"] as const).map((id) => {
              const on = payment === id;
              const off = !visible(id) || (id === "part" && !pct);
              const amt = amountNow(id);
              return (
                <button key={id} type="button" role="radio" aria-checked={on} disabled={off} onClick={() => { setPayment(id); setError(null); }}
                  className={`dk-pay ${on ? "is-on" : ""}`}>
                  <span className="block text-xs font-extrabold text-slate-900">{id === "part" && pct ? `${pct}% now` : PAY_LABEL[id]}</span>
                  <span className="block text-[10.5px] font-semibold text-slate-500 mt-0.5">{off ? "Not offered" : id === "later" ? "₹0 now" : amt !== null ? `${formatINR(amt)} now` : "—"}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5">Saved as a preference on the draft. No payment link is created in this step.</p>
        </fieldset>

        {error && <div role="alert" className="px-3 py-2 rounded-xl text-xs font-semibold bg-red-50 text-red-800 border border-red-200">{error}</div>}

        <button type="button" onClick={save} className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm flex items-center justify-center gap-2">
          <Icon name="file-check-2" size={16} />Save booking draft
        </button>
      </div>
    </DeskDialog>
  );
}
