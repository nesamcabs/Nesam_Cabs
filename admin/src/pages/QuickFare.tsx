import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { BellRing, Calculator, CircleAlert } from "lucide-react";
import "../styles/quickFareDesk.css";
import {
  DESK_BRANDS,
  DESK_TABS,
  addOnRateLabel,
  buildQueue,
  clock12,
  coverageNote,
  coverageOf,
  ddmmyyyy,
  deskAddOnLabels,
  deskExtrasLabel,
  deskFuelLabel,
  deskKeyOf,
  fareEstimateText,
  formatINR,
  normalizeBrand,
  openDuplicateOf,
  scheduleLabel,
  slabLabelOf,
  type DeskBrand,
  type DeskQueueRow,
  type DeskQuoteLine,
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
  type QuickTrip,
  type CategoryEstimate,
} from "../components/booking/QuickFare";
import { useCustomers } from "../hooks/useOfficeData";
import { useNow } from "../hooks/useNow";
import { useQuickFareDesk } from "../hooks/useQuickFareDesk";
import { useNotifications } from "../components/NotificationHost";
import { useCanDo, useStaffFlag } from "../components/AccessContext";
import { copyText } from "../services/customerDirectoryService";
import type { NewBookingDraft } from "./NewBooking";
import type { PickedPoint } from "../components/MapLocationPicker";
import { SERVICE_KEY, TAB_TRIP, activeTrip, deskTabOf, lineOfEstimate, pricingOf, quickTripOfRecord, quoteKeyOf, routeOf, snapshotOf } from "../components/quickFareDesk/deskTrip";
import TripForm from "../components/quickFareDesk/TripForm";
import FareResults, { type FareExtras, type FareView } from "../components/quickFareDesk/FareResults";
import { AlertPill, DueBanner, SourceSwitcher } from "../components/quickFareDesk/DeskHeader";
import { FollowUpQueue, NumberViewLog } from "../components/quickFareDesk/FollowUpQueue";
import FollowUpDialog, { type FollowUpSubmit } from "../components/quickFareDesk/FollowUpDialog";
import ConfirmBookingDialog, { type BookTarget, type BookedResult } from "../components/quickFareDesk/ConfirmBookingDialog";
import { LostDialog, RentalDialog, RevealDialog } from "../components/quickFareDesk/SmallDialogs";
import MapPickerDialog from "../components/quickFareDesk/MapPickerDialog";

interface QuickFareProps {
  onNewBooking?: (draft: NewBookingDraft) => void;
  onEnquirySaved?: () => void;
  onNavigate?: (page: string, tab?: string) => void;
  /** Kept for the App route contract. */
  onSelectBooking?: (bookingId: string) => void;
}

/** The trip that was priced, with its results. Every action uses this snapshot, never the live form. */
interface Quote {
  key: string;
  trip: QuickTrip;
  brand: DeskBrand;
  estimates: CategoryEstimate[] | null;
  lines: DeskQuoteLine[];
  unpriced: { vehicle: string; reason: string }[];
  roadKm: number | null;
  roadMinutes: number | null;
  /** Set when no server price exists for this trip (a typed draft quote is offered). */
  unavailable: string | null;
}

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
const duration = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

/** Desk wording for missing places; every other rule is the shared booking validation. */
function deskProblem(t: QuickTrip): string | null {
  if (!t.pickup) return t.pickupText.trim() ? "Choose the pickup from the suggestions or set it on the map." : "Please enter a pickup location.";
  if (t.tripType !== "Local Rental" && !t.drop) return t.dropText.trim() ? "Choose the drop from the suggestions or set it on the map." : "Please enter a drop location.";
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
    osc.onended = () => { void ctx.close(); };
  } catch {
    // Audio blocked: the banner and the toast still show.
  }
}

