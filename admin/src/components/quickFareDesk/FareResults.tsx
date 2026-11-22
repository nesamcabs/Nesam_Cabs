import { useEffect, useRef, useState, type FormEvent } from "react";
import { BellPlus, Calculator, Car, Check, CircleAlert, Copy, Fuel, Info, LoaderCircle, Luggage, PawPrint, Pencil } from "lucide-react";
import { DESK_ADDON_LABELS, formatINR, type DeskQuoteLine } from "../../domain/quickFareDesk";
import { bagsOf, classBadgeOf, seatsOf } from "./deskTrip";
import type { VehicleCategory } from "../../types";

export interface FareView {
  busy: boolean;
  /** A quote exists (results, an error or the unavailable state are shown instead of the empty state). */
  quoted: boolean;
  /** Lines of the last quoted trip (server-priced, or one typed draft). */
  lines: DeskQuoteLine[];
  /** Vehicles the server could not price for this trip, with its reason. */
  unpriced: { vehicle: string; reason: string }[];
  /** The trip changed since these fares were priced. */
  stale: boolean;
  route: string;
  /** "22-11-2026" and "8:00 AM" of the quoted pickup. */
  date: string;
  time: string;
  distance: string;
  /** "Diesel • Pet Friendly" as priced; empty for a typed draft. */
  config: { fuel: "CNG" | "Diesel"; addOns: string[] } | null;
  slab: string;
  coverage: string;
  /** Set when no server price is available for this trip (the typed draft is offered). */
  unavailable: string | null;
}

/** The fuel toggle and add-ons that the next quote is priced with. */
export interface FareExtras {
  fuel: "cng" | null;
  addOns: { pets: boolean; carrier: boolean };
  /** "+₹300" / "from +₹250" from the last quote's add-on rates; "" while not known. */
  petRate: string;
  carrierRate: string;
  /** False when no vehicle category offers CNG. */
  cngOffered: boolean;
}

const ADDONS = [
  { key: "pets", label: DESK_ADDON_LABELS.pets, Icon: PawPrint },
  { key: "carrier", label: DESK_ADDON_LABELS.carrier, Icon: Luggage },
] as const;

