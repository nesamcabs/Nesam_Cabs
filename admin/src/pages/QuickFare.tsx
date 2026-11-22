import { useState, useEffect, useRef, useMemo, type FormEvent } from "react";
import { Timestamp } from "firebase/firestore";
import Icon from "../components/ui/Icon";
import "../styles/quickFareDesk.css";
import {
  type DeskBrand,
  DESK_BRANDS,
  DESK_BRAND_LIST,
  TRIP_SERVICES,
  QUEUE_FILTERS,
  LOST_REASONS,
  REVEAL_CATEGORIES,
  type DeskTripServiceKey,
  type QueueFilter,
  type LostReason,
  formatINR,
  maskPhone,
  phoneDigits,
  formatDuration,
  formatWhatsAppQuote,
  deskFilterOf,
  dueLabelOf,
  isFollowUpDue,
} from "../domain/quickFareDesk";
import {
  useQuickData,
  estimateAll,
  emptyTrip,
  validateTrip,
  withPickup,
  withTripType,
  airportSide,
  tripServiceOffered,
  tripPickupDate,
  roundStopPoints,
  breakupLines,
  estimateFacts,
  PlaceField,
  LocationPinDialog,
  type QuickTrip,
  type CategoryEstimate,
} from "../components/booking/QuickFare";
import {
  subscribeEnquiries,
  saveEnquiry,
  snoozeEnquiry,
  markEnquiryLost,
  revealEnquiryNumber,
  currentStaff,
  type Enquiry,
} from "../services/enquiryService";
import { useCustomers } from "../hooks/useOfficeData";
import { useNow } from "../hooks/useNow";
import { addDaysISO, dayOffsetIST, formatDate, formatDateTime12, formatTime12, isoDateIST, ROUND_TRIP_MAX_DAYS } from "../utils/time";
import type { NewBookingDraft } from "./NewBooking";
import type { PickedPoint } from "../components/MapLocationPicker";

interface QuickFareProps {
  onNewBooking?: (draft: NewBookingDraft) => void;
  onEnquirySaved?: () => void;
  onNavigate?: (page: string, tab?: string) => void;
  /** Kept for the App route contract; bookings are created and opened by the New booking flow. */
  onSelectBooking?: (bookingId: string) => void;
}

/** One follow-up row, read from a saved enquiry. Missing values stay missing (never defaulted). */
interface FollowUpItem {
  id: string;
  enquiry: Enquiry;
  name: string;
  phone: string;
  brand: string;
  route: string;
  pickupLabel: string;
  vehicleName: string;
  fare: number | null;
  note: string;
  status: QueueFilter;
  dueLabel: string;
  dueMs: number | null;
}

interface RevealLog {
  id: string;
  staff: string;
  caller: string;
  reason: string;
  time: string;
}

const QUEUE_LIMIT = 50;
const IST_OFFSET = "+05:30";

/** "HH:mm" of an instant on the India clock. */
const hhmmIST = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
/** "YYYY-MM-DD" + "HH:mm" read as India time → instant. */
const istInstant = (date: string, time: string) => new Date(`${date}T${time || "09:00"}:00${IST_OFFSET}`);
const time12 = (hhmm: string) => (hhmm ? formatTime12(istInstant(isoDateIST(new Date()), hhmm)) : "");

/** Desk tab ↔ the trip it books. Tabs follow the desk's labels; pricing follows the trip fields. */
const DESK_SERVICE_RECORD: Record<DeskTripServiceKey, string> = {
  "One Way": "One Way",
  "Round Trip": "Round Trip",
  Multicity: "Multicity",
  Airport: "Airport Taxi",
  Rental: "Local Rental",
  Local: "Pickup & Drop",
};
const deskTabOf = (t: QuickTrip): DeskTripServiceKey =>
  t.multicity ? "Multicity" : t.local ? "Local" : t.tripType === "Airport Taxi" ? "Airport" : t.tripType === "Local Rental" ? "Rental" : t.tripType === "Round Trip" ? "Round Trip" : "One Way";

const brandIdOf = (name?: string): DeskBrand | undefined => DESK_BRAND_LIST.find((k) => DESK_BRANDS[k].name === name);

/** A stable key for "the trip that was priced", so results never outlive the trip they were quoted for. */
const quoteKeyOf = (t: QuickTrip, brand: DeskBrand) =>
  JSON.stringify([brand, t.tripType, t.multicity, t.local, t.serviceId, t.airportDirection, t.pickup?.lat, t.pickup?.lng, t.drop?.lat, t.drop?.lng,
    (t.stops ?? []).map((s) => [s.point?.lat, s.point?.lng]), t.date, t.time, t.days, t.rentalHours]);

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function playAlertBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // browser auto-play policy guard
  }
}

function followUpOf(e: Enquiry, nowMs: number): FollowUpItem {
  const stops = (e.stops?.length ? e.stops : e.roundStops ?? []).map((s) => s.name || s.address).filter(Boolean);
  const pickup = e.pickupPoint?.name || e.pickup || "";
  const drop = e.dropPoint?.name || e.drop || "";
  const route = pickup && drop ? [pickup, ...stops, drop].join(" → ") : pickup || drop || "Route not recorded";
  const pickupAt = e.pickupAt?.toDate?.();
  return {
    id: e.id,
    enquiry: e,
    name: e.customerName?.trim() || "Caller (name not given)",
    phone: phoneDigits(e.phone),
    brand: e.brand || "",
    route,
    pickupLabel: pickupAt ? formatDateTime12(pickupAt) : "Pickup time not set",
    vehicleName: e.vehicle || "Vehicle not chosen",
    fare: typeof e.estimate === "number" && e.estimate > 0 ? e.estimate : null,
    note: e.note?.trim() || "",
    status: deskFilterOf(e, nowMs),
    dueLabel: dueLabelOf(e, nowMs),
    dueMs: e.followUpAt?.toMillis?.() ?? e.due?.toMillis?.() ?? null,
  };
}

const STATUS_ORDER: Record<QueueFilter, number> = { due: 0, upcoming: 1, all: 2, booked: 3, lost: 4 };

