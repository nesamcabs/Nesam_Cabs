import { useState, type FormEvent } from "react";
import Icon from "../ui/Icon";
import { DESK_ADDON_LABELS, deskAddOnLabels, deskFuelLabel, formatINR, type DeskQuoteLine } from "../../domain/quickFareDesk";
import { classBadgeOf, seatsLineOf } from "./deskTrip";
import type { VehicleCategory } from "../../types";

export interface FareView {
  busy: boolean;
  /** Lines shown for the last quoted trip (server-priced or one manual draft). */
  lines: DeskQuoteLine[] | null;
  /** Vehicles the pricing service could not price for this trip, with its reason. */
  unpriced: { vehicle: string; reason: string }[];
  stale: boolean;
  route: string;
  when: string;
  roadKm: number | null;
  roadMinutes: number | null;
  /** Set when no server price is available for this trip (the manual draft path is offered). */
  pricingUnavailable: string | null;
  /** Fuel and add-ons the shown fares were priced with (null before the first quote). */
  quoted: { fuel: "cng" | null; addOns: { pets: boolean; carrier: boolean } } | null;
}

/** The Fuel bar and add-on toggles: what the next quote is priced with. */
export interface FareExtras {
  fuel: "cng" | null;
  addOns: { pets: boolean; carrier: boolean };
  /** "+₹300" / "from +₹250" from the last quote's add-on rates; "" when not known yet. */
  petRate: string;
  carrierRate: string;
  /** False when no vehicle category offers CNG (CNG is then not offered). */
  cngOffered: boolean;
}

const ADDONS = [
  { key: "pets", label: DESK_ADDON_LABELS.pets, icon: "paw-print" },
  { key: "carrier", label: DESK_ADDON_LABELS.carrier, icon: "luggage" },
] as const;

