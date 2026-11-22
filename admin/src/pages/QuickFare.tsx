import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Icon from "../components/ui/Icon";
import "../styles/quickFareDesk.css";
import {
  DESK_BRANDS,
  addOnRateLabel,
  deskAddOnLabels,
  deskExtrasLabel,
  deskFollowUpStatus,
  formatDeskQuoteText,
  formatINR,
  maskPhone,
  sortDeskFollowUps,
  type DeskBrand,
  type DeskFollowUp,
  type DeskQuoteLine,
  type DeskTripSnapshot,
  type QueueFilter,
} from "../domain/quickFareDesk";
import {
  useQuickData,
  estimateAll,
  emptyTrip,
  validateTrip,
  withPickup,
  withTripType,
  tripServiceOffered,
  LocationPinDialog,
  type QuickTrip,
  type CategoryEstimate,
} from "../components/booking/QuickFare";
import { useCustomers } from "../hooks/useOfficeData";
import { useNow } from "../hooks/useNow";
import { useQuickFareDesk } from "../hooks/useQuickFareDesk";
import { useNotifications } from "../components/NotificationHost";
import { getPaymentChoiceSettings } from "../services/bookingOpsService";
import { auth } from "../services/firebase";
import { parseChoices } from "../domain/paymentChoices";
import { formatTime12 } from "../utils/time";
import type { NewBookingDraft } from "./NewBooking";
import type { PickedPoint } from "../components/MapLocationPicker";
import { activeTrip, dateLabel, deskTabOf, lineOfEstimate, quoteKeyOf, routeOf, snapshotOf, time12, type DeskTab } from "../components/quickFareDesk/deskTrip";
import TripForm from "../components/quickFareDesk/TripForm";
import FareResults, { type FareExtras, type FareView } from "../components/quickFareDesk/FareResults";
import { FollowUpControls, SourceSwitcher } from "../components/quickFareDesk/DeskHeader";
import { FollowUpQueue, RevealHistory } from "../components/quickFareDesk/FollowUpQueue";
import FollowUpDialog, { type FollowUpSubmit } from "../components/quickFareDesk/FollowUpDialog";
import BookingDraftDialog, { type PaySettingsState } from "../components/quickFareDesk/BookingDraftDialog";
import { LostDialog, RentalDialog, RevealDialog } from "../components/quickFareDesk/SmallDialogs";

interface QuickFareProps {
  onNewBooking?: (draft: NewBookingDraft) => void;
  onEnquirySaved?: () => void;
  onNavigate?: (page: string, tab?: string) => void;
  /** Kept for the App route contract. */
  onSelectBooking?: (bookingId: string) => void;
}

/** The trip that was priced, with its results. Actions always use this snapshot, never the live form. */
interface Quote {
  key: string;
  trip: QuickTrip;
  brand: DeskBrand;
  estimates: CategoryEstimate[] | null;
  lines: DeskQuoteLine[] | null;
  unpriced: { vehicle: string; reason: string }[];
  roadKm: number | null;
  roadMinutes: number | null;
  pricingUnavailable: string | null;
}

/** Desk tab → the built-in trip-type key the Services page switches on and off. */
const SERVICE_KEY: Record<DeskTab, string> = { "One Way": "One Way", "Round Trip": "Round Trip", Multicity: "Multicity", Airport: "Airport Taxi", Rental: "Local Rental", Local: "Pickup & Drop" };
const TAB_TRIP: Record<DeskTab, { tripType: QuickTrip["tripType"]; multicity?: boolean; local?: boolean }> = {
  "One Way": { tripType: "One Way" },
  "Round Trip": { tripType: "Round Trip" },
  Multicity: { tripType: "Round Trip", multicity: true },
  Airport: { tripType: "Airport Taxi" },
  Rental: { tripType: "Local Rental" },
  Local: { tripType: "One Way", local: true },
};
const ALL_TABS = Object.keys(TAB_TRIP) as DeskTab[];
const EMPTY_STOP = () => ({ text: "", point: null });

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const staffName = () => auth.currentUser?.displayName?.trim() || auth.currentUser?.email?.trim() || "Current user";

/** Desk-specific wording for missing places; every other rule is the shared booking validation. */
function deskProblem(t: QuickTrip): string | null {
  if (!t.pickup) return t.pickupText.trim() ? "Choose the pickup from the suggestions or set it on the map." : "Enter the pickup location.";
  if (t.tripType !== "Local Rental" && !t.drop) return t.dropText.trim() ? "Choose the drop from the suggestions or set it on the map." : "Enter the drop location.";
  return validateTrip(t);
}