export default function QuickFare({ onNewBooking }: QuickFareProps) {
  const data = useQuickData();
  const customers = useCustomers();
  const customerRows = customers.rows ?? [];
  // The 15 s tick moves follow-ups from Upcoming to Due; status is always read against the real current time.
  useNow(15000);
  const nowMs = Date.now();
  const desk = useQuickFareDesk();
  const { soundOn } = useNotifications();
  // The server's rule for a number reveal (functions/src/customerDirectory.ts viewerOf): it checks again on every reveal.
  const canViewCustomers = useCanDo("Customers", "view");
  const canTemporarilyReveal = useStaffFlag("privacy", "temporaryReveal");
  const canReveal = canViewCustomers && canTemporarilyReveal;
  const canBook = !!onNewBooking;

  // ── The enquiry being quoted ──
  const [brand, setBrand] = useState<DeskBrand>("nesam");
  const [trip, setTrip] = useState<QuickTrip>(emptyTrip);
  const [notice, setNotice] = useState<string | null>(null);
  const set = (patch: Partial<QuickTrip>) => { setTrip((t) => ({ ...t, ...patch })); setNotice(null); };
  const [swapping, setSwapping] = useState(false);
  const [pinFor, setPinFor] = useState<"pickup" | "drop" | null>(null);
  const [rentalOpen, setRentalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const currentKey = quoteKeyOf(trip, brand);
  const stale = !!quote && quote.key !== currentKey;

  // ── Queue and dialogs ──
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const revealTimers = useRef<number[]>([]);
  const [working, setWorking] = useState<ReadonlySet<string>>(() => new Set());
  const [fuTarget, setFuTarget] = useState<{ line: DeskQuoteLine; quote: Quote } | null>(null);
  const [bookTarget, setBookTarget] = useState<(BookTarget & { estimates: CategoryEstimate[] | null }) | null>(null);
  const [revealTarget, setRevealTarget] = useState<DeskQueueRow | null>(null);
  const [lostTarget, setLostTarget] = useState<DeskQueueRow | null>(null);

  const [toast, setToast] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = (text: string, tone: "info" | "error" = "info") => {
    setToast({ text, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), tone === "error" ? 6000 : 3500);
  };
  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    revealTimers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  // Sound may play only after the person has used the page (browser autoplay rules).
  const audioOk = useRef(false);
  useEffect(() => {
    const unlock = () => { audioOk.current = true; };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => { document.removeEventListener("pointerdown", unlock); document.removeEventListener("keydown", unlock); };
  }, []);

  // ── Follow-up queue: the office's enquiries, read on the India clock ──
  const queue = useMemo(() => buildQueue(desk.enquiries ?? [], nowMs), [desk.enquiries, nowMs]);
  const topDue = queue.rows.find((r) => r.status === "due") ?? null;

  // A follow-up that becomes due while the desk is open alerts once: a beep (when sound is on) and a toast.
  const alerted = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (desk.enquiries === null) return;
    const due = queue.rows.filter((r) => r.status === "due");
    const keys = due.map((r) => `${r.id}:${r.followUpAtMs}`);
    if (alerted.current === null) { alerted.current = new Set(keys); return; }
    const fresh = due.filter((r) => !alerted.current!.has(`${r.id}:${r.followUpAtMs}`));
    keys.forEach((k) => alerted.current!.add(k));
    if (!fresh.length) return;
    if (soundOn && audioOk.current) playBeep();
    const f = fresh[0];
    showToast(`Follow-up Alert: Call ${f.name || "Enquiry Caller"}${f.masked ? ` (${f.masked})` : ""} for ${f.route}`);
  }, [queue, desk.enquiries]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Trip form ──
  const tabs = DESK_TABS.filter((t) => tripServiceOffered(SERVICE_KEY[t], data, SERVICE_KEY[deskTabOf(trip)]));
  const pickTab = (tab: (typeof DESK_TABS)[number]) => {
    const def = TAB_TRIP[tab];
    setTrip((t) => {
      const sameKind = t.tripType === "Round Trip" && !!t.multicity === !!def.multicity;
      const stops = def.tripType !== "Round Trip" ? [] : sameKind ? t.stops ?? [] : def.multicity ? [{ text: "", point: null }] : [];
      return { ...t, serviceId: "", multicity: !!def.multicity, local: !!def.local, ...withTripType(t, def.tripType), stops };
    });
    setNotice(null);
  };
  const pickPoint = (side: "pickup" | "drop", p: PickedPoint | null, text: string) => {
    setTrip((t) => ({ ...t, ...(side === "pickup" ? withPickup(t, p, text) : { drop: p, dropText: text }) }));
    setNotice(null);
  };
  const swap = () => {
    setSwapping(false);
    window.requestAnimationFrame(() => setSwapping(true));
    window.setTimeout(() => setSwapping(false), 400);
    setTrip((t) => ({
      ...t, pickup: t.drop, pickupText: t.dropText, drop: t.pickup, dropText: t.pickupText,
      ...(t.tripType === "Airport Taxi" ? { airportDirection: t.airportDirection === "to" ? ("from" as const) : ("to" as const) } : {}),
    }));
  };
  const clear = () => { quoteSeq.current++; setBusy(false); setTrip(emptyTrip()); setQuote(null); setNotice(null); };

  const quoteSeq = useRef(0);
  /** Prices `t` for every vehicle category with the server's fare settings; a newer request replaces an older one. */
  const runQuote = async (t: QuickTrip, b: DeskBrand) => {
    const snapshot = activeTrip(t);
    const problem = deskProblem(snapshot);
    if (problem) {
      setNotice(problem);
      const fields = document.querySelectorAll<HTMLInputElement>("[data-place-field] input");
      (!snapshot.pickup ? fields[0] : snapshot.tripType !== "Local Rental" && !snapshot.drop ? fields[fields.length - 1] : null)?.focus();
      return;
    }
    setNotice(null);
    const seq = ++quoteSeq.current;
    const base = { key: quoteKeyOf(t, b), trip: snapshot, brand: b, roadKm: null, roadMinutes: null, unpriced: [] as Quote["unpriced"] };
    if (!data.categories.length) {
      setQuote({ ...base, estimates: null, lines: [], unavailable: "No vehicle categories are set up, so no fare could be priced. You can enter a draft quote." });
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
        ...base, estimates: priced, lines, unpriced: lines.length ? unpriced : [],
        roadKm: road?.roadKm ? Math.round(road.roadKm) : null, roadMinutes: road?.roadMinutes ? Math.round(road.roadMinutes) : null,
        unavailable: lines.length ? null : `The fare settings could not price this trip${priced[0]?.error ? ` (${priced[0].error})` : ""}. You can enter a draft quote.`,
      });
    } catch (err) {
      if (seq !== quoteSeq.current) return;
      setQuote({ ...base, estimates: null, lines: [], unavailable: `Fares are unavailable right now (${errText(err, "pricing service not reachable")}). You can enter a draft quote.` });
    } finally {
      if (seq === quoteSeq.current) setBusy(false);
    }
  };
  const getFare = (e: FormEvent) => {
    e.preventDefault();
    void runQuote(trip, brand);
  };
  // With fares on screen, a change to the trip, fuel, add-ons or source re-prices once the trip is complete (as the
  // reference desk recalculates). An incomplete trip keeps the old fares marked out of date and unusable.
  useEffect(() => {
    if (!quote || quote.key === currentKey || deskProblem(activeTrip(trip))) return undefined;
    const t = window.setTimeout(() => void runQuote(trip, brand), 350);
    return () => window.clearTimeout(t);
  }, [currentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fuel bar and add-ons: priced by the server (CNG rate card, pet and roof-carrier charges) ──
  const pricedRates = quote?.estimates ?? [];
  const extras: FareExtras = {
    fuel: trip.fuel === "cng" ? "cng" : null,
    addOns: { pets: trip.pets === true, carrier: trip.carrier === true },
    petRate: addOnRateLabel(pricedRates.map((e) => e.quote?.addOnRates?.petCharge)),
    carrierRate: addOnRateLabel(pricedRates.map((e) => e.quote?.addOnRates?.carrierCharge)),
    cngOffered: data.categories.some((c) => c.cngEnabled === true),
  };

  // ── What the fares card shows, all from the quoted snapshot ──
  const firstPriced = quote?.estimates?.find((e) => e.quote)?.quote ?? null;
  const manual = !!quote?.lines.some((l) => l.manual);
  const qTab = quote ? deskTabOf(quote.trip) : "One Way";
  const rentalKm = quote && quote.trip.tripType === "Local Rental" && quote.lines[0]?.includedKm ? `${quote.lines[0].includedKm} km` : null;
  const coverage = coverageOf(firstPriced?.breakup?.lines);
  const fareView: FareView = {
    busy,
    quoted: !!quote,
    lines: quote?.lines ?? [],
    unpriced: quote?.unpriced ?? [],
    stale,
    route: quote ? routeOf(quote.trip) : "",
    date: quote ? ddmmyyyy(quote.trip.date) : "",
    time: quote ? clock12(quote.trip.time) : "",
    distance: !quote ? "" : quote.trip.tripType === "Local Rental"
      ? (rentalKm ? `${quote.trip.rentalHours ?? 1}h / ${rentalKm}` : `${quote.trip.rentalHours ?? 1}h`)
      : quote.roadKm ? `${manual ? "" : "Est. "}${quote.roadKm} km${quote.roadMinutes ? ` • ~${duration(quote.roadMinutes)}` : ""}${manual ? " (entered)" : ""}` : "",
    config: quote && quote.lines.length && !manual ? { fuel: deskFuelLabel(quote.trip.fuel === "cng" ? "cng" : null), addOns: deskAddOnLabels({ pets: quote.trip.pets === true, carrier: quote.trip.carrier === true }) } : null,
    slab: quote && !manual ? slabLabelOf(qTab, pricingOf(firstPriced), quote.trip.tripType === "Round Trip" && !quote.trip.multicity ? quote.trip.days : null, quote.trip.tripType === "Local Rental" ? quote.trip.rentalHours ?? 1 : null) : "",
    coverage: manual ? "" : coverageNote(coverage),
    unavailable: quote?.unavailable ?? null,
  };

  const copyQuote = async () => {
    if (!quote?.lines.length) return false;
    return copyText(fareEstimateText({
      brandName: DESK_BRANDS[quote.brand].name, route: routeOf(quote.trip), date: ddmmyyyy(quote.trip.date), time: clock12(quote.trip.time),
      fuel: quote.trip.fuel === "cng" ? "cng" : null,
      addOns: manual ? [] : deskAddOnLabels({ pets: quote.trip.pets === true, carrier: quote.trip.carrier === true }),
      lines: quote.lines, coverage: manual ? { includes: [], excludes: [] } : coverage,
    }));
  };

  // ── Follow-ups ──
  const fuSnapshot = fuTarget ? snapshotOf(fuTarget.quote.trip, fuTarget.quote.brand, fuTarget.quote.roadKm) : null;
  const saveFollowUp = async (v: FollowUpSubmit) => {
    if (!fuTarget || !fuSnapshot) return;
    const res = await desk.saveFollowUp({
      ...v,
      trip: fuTarget.quote.trip,
      snapshot: fuSnapshot,
      line: fuTarget.line,
      estimate: fuTarget.quote.estimates?.find((e) => e.category.id === fuTarget.line.categoryId && e.quote) ?? null,
    });
    setFuTarget(null);
    const dueNow = v.followUpAtMs <= Date.now() + 5000;
    // A follow-up saved as already due is confirmed by this toast; the due alert is for callbacks that fall due later.
    if (dueNow) alerted.current?.add(`${res.code}:${v.followUpAtMs}`);
    const when = dueNow ? "Follow-up Alert triggered immediately!" : `Follow-up scheduled for ${scheduleLabel(v.followUpAtMs)}`;
    showToast(res.kind === "updated" ? `${when} (updated ${res.code})` : `${when} (${res.code})`);
  };

  const busyFor = (id: string, on: boolean) => setWorking((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const snooze = async (r: DeskQueueRow, from: "banner" | "queue") => {
    if (working.has(r.id)) return;
    busyFor(r.id, true);
    try {
      await desk.snooze(r.id);
      showToast(from === "banner" ? `Alert snoozed for 15 mins (${r.name || "Enquiry Caller"})` : `Follow-up snoozed +15m for ${r.name || "Enquiry Caller"}`);
    } catch (e) {
      showToast(`Snooze failed: ${errText(e, "try again")}`, "error");
    } finally {
      busyFor(r.id, false);
    }
  };
  const scrollToQueue = () => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("followUpQueueSection")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  /** "Fare OK • Book" on a saved follow-up: its own trip, source and quoted vehicle — never the live calculator. */
  const bookFromRow = (r: DeskQueueRow) => {
    const e = desk.byId(r.id);
    if (!e) return;
    const qt = quickTripOfRecord(e.deskTrip);
    const q = e.deskQuote;
    const source = normalizeBrand(e.brand);
    if (qt && q && !q.manual && q.categoryId && typeof q.fare === "number" && q.fare > 0) {
      const line: DeskQuoteLine = { categoryId: q.categoryId, vehicle: q.vehicle || e.vehicle || "Vehicle", classBadge: q.classBadge || "", seats: q.seats || "", bags: q.bags || "", fare: q.fare, rateNote: q.rateNote || "", includedKm: q.includedKm ?? null, manual: false };
      const t = activeTrip(qt);
      setBookTarget({ trip: t, snapshot: snapshotOf(t, source, null), line, estimates: null, enquiry: { id: e.id, code: e.code, phone: e.phone || "", name: e.customerName || "", customerId: e.customerId ?? null } });
      return;
    }
    if (qt) {
      // A typed draft quote has no server price to book on: the trip is priced again in the calculator.
      setBrand(source);
      setTrip(qt);
      void runQuote(qt, source);
      window.scrollTo({ top: 0, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      showToast("Draft quote loaded into the calculator. Book from the server fare once it shows.");
      return;
    }
    // Saved on another screen: the office's existing conversion (New booking with this enquiry).
    onNewBooking?.({ enquiry: e, categoryId: e.categoryId || "", channel: source });
  };

  const onBooked = async (res: BookedResult): Promise<string | null> => {
    const t = bookTarget;
    if (!t) return null;
    const target = t.enquiry ? desk.byId(t.enquiry.id) : openDuplicateOf(desk.enquiries ?? [], deskKeyOf(res.digits, t.snapshot), Date.now());
    let warning: string | null = null;
    if (target) {
      try { await desk.markConverted(target.id, res.bookingId); }
      catch (e) { warning = `Booking created, but enquiry ${target.code} could not be marked converted (${errText(e, "try again")}). Mark it in Bookings › Enquiries & quotes.`; }
    }
    showToast(`Booking ${res.bookingId} created`);
    return warning;
  };

  const caller = (r: DeskQueueRow) => r.name || "Enquiry Caller";
  return (
    <div className="qfd-root w-full min-h-full bg-[#F8FAFC] text-slate-900">
      <main className="max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-6 space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-crimson-50 border border-crimson-100 text-[#991B1B] flex items-center justify-center shrink-0" aria-hidden="true">
              <Calculator className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">Quick Fare &amp; Enquiry Desk</h1>
              <p className="text-xs text-slate-500 truncate">Check instant rates for callers, toggle CNG/Diesel &amp; add-ons, or confirm booking in 1 click</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <AlertPill due={queue.counts.due} onClick={scrollToQueue} />
            <SourceSwitcher brand={brand} onChange={setBrand} />
          </div>
        </header>

        {topDue && (
          <DueBanner row={topDue} phone={revealed[topDue.id] ?? null} busy={working.has(topDue.id)} canBook={canBook}
            onSnooze={() => void snooze(topDue, "banner")} onBook={() => bookFromRow(topDue)} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <TripForm trip={trip} set={set} data={data} tabs={tabs} notice={notice} busy={busy} swapping={swapping} nowMs={nowMs}
            rentalKm={!stale ? rentalKm : null}
            onTab={pickTab} onPickPoint={pickPoint} onSwap={swap} onPin={setPinFor} onRental={() => setRentalOpen(true)} onClear={clear} onSubmit={getFare} />
          <FareResults view={fareView} extras={extras} categories={data.categories} canBook={canBook}
            onFuel={(f) => set({ fuel: f ?? undefined })}
            onAddOn={(k) => set(k === "pets" ? { pets: !trip.pets } : { carrier: !trip.carrier })}
            onFollowUp={(line) => quote && !stale && setFuTarget({ line, quote })}
            onBook={(line) => {
              if (!quote || stale || line.manual) return;
              const s = snapshotOf(quote.trip, quote.brand, quote.roadKm);
              setBookTarget({ trip: quote.trip, snapshot: s, line, estimates: quote.estimates, enquiry: null });
            }}
            onCopy={copyQuote}
            onManual={(line, km) => quote && setQuote({ ...quote, lines: [line], unpriced: [], roadKm: km, roadMinutes: null })} />
        </div>

        <FollowUpQueue rows={queue.rows} filter={filter} onFilter={setFilter} nowMs={nowMs} loading={desk.enquiries === null} error={desk.loadError}
          revealed={revealed} canReveal={canReveal} canBook={canBook} busy={working}
          onReveal={setRevealTarget} onSnooze={(r) => void snooze(r, "queue")} onLost={setLostTarget} onBook={bookFromRow} />

        <NumberViewLog rows={desk.views.rows} scope={desk.views.scope} loading={desk.views.loading} error={desk.views.error} nowMs={nowMs} onRetry={() => void desk.reloadViews()} />
      </main>

      {pinFor && (
        <MapPickerDialog side={pinFor} value={pinFor === "pickup" ? trip.pickup : trip.drop} startNear={pinFor === "drop" ? trip.pickup : null}
          saved={pinFor === "pickup" ? data.pickups : data.drops}
          onChange={(p) => pickPoint(pinFor, p, p?.name || p?.address || "")} onClose={() => setPinFor(null)} />
      )}

      {rentalOpen && <RentalDialog hours={trip.rentalHours ?? 1} onPick={(h) => { set({ rentalHours: h }); setRentalOpen(false); }} onClose={() => setRentalOpen(false)} />}

      {fuTarget && fuSnapshot && (
        <FollowUpDialog customers={customerRows} onSave={saveFollowUp} onClose={() => setFuTarget(null)}
          summary={`${fuSnapshot.route} • ${fuTarget.line.classBadge || fuTarget.line.vehicle} (${fuTarget.line.manual ? "Draft quote" : deskExtrasLabel(fuSnapshot)}) • ${formatINR(fuTarget.line.fare)}`} />
      )}

      {bookTarget && (
        <ConfirmBookingDialog target={bookTarget} customers={customerRows} onBooked={onBooked} onClose={() => setBookTarget(null)}
          onFullForm={onNewBooking ? () => {
            const t = bookTarget;
            setBookTarget(null);
            const enquiry = t.enquiry ? desk.byId(t.enquiry.id) ?? undefined : undefined;
            onNewBooking({ trip: t.trip, categoryId: t.line.categoryId, estimates: t.estimates ?? undefined, channel: t.snapshot.source, ...(enquiry ? { enquiry } : {}) });
          } : undefined} />
      )}

      {revealTarget && (
        <RevealDialog caller={`${caller(revealTarget)} (${revealTarget.code}) • Reason logged to Master Admin`} onClose={() => setRevealTarget(null)}
          onReveal={async (category, note) => {
            const r = revealTarget;
            const res = await desk.reveal(r.id, category, note);
            setRevealed((m) => ({ ...m, [r.id]: res.phone }));
            const secs = Math.max(10, Number(res.revealSeconds) || 60);
            revealTimers.current.push(window.setTimeout(() => setRevealed((m) => { const n = { ...m }; delete n[r.id]; return n; }), secs * 1000));
            setRevealTarget(null);
            showToast(`Caller number revealed & logged (${caller(r)}) — hidden again in ${secs}s`);
          }} />
      )}

      {lostTarget && (
        <LostDialog caller={`${caller(lostTarget)} • ${lostTarget.route}`} onClose={() => setLostTarget(null)}
          onSave={async (reason) => {
            const r = lostTarget;
            const res = await desk.markLost(r.id, reason);
            setLostTarget(null);
            showToast(res.converted ? `Not changed: ${caller(r)} was already converted to booking ${res.bookingId ?? ""}`.trim() : `Marked ${caller(r)} as Lost (${reason})`);
          }} />
      )}

      {toast && (
        <div role={toast.tone === "error" ? "alert" : "status"}
          className={`fixed bottom-5 right-5 left-5 sm:left-auto z-50 sm:max-w-sm px-4 py-3 rounded-xl shadow-xl text-xs font-medium flex items-center gap-2.5 fade-slide-in text-white ${toast.tone === "error" ? "bg-red-700" : "bg-slate-900"}`}>
          {toast.tone === "error" ? <CircleAlert className="w-4 h-4 shrink-0" aria-hidden="true" /> : <BellRing className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />}
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