/** CNG / Diesel segmented control and the Pet Friendly / Luggage Carrier toggles. Prices always come from the server. */
function FuelBar({ extras, disabled, onFuel, onAddOn }: { extras: FareExtras; disabled: boolean; onFuel: (f: "cng" | null) => void; onAddOn: (k: "pets" | "carrier") => void }) {
  const cng = extras.fuel === "cng";
  const fuelBtn = (on: boolean, tone: "cng" | "diesel") =>
    `px-3 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${
      on ? `font-extrabold bg-white shadow-xs ${tone === "cng" ? "text-emerald-700" : "text-amber-800"}` : "font-semibold text-slate-600 hover:text-slate-900"
    }`;
  return (
    <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
          <Icon name="fuel" size={14} className="text-slate-500" /><span>Fuel</span>
        </span>
        <div role="radiogroup" aria-label="Fuel" className="inline-flex items-center p-0.5 rounded-xl bg-slate-200/80 border border-slate-200">
          <button type="button" role="radio" aria-checked={cng} disabled={disabled || !extras.cngOffered} onClick={() => !cng && onFuel("cng")}
            title={extras.cngOffered ? "Price on the CNG rate card (vehicles that offer CNG)" : "No vehicle category offers CNG. Turn on CNG in Vehicle categories."}
            className={fuelBtn(cng, "cng")}>
            <span className={`w-1.5 h-1.5 rounded-full ${cng ? "bg-emerald-500" : "bg-slate-400"}`} aria-hidden="true" />
            <span>CNG</span>
          </button>
          <button type="button" role="radio" aria-checked={!cng} disabled={disabled} onClick={() => cng && onFuel(null)}
            title="Standard Diesel / Petrol rate" className={fuelBtn(!cng, "diesel")}>
            <span className={`w-1.5 h-1.5 rounded-full ${!cng ? "bg-amber-500" : "bg-slate-400"}`} aria-hidden="true" />
            <span>Diesel</span>
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {ADDONS.map((a) => {
          const on = extras.addOns[a.key];
          const rate = a.key === "pets" ? extras.petRate : extras.carrierRate;
          return (
            <button key={a.key} type="button" aria-pressed={on} disabled={disabled} onClick={() => onAddOn(a.key)}
              className={`h-8 px-2.5 rounded-xl border transition-all flex items-center gap-1.5 text-xs shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed ${
                on ? "border-[#991B1B] bg-red-50 text-[#991B1B] font-extrabold" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold"
              }`}>
              <span className={`w-3.5 h-3.5 rounded-md border flex items-center justify-center text-white transition-colors ${on ? "border-[#991B1B] bg-[#991B1B]" : "border-slate-300 bg-white"}`} aria-hidden="true">
                {on && <Icon name="check" size={10} />}
              </span>
              <Icon name={a.icon} size={14} className={on ? "text-[#991B1B]" : "text-slate-500"} />
              <span>{a.label}</span>
              {rate && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${on ? "bg-[#991B1B] text-white" : "bg-slate-100 text-slate-600"}`}>{rate}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const duration = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

/** Manual draft quote: typed by staff when no server price exists. Clearly a draft, never shown as a server fare. */
function ManualQuote({ categories, onUse }: { categories: VehicleCategory[]; onUse: (line: DeskQuoteLine, km: number | null) => void }) {
  const [catId, setCatId] = useState(categories[0]?.id ?? "");
  const [vehicle, setVehicle] = useState("");
  const [fare, setFare] = useState("");
  const [km, setKm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(fare.replace(/[,\s₹]/g, ""));
    const dist = km.trim() ? Number(km) : null;
    const cat = categories.find((c) => c.id === catId);
    const name = cat?.name ?? vehicle.trim();
    if (!name) return setError("Choose or type the vehicle.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return setError("Enter the fare in rupees.");
    if (dist !== null && (!Number.isFinite(dist) || dist <= 0 || dist > 5000)) return setError("Distance must be a number of kilometres, or leave it empty.");
    onUse({
      categoryId: cat?.id ?? `manual:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      vehicle: name,
      classBadge: cat ? classBadgeOf(cat) : "",
      seats: cat ? seatsLineOf(cat) : "",
      fare: Math.round(amount),
      rateLine: "",
      includedKm: null,
      manual: true,
    }, dist !== null ? Math.round(dist) : null);
  };
  return (
    <form onSubmit={submit} className="dk-manual" noValidate aria-label="Manual draft quote">
      <p className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5"><Icon name="pencil" size={14} />Enter a draft quote</p>
      <p className="text-[11px] text-slate-500">Typed by you, saved as a draft quote. It is not a price from the fare settings.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="dk-ff">
          <label htmlFor="mqVehicle">Vehicle</label>
          {categories.length ? (
            <select id="mqVehicle" className="dk-in" value={catId} onChange={(e) => setCatId(e.target.value)}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            <input id="mqVehicle" className="dk-in" maxLength={60} value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
          )}
        </div>
        <div className="dk-ff">
          <label htmlFor="mqFare">Fare (₹) *</label>
          <input id="mqFare" className="dk-in" inputMode="numeric" value={fare} onChange={(e) => { setFare(e.target.value); setError(null); }} />
        </div>
        <div className="dk-ff">
          <label htmlFor="mqKm">Distance (km)</label>
          <input id="mqKm" className="dk-in" inputMode="numeric" value={km} onChange={(e) => { setKm(e.target.value); setError(null); }} placeholder="Optional" />
        </div>
      </div>
      {error && <p role="alert" className="text-[11.5px] font-semibold text-red-700">{error}</p>}
      <button type="submit" className="h-10 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold self-start">Use as draft quote</button>
    </form>
  );
}

export default function FareResults({ view, extras, categories, canBook, sourceName, onFuel, onAddOn, onFollowUp, onBook, onCopy, onManual }: {
  view: FareView;
  extras: FareExtras;
  categories: VehicleCategory[];
  canBook: boolean;
  sourceName: string;
  onFuel: (fuel: "cng" | null) => void;
  onAddOn: (key: "pets" | "carrier") => void;
  onFollowUp: (line: DeskQuoteLine) => void;
  onBook: (line: DeskQuoteLine) => void;
  onCopy: () => Promise<boolean>;
  onManual: (line: DeskQuoteLine, km: number | null) => void;
}) {
  const [copyLabel, setCopyLabel] = useState("Copy All for WhatsApp");
  const lines = view.lines ?? [];
  const actionable = !view.stale && lines.length > 0;
  const quotedFuel = view.quoted ? deskFuelLabel(view.quoted.fuel) : null;
  const quotedAddOns = view.quoted ? deskAddOnLabels(view.quoted.addOns) : [];
  const copy = async () => {
    const ok = await onCopy();
    setCopyLabel(ok ? "Copied — paste in WhatsApp" : "Copy failed");
    setTimeout(() => setCopyLabel("Copy All for WhatsApp"), 2200);
  };

  return (
    <section className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 shadow-sm flex flex-col min-w-0" aria-busy={view.busy || undefined} aria-labelledby="fareTitle">
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0"><Icon name="car" size={16} /></span>
          <h2 id="fareTitle" className="text-sm font-extrabold text-slate-900">Vehicle fares</h2>
        </div>
        {actionable && (
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={copy} className="h-9 px-3 rounded-[10px] text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 flex items-center gap-1.5" aria-live="polite">
              <Icon name="copy" size={14} /><span>{copyLabel}</span>
            </button>
            <button type="button" onClick={() => onFollowUp(lines[0])} className="h-9 px-3 rounded-[10px] text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 flex items-center gap-1.5">
              <Icon name="bell-plus" size={14} /><span>Save Follow-up</span>
            </button>
          </div>
        )}
      </div>

      <FuelBar extras={extras} disabled={view.busy} onFuel={onFuel} onAddOn={onAddOn} />

      {view.busy && (
        <div className="flex-1 p-10 flex flex-col items-center justify-center text-center" role="status">
          <span className="ds-spinner text-[#991B1B]" aria-hidden="true" style={{ width: 22, height: 22 }} />
          <p className="text-sm font-bold text-slate-800 mt-3">Getting fares…</p>
        </div>
      )}

      {!view.busy && view.lines === null && !view.pricingUnavailable && (
        <div className="flex-1 p-10 flex flex-col items-center justify-center text-center">
          <span className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3"><Icon name="calculator" size={24} /></span>
          <p className="text-sm font-bold text-slate-800">No fare yet</p>
          <p className="text-xs text-slate-500 mt-1">Choose pickup and drop, then Get Fare.</p>
        </div>
      )}

      {!view.busy && (view.lines !== null || view.pricingUnavailable) && (
        <div className="flex-1 flex flex-col fade-slide-in min-w-0">
          <div className="px-5 py-2.5 bg-slate-50/90 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="min-w-0"><b className="font-extrabold text-slate-900">{view.route}</b><span className="text-slate-500"> · {view.when} · {sourceName}</span></span>
            {quotedFuel && lines.some((l) => !l.manual) && (
              <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 border ${
                quotedAddOns.length ? "font-extrabold text-[#991B1B] bg-red-50 border-red-200" : quotedFuel === "CNG" ? "font-bold text-emerald-700 bg-emerald-50 border-emerald-200" : "font-bold text-slate-600 bg-white border-slate-200"
              }`}>
                {[quotedFuel, ...quotedAddOns].join(" • ")}
              </span>
            )}
            {view.roadKm !== null && (
              <span className="text-[11px] font-semibold text-slate-500 bg-white border border-slate-200 px-2.5 py-0.5 rounded-full shrink-0">
                {view.roadKm} km{view.roadMinutes ? ` · ${duration(view.roadMinutes)}` : ""}{lines.some((l) => l.manual) ? " (entered)" : " by road"}
              </span>
            )}
          </div>

          {view.stale && (
            <div role="status" className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-[11.5px] font-bold text-amber-800 flex items-center gap-2">
              <Icon name="info" size={14} className="shrink-0" />The trip changed. Get Fare again before saving or booking.
            </div>
          )}

          {view.pricingUnavailable && !lines.length && (
            <div className="px-5 py-3 border-b border-slate-100 space-y-3">
              <p role="alert" className="text-[12px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-start gap-2">
                <Icon name="circle-alert" size={14} className="shrink-0 mt-0.5" />{view.pricingUnavailable}
              </p>
              <ManualQuote categories={categories} onUse={onManual} />
            </div>
          )}

          <ul className={`divide-y divide-slate-100 flex-1 ${view.stale ? "opacity-60" : ""}`} aria-label="Vehicle fares">
            {lines.map((l) => (
              <li key={l.categoryId} className="px-5 py-3.5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[15px] font-extrabold text-slate-900">{l.vehicle}</span>
                    {l.classBadge && <span className="dk-class">{l.classBadge}</span>}
                    {!l.manual && quotedFuel && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${quotedFuel === "CNG" ? "bg-emerald-50 text-emerald-700 border-emerald-200/70" : "bg-amber-50 text-amber-800 border-amber-200/70"}`}>
                        {quotedFuel}
                      </span>
                    )}
                    {l.manual && <span className="dk-draftbadge">Draft quote</span>}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{[l.seats, l.rateLine, l.includedKm ? `${l.includedKm} km included` : ""].filter(Boolean).join(" • ") || " "}</p>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <p className="text-lg font-extrabold text-slate-900 tabular-nums mr-1">{formatINR(l.fare)}</p>
                  <button type="button" disabled={view.stale} onClick={() => onFollowUp(l)} title="Save a follow-up for this vehicle" aria-label={`Follow-up for ${l.vehicle}`}
                    className="h-9 px-3 rounded-[10px] text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                    <Icon name="bell-plus" size={14} /><span className="hidden sm:inline">Follow-up</span>
                  </button>
                  {canBook && (
                    <button type="button" disabled={view.stale} onClick={() => onBook(l)} title="Save a booking draft for this vehicle" aria-label={`Book ${l.vehicle}`}
                      className="h-9 px-3.5 rounded-[10px] text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
                      <Icon name="check" size={14} /><span>Book</span>
                    </button>
                  )}
                </div>
              </li>
            ))}
            {view.unpriced.map((u) => (
              <li key={u.vehicle} className="px-5 py-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-[15px] font-extrabold text-slate-900">{u.vehicle}</span>
                  <p className="text-xs font-semibold text-amber-700 mt-0.5">{u.reason}</p>
                </div>
                <span className="text-lg font-extrabold text-slate-300" aria-label="No fare">—</span>
              </li>
            ))}
          </ul>
          {!canBook && lines.length > 0 && (
            <p className="px-5 py-2.5 bg-slate-50/70 border-t border-slate-100 text-[11px] font-semibold text-slate-500">Your access can quote and save follow-ups, not bookings.</p>
          )}
        </div>
      )}
    </section>
  );
}