function playBeep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Audio blocked: the visual alert still shows.
  }
}

type BookTarget = { line: DeskQuoteLine; trip: DeskTripSnapshot; followUp: DeskFollowUp | null; quickTrip: QuickTrip | null; estimates: CategoryEstimate[] | null };

export default function QuickFare({ onNewBooking }: QuickFareProps) {
  const data = useQuickData();
  const customers = useCustomers();
  const customerRows = customers.rows ?? [];
  // The 15 s tick re-renders the queue; status is read against the real current time (so "Alert Now" is due at once).
  useNow(15000);
  const nowMs = Date.now();
  const desk = useQuickFareDesk();
  const { soundOn, setSoundOn } = useNotifications();

  // ── One source of truth for the enquiry being quoted ──
  const [brand, setBrand] = useState<DeskBrand>("nesam");
  const [trip, setTrip] = useState<QuickTrip>(emptyTrip);
  const [notice, setNotice] = useState<string | null>(null);
  const set = (patch: Partial<QuickTrip>) => { setTrip((t) => ({ ...t, ...patch })); setNotice(null); };
  const [swapping, setSwapping] = useState(false);
  const [pinFor, setPinFor] = useState<"pickup" | "drop" | null>(null);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const stale = !!quote && quote.key !== quoteKeyOf(trip, brand);

  // ── Queue / dialogs ──
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [revealed, setRevealed] = useState<Record<string, true>>({});
  const [fuTarget, setFuTarget] = useState<{ line: DeskQuoteLine; trip: DeskTripSnapshot } | null>(null);
  const [bookTarget, setBookTarget] = useState<BookTarget | null>(null);
  const [revealTarget, setRevealTarget] = useState<DeskFollowUp | null>(null);
  const [lostTarget, setLostTarget] = useState<DeskFollowUp | null>(null);
  const [rentalOpen, setRentalOpen] = useState(false);
  const [pay, setPay] = useState<PaySettingsState>({ loading: false, choices: null, error: null });
  const payLoaded = useRef(false);

  const [toast, setToast] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = (text: string, tone: "info" | "error" = "info") => {
    setToast({ text, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), tone === "error" ? 6000 : 3500);
  };

  // Audio may play only after the person has interacted with the page (browser autoplay rules).
  const audioOk = useRef(false);
  useEffect(() => {
    const unlock = () => { audioOk.current = true; };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => { document.removeEventListener("pointerdown", unlock); document.removeEventListener("keydown", unlock); };
  }, []);

  // ── Follow-up queue (derived on the India clock) ──
  const rows = useMemo(() => sortDeskFollowUps(desk.followUps, nowMs), [desk.followUps, nowMs]);
  const counts = useMemo(() => {
    const c: Record<QueueFilter, number> = { all: rows.length, due: 0, upcoming: 0, booked: 0, lost: 0 };
    for (const r of rows) c[deskFollowUpStatus(r, nowMs)] += 1;
    return c;
  }, [rows, nowMs]);
  const topDue = rows.find((r) => deskFollowUpStatus(r, nowMs) === "due") ?? null;

  // A follow-up that becomes due while the desk is open alerts once (sound only if on and allowed).
  const alerted = useRef<Set<string> | null>(null);
  useEffect(() => {
    const due = rows.filter((r) => deskFollowUpStatus(r, nowMs) === "due").map((r) => `${r.id}:${r.reminderAtMs}`);
    if (alerted.current === null) { alerted.current = new Set(due); return; }
    const fresh = due.filter((k) => !alerted.current!.has(k));
    fresh.forEach((k) => alerted.current!.add(k));
    if (!fresh.length) return;
    const first = rows.find((r) => fresh[0].startsWith(`${r.id}:`));
    if (soundOn && audioOk.current) playBeep();
    if (first) showToast(`Follow-up due: ${first.name || "caller"} · ${first.trip.route}`);
  }, [rows, nowMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Payment options are read once, when a booking draft is first opened.
  const openBook = (t: BookTarget) => {
    setBookTarget(t);
    if (payLoaded.current) return;
    payLoaded.current = true;
    setPay({ loading: true, choices: null, error: null });
    getPaymentChoiceSettings()
      .then((r) => setPay({ loading: false, choices: parseChoices(r), error: null }))
      .catch((e) => setPay({ loading: false, choices: null, error: errorText(e, "unavailable") }));
  };

  // ── Trip form ──
  const tabs = ALL_TABS.filter((t) => tripServiceOffered(SERVICE_KEY[t], data, SERVICE_KEY[deskTabOf(trip)]));
  const pickTab = (tab: DeskTab) => {
    const def = TAB_TRIP[tab];
    setTrip((t) => {
      const sameKind = t.tripType === "Round Trip" && !!t.multicity === !!def.multicity;
      const stops = def.tripType !== "Round Trip" ? [] : sameKind ? t.stops ?? [] : def.multicity ? [EMPTY_STOP()] : [];
      return { ...t, serviceId: "", multicity: !!def.multicity, local: !!def.local, ...withTripType(t, def.tripType), stops };
    });
    setNotice(null);
  };
  const pickPoint = (side: "pickup" | "drop", p: PickedPoint | null, text: string) => {
    setTrip((t) => ({ ...t, ...(side === "pickup" ? withPickup(t, p, text) : { drop: p, dropText: text }) }));
    setNotice(null);
  };
  const swap = () => {
    setSwapping(true);
    window.setTimeout(() => setSwapping(false), 350);
    setTrip((t) => ({
      ...t, pickup: t.drop, pickupText: t.dropText, drop: t.pickup, dropText: t.pickupText,
      ...(t.tripType === "Airport Taxi" ? { airportDirection: t.airportDirection === "to" ? ("from" as const) : ("to" as const) } : {}),
    }));
  };
  const clear = () => { setTrip(emptyTrip()); setQuote(null); setNotice(null); };

  const quoteSeq = useRef(0);
  /** Prices `t` for every vehicle category with the server's fare settings; a newer request replaces an older one. */
  const runQuote = async (t: QuickTrip, b: DeskBrand) => {
    const snapshot = activeTrip(t);
    const problem = deskProblem(snapshot);
    if (problem) return setNotice(problem);
    setNotice(null);
    const seq = ++quoteSeq.current;
    const base = { key: quoteKeyOf(t, b), trip: snapshot, brand: b, roadKm: null, roadMinutes: null, unpriced: [] as Quote["unpriced"] };
    if (!data.categories.length) {
      setQuote({ ...base, estimates: null, lines: null, pricingUnavailable: "No vehicle categories are set up, so no fare could be priced. You can enter a draft quote." });
      return;
    }
    setBusy(true);
    try {
      const priced = await estimateAll(snapshot, data.categories, b);
      if (seq !== quoteSeq.current) return;
      const lines = priced.map(lineOfEstimate).filter((l): l is DeskQuoteLine => !!l);
      const unpriced = priced.filter((r) => !r.quote).map((r) => ({ vehicle: r.category.name, reason: r.error || "Not available on this route" }));
      const road = priced.find((r) => r.quote?.roadKm)?.quote;
      setQuote({
        ...base, estimates: priced, lines: lines.length ? lines : null, unpriced: lines.length ? unpriced : [],
        roadKm: road?.roadKm ? Math.round(road.roadKm) : null, roadMinutes: road?.roadMinutes ? Math.round(road.roadMinutes) : null,
        pricingUnavailable: lines.length ? null : `The fare settings could not price this trip${priced[0]?.error ? ` (${priced[0].error})` : ""}. You can enter a draft quote.`,
      });
    } catch (err) {
      if (seq !== quoteSeq.current) return;
      setQuote({ ...base, estimates: null, lines: null, pricingUnavailable: `Fares are unavailable right now (${errorText(err, "pricing service not reachable")}). You can enter a draft quote.` });
    } finally {
      if (seq === quoteSeq.current) setBusy(false);
    }
  };
  const getFare = (e: FormEvent) => {
    e.preventDefault();
    void runQuote(trip, brand);
  };

  // ── Fuel bar & add-ons: priced by the server (CNG rate card, pet and roof-carrier charges) ──
  /** With current fares on screen, a fuel or add-on change re-prices at once (the route is already checked). */
  const changeExtras = (patch: Partial<QuickTrip>) => {
    const next = { ...trip, ...patch };
    setTrip(next);
    setNotice(null);
    if (quote && !stale) void runQuote(next, brand);
  };
  const pricedRates = quote?.estimates ?? [];
  const extras: FareExtras = {
    fuel: trip.fuel === "cng" ? "cng" : null,
    addOns: { pets: trip.pets === true, carrier: trip.carrier === true },
    petRate: addOnRateLabel(pricedRates.map((e) => e.quote?.addOnRates?.petCharge)),
    carrierRate: addOnRateLabel(pricedRates.map((e) => e.quote?.addOnRates?.carrierCharge)),
    cngOffered: data.categories.some((c) => c.cngEnabled === true),
  };

  const when = (t: QuickTrip) => `${dateLabel(t.date)}, ${time12(t.time)} IST`;
  const fareView: FareView = {
    busy,
    lines: quote?.lines ?? null,
    unpriced: quote?.unpriced ?? [],
    stale,
    route: quote ? routeOf(quote.trip) : "",
    when: quote ? when(quote.trip) : "",
    roadKm: quote?.roadKm ?? null,
    roadMinutes: quote?.roadMinutes ?? null,
    pricingUnavailable: quote?.pricingUnavailable ?? null,
    quoted: quote ? { fuel: quote.trip.fuel === "cng" ? "cng" : null, addOns: { pets: quote.trip.pets === true, carrier: quote.trip.carrier === true } } : null,
  };
  const snapshotFor = (q: Quote) => snapshotOf(q.trip, q.brand, q.roadKm);

  const copyQuote = async () => {
    if (!quote?.lines?.length) return false;
    const serverPriced = !quote.lines.some((l) => l.manual);
    const text = formatDeskQuoteText({
      brandName: DESK_BRANDS[quote.brand].name, route: routeOf(quote.trip), when: when(quote.trip), roadKm: quote.roadKm, lines: quote.lines,
      ...(serverPriced ? { fuel: quote.trip.fuel === "cng" ? ("cng" as const) : null, addOns: deskAddOnLabels({ pets: quote.trip.pets === true, carrier: quote.trip.carrier === true }) } : {}),
    });
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  };

  // ── Follow-ups ──
  const saveFollowUp = (v: FollowUpSubmit) => {
    if (!fuTarget) return;
    const res = desk.saveFollowUp({ ...v, trip: fuTarget.trip, quote: fuTarget.line });
    setFuTarget(null);
    const at = `${formatTime12(new Date(res.item.reminderAtMs))} IST`;
    showToast(res.kind === "updated" ? `Updated the open follow-up for this trip · reminder ${at}` : `Follow-up saved · reminder ${at}`);
  };
  const snooze = (f: DeskFollowUp) => { const at = desk.snooze(f.id); if (at) showToast(`Snoozed to ${formatTime12(new Date(at))} IST`); };
  const scrollToQueue = (f: QueueFilter) => {
    setFilter(f);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("followUpQueueSection")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };
  const bookFromFollowUp = (f: DeskFollowUp) => openBook({ line: f.quote, trip: f.trip, followUp: f, quickTrip: null, estimates: null });

  return (
    <div className="qfd-root w-full min-h-screen bg-[#F8FAFC] text-slate-900">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-7 space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 rounded-xl bg-crimson-50 border border-crimson-100 text-[#991B1B] flex items-center justify-center shrink-0"><Icon name="calculator" size={20} /></span>
            <h1 className="text-base sm:text-lg font-extrabold text-slate-900 leading-tight">Quick Fare &amp; Enquiry Desk</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <FollowUpControls due={counts.due} upcoming={counts.upcoming} soundOn={soundOn} onFilter={scrollToQueue}
              onToggleSound={() => { audioOk.current = true; setSoundOn(!soundOn); }} />
            <SourceSwitcher brand={brand} onChange={setBrand} />
          </div>
        </header>

        {topDue && (
          <section className="rounded-2xl bg-gradient-to-r from-amber-50 via-orange-50/70 to-amber-50 border border-amber-200/90 p-3.5 sm:px-5 fade-slide-in" aria-label="Follow-up due">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <span className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0"><Icon name="bell-ring" size={16} /></span>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-extrabold text-slate-900 truncate">
                    <span className="px-2 py-0.5 mr-2 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-600 text-white">Due now</span>
                    {topDue.name || "Caller"} ({revealed[topDue.id] ? topDue.mobile : maskPhone(topDue.mobile)})
                  </p>
                  <p className="text-xs font-semibold text-slate-600 mt-0.5 truncate">{topDue.trip.route} · {topDue.quote.vehicle}{topDue.quote.manual ? "" : ` [${deskExtrasLabel(topDue.trip)}]`} {formatINR(topDue.quote.fare)}{topDue.note ? ` — “${topDue.note}”` : ""}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button type="button" onClick={() => snooze(topDue)} className="h-8 px-3 rounded-[10px] text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50">Snooze +15m</button>
                <button type="button" onClick={() => bookFromFollowUp(topDue)} className="h-8 px-3.5 rounded-[10px] text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5"><Icon name="check" size={14} />Book</button>
              </div>
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <TripForm trip={trip} set={set} data={data} tabs={tabs} notice={notice} busy={busy} stale={stale} swapping={swapping}
            onTab={pickTab} onPickPoint={pickPoint} onSwap={swap} onPin={setPinFor} onRental={() => setRentalOpen(true)} onClear={clear} onSubmit={getFare} />
          <FareResults view={fareView} extras={extras} categories={data.categories} canBook sourceName={DESK_BRANDS[quote?.brand ?? brand].name}
            onFuel={(f) => changeExtras({ fuel: f ?? undefined })}
            onAddOn={(k) => changeExtras(k === "pets" ? { pets: !trip.pets } : { carrier: !trip.carrier })}
            onFollowUp={(line) => quote && setFuTarget({ line, trip: snapshotFor(quote) })}
            onBook={(line) => quote && openBook({ line, trip: snapshotFor(quote), followUp: null, quickTrip: quote.trip, estimates: quote.estimates })}
            onCopy={copyQuote}
            onManual={(line, km) => quote && setQuote({ ...quote, lines: [line], roadKm: km, roadMinutes: null })} />
        </div>

        <FollowUpQueue rows={rows} nowMs={nowMs} filter={filter} onFilter={setFilter} counts={counts} revealed={revealed} canBook
          onReveal={setRevealTarget}
          onHide={(f) => setRevealed((r) => { const n = { ...r }; delete n[f.id]; return n; })}
          onSnooze={snooze}
          onLost={setLostTarget}
          onBook={bookFromFollowUp} />

        <RevealHistory rows={desk.reveals} />
      </main>

      {pinFor && (
        <LocationPinDialog side={pinFor} context="Quick Fare & Enquiry Desk" value={pinFor === "pickup" ? trip.pickup : trip.drop} startNear={pinFor === "drop" ? trip.pickup : null}
          onChange={(p) => pickPoint(pinFor, p, p?.name || p?.address || (pinFor === "pickup" ? trip.pickupText : trip.dropText))} onClose={() => setPinFor(null)} />
      )}

      {fuTarget && (
        <FollowUpDialog route={fuTarget.trip.route} line={fuTarget.line} sourceName={DESK_BRANDS[fuTarget.trip.source].name} extras={deskExtrasLabel(fuTarget.trip)} customers={customerRows}
          onSave={saveFollowUp} onClose={() => setFuTarget(null)} />
      )}

      {bookTarget && (
        <BookingDraftDialog trip={bookTarget.trip} line={bookTarget.line} sourceName={DESK_BRANDS[bookTarget.trip.source].name} customers={customerRows}
          initial={bookTarget.followUp ? { mobile: bookTarget.followUp.mobile, name: bookTarget.followUp.name } : undefined}
          pay={pay}
          onSave={(v) => desk.createDraft({ ...v, trip: bookTarget.trip, quote: bookTarget.line, followUpId: bookTarget.followUp?.id ?? null })}
          onContinue={onNewBooking && bookTarget.quickTrip ? () => {
            const t = bookTarget;
            setBookTarget(null);
            onNewBooking({ trip: t.quickTrip!, categoryId: t.line.categoryId, estimates: t.estimates ?? undefined, channel: t.trip.source });
          } : undefined}
          onClose={() => setBookTarget(null)} />
      )}

      {revealTarget && (
        <RevealDialog caller={`${revealTarget.name || "Caller"} · ${maskPhone(revealTarget.mobile)}`} onClose={() => setRevealTarget(null)}
          onReveal={(category, note) => {
            const f = revealTarget;
            setRevealed((r) => ({ ...r, [f.id]: true }));
            desk.addReveal({ staff: staffName(), caller: `${f.name || "Caller"} (${maskPhone(f.mobile)})`, reason: `${category} — ${note}` });
            setRevealTarget(null);
            showToast("Number shown and added to this session's history");
          }} />
      )}

      {lostTarget && (
        <LostDialog caller={`${lostTarget.name || "Caller"} · ${lostTarget.trip.route}`} onClose={() => setLostTarget(null)}
          onSave={(reason) => { const ok = desk.markLost(lostTarget.id, reason); setLostTarget(null); if (ok) showToast(`Marked as lost · ${reason}`); }} />
      )}

      {rentalOpen && <RentalDialog hours={trip.rentalHours ?? 1} onPick={(h) => { set({ rentalHours: h }); setRentalOpen(false); }} onClose={() => setRentalOpen(false)} />}

      {toast && (
        <div role={toast.tone === "error" ? "alert" : "status"} className={`fixed bottom-5 right-5 left-5 sm:left-auto z-50 sm:max-w-sm px-4 py-3 rounded-xl shadow-xl text-xs font-semibold flex items-center gap-2.5 fade-slide-in ${toast.tone === "error" ? "bg-red-700 text-white" : "bg-slate-900 text-white"}`}>
          <Icon name={toast.tone === "error" ? "circle-alert" : "check"} size={16} className="shrink-0" /><span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