/** CNG / Diesel and the Pet Friendly / Luggage Carrier toggles. Every price comes from the server. */
function FuelBar({ extras, disabled, onFuel, onAddOn }: { extras: FareExtras; disabled: boolean; onFuel: (f: "cng" | null) => void; onAddOn: (k: "pets" | "carrier") => void }) {
  const cng = extras.fuel === "cng";
  const fuelBtn = (on: boolean, tone: "cng" | "diesel") =>
    `px-3 py-1.5 rounded-lg text-xs transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${
      on ? `font-bold bg-white shadow-xs ${tone === "cng" ? "text-emerald-700" : "text-amber-800"}` : "font-semibold text-slate-600 hover:text-slate-900"
    }`;
  return (
    <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1" aria-hidden="true">
          <Fuel className="w-3.5 h-3.5 text-slate-500" /><span>Fuel</span>
        </span>
        <div role="group" aria-label="Fuel Type" className="inline-flex items-center p-0.5 rounded-xl bg-slate-200/80 border border-slate-200">
          <button type="button" aria-pressed={cng} disabled={disabled || !extras.cngOffered} onClick={() => !cng && onFuel("cng")}
            title={extras.cngOffered ? "Price on the CNG rate card (vehicles that offer CNG)" : "No vehicle category offers CNG. Turn on CNG in Vehicle categories."}
            className={fuelBtn(cng, "cng")}>
            <span className={`w-1.5 h-1.5 rounded-full ${cng ? "bg-emerald-500" : "bg-slate-400"}`} aria-hidden="true" />
            <span>CNG</span>
          </button>
          <button type="button" aria-pressed={!cng} disabled={disabled} onClick={() => cng && onFuel(null)} title="Standard Diesel / Petrol rate" className={fuelBtn(!cng, "diesel")}>
            <span className={`w-1.5 h-1.5 rounded-full ${!cng ? "bg-amber-500" : "bg-slate-400"}`} aria-hidden="true" />
            <span>Diesel</span>
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {ADDONS.map(({ key, label, Icon }) => {
          const on = extras.addOns[key];
          const rate = key === "pets" ? extras.petRate : extras.carrierRate;
          return (
            <button key={key} type="button" aria-pressed={on} disabled={disabled} onClick={() => onAddOn(key)}
              className={`h-8 px-2.5 rounded-xl border transition-all flex items-center gap-1.5 text-xs shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed ${
                on ? "border-[#991B1B] bg-crimson-50 text-[#991B1B] font-bold" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold"
              }`}>
              <span className={`w-3.5 h-3.5 rounded-md border flex items-center justify-center text-white transition-colors ${on ? "border-[#991B1B] bg-[#991B1B]" : "border-slate-300 bg-white"}`} aria-hidden="true">
                {on && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
              </span>
              <Icon className={`w-3.5 h-3.5 ${on ? "text-[#991B1B]" : "text-slate-500"}`} aria-hidden="true" />
              <span>{label}</span>
              {rate && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${on ? "bg-[#991B1B] text-white" : "bg-slate-100 text-slate-600"}`}>{rate}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const INPUT = "w-full h-9 px-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#991B1B]";

/** A typed draft quote, offered only when no server price exists. Always marked as a draft, never shown as a server fare. */
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
      seats: cat ? seatsOf(cat) : "",
      bags: cat ? bagsOf(cat) : "",
      fare: Math.round(amount),
      rateNote: "",
      includedKm: null,
      manual: true,
    }, dist !== null ? Math.round(dist) : null);
  };
  return (
    <form onSubmit={submit} noValidate aria-label="Draft quote" className="p-3.5 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 space-y-2.5">
      <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" aria-hidden="true" />Enter a draft quote</p>
      <p className="text-[11px] text-slate-500">Typed by you and saved as a draft quote. It is not a price from the fare settings, so it cannot be booked from here.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <label htmlFor="mqVehicle" className="block text-[10px] font-medium text-slate-500 mb-1">Vehicle</label>
          {categories.length ? (
            <select id="mqVehicle" className={INPUT} value={catId} onChange={(e) => setCatId(e.target.value)}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            <input id="mqVehicle" className={INPUT} maxLength={60} value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
          )}
        </div>
        <div>
          <label htmlFor="mqFare" className="block text-[10px] font-medium text-slate-500 mb-1">Fare (₹) *</label>
          <input id="mqFare" className={INPUT} inputMode="numeric" value={fare} onChange={(e) => { setFare(e.target.value); setError(null); }} />
        </div>
        <div>
          <label htmlFor="mqKm" className="block text-[10px] font-medium text-slate-500 mb-1">Distance (km)</label>
          <input id="mqKm" className={INPUT} inputMode="numeric" value={km} onChange={(e) => { setKm(e.target.value); setError(null); }} placeholder="Optional" />
        </div>
      </div>
      {error && <p role="alert" className="text-[11px] font-semibold text-red-700">{error}</p>}
      <button type="submit" className="h-9 px-3.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold">Use as draft quote</button>
    </form>
  );
}

export default function FareResults({ view, extras, categories, canBook, onFuel, onAddOn, onFollowUp, onBook, onCopy, onManual }: {
  view: FareView;
  extras: FareExtras;
  categories: VehicleCategory[];
  canBook: boolean;
  onFuel: (fuel: "cng" | null) => void;
  onAddOn: (key: "pets" | "carrier") => void;
  onFollowUp: (line: DeskQuoteLine) => void;
  onBook: (line: DeskQuoteLine) => void;
  onCopy: () => Promise<boolean>;
  onManual: (line: DeskQuoteLine, km: number | null) => void;
}) {
  const [copyLabel, setCopyLabel] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);
  useEffect(() => () => { if (copyTimer.current) window.clearTimeout(copyTimer.current); }, []);
  const lines = view.lines;
  const actionable = !view.stale && !view.busy && lines.length > 0;
  const showResults = view.quoted && (lines.length > 0 || view.unpriced.length > 0 || !!view.unavailable);
  const copy = async () => {
    const ok = await onCopy();
    setCopyLabel(ok ? "Copied for WhatsApp!" : "Copy failed — select and copy manually");
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyLabel(null), 2000);
  };
  const config = view.config;
  const configText = config ? [config.fuel, ...config.addOns].join(" • ") : "";
  const configClass = !config ? "" : config.addOns.length
    ? "text-[11px] font-bold text-[#991B1B] bg-crimson-50 border border-crimson-200 px-2 py-0.5 rounded-full shrink-0"
    : config.fuel === "CNG"
      ? "text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full shrink-0"
      : "text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 px-2 py-0.5 rounded-full shrink-0";

  return (
    <section className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 shadow-xs flex flex-col min-w-0" aria-labelledby="qfFaresTitle" aria-busy={view.busy || undefined}>
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0" aria-hidden="true"><Car className="w-4 h-4" /></div>
          <div className="min-w-0">
            <h2 id="qfFaresTitle" className="text-sm font-bold text-slate-900">Vehicle Fares</h2>
            <p className="text-[11px] text-slate-500 truncate">{showResults && view.date ? `${view.date} • ${view.time}` : "The fare for every vehicle appears here"}</p>
          </div>
        </div>
        {actionable && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={copy} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors flex items-center gap-1.5">
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              <span aria-live="polite">{copyLabel ?? "Copy All for WhatsApp"}</span>
            </button>
            <button type="button" onClick={() => onFollowUp(lines[0])} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-1.5">
              <BellPlus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Save Follow-up</span>
            </button>
          </div>
        )}
      </div>

      <FuelBar extras={extras} disabled={view.busy} onFuel={onFuel} onAddOn={onAddOn} />

      {view.busy && !showResults && (
        <div className="flex-1 p-8 sm:p-12 flex flex-col items-center justify-center text-center" role="status">
          <LoaderCircle className="w-6 h-6 text-[#991B1B] animate-spin" aria-hidden="true" />
          <p className="text-sm font-bold text-slate-800 mt-3">Getting fares…</p>
          <p className="text-xs text-slate-500 mt-1">Pricing every vehicle with the fare settings.</p>
        </div>
      )}

      {!view.busy && !showResults && (
        <div className="flex-1 p-8 sm:p-12 flex flex-col items-center justify-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3" aria-hidden="true"><Calculator className="w-6 h-6" /></div>
          <p className="text-sm font-bold text-slate-800">No fare calculated yet</p>
          <p className="text-xs text-slate-500 mt-1 max-w-xs">Enter pickup, drop, and date on the left, then click <strong>Get Fare</strong> to view the vehicle prices.</p>
        </div>
      )}

      {showResults && (
        <div className="flex-1 flex flex-col min-w-0 fade-slide-in">
          <div className="px-5 py-2.5 bg-slate-50/90 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="font-bold text-slate-800 truncate max-w-full">{view.route}</span>
              {view.distance && <span className="text-[11px] font-medium text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full shrink-0">{view.distance}</span>}
              {configText && <span className={configClass}>{configText}</span>}
            </div>
            {view.busy ? (
              <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1 shrink-0" role="status"><LoaderCircle className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />Updating fares…</span>
            ) : view.slab ? (
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/70 shrink-0">{view.slab}</span>
            ) : null}
          </div>

          {view.stale && !view.busy && (
            <div role="status" className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-[11px] font-semibold text-amber-800 flex items-center gap-2">
              <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />The trip changed. Complete the trip details and Get Fare again before saving or booking.
            </div>
          )}

          {view.unavailable && !lines.length && (
            <div className="px-5 py-3 border-b border-slate-100 space-y-3">
              <p role="alert" className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-start gap-2">
                <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />{view.unavailable}
              </p>
              <ManualQuote categories={categories} onUse={onManual} />
            </div>
          )}

          <div className={`divide-y divide-slate-100 flex-1 transition-opacity ${view.stale || view.busy ? "opacity-60" : ""}`} role="list" aria-label="Vehicle fares">
            {lines.map((l) => (
              <div key={l.categoryId} role="listitem" className="px-5 py-3.5 hover:bg-slate-50/80 transition-colors flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-900">{l.vehicle}</span>
                    {l.classBadge && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{l.classBadge}</span>}
                    {!l.manual && config && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${config.fuel === "Diesel" ? "bg-amber-50 text-amber-800 border border-amber-200/70" : "bg-emerald-50 text-emerald-700 border border-emerald-200/70"}`}>{config.fuel}</span>
                    )}
                    {l.manual && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-900 text-white">Draft quote</span>}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">{[l.seats, l.bags, l.rateNote].filter(Boolean).join(" • ") || " "}</p>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <div className="text-right mr-1"><p className="text-base font-bold text-slate-900 tabular-nums">{formatINR(l.fare)}</p></div>
                  <button type="button" disabled={!actionable} onClick={() => onFollowUp(l)} title="Save follow-up for this cab" aria-label={`Follow-up for ${l.vehicle}`}
                    className="h-8 px-2.5 rounded-lg text-[11px] font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed">
                    <BellPlus className="w-3.5 h-3.5" aria-hidden="true" /><span className="hidden sm:inline">Follow-up</span>
                  </button>
                  {canBook && (
                    <button type="button" disabled={!actionable || l.manual} onClick={() => onBook(l)} aria-label={`Book ${l.vehicle}`}
                      title={l.manual ? "A draft quote cannot be booked: get a server fare first" : "Customer approved the fare: confirm the booking"}
                      className="h-8 px-3 rounded-lg text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed">
                      <Check className="w-3.5 h-3.5" aria-hidden="true" /><span>Book</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
            {view.unpriced.map((u) => (
              <div key={u.vehicle} role="listitem" className="px-5 py-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm font-bold text-slate-900">{u.vehicle}</span>
                  <p className="text-[11px] font-medium text-amber-700 mt-0.5">{u.reason}</p>
                </div>
                <span className="text-base font-bold text-slate-300" aria-label="No fare">—</span>
              </div>
            ))}
          </div>

          {lines.length > 0 && (
            <div className="px-5 py-2.5 bg-slate-50/70 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <span>{view.coverage}</span>
              <span className="font-medium text-slate-700">{canBook ? <>Click <strong>Book</strong> if customer says OK</> : "Your access can quote and save follow-ups"}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