export default function QuickFare({ onNewBooking, onEnquirySaved, onNavigate }: QuickFareProps) {
  const data = useQuickData();
  const customers = useCustomers();
  const now = useNow(15000);

  // 1. Desk Brand State
  const [brand, setBrand] = useState<DeskBrand>("nesam");
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const brandSwitcherRef = useRef<HTMLDivElement>(null);

  // 2. Trip being quoted: the same trip model New booking uses (chosen places carry coordinates).
  const [trip, setTrip] = useState<QuickTrip>(emptyTrip);
  const set = (patch: Partial<QuickTrip>) => setTrip((t) => ({ ...t, ...patch }));
  const [pinFor, setPinFor] = useState<"pickup" | "drop" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [spinSwap, setSpinSwap] = useState(false);
  const deskTab = deskTabOf(trip);

  // 3. Server estimates for the priced trip
  const [estimates, setEstimates] = useState<CategoryEstimate[] | null>(null);
  const [quotedKey, setQuotedKey] = useState<string | null>(null);
  const [quotedTrip, setQuotedTrip] = useState<QuickTrip | null>(null);
  const [busyEstimates, setBusyEstimates] = useState<boolean>(false);
  const [copyAllStatus, setCopyAllStatus] = useState<string>("Copy All for WhatsApp");
  const calculated = estimates !== null;
  const stale = calculated && quotedKey !== quoteKeyOf(trip, brand);
  const priced = useMemo(() => (estimates ?? []).filter((e) => e.quote), [estimates]);

  // 4. Follow-Up Queue State (live enquiries)
  const [fuFilter, setFuFilter] = useState<QueueFilter>("all");
  const [enquiries, setEnquiries] = useState<Enquiry[] | null>(null);
  const [enquiryError, setEnquiryError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, { phone: string; until: number }>>({});
  const [revealLogs, setRevealLogs] = useState<RevealLog[]>([]);
  const [busyRow, setBusyRow] = useState<string | null>(null);

  // 5. Toast Notification State
  const [toast, setToast] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);
  const showToast = (text: string, tone: "info" | "error" = "info") => {
    setToast({ text, tone });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => setToast(null), tone === "error" ? 6000 : 3500);
  };

  // 6. Modals State
  // Modal 1: Follow-Up
  const [fuModalOpen, setFuModalOpen] = useState<boolean>(false);
  const [fuCategoryId, setFuCategoryId] = useState<string>("");
  const [fuMobile, setFuMobile] = useState<string>("");
  const [fuName, setFuName] = useState<string>("");
  const [fuScheduleDate, setFuScheduleDate] = useState<string>("");
  const [fuScheduleTime, setFuScheduleTime] = useState<string>("");
  const [fuReminderMins, setFuReminderMins] = useState<number | null>(15);
  const [fuNote, setFuNote] = useState<string>("");
  const [fuBusy, setFuBusy] = useState(false);
  const [fuError, setFuError] = useState<string | null>(null);

  // Modal 3: Rental Duration
  const [rentalModalOpen, setRentalModalOpen] = useState<boolean>(false);

  // Modal 4: Reveal Number
  const [revealModalOpen, setRevealModalOpen] = useState<boolean>(false);
  const [pendingRevealFuId, setPendingRevealFuId] = useState<string | null>(null);
  const [revealCategory, setRevealCategory] = useState<string>("");
  const [revealNote, setRevealNote] = useState<string>("");
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  // Modal 5: Mark Lost
  const [lostModalOpen, setLostModalOpen] = useState<boolean>(false);
  const [pendingLostFuId, setPendingLostFuId] = useState<string | null>(null);
  const [lostReasonSelected, setLostReasonSelected] = useState<LostReason>("Rate too high / Budget issue");
  const [lostBusy, setLostBusy] = useState(false);
  const [lostError, setLostError] = useState<string | null>(null);

  // Close brand dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (brandSwitcherRef.current && !brandSwitcherRef.current.contains(e.target as Node)) {
        setBrandMenuOpen(false);
      }
    };
    document.addEventListener("click", handleOutsideClick);
    return () => document.removeEventListener("click", handleOutsideClick);
  }, []);

  // Live enquiries from Firestore — the only source of the follow-up queue.
  useEffect(() => {
    const unsub = subscribeEnquiries(
      (rows) => {
        setEnquiries(rows);
        setEnquiryError(null);
      },
      (message) => setEnquiryError(message),
    );
    return () => unsub();
  }, []);

  // Follow-up queue, derived from the live rows on the India clock.
  const followUps = useMemo(() => {
    const nowMs = now.getTime();
    return (enquiries ?? [])
      .map((e) => followUpOf(e, nowMs))
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        || (a.status === "due" || a.status === "upcoming" ? (a.dueMs ?? 0) - (b.dueMs ?? 0) : (b.enquiry.createdAt?.toMillis?.() ?? 0) - (a.enquiry.createdAt?.toMillis?.() ?? 0)));
  }, [enquiries, now]);

  // Alert once when a saved follow-up becomes due while the desk is open.
  const alerted = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!enquiries) return;
    const nowMs = now.getTime();
    const dueIds = enquiries.filter((e) => isFollowUpDue(e, nowMs)).map((e) => e.id);
    if (alerted.current === null) {
      alerted.current = new Set(dueIds); // already due when the desk opened: shown, not re-announced
      return;
    }
    const fresh = dueIds.filter((id) => !alerted.current!.has(id));
    fresh.forEach((id) => alerted.current!.add(id));
    if (fresh.length) {
      const first = followUps.find((f) => f.id === fresh[0]);
      playAlertBeep();
      if (first) showToast(`Follow-up due: call ${first.name} (${maskPhone(first.phone)}) for ${first.route}`);
    }
  }, [enquiries, now]); // eslint-disable-line react-hooks/exhaustive-deps

  // Revealed numbers hide again when the server's reveal window ends.
  useEffect(() => {
    const nowMs = now.getTime();
    if (Object.values(revealed).some((r) => r.until <= nowMs)) {
      setRevealed((prev) => Object.fromEntries(Object.entries(prev).filter(([, r]) => r.until > nowMs)));
    }
  }, [now, revealed]);

  // Pickup date display (India calendar) and Today / Tomorrow badge
  const todayIST = isoDateIST(now);
  const { dateDisplayStr, dayBadgeText, dayBadgeClass } = useMemo(() => {
    if (!trip.date) return { dateDisplayStr: "Choose date", dayBadgeText: null, dayBadgeClass: "" };
    const at = istInstant(trip.date, "12:00");
    const offset = dayOffsetIST(at, now);
    if (offset === 0) {
      return { dateDisplayStr: formatDate(at), dayBadgeText: "Today", dayBadgeClass: "px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70" };
    }
    if (offset === 1) {
      return { dateDisplayStr: formatDate(at), dayBadgeText: "Tomorrow", dayBadgeClass: "px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/70" };
    }
    return { dateDisplayStr: formatDate(at), dayBadgeText: null, dayBadgeClass: "" };
  }, [trip.date, now]);

  // Route label of a trip (chosen place names, in order).
  const routeOf = (t: QuickTrip) => {
    const p = t.pickup?.name || t.pickupText.trim();
    const d = t.drop?.name || t.dropText.trim();
    if (t.tripType === "Local Rental") return `Local Rental • ${p}`;
    const stops = (t.stops ?? []).map((s) => s.point?.name || s.text.trim()).filter(Boolean);
    if (t.tripType === "Round Trip" && !t.multicity) return stops.length ? `${p} → ${stops.join(" → ")} → ${d} → ${p}` : `${p} ⇄ ${d}`;
    return stops.length ? `${p} → ${stops.join(" → ")} → ${d}` : `${p} → ${d}`;
  };
  const quotedRoute = quotedTrip ? routeOf(quotedTrip) : "";
  const roadFacts = useMemo(() => {
    const q = priced.find((e) => e.quote?.roadKm)?.quote;
    return q?.roadKm ? { km: Math.round(q.roadKm), minutes: q.roadMinutes ? Math.round(q.roadMinutes) : null } : null;
  }, [priced]);

  // Desk tabs a trip can use (a trip type switched off on the Services page is not offered).
  const deskTabs = TRIP_SERVICES.filter((s) => tripServiceOffered(DESK_SERVICE_RECORD[s.key], data, DESK_SERVICE_RECORD[deskTab]));

  const pickDeskTab = (key: DeskTripServiceKey) => {
    const s = TRIP_SERVICES.find((x) => x.key === key)!;
    const multicity = "multicity" in s && !!s.multicity;
    const local = "local" in s && !!s.local;
    setTrip((t) => {
      const next = { ...t, serviceId: "", multicity, local, ...withTripType(t, s.tripType as QuickTrip["tripType"]) };
      if (multicity && !(next.stops ?? []).length) next.stops = [{ text: "", point: null }];
      if (s.tripType !== "Round Trip") next.stops = [];
      return next;
    });
    setNotice(null);
  };

  const pickPoint = (side: "pickup" | "drop", p: PickedPoint | null, text: string) => {
    setTrip((t) => ({ ...t, ...(side === "pickup" ? withPickup(t, p, text) : { drop: p, dropText: text }) }));
    setNotice(null);
  };

  // Get fare: every bookable vehicle priced by the booking server for this trip and brand.
  const handleCalculate = async (e?: FormEvent) => {
    e?.preventDefault();
    setNotice(null);
    const problem = validateTrip(trip);
    if (problem) {
      setNotice(problem);
      return;
    }
    if (!data.categories.length) {
      setNotice("No bookable vehicle categories are set up yet, so no fare can be quoted. Add them on the Vehicle categories page.");
      return;
    }
    const key = quoteKeyOf(trip, brand);
    const snapshot = trip;
    setBusyEstimates(true);
    try {
      const rows = await estimateAll(snapshot, data.categories, brand);
      setEstimates(rows);
      setQuotedKey(key);
      setQuotedTrip(snapshot);
      if (!rows.some((r) => r.quote)) setNotice(rows[0]?.error || "The pricing server could not price this trip.");
    } catch (err) {
      setEstimates(null);
      setNotice(errorText(err, "The pricing server could not be reached. Check the connection and try again."));
    } finally {
      setBusyEstimates(false);
    }
  };

  // Swap pickup & drop (an airport transfer changes direction with it)
  const handleSwap = () => {
    setSpinSwap(true);
    setTimeout(() => setSpinSwap(false), 350);
    setTrip((t) => ({
      ...t,
      pickup: t.drop, pickupText: t.dropText, drop: t.pickup, dropText: t.pickupText,
      ...(t.tripType === "Airport Taxi" ? { airportDirection: t.airportDirection === "to" ? "from" : "to" } : {}),
    }));
  };

  // Clear Calculator
  const handleClear = () => {
    setTrip((t) => ({ ...emptyTrip(), tripType: t.tripType, multicity: t.multicity, local: t.local, stops: t.multicity ? [{ text: "", point: null }] : [] }));
    setEstimates(null);
    setQuotedKey(null);
    setQuotedTrip(null);
    setNotice(null);
  };

  // Copy every priced fare for WhatsApp
  const handleCopyAllFares = async () => {
    if (!quotedTrip || !priced.length) return;
    const msg = formatWhatsAppQuote({
      brandName: DESK_BRANDS[brand].name,
      route: quotedRoute,
      dateStr: formatDate(istInstant(quotedTrip.date, "12:00")),
      timeStr: time12(quotedTrip.time),
      vehicleLines: priced.map((e) => ({ name: e.category.name, seats: e.category.seatingCapacity, fare: e.quote!.quote.total })),
    });
    try {
      await navigator.clipboard.writeText(msg);
      setCopyAllStatus("Copied for WhatsApp!");
    } catch {
      setCopyAllStatus("Copy failed — try again");
    }
    setTimeout(() => setCopyAllStatus("Copy All for WhatsApp"), 2000);
  };

  // Follow-up schedule presets (India clock)
  const setScheduleIn = (mins: number) => {
    setFuReminderMins(mins);
    const target = new Date(Date.now() + mins * 60000);
    setFuScheduleDate(isoDateIST(target));
    setFuScheduleTime(hhmmIST(target));
  };
  const handleFuTomorrowPreset = (hour24: number, labelText: string) => {
    setFuReminderMins(null);
    setFuScheduleDate(addDaysISO(isoDateIST(new Date()), 1));
    setFuScheduleTime(`${String(hour24).padStart(2, "0")}:00`);
    if (!fuNote.trim()) setFuNote(`Customer said will book ${labelText}`);
  };

  const openFollowUpModal = (categoryId: string) => {
    setFuCategoryId(categoryId);
    setScheduleIn(15);
    setFuMobile("");
    setFuName("");
    setFuNote("");
    setFuError(null);
    setFuModalOpen(true);
  };
  const fuEstimate = priced.find((e) => e.category.id === fuCategoryId) ?? null;

  // Caller lookup against real customer records (only where this account may read them).
  const fuCallerMatch = useMemo(() => {
    const digits = fuMobile.replace(/\D/g, "").slice(0, 10);
    if (digits.length !== 10) return null;
    return (customers.rows ?? []).find((c) => phoneDigits(c.phone) === digits) ?? null;
  }, [fuMobile, customers.rows]);

  // Submit Follow-Up: saved to Firestore first; the queue shows it once the server has it.
  const handleSaveFollowUp = async (e: FormEvent) => {
    e.preventDefault();
    setFuError(null);
    const phone = fuMobile.replace(/\D/g, "").slice(0, 10);
    if (!/^[6-9]\d{9}$/.test(phone)) return setFuError("Enter the caller's 10-digit mobile number.");
    if (!quotedTrip || !fuEstimate?.quote || stale) return setFuError("The trip changed after the fare was quoted. Click Get Fare again, then save the follow-up.");
    if (!fuScheduleDate || !fuScheduleTime) return setFuError("Choose the follow-up date and time.");
    const followUpAt = istInstant(fuScheduleDate, fuScheduleTime);
    if (Number.isNaN(followUpAt.getTime())) return setFuError("Choose a valid follow-up date and time.");

    const q = fuEstimate.quote;
    const t = quotedTrip;
    const multicity = !!t.multicity;
    const stops = roundStopPoints(t).map((p, i) => ({ id: p.placeId ?? `stop-${i + 1}`, name: p.name || p.address, address: p.address, lat: p.lat, lng: p.lng }));
    const pickupAt = tripPickupDate(t);
    setFuBusy(true);
    try {
      const saved = await saveEnquiry({
        brand: DESK_BRANDS[brand].name,
        pickup: t.pickup?.address || t.pickupText,
        drop: t.drop?.address || t.dropText,
        pickupPoint: t.pickup,
        dropPoint: t.drop,
        ...(multicity ? { stops } : { roundStops: stops }),
        pickupAt: pickupAt ? Timestamp.fromDate(pickupAt) : null,
        serviceId: multicity ? "multicity" : t.serviceId,
        service: deskTab,
        tripType: multicity ? "Multicity" : t.tripType === "Airport Taxi" ? "Airport" : t.tripType === "Local Rental" ? "Rental" : t.tripType,
        categoryId: fuEstimate.category.id,
        vehicle: fuEstimate.category.name,
        includedKm: estimateFacts.includedKmOf(q),
        extraKmRate: estimateFacts.extraKmRateOf(q),
        estimate: q.quote.total,
        breakup: breakupLines(q),
        gstRate: q.quote.gstRate ?? 0,
        payout: estimateFacts.partnerPayoutOf(q),
        customerName: fuName.trim() || fuCallerMatch?.name || "",
        phone: `+91${phone}`,
        whatsapp: `+91 ${phone}`,
        followUpAt: Timestamp.fromDate(followUpAt),
        followUpDateTime: formatDateTime12(followUpAt),
        note: fuNote.trim(),
        source: "Phone",
        validUntil: Timestamp.fromDate(new Date(Date.now() + 86400000)),
        handler: null,
        nextAction: "",
        due: null,
        handoverNote: "",
      });
      setFuModalOpen(false);
      if (onEnquirySaved) onEnquirySaved();
      else showToast(`Follow-up ${saved.code} saved for ${formatDateTime12(followUpAt)}`);
    } catch (err) {
      setFuError(errorText(err, "The follow-up was not saved. Check the connection and try again."));
    } finally {
      setFuBusy(false);
    }
  };

  // Book from a priced fare: New booking creates it on the server, with this trip, brand and quote.
  const bookFromEstimate = (categoryId: string) => {
    if (!onNewBooking || !quotedTrip || stale) return;
    onNewBooking({ trip: quotedTrip, categoryId, estimates: estimates ?? undefined, channel: brand });
  };
  // Book a saved follow-up: the same conversion the Enquiries page uses.
  const bookFromEnquiry = (item: FollowUpItem) => {
    if (!onNewBooking) return;
    onNewBooking({ enquiry: item.enquiry, categoryId: item.enquiry.categoryId || "", channel: brandIdOf(item.brand) });
  };

  // Snooze follow-up +15m — the row changes only after Firestore accepts it.
  const handleSnooze = async (item: FollowUpItem) => {
    setBusyRow(item.id);
    try {
      const due = await snoozeEnquiry(item.id, 15);
      showToast(`Follow-up for ${item.name} moved to ${formatTime12(due)}`);
    } catch (err) {
      showToast(errorText(err, `Could not snooze the follow-up for ${item.name}. Try again.`), "error");
    } finally {
      setBusyRow(null);
    }
  };

  // Reveal number submission — the number shows only when the server logs the reason and returns it.
  const handleRevealSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setRevealError(null);
    if (!revealCategory || revealNote.trim().length < 10) {
      setRevealError("Select a reason and write at least 10 characters.");
      return;
    }
    const item = followUps.find((f) => f.id === pendingRevealFuId);
    if (!item) return;
    setRevealBusy(true);
    try {
      const res = await revealEnquiryNumber(item.id, revealCategory, revealNote.trim());
      const seconds = res.revealSeconds > 0 ? res.revealSeconds : 60;
      setRevealed((prev) => ({ ...prev, [item.id]: { phone: res.phone, until: Date.now() + seconds * 1000 } }));
      const who = currentStaff();
      setRevealLogs((prev) => [{
        id: res.logId || `rev-${Date.now()}`,
        staff: `${who.name} (@${who.uid.slice(0, 8) || "staff"})`,
        caller: `${item.name} (${item.enquiry.code || item.id})`,
        reason: `${revealCategory} — ${revealNote.trim()}`,
        time: formatTime12(new Date()),
      }, ...prev]);
      setRevealModalOpen(false);
      showToast(`Number shown for ${item.name} and logged`);
    } catch (err) {
      setRevealError(errorText(err, "The number could not be shown. Your request was not logged; try again."));
    } finally {
      setRevealBusy(false);
    }
  };

  // Mark lost submission
  const handleLostSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLostError(null);
    const item = followUps.find((f) => f.id === pendingLostFuId);
    if (!item) return;
    setLostBusy(true);
    try {
      const res = await markEnquiryLost(item.id, lostReasonSelected);
      setLostModalOpen(false);
      showToast(res.converted ? `${item.name} was already converted to booking ${res.bookingId ?? ""}`.trim() : `Marked ${item.name} as lost (${lostReasonSelected})`);
    } catch (err) {
      setLostError(errorText(err, "The enquiry was not updated. Try again."));
    } finally {
      setLostBusy(false);
    }
  };

  // Due items & Top Due Item for Banner
  const dueItems = useMemo(() => followUps.filter((f) => f.status === "due"), [followUps]);
  const dueCount = dueItems.length;
  const topDueItem = dueItems[0] || null;

  // Filtered Queue
  const filteredFollowUps = useMemo(() => (fuFilter === "all" ? followUps : followUps.filter((f) => f.status === fuFilter)), [followUps, fuFilter]);
  const countOf = (f: QueueFilter) => (f === "all" ? followUps.length : followUps.filter((x) => x.status === f).length);
  const shownPhone = (item: FollowUpItem) => {
    const r = revealed[item.id];
    return r ? r.phone : maskPhone(item.phone);
  };
  const seatsOf = (e: CategoryEstimate) => (e.category.seatingCapacity ? `${e.category.seatingCapacity} Seats` : "");
  const bagsOf = (e: CategoryEstimate) => (e.category.luggageCapacity ? `${e.category.luggageCapacity} Bags` : "");

  const placeBox = "min-h-[54px] px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white focus-within:border-[#991B1B] focus-within:ring-2 focus-within:ring-[#991B1B]/15 transition-all flex flex-col justify-center";
  const airportAt = trip.tripType === "Airport Taxi" ? airportSide(trip) : null;
  const canBook = !!onNewBooking;

  return (
    <div className="qfd-root w-full min-h-screen bg-[#F8FAFC] text-slate-900 selection:bg-crimson-100 selection:text-crimson-800">
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-7 space-y-5">
        {/* ========================================================= */}
        {/* TOP HEADER: TITLE + BRAND SOURCE + FOLLOW-UP ALERT PILL   */}
        {/* ========================================================= */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-crimson-50 border border-crimson-100 text-[#991B1B] flex items-center justify-center shrink-0">
              <Icon name="calculator" size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">Quick Fare &amp; Enquiry Desk</h1>
              <p className="text-xs text-slate-500 truncate">Check instant rates for callers, set follow-up alerts, or confirm booking in 1 click</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Live Follow-Up Alert Counter Pill */}
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById("followUpQueueSection");
                el?.scrollIntoView({ behavior: "smooth" });
              }}
              className={`h-9 px-3 rounded-xl flex items-center gap-2 transition-all ${
                dueCount > 0
                  ? "bg-amber-50 hover:bg-amber-100/80 border border-amber-200/90 text-amber-800"
                  : "bg-white hover:bg-slate-50 border border-slate-200 text-slate-600"
              }`}
            >
              {dueCount > 0 && (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-600"></span>
                </span>
              )}
              <Icon name="bell-ring" size={14} className={dueCount > 0 ? "text-amber-700" : "text-slate-400"} />
              <span className="text-xs font-semibold">
                {dueCount > 0 ? `${dueCount} Follow-up${dueCount > 1 ? "s" : ""} Due` : "No Due Alerts"}
              </span>
            </button>

            {/* Sleek Brand Source Switcher */}
            <div className="relative shrink-0" ref={brandSwitcherRef}>
              <button
                type="button"
                onClick={() => setBrandMenuOpen(!brandMenuOpen)}
                aria-haspopup="listbox"
                aria-expanded={brandMenuOpen}
                aria-label={`Booking source for this quote: ${DESK_BRANDS[brand].name}`}
                className="h-9 pl-2.5 pr-3 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 flex items-center gap-2 transition-all shadow-xs focus:outline-none focus:ring-2 focus:ring-[#991B1B]/15"
              >
                <span className={`w-2 h-2 rounded-full ring-2 shrink-0 ${DESK_BRANDS[brand].dotClass} ${DESK_BRANDS[brand].ringClass}`}></span>
                <span className="text-[11px] font-medium text-slate-400 hidden sm:inline">Source:</span>
                <span className="text-xs font-semibold text-slate-800">{DESK_BRANDS[brand].name}</span>
                <Icon name="chevrons-up-down" size={14} className="text-slate-400 shrink-0" />
              </button>

              {brandMenuOpen && (
                <div
                  role="listbox"
                  className="absolute right-0 top-[calc(100%+6px)] z-40 w-52 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 fade-slide-in"
                >
                  <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Booking Source</p>
                  {DESK_BRAND_LIST.map((bKey) => {
                    const bMeta = DESK_BRANDS[bKey];
                    const isSelected = brand === bKey;
                    return (
                      <button
                        key={bKey}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => {
                          setBrand(bKey);
                          setBrandMenuOpen(false);
                        }}
                        className={`w-full px-2.5 py-2 rounded-lg flex items-center justify-between gap-2 text-left transition-colors ${
                          isSelected ? "bg-slate-100/90 text-slate-900" : "text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span className={`w-2 h-2 rounded-full ring-2 shrink-0 ${bMeta.dotClass} ${bMeta.ringClass}`}></span>
                          <span className={`text-xs truncate ${isSelected ? "font-semibold" : "font-medium"}`}>
                            {bMeta.name}
                          </span>
                        </span>
                        {isSelected && <Icon name="check" size={14} className={bMeta.bannerTone} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* ========================================================= */}
        {/* LIVE FOLLOW-UP ALERT BANNER (REAL DUE FOLLOW-UPS ONLY)    */}
        {/* ========================================================= */}
        {topDueItem && (
          <section className="rounded-2xl bg-gradient-to-r from-amber-50 via-orange-50/70 to-amber-50 border border-amber-200/90 p-3.5 sm:px-5 shadow-xs fade-slide-in">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                  <Icon name="bell-ring" size={16} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-600 text-white">
                      Follow-up Alert
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                      {topDueItem.name} ({shownPhone(topDueItem)})
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5 truncate">
                    {topDueItem.route} • {topDueItem.vehicleName} ({topDueItem.fare !== null ? formatINR(topDueItem.fare) : "fare not quoted"})
                    {topDueItem.note && <> — &ldquo;{topDueItem.note}&rdquo;</>}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  disabled={busyRow === topDueItem.id}
                  onClick={() => handleSnooze(topDueItem)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  {busyRow === topDueItem.id ? "Saving…" : "Snooze +15m"}
                </button>
                {canBook && (
                  <button
                    type="button"
                    onClick={() => bookFromEnquiry(topDueItem)}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors flex items-center gap-1.5"
                  >
                    <Icon name="check-circle-2" size={14} />
                    <span>Fare OK • Book Now</span>
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ========================================================= */}
        {/* MAIN 2-COLUMN WORKSPACE: QUICK FARE + LIVE VEHICLE FARES  */}
        {/* ========================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* LEFT COLUMN (5/12): QUICK FARE CALCULATOR */}
          <section className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 shadow-sm flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Quick Fare Calculator</h2>
                <p className="text-[11px] text-slate-500 mt-0.5">Nothing is saved until you click Follow-up or Book</p>
              </div>
              <button
                type="button"
                onClick={handleClear}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors flex items-center gap-1"
              >
                <Icon name="rotate-ccw" size={14} />
                <span>Clear</span>
              </button>
            </div>

            <form onSubmit={handleCalculate} noValidate className="p-5 space-y-4 flex-1 flex flex-col">
              {/* Trip Type Tabs */}
              <div role="tablist" aria-label="Trip Type" className="bg-[#F1F5F9] p-1 rounded-xl grid grid-cols-3 gap-1">
                {deskTabs.map((s) => {
                  const active = deskTab === s.key;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => pickDeskTab(s.key)}
                      className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs transition-all ${
                        active
                          ? "bg-white text-[#991B1B] shadow-sm font-semibold"
                          : "text-slate-600 hover:text-slate-900 font-medium"
                      }`}
                    >
                      <Icon name={s.icon as never} size={14} className="shrink-0" />
                      <span>{s.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Airport direction */}
              {airportAt && (
                <div role="group" aria-label="Airport direction" className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#F1F5F9] fade-slide-in">
                  {(["to", "from"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={trip.airportDirection === d}
                      onClick={() => set({ airportDirection: d })}
                      className={`py-1.5 rounded-lg text-xs transition-all ${trip.airportDirection === d ? "bg-white text-[#991B1B] shadow-sm font-semibold" : "text-slate-600 font-medium"}`}
                    >
                      {d === "to" ? "To airport" : "From airport"}
                    </button>
                  ))}
                </div>
              )}

              {/* Route Inputs with Visual Track & Swap — places come from saved locations and map search */}
              <div className="relative flex items-stretch gap-2.5">
                <div className="w-4 flex flex-col items-center py-5 shrink-0 select-none" aria-hidden="true">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-50 shrink-0"></span>
                  {trip.tripType !== "Local Rental" && <div className="flex-1 w-0 border-l-2 border-dashed border-slate-300 my-1.5"></div>}
                  {trip.tripType !== "Local Rental" && <Icon name="map-pin" size={14} className="text-[#991B1B] shrink-0 fill-crimson-50" />}
                </div>

                <div className="flex-1 space-y-2.5 relative min-w-0">
                  {/* Pickup */}
                  <div className={`${placeBox} qfd-place`}>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 leading-none mb-1" aria-hidden="true">
                      Pickup Location
                    </span>
                    <PlaceField
                      label="Pickup location"
                      placeholder={airportAt === "pickup" ? "Search airport" : "Search area, landmark or city"}
                      text={trip.pickupText}
                      value={trip.pickup}
                      saved={data.pickups}
                      near={null}
                      airport={airportAt === "pickup"}
                      onChange={(text, p) => pickPoint("pickup", p, text)}
                      onPin={() => setPinFor("pickup")}
                      pinned={!!trip.pickup?.confirmed}
                    />
                  </div>

                  {/* Optional Stops for Round Trip & Multicity */}
                  {trip.tripType === "Round Trip" && (
                    <div className="space-y-2 fade-slide-in">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          disabled={(trip.stops ?? []).length >= 4}
                          onClick={() => set({ stops: [...(trip.stops ?? []), { text: "", point: null }] })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#991B1B] bg-crimson-50/70 border border-crimson-200/70 hover:bg-crimson-50 disabled:opacity-50"
                        >
                          <Icon name="plus" size={12} />
                          <span>{trip.multicity ? "Add Via-Stop" : "Add Itinerary Stop"}</span>
                        </button>
                        {!trip.multicity && (
                          <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                            Itinerary Lock
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {(trip.stops ?? []).map((stop, idx) => (
                          <div key={idx} className="flex items-start gap-1.5">
                            <div className="flex-1 min-w-0 px-2.5 py-1 rounded-lg bg-slate-50 border border-dashed border-slate-300 focus-within:bg-white focus-within:border-[#991B1B] qfd-place qfd-place--stop">
                              <PlaceField
                                label={`Stop ${idx + 1}`}
                                placeholder={`Search stop ${idx + 1}`}
                                text={stop.text}
                                value={stop.point}
                                saved={data.drops}
                                near={trip.pickup}
                                onChange={(text, p) => set({ stops: (trip.stops ?? []).map((x, n) => (n === idx ? { text, point: p } : x)) })}
                              />
                            </div>
                            <button
                              type="button"
                              aria-label={`Remove stop ${idx + 1}`}
                              disabled={!!trip.multicity && (trip.stops ?? []).length === 1}
                              onClick={() => set({ stops: (trip.stops ?? []).filter((_, n) => n !== idx) })}
                              className="w-8 h-8 mt-0.5 rounded-lg border border-slate-200 text-slate-400 hover:text-[#991B1B] flex items-center justify-center disabled:opacity-40"
                            >
                              <Icon name="x" size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Swap Button */}
                  {trip.tripType !== "Local Rental" && (trip.stops ?? []).length === 0 && (
                    <button
                      type="button"
                      onClick={handleSwap}
                      aria-label="Swap pickup and drop"
                      title="Swap pickup and drop"
                      className={`qfd-swap absolute -left-[32px] top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white border border-slate-200 shadow-sm text-slate-500 hover:text-[#991B1B] hover:border-[#991B1B] flex items-center justify-center transition-colors ${
                        spinSwap ? "swap-spin" : ""
                      }`}
                    >
                      <Icon name="arrow-up-down" size={13} />
                    </button>
                  )}

                  {/* Drop */}
                  {trip.tripType !== "Local Rental" && (
                    <div className={`${placeBox} qfd-place`}>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 leading-none mb-1" aria-hidden="true">
                        {trip.multicity ? "Final Drop Location" : "Drop Location"}
                      </span>
                      <PlaceField
                        label={trip.multicity ? "Final drop location" : "Drop location"}
                        placeholder={airportAt === "drop" ? "Search airport" : "Search area, landmark or city"}
                        text={trip.dropText}
                        value={trip.drop}
                        saved={data.drops}
                        near={trip.pickup}
                        airport={airportAt === "drop"}
                        onChange={(text, p) => pickPoint("drop", p, text)}
                        onPin={() => setPinFor("drop")}
                        pinned={!!trip.drop?.confirmed}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Conditional: Rental Duration Card */}
              {trip.tripType === "Local Rental" && (
                <div className="fade-slide-in">
                  <button
                    type="button"
                    onClick={() => setRentalModalOpen(true)}
                    className="w-full px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50/50 hover:border-[#991B1B]/50 hover:bg-crimson-50/20 transition-all flex items-center justify-between gap-2 text-left"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-crimson-50 text-[#991B1B] flex items-center justify-center shrink-0">
                        <Icon name="clock" size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Rental Duration</p>
                        <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                          {trip.rentalHours ?? 1} {(trip.rentalHours ?? 1) === 1 ? "hour" : "hours"} • km included shown with the fare
                        </p>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-crimson-50 text-[#991B1B] border border-crimson-200/70 shrink-0">
                      Change
                    </span>
                  </button>
                </div>
              )}

              {/* Date & Time Row (India time) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <label htmlFor="qfDateNative" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Pickup Date
                    </label>
                    {dayBadgeText && <span className={dayBadgeClass}>{dayBadgeText}</span>}
                  </div>
                  <div className="relative h-11 px-3 rounded-xl border border-slate-200 bg-white focus-within:border-[#991B1B] flex items-center justify-between">
                    <span className="text-xs sm:text-sm font-medium text-slate-800">{dateDisplayStr}</span>
                    <Icon name="calendar" size={16} className="text-slate-400 pointer-events-none" />
                    <input
                      type="date"
                      id="qfDateNative"
                      min={todayIST}
                      value={trip.date}
                      onChange={(e) => set({ date: e.target.value })}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="qfTimeInput" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Pickup Time
                  </label>
                  <div className="relative h-11 px-3 rounded-xl border border-slate-200 bg-white focus-within:border-[#991B1B] flex items-center justify-between">
                    <span className="text-xs sm:text-sm font-medium text-slate-800">{time12(trip.time) || "Choose time"}</span>
                    <Icon name="clock" size={16} className="text-slate-400 pointer-events-none" />
                    <input
                      type="time"
                      id="qfTimeInput"
                      step={300}
                      value={trip.time}
                      onChange={(e) => set({ time: e.target.value })}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              {/* Conditional: Round Trip Days Stepper */}
              {trip.tripType === "Round Trip" && !trip.multicity && (
                <div className="fade-slide-in">
                  <div className="px-3.5 py-2.5 rounded-xl border border-blue-200/80 bg-blue-50/20 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900">Days</p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {trip.days === 1 ? "Same day return" : `Returns ${formatDate(istInstant(addDaysISO(trip.date, trip.days - 1), "12:00"))} by ${time12(trip.time)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-200 bg-white shrink-0">
                      <button
                        type="button"
                        aria-label="One day less"
                        disabled={trip.days <= 1}
                        onClick={() => set({ days: Math.max(1, trip.days - 1) })}
                        className="w-8 h-8 rounded-lg bg-blue-50 text-[#2563EB] hover:bg-blue-100 disabled:opacity-40 flex items-center justify-center"
                      >
                        <Icon name="minus" size={14} />
                      </button>
                      <span className="min-w-[56px] text-center text-xs font-bold text-slate-900">
                        {trip.days} {trip.days === 1 ? "day" : "days"}
                      </span>
                      <button
                        type="button"
                        aria-label="One day more"
                        disabled={trip.days >= ROUND_TRIP_MAX_DAYS}
                        onClick={() => set({ days: Math.min(ROUND_TRIP_MAX_DAYS, trip.days + 1) })}
                        className="w-8 h-8 rounded-lg bg-blue-50 text-[#2563EB] hover:bg-blue-100 disabled:opacity-40 flex items-center justify-center"
                      >
                        <Icon name="plus" size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Inline Validation */}
              {notice && (
                <div role="alert" className="px-3 py-2 rounded-xl text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-2">
                  <Icon name="info" size={14} className="shrink-0" />
                  <span>{notice}</span>
                </div>
              )}

              {/* Primary CTA */}
              <div className="pt-1 mt-auto">
                <button
                  type="submit"
                  disabled={busyEstimates}
                  aria-busy={busyEstimates || undefined}
                  className="w-full bg-[#991B1B] hover:bg-[#7F1D1D] active:scale-[0.99] text-white font-semibold text-sm py-3 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {busyEstimates ? <span className="ds-spinner" aria-hidden="true" /> : <Icon name="calculator" size={16} />}
                  <span>{busyEstimates ? "Getting fares…" : stale ? "Get Fare Again" : "Get Fare"}</span>
                </button>
              </div>
            </form>
          </section>

          {/* RIGHT COLUMN (7/12): FARES LIST + FOLLOW-UP & BOOK ACTIONS */}
          <section className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 shadow-sm flex flex-col" aria-busy={busyEstimates || undefined}>
            <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                  <Icon name="car" size={16} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-slate-900">Vehicle Fares</h2>
                  <p className="text-[11px] text-slate-500 truncate">
                    {calculated && quotedTrip ? `${formatDate(istInstant(quotedTrip.date, "12:00"))} • ${time12(quotedTrip.time)} • ${DESK_BRANDS[brand].name}` : "The fare for every vehicle appears here"}
                  </p>
                </div>
              </div>

              {calculated && priced.length > 0 && !stale && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyAllFares}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors flex items-center gap-1.5"
                  >
                    <Icon name="copy" size={14} />
                    <span>{copyAllStatus}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openFollowUpModal(priced[0].category.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-1.5"
                  >
                    <Icon name="bell-plus" size={14} />
                    <span>Save Follow-up</span>
                  </button>
                </div>
              )}
            </div>

            {/* Loading State */}
            {busyEstimates && (
              <div className="flex-1 p-8 sm:p-12 flex flex-col items-center justify-center text-center" role="status">
                <span className="ds-spinner text-[#991B1B]" aria-hidden="true" style={{ width: 22, height: 22 }} />
                <p className="text-sm font-bold text-slate-800 mt-3">Getting fares from the pricing server…</p>
                <p className="text-xs text-slate-500 mt-1">Every vehicle is priced for the chosen route, date and booking source.</p>
              </div>
            )}

            {/* Empty State */}
            {!busyEstimates && !calculated && (
              <div className="flex-1 p-8 sm:p-12 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                  <Icon name="calculator" size={24} />
                </div>
                <p className="text-sm font-bold text-slate-800">No fare calculated yet</p>
                <p className="text-xs text-slate-500 mt-1 max-w-xs">
                  Choose the pickup and drop from the suggestions (or set the pin on the map), pick the date, then click <strong>Get Fare</strong>.
                </p>
              </div>
            )}

            {/* Populated Fares State */}
            {!busyEstimates && calculated && (
              <div className="flex-1 flex flex-col fade-slide-in">
                {/* Route & Distance Meta Bar */}
                <div className="px-5 py-2.5 bg-slate-50/90 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-slate-800 truncate">{quotedRoute}</span>
                    {roadFacts && (
                      <span className="text-[11px] font-medium text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full shrink-0">
                        {roadFacts.km} km{roadFacts.minutes ? ` • ~${formatDuration(roadFacts.minutes)}` : ""} by road
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/70 shrink-0">
                    {priced.length} of {estimates!.length} vehicles priced
                  </span>
                </div>

                {stale && (
                  <div role="status" className="px-5 py-2 bg-amber-50 border-b border-amber-200 text-[11px] font-semibold text-amber-800 flex items-center gap-2">
                    <Icon name="info" size={14} className="shrink-0" />
                    The trip or booking source changed after these fares were quoted. Click Get Fare Again before saving or booking.
                  </div>
                )}

                {/* Vehicle Fare Rows (server quotes) */}
                <div className={`divide-y divide-slate-100 flex-1 overflow-y-auto ${stale ? "opacity-60" : ""}`}>
                  {estimates!.map((e) => {
                    const q = e.quote;
                    const includedKm = q ? estimateFacts.includedKmOf(q) : 0;
                    const meta = [seatsOf(e), bagsOf(e), q && includedKm ? `${includedKm} km included` : ""].filter(Boolean).join(" • ");
                    return (
                      <div
                        key={e.category.id}
                        className="px-5 py-3.5 hover:bg-slate-50/80 transition-colors flex flex-wrap sm:flex-nowrap items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-900">{e.category.name}</span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">{q ? meta || " " : <span className="text-amber-700">{e.error || "Not available for this trip"}</span>}</p>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <div className="text-right mr-1">
                            <p className="text-base font-bold text-slate-900">{q ? formatINR(q.quote.total) : "—"}</p>
                            {q && <p className="text-[10px] text-slate-400">{q.quote.gst ? `incl. ${formatINR(q.quote.gst)} GST` : "Estimated total"}</p>}
                          </div>
                          <button
                            type="button"
                            disabled={!q || stale}
                            onClick={() => openFollowUpModal(e.category.id)}
                            title="Save follow-up for this cab"
                            className="h-8 px-2.5 rounded-lg text-[11px] font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Icon name="bell-plus" size={14} />
                            <span className="hidden sm:inline">Follow-up</span>
                          </button>
                          {canBook && (
                            <button
                              type="button"
                              disabled={!q || stale}
                              onClick={() => bookFromEstimate(e.category.id)}
                              title="Open New booking with this trip and vehicle"
                              className="h-8 px-3 rounded-lg text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs transition-colors flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Icon name="check" size={14} />
                              <span>Book</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer Note */}
                <div className="px-5 py-2.5 bg-slate-50/70 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span>Fares from the pricing server for {DESK_BRANDS[brand].name}. The full breakup opens in New booking.</span>
                  {canBook ? (
                    <span className="font-medium text-slate-700">Click <strong>Book</strong> if customer says OK</span>
                  ) : (
                    <span className="font-medium text-slate-500">Your access can quote and save follow-ups, not create bookings.</span>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>

        {/* ========================================================= */}
        {/* BOTTOM SECTION: FOLLOW-UP QUEUE & ALERTS TRACKER          */}
        {/* ========================================================= */}
        <section id="followUpQueueSection" className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
                <Icon name="clock-alert" size={16} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">Follow-Up Queue &amp; Alerts</h2>
                <p className="text-[11px] text-slate-500">Track callers who asked for a fare — call back when alert triggers &amp; convert to booking</p>
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl flex-wrap">
              {QUEUE_FILTERS.map((f) => {
                const active = fuFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFuFilter(f.id)}
                    className={`px-3 py-1 rounded-lg text-xs transition-all ${
                      active ? "font-semibold bg-white text-slate-900 shadow-xs" : "font-medium text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {f.label}
                    {enquiries && <span className="ml-1 text-[10px] text-slate-400">{countOf(f.id)}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Queue Cards Container */}
          <div className="divide-y divide-slate-100">
            {enquiryError ? (
              <div role="alert" className="p-6 text-center text-xs text-amber-800 bg-amber-50/60">
                Follow-ups could not be loaded: {enquiryError}
              </div>
            ) : enquiries === null ? (
              <div role="status" className="p-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                <span className="ds-spinner" aria-hidden="true" />
                Loading follow-ups…
              </div>
            ) : filteredFollowUps.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                {followUps.length === 0 ? (
                  <>
                    <p className="text-sm font-bold text-slate-800">No follow-ups yet</p>
                    <p className="mt-1">When a caller asks to be called back, get the fare and click <strong>Follow-up</strong>. It appears here with an alert.</p>
                  </>
                ) : (
                  "No follow-ups in this filter."
                )}
              </div>
            ) : (
              filteredFollowUps.slice(0, QUEUE_LIMIT).map((item) => {
                const isRev = !!revealed[item.id];
                const rowBusy = busyRow === item.id;

                return (
                  <div
                    key={item.id}
                    className="px-5 py-3.5 hover:bg-slate-50/70 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {item.status === "due" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></span>
                            Due Now
                          </span>
                        )}
                        {item.status === "booked" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Booked ✓
                          </span>
                        )}
                        {item.status === "lost" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">
                            Lost • {item.enquiry.lostReason || "Closed"}
                          </span>
                        )}
                        {(item.status === "upcoming" || item.status === "all") && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                            <Icon name="calendar-clock" size={12} />
                            {item.dueLabel}
                          </span>
                        )}

                        <span className="text-sm font-bold text-slate-900">{item.name}</span>
                        <span className={`text-xs font-semibold ${isRev ? "text-emerald-700" : "text-slate-600"}`}>
                          {item.phone ? shownPhone(item) : "No number"}
                        </span>

                        {!isRev && item.phone && (
                          <button
                            type="button"
                            onClick={() => {
                              setPendingRevealFuId(item.id);
                              setRevealCategory("");
                              setRevealNote("");
                              setRevealError(null);
                              setRevealModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80"
                          >
                            <Icon name="eye" size={12} />
                            <span>View #</span>
                          </button>
                        )}
                        {isRev && (
                          <a href={`tel:+91${phoneDigits(revealed[item.id].phone)}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/80">
                            <Icon name="phone" size={12} />
                            <span>Call</span>
                          </a>
                        )}

                        {item.brand && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                            {item.brand}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-700 font-medium">
                        {item.route} • <span className="text-slate-500">{item.pickupLabel}</span> •{" "}
                        <strong className="text-[#991B1B]">{item.vehicleName} ({item.fare !== null ? formatINR(item.fare) : "fare not quoted"})</strong>
                      </p>
                      {item.note && <p className="text-[11px] text-slate-500 italic">&ldquo;{item.note}&rdquo;</p>}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      {item.status === "due" || item.status === "upcoming" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingLostFuId(item.id);
                              setLostError(null);
                              setLostModalOpen(true);
                            }}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-red-700 bg-red-50 hover:bg-red-100"
                          >
                            Lost
                          </button>
                          <button
                            type="button"
                            disabled={rowBusy}
                            onClick={() => handleSnooze(item)}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {rowBusy ? "Saving…" : "Snooze +15m"}
                          </button>
                          {canBook && (
                            <button
                              type="button"
                              onClick={() => bookFromEnquiry(item)}
                              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs flex items-center gap-1"
                            >
                              <Icon name="check-circle-2" size={14} />
                              <span>Fare OK • Book</span>
                            </button>
                          )}
                        </>
                      ) : item.status === "booked" ? (
                        <span className="text-xs font-semibold text-emerald-700">
                          Converted to Booking{item.enquiry.convertedBookingId ? ` · ${item.enquiry.convertedBookingId}` : ""}
                        </span>
                      ) : item.status === "lost" ? (
                        <span className="text-xs font-medium text-slate-400">Closed ({item.enquiry.lostReason || "Lost"})</span>
                      ) : (
                        <span className="text-xs font-medium text-slate-400">{item.enquiry.status}</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            {filteredFollowUps.length > QUEUE_LIMIT && (
              <div className="px-5 py-3 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
                <span>Showing the first {QUEUE_LIMIT} of {filteredFollowUps.length}.</span>
                {onNavigate && (
                  <button type="button" className="font-semibold text-[#991B1B] hover:underline" onClick={() => onNavigate("bookings", "Enquiries")}>
                    Open all enquiries →
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ========================================================= */}
        {/* NUMBER REVEAL AUDIT LOG (MANDATORY REASON LEDGER)         */}
        {/* ========================================================= */}
        <section className="bg-white rounded-2xl border border-amber-200/90 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-amber-50/60 border-b border-amber-200/70 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Icon name="shield-alert" size={16} className="text-amber-700" />
              <h2 className="text-xs font-bold text-amber-950">Caller Number View Log (Mandatory Reason Required)</h2>
            </div>
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
              Logged on server
            </span>
          </div>
          {revealLogs.length === 0 ? (
            <p className="px-5 py-4 text-[11px] text-slate-500">
              No numbers viewed in this session. Every view is recorded on the server with your staff ID and reason; this list shows the views made here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="py-2 px-5">Staff Account</th>
                    <th className="py-2 px-4">Caller</th>
                    <th className="py-2 px-4">Mandatory Reason Given</th>
                    <th className="py-2 px-5 text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {revealLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-2 px-5 font-semibold text-slate-900">{log.staff}</td>
                      <td className="py-2 px-4 font-medium text-[#991B1B]">{log.caller}</td>
                      <td className="py-2 px-4 text-slate-700">{log.reason}</td>
                      <td className="py-2 px-5 text-right text-[11px] font-semibold text-slate-500">{log.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Pin check on the map for pickup / drop */}
      {pinFor && (
        <LocationPinDialog
          side={pinFor}
          context="Quick Fare & Enquiry Desk"
          value={pinFor === "pickup" ? trip.pickup : trip.drop}
          startNear={pinFor === "drop" ? trip.pickup : null}
          onChange={(p) => pickPoint(pinFor, p, p?.name || p?.address || (pinFor === "pickup" ? trip.pickupText : trip.dropText))}
          onClose={() => setPinFor(null)}
        />
      )}

      {/* ========================================================= */}
      {/* MODAL 1: SAVE FOLLOW-UP & SET ALERT                       */}
      {/* ========================================================= */}
      {fuModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Save follow-up and set alert">
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden fade-slide-in">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                  <Icon name="bell-plus" size={16} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900">Save Follow-Up &amp; Set Alert</h3>
                  <p className="text-[11px] text-slate-500 truncate">
                    {quotedRoute} • {fuEstimate ? `${fuEstimate.category.name} (${formatINR(fuEstimate.quote!.quote.total)})` : "Choose a priced vehicle"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                disabled={fuBusy}
                onClick={() => setFuModalOpen(false)}
                className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveFollowUp} className="p-5 space-y-4" noValidate>
              {priced.length > 1 && (
                <div>
                  <label htmlFor="fuVehicleSel" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Vehicle quoted
                  </label>
                  <select
                    id="fuVehicleSel"
                    value={fuCategoryId}
                    onChange={(e) => setFuCategoryId(e.target.value)}
                    className="w-full h-10 px-3 text-sm font-medium text-slate-800 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
                  >
                    {priced.map((e) => (
                      <option key={e.category.id} value={e.category.id}>{e.category.name} — {formatINR(e.quote!.quote.total)}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="fuMobileInp" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Caller Mobile *
                  </label>
                  <div className="flex items-center h-10 bg-white border border-slate-200 rounded-xl overflow-hidden focus-within:border-[#991B1B]">
                    <span className="px-2.5 text-xs font-semibold text-slate-500 bg-slate-50 h-full flex items-center border-r border-slate-200">
                      +91
                    </span>
                    <input
                      type="tel"
                      id="fuMobileInp"
                      maxLength={10}
                      required
                      inputMode="numeric"
                      autoComplete="off"
                      value={fuMobile}
                      onChange={(e) => {
                        setFuMobile(e.target.value.replace(/\D/g, "").slice(0, 10));
                        setFuError(null);
                      }}
                      placeholder="10-digit mobile"
                      className="w-full h-full px-2.5 text-sm font-medium text-slate-800 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="fuNameInp" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Caller Name
                  </label>
                  <input
                    type="text"
                    id="fuNameInp"
                    maxLength={80}
                    value={fuName}
                    onChange={(e) => setFuName(e.target.value)}
                    placeholder={fuCallerMatch?.name || "Caller name"}
                    className="w-full h-10 px-3 text-sm font-medium text-slate-800 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
                  />
                </div>
              </div>

              {fuCallerMatch && (
                <p className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/70 px-3 py-1.5 rounded-lg">
                  Existing customer: {fuCallerMatch.name}{fuCallerMatch.city ? ` • ${fuCallerMatch.city}` : ""}
                </p>
              )}

              {/* Scheduled Follow-Up Date & Time (India time) */}
              <div className="p-3 rounded-xl bg-slate-50/90 border border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                    <Icon name="calendar-clock" size={14} className="text-amber-600" />
                    <span>Follow-Up Date &amp; Time (IST)</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleFuTomorrowPreset(9, "tomorrow morning")}
                      className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-white text-slate-700 border border-slate-200 hover:border-amber-400 hover:text-amber-800 transition-colors"
                    >
                      Tomorrow 9 AM
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFuTomorrowPreset(17, "tomorrow evening")}
                      className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-white text-slate-700 border border-slate-200 hover:border-amber-400 hover:text-amber-800 transition-colors"
                    >
                      Tomorrow 5 PM
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="fuScheduleDateInp" className="block text-[10px] font-medium text-slate-500 mb-1">
                      Follow-Up Date
                    </label>
                    <input
                      type="date"
                      id="fuScheduleDateInp"
                      min={todayIST}
                      value={fuScheduleDate}
                      onChange={(e) => { setFuScheduleDate(e.target.value); setFuReminderMins(null); }}
                      className="w-full h-9 px-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#991B1B]"
                    />
                  </div>
                  <div>
                    <label htmlFor="fuScheduleTimeInp" className="block text-[10px] font-medium text-slate-500 mb-1">
                      Follow-Up Time
                    </label>
                    <input
                      type="time"
                      id="fuScheduleTimeInp"
                      value={fuScheduleTime}
                      onChange={(e) => { setFuScheduleTime(e.target.value); setFuReminderMins(null); }}
                      className="w-full h-9 px-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#991B1B]"
                    />
                  </div>
                </div>
              </div>

              {/* Quick Reminder Time Chips */}
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Follow-Up Alert Time
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: "In 15 min", mins: 15 },
                    { label: "In 30 min", mins: 30 },
                    { label: "In 1 hour", mins: 60 },
                    { label: "Alert Now", mins: 0 },
                  ].map((chip) => {
                    const active = fuReminderMins === chip.mins;
                    return (
                      <button
                        key={chip.mins}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setScheduleIn(chip.mins)}
                        className={`py-2 px-2 rounded-xl text-xs transition-colors ${
                          active
                            ? "font-semibold border border-[#991B1B] bg-crimson-50 text-[#991B1B]"
                            : "font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label htmlFor="fuNoteInp" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Call Note
                </label>
                <input
                  type="text"
                  id="fuNoteInp"
                  maxLength={300}
                  value={fuNote}
                  onChange={(e) => setFuNote(e.target.value)}
                  placeholder="What the caller said"
                  className="w-full h-10 px-3 text-xs sm:text-sm text-slate-800 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
                />
              </div>

              {fuError && (
                <div role="alert" className="px-3 py-2 rounded-xl text-xs font-medium bg-red-50 text-red-800 border border-red-200">
                  {fuError}
                </div>
              )}

              <button
                type="submit"
                disabled={fuBusy}
                aria-busy={fuBusy || undefined}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm py-3 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-70"
              >
                {fuBusy ? <span className="ds-spinner" aria-hidden="true" /> : <Icon name="bell-ring" size={16} />}
                <span>{fuBusy ? "Saving follow-up…" : "Save Follow-Up & Activate Alert"}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 3: RENTAL DURATION (1 TO 15 HOURS)                  */}
      {/* ========================================================= */}
      {rentalModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Rental duration">
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden fade-slide-in">
            <div className="pt-3 pb-1 flex justify-center">
              <span className="w-11 h-1 rounded-full bg-slate-300/80"></span>
            </div>
            <div className="px-5 pt-2 pb-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-bold text-slate-900">Rental duration</h3>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setRentalModalOpen(false)}
                  className="w-8 h-8 rounded-full text-slate-500 hover:bg-slate-100 flex items-center justify-center"
                >
                  <Icon name="x" size={20} />
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">Choose from 1 to 15 hours. The fare and included km come from the pricing server.</p>
              <div className="grid grid-cols-3 gap-2.5 mt-4">
                {Array.from({ length: 15 }, (_, i) => i + 1).map((h) => {
                  const active = (trip.rentalHours ?? 1) === h;
                  return (
                    <button
                      key={h}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        set({ rentalHours: h });
                        setRentalModalOpen(false);
                      }}
                      className={`py-2.5 px-2 rounded-xl text-xs transition-colors ${
                        active
                          ? "font-bold border border-[#B91C1C] bg-[#FEF2F2] text-[#991B1B]"
                          : "font-semibold border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      {h} {h === 1 ? "hour" : "hours"}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 4: MANDATORY REASON TO VIEW CALLER NUMBER           */}
      {/* ========================================================= */}
      {revealModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Mandatory reason to view number">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden fade-slide-in">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-amber-50/60">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center">
                  <Icon name="eye" size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Mandatory Reason to View Number</h3>
                  <p className="text-[11px] text-slate-600">Staff ID &amp; reason are permanently logged</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                disabled={revealBusy}
                onClick={() => setRevealModalOpen(false)}
                className="w-8 h-8 rounded-full text-slate-400 hover:bg-slate-100 flex items-center justify-center"
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            <form onSubmit={handleRevealSubmit} className="p-5 space-y-3.5 text-xs" noValidate>
              <div>
                <label htmlFor="revealCategorySel" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Reason Category *
                </label>
                <select
                  id="revealCategorySel"
                  required
                  value={revealCategory}
                  onChange={(e) => setRevealCategory(e.target.value)}
                  className="w-full h-9 px-2.5 font-semibold border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#991B1B]"
                >
                  <option value="">-- Select valid reason --</option>
                  {REVEAL_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="revealDetailInp" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Detailed Note (Min 10 characters) *
                </label>
                <input
                  type="text"
                  id="revealDetailInp"
                  required
                  value={revealNote}
                  onChange={(e) => setRevealNote(e.target.value)}
                  placeholder="Why you need the number now"
                  className="w-full h-9 px-3 border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
                />
              </div>
              {revealError && (
                <div role="alert" className="px-3 py-2 rounded-xl font-medium bg-red-50 text-red-800 border border-red-200">
                  {revealError}
                </div>
              )}
              <button
                type="submit"
                disabled={revealBusy}
                className="w-full bg-[#991B1B] hover:bg-[#7F1D1D] text-white font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-70"
              >
                {revealBusy ? "Logging reason…" : "Log Reason & Reveal Number"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 5: MARK FOLLOW-UP AS LOST (REASON TRACKER)          */}
      {/* ========================================================= */}
      {lostModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Mark enquiry as lost">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden fade-slide-in">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Mark Enquiry as Lost</h3>
                <p className="text-[11px] text-slate-500">Select why caller did not book</p>
              </div>
              <button
                type="button"
                aria-label="Close"
                disabled={lostBusy}
                onClick={() => setLostModalOpen(false)}
                className="w-8 h-8 rounded-full text-slate-400 hover:bg-slate-100 flex items-center justify-center"
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            <form onSubmit={handleLostSubmit} className="p-5 space-y-3 text-xs">
              <div className="space-y-2">
                {LOST_REASONS.map((r) => (
                  <label
                    key={r}
                    className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <input
                      type="radio"
                      name="lostReasonRadio"
                      value={r}
                      checked={lostReasonSelected === r}
                      onChange={() => setLostReasonSelected(r)}
                      className="accent-[#991B1B]"
                    />
                    <span className="font-medium text-slate-800">{r}</span>
                  </label>
                ))}
              </div>
              {lostError && (
                <div role="alert" className="px-3 py-2 rounded-xl font-medium bg-red-50 text-red-800 border border-red-200">
                  {lostError}
                </div>
              )}
              <button
                type="submit"
                disabled={lostBusy}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-70"
              >
                {lostBusy ? "Saving…" : "Save Lost Reason"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toast && (
        <div
          role={toast.tone === "error" ? "alert" : "status"}
          className={`fixed bottom-5 right-5 z-50 max-w-sm px-4 py-3 rounded-xl shadow-xl text-xs font-medium flex items-center gap-2.5 fade-slide-in ${toast.tone === "error" ? "bg-red-700 text-white" : "bg-slate-900 text-white"}`}
        >
          <Icon name={toast.tone === "error" ? "circle-alert" : "bell-ring"} size={16} className={`${toast.tone === "error" ? "text-white" : "text-amber-400"} shrink-0`} />
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
