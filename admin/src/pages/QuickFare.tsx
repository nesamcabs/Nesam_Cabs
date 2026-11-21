import { useState, useEffect, useRef, useMemo, type FormEvent } from "react";
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
  type QueueFilter,
  type LostReason,
  type RevealCategory,
  type PaymentPlan,
  formatINR,
  maskPhone,
  phoneDigits,
  formatDuration,
  formatWhatsAppQuote,
  formatWhatsAppBooking,
} from "../domain/quickFareDesk";
import {
  useQuickData,
  estimateAll,
  type QuickTrip,
  emptyTrip,
} from "../components/booking/QuickFare";
import {
  subscribeEnquiries,
  saveEnquiry,
  snoozeEnquiry,
  markEnquiryLost,
  revealEnquiryNumber,
  createBookingPaymentLink,
  markEnquiryConverted,
  currentStaff,
  type Enquiry,
} from "../services/enquiryService";
import {
  createAdminBooking,
  emptyManualBooking,
  newRequestId,
  type ManualBookingForm,
} from "../services/adminBookingService";
import { matchMainCities } from "../services/mainCities";
import type { NewBookingDraft } from "./NewBooking";
import type { PickedPoint } from "../components/MapLocationPicker";

interface QuickFareProps {
  onNewBooking?: (draft: NewBookingDraft) => void;
  onEnquirySaved?: () => void;
  onNavigate?: (page: string, tab?: string) => void;
  onSelectBooking?: (bookingId: string) => void;
}

interface DeskVehicle {
  id: string;
  name: string;
  category: string;
  seats: string;
  bags: string;
  oneWayRate: number;
  roundRate: number;
  base30: number;
  bata: number;
  rental1Hr: number;
  rentalPerHr: number;
}

const DESK_VEHICLES: DeskVehicle[] = [
  { id: "hatchback", name: "Wagon R Or Similar", category: "HATCHBACK", seats: "4 Seats", bags: "2 Bags", oneWayRate: 14, roundRate: 13, base30: 550, bata: 500, rental1Hr: 320, rentalPerHr: 230 },
  { id: "sedan", name: "Dzire / Etios Or Similar", category: "SEDAN", seats: "4 Seats", bags: "2 Bags", oneWayRate: 15, roundRate: 14, base30: 600, bata: 500, rental1Hr: 350, rentalPerHr: 260 },
  { id: "suv", name: "Ertiga Or Similar", category: "SUV", seats: "6 Seats", bags: "4 Bags", oneWayRate: 19, roundRate: 18, base30: 750, bata: 500, rental1Hr: 450, rentalPerHr: 330 },
  { id: "muv", name: "Kia Carens Or Similar", category: "MUV", seats: "7 Seats", bags: "4 Bags", oneWayRate: 20, roundRate: 19, base30: 800, bata: 500, rental1Hr: 480, rentalPerHr: 350 },
  { id: "innova", name: "Innova", category: "INNOVA", seats: "7 Seats", bags: "4 Bags", oneWayRate: 21, roundRate: 20, base30: 850, bata: 600, rental1Hr: 520, rentalPerHr: 380 },
  { id: "crysta", name: "Innova Crysta", category: "CRYSTA", seats: "7 Seats", bags: "4 Bags", oneWayRate: 24, roundRate: 23, base30: 950, bata: 600, rental1Hr: 600, rentalPerHr: 430 },
];

const TN_CITY_COORDS: Record<string, [number, number]> = {
  chennai: [13.0827, 80.2707],
  madurai: [9.9252, 78.1198],
  trichy: [10.7905, 78.7047],
  coimbatore: [11.0168, 76.9558],
  tiruppur: [11.1085, 77.3411],
  salem: [11.6643, 78.146],
  tiruvannamalai: [12.2253, 79.0747],
  pondicherry: [11.9416, 79.8083],
  kodaikanal: [10.2381, 77.4892],
  theni: [10.0104, 77.4768],
  vellore: [12.9165, 79.1325],
  bengaluru: [12.9716, 77.5946],
  bangalore: [12.9716, 77.5946],
  dindigul: [10.3624, 77.9695],
  tirunelveli: [8.7139, 77.7567],
  kanyakumari: [8.0883, 77.5385],
  rameswaram: [9.2876, 79.3129],
  thanjavur: [10.787, 79.1378],
  erode: [11.341, 77.7172],
  karur: [10.9601, 78.0766],
  ooty: [11.4102, 76.695],
  pollachi: [10.6581, 77.0087],
  airport: [12.9941, 80.1709],
};

function lookupCoord(text: string): [number, number] | null {
  if (!text) return null;
  const lower = text.toLowerCase().trim();
  for (const k of Object.keys(TN_CITY_COORDS)) {
    if (lower.includes(k)) return TN_CITY_COORDS[k];
  }
  return null;
}

function roadKm(c1: [number, number], c2: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(c2[0] - c1[0]);
  const dLon = toRad(c2[1] - c1[1]);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(c1[0])) * Math.cos(toRad(c2[0])) * Math.sin(dLon / 2) ** 2;
  return Math.max(15, Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.22));
}

function parseHours(timeStr: string): number {
  const [hm, mer] = timeStr.split(" ");
  let [h, m] = hm.split(":").map(Number);
  if (mer === "PM" && h !== 12) h += 12;
  if (mer === "AM" && h === 12) h = 0;
  return h + m / 60;
}

interface CallerLookup {
  phone: string;
  name: string;
  trips: number;
  prefCab: string;
}

const CALLER_DIRECTORY: CallerLookup[] = [
  { phone: "9842144510", name: "Arun Prakash", trips: 5, prefCab: "Sedan" },
  { phone: "9894011223", name: "Divya Menon", trips: 3, prefCab: "SUV" },
  { phone: "6379056759", name: "Mithravarun", trips: 1, prefCab: "Sedan" },
  { phone: "9842277890", name: "Sri Tex Exports", trips: 19, prefCab: "Innova Crysta" },
];

interface FollowUpItem {
  id: string;
  name: string;
  phone: string;
  brand: string;
  tripType: string;
  route: string;
  pickup: string;
  drop: string;
  date: string;
  time: string;
  followUpDateTime?: string;
  vehicleId: string;
  vehicleName: string;
  fare: number;
  note: string;
  status: "due" | "upcoming" | "booked" | "lost";
  dueLabel: string;
  dueTimestamp: number;
  lostReason?: string;
}

interface RevealLog {
  id: string;
  staff: string;
  caller: string;
  reason: string;
  time: string;
}

const INITIAL_DEMO_FOLLOW_UPS: FollowUpItem[] = [
  {
    id: "FU-101",
    name: "Arun Prakash",
    phone: "9842144510",
    brand: "Nesam Cabs",
    tripType: "One Way",
    route: "Coimbatore → Madurai",
    pickup: "Coimbatore",
    drop: "Madurai",
    date: "22-11-2026",
    time: "8:00 AM",
    vehicleId: "sedan",
    vehicleName: "Dzire / Etios Or Similar",
    fare: 3725,
    note: "Checking with wife, asked to call back in 10 mins",
    status: "due",
    dueLabel: "Due Now",
    dueTimestamp: Date.now() - 60000,
  },
  {
    id: "FU-102",
    name: "Divya Menon",
    phone: "9894011223",
    brand: "Nesam Cabs",
    tripType: "Round Trip",
    route: "Coimbatore ⇄ Ooty",
    pickup: "Coimbatore",
    drop: "Ooty",
    date: "23-11-2026",
    time: "7:00 AM",
    vehicleId: "suv",
    vehicleName: "Ertiga Or Similar",
    fare: 5000,
    note: "Comparing Innova vs Ertiga rate",
    status: "upcoming",
    dueLabel: "In 25 mins",
    dueTimestamp: Date.now() + 25 * 60000,
  },
];

const INITIAL_REVEAL_LOGS: RevealLog[] = [
  {
    id: "rev-init",
    staff: "Karthik Raja (@booking.karthik)",
    caller: "Arun Prakash (FU-101)",
    reason: "Scheduled follow-up callback — Confirming Coimbatore → Madurai Sedan quote",
    time: "12:30 PM",
  },
];

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

function toIsoDate(dateObj: Date): string {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toHhMm(dateObj: Date): string {
  const hh = String(dateObj.getHours()).padStart(2, "0");
  const min = String(dateObj.getMinutes()).padStart(2, "0");
  return `${hh}:${min}`;
}

function formatScheduledDisplay(isoDate: string, hhMm: string): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  const dateFormatted = `${d}-${m}-${y}`;
  if (!hhMm) return dateFormatted;
  const [hStr, minStr] = hhMm.split(":");
  let hNum = parseInt(hStr, 10);
  const mer = hNum >= 12 ? "PM" : "AM";
  if (hNum === 0) hNum = 12;
  else if (hNum > 12) hNum -= 12;
  return `${dateFormatted} • ${hNum}:${minStr} ${mer}`;
}

export default function QuickFare({
  onNewBooking,
  onEnquirySaved,
  onNavigate,
  onSelectBooking,
}: QuickFareProps) {
  const data = useQuickData();

  // 1. Desk Brand State
  const [brand, setBrand] = useState<DeskBrand>("nesam");
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const brandSwitcherRef = useRef<HTMLDivElement>(null);

  // 2. Calculator Form State
  const [tripType, setTripType] = useState<string>("One Way");
  const [pickupInput, setPickupInput] = useState<string>("");
  const [dropInput, setDropInput] = useState<string>("");
  const [viaStops, setViaStops] = useState<string[]>([]);
  const [rentalHours, setRentalHours] = useState<number>(4);
  const [roundTripDays, setRoundTripDays] = useState<number>(1);
  const [pickupDateNative, setPickupDateNative] = useState<string>("2026-11-22");
  const [pickupTime, setPickupTime] = useState<string>("8:00 AM");
  const [notice, setNotice] = useState<string | null>(null);
  const [spinSwap, setSpinSwap] = useState(false);

  // 3. Calculation & Vehicle Fares State
  const [calculated, setCalculated] = useState<boolean>(false);
  const [busyEstimates, setBusyEstimates] = useState<boolean>(false);
  const [autoKm, setAutoKm] = useState<number>(215);
  const [autoMinutes, setAutoMinutes] = useState<number>(270);
  const [copyAllStatus, setCopyAllStatus] = useState<string>("Copy All for WhatsApp");

  // 4. Follow-Up Queue State
  const [fuFilter, setFuFilter] = useState<QueueFilter>("all");
  const [followUps, setFollowUps] = useState<FollowUpItem[]>(INITIAL_DEMO_FOLLOW_UPS);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [revealLogs, setRevealLogs] = useState<RevealLog[]>(INITIAL_REVEAL_LOGS);

  // 5. Toast Notification State
  const [toastText, setToastText] = useState<string | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const showToast = (msg: string) => {
    setToastText(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => setToastText(null), 3500);
  };

  // 6. Modals State
  // Modal 1: Follow-Up
  const [fuModalOpen, setFuModalOpen] = useState<boolean>(false);
  const [fuActiveVehicleId, setFuActiveVehicleId] = useState<string>("sedan");
  const [fuMobile, setFuMobile] = useState<string>("");
  const [fuName, setFuName] = useState<string>("");
  const [fuScheduleDate, setFuScheduleDate] = useState<string>("");
  const [fuScheduleTime, setFuScheduleTime] = useState<string>("");
  const [fuReminderMins, setFuReminderMins] = useState<number>(15);
  const [fuNote, setFuNote] = useState<string>("");

  // Modal 2: Confirm Booking
  interface ConfirmPayload {
    route: string;
    tripType: string;
    date: string;
    time: string;
    vehicle: DeskVehicle;
    fare: number;
    slab: string;
    customerPhone: string;
    customerName: string;
    followUpId: string | null;
    bookingId?: string;
  }
  const [confirmModalOpen, setConfirmModalOpen] = useState<boolean>(false);
  const [confirmPayload, setConfirmPayload] = useState<ConfirmPayload | null>(null);
  const [cbPayPlan, setCbPayPlan] = useState<PaymentPlan>("later");
  const [cbMobile, setCbMobile] = useState<string>("");
  const [cbName, setCbName] = useState<string>("");
  const [cbError, setCbError] = useState<string | null>(null);
  const [cbSuccess, setCbSuccess] = useState<boolean>(false);
  const [cbCopyWaText, setCbCopyWaText] = useState<string>("Copy WhatsApp Confirmation");

  // Modal 3: Rental Duration
  const [rentalModalOpen, setRentalModalOpen] = useState<boolean>(false);

  // Modal 4: Reveal Number
  const [revealModalOpen, setRevealModalOpen] = useState<boolean>(false);
  const [pendingRevealFuId, setPendingRevealFuId] = useState<string | null>(null);
  const [revealCategory, setRevealCategory] = useState<string>("");
  const [revealNote, setRevealNote] = useState<string>("");

  // Modal 5: Mark Lost
  const [lostModalOpen, setLostModalOpen] = useState<boolean>(false);
  const [pendingLostFuId, setPendingLostFuId] = useState<string | null>(null);
  const [lostReasonSelected, setLostReasonSelected] = useState<LostReason>("Rate too high / Budget issue");

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

  // Subscribe to real enquiries from Firestore
  useEffect(() => {
    const unsub = subscribeEnquiries((realEnquiries) => {
      if (realEnquiries.length > 0) {
        setFollowUps((prev) => {
          const map = new Map<string, FollowUpItem>();
          // preserve demo items if not overridden
          prev.forEach((item) => map.set(item.id, item));
          // overlay real enquiries
          realEnquiries.forEach((e) => {
            const dueMs = e.followUpAt?.toMillis?.() ?? (e.due?.toMillis?.() ?? null);
            const now = Date.now();
            let status: FollowUpItem["status"] = "upcoming";
            let dueLabel = "Saved";
            if (e.status === "Converted" || e.convertedBookingId) {
              status = "booked";
              dueLabel = "Booked";
            } else if (e.status === "Closed" && e.lostReason) {
              status = "lost";
              dueLabel = `Lost • ${e.lostReason}`;
            } else if (dueMs !== null) {
              if (dueMs <= now) {
                status = "due";
                dueLabel = "Due Now";
              } else {
                status = "upcoming";
                dueLabel = dueMs <= now + 60 * 60000 ? `In ${Math.round((dueMs - now) / 60000)} mins` : "Upcoming";
              }
            }

            map.set(e.id, {
              id: e.id,
              name: e.customerName || "Enquiry Caller",
              phone: phoneDigits(e.phone),
              brand: e.brand || "Nesam Cabs",
              tripType: e.tripType || e.service || "One Way",
              route: e.pickup && e.drop ? `${e.pickup} → ${e.drop}` : (e.pickup || e.drop || "Route"),
              pickup: e.pickup || "",
              drop: e.drop || "",
              date: "Tomorrow",
              time: "8:00 AM",
              followUpDateTime: e.followUpDateTime,
              vehicleId: e.categoryId || "sedan",
              vehicleName: e.vehicle || "Dzire / Etios Or Similar",
              fare: e.estimate || 3725,
              note: e.note || "Asked for fare quote",
              status,
              dueLabel,
              dueTimestamp: dueMs ?? (now + 15 * 60000),
              lostReason: e.lostReason,
            });
          });
          return Array.from(map.values());
        });
      }
    });
    return () => unsub();
  }, []);

  // Periodic due check (every 15s) and on window focus / visibility change
  useEffect(() => {
    const checkDue = () => {
      const now = Date.now();
      setFollowUps((prev) => {
        let changed = false;
        const updated = prev.map((item) => {
          if (item.status === "upcoming" && item.dueTimestamp <= now) {
            changed = true;
            playAlertBeep();
            showToast(`Follow-up Alert: Call ${item.name} (${maskPhone(item.phone)}) for ${item.route}`);
            return {
              ...item,
              status: "due" as const,
              dueLabel: "Due Now",
            };
          }
          return item;
        });
        return changed ? updated : prev;
      });
    };

    const intervalId = window.setInterval(checkDue, 15000);
    const onFocus = () => checkDue();
    const onVisibility = () => {
      if (document.visibilityState === "visible") checkDue();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Format date display (DD-MM-YYYY) and badge
  const { dateDisplayStr, dayBadgeText, dayBadgeClass } = useMemo(() => {
    if (!pickupDateNative) return { dateDisplayStr: "22-11-2026", dayBadgeText: null, dayBadgeClass: "" };
    const [y, m, d] = pickupDateNative.split("-");
    const formatted = `${d}-${m}-${y}`;
    if (pickupDateNative === "2026-11-21") {
      return {
        dateDisplayStr: formatted,
        dayBadgeText: "Today",
        dayBadgeClass: "px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70",
      };
    } else if (pickupDateNative === "2026-11-22") {
      return {
        dateDisplayStr: formatted,
        dayBadgeText: "Tomorrow",
        dayBadgeClass: "px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/70",
      };
    }
    return { dateDisplayStr: formatted, dayBadgeText: null, dayBadgeClass: "" };
  }, [pickupDateNative]);

  // Current Route String
  const currentRouteStr = useMemo(() => {
    const p = pickupInput.trim() || "Coimbatore";
    const d = dropInput.trim() || "Madurai";
    if (tripType === "Rental") return `Local Rental • ${p}`;
    const stops = viaStops.map((s) => s.trim()).filter(Boolean);
    if (tripType === "Round Trip") {
      return stops.length ? `${p} → ${stops.join(" → ")} → ${d} → ${p}` : `${p} ⇄ ${d}`;
    }
    return stops.length ? `${p} → ${stops.join(" → ")} → ${d}` : `${p} → ${d}`;
  }, [tripType, pickupInput, dropInput, viaStops]);

  // Silent Distance Calculation
  const calculateDistance = () => {
    if (tripType === "Rental") {
      const km = rentalHours * 10;
      setAutoKm(km);
      setAutoMinutes(rentalHours * 60);
      return;
    }
    const p = pickupInput.trim();
    const d = dropInput.trim();
    const pts = [p];
    if (tripType === "Round Trip" || tripType === "Multicity") {
      viaStops.forEach((s) => {
        if (s.trim()) pts.push(s.trim());
      });
    }
    pts.push(d);
    if (tripType === "Round Trip") pts.push(p);

    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const c1 = lookupCoord(pts[i]);
      const c2 = lookupCoord(pts[i + 1]);
      if (c1 && c2) total += roadKm(c1, c2);
      else total += 75 + ((pts[i].length * 19 + pts[i + 1].length * 23) % 130);
    }
    const computedKm = Math.max(20, total);
    setAutoKm(computedKm);
    setAutoMinutes(Math.round((computedKm / 48) * 60));
  };

  // Tariff calculation for vehicle
  const computeVehicleFare = (v: DeskVehicle) => {
    const km = autoKm;
    if (tripType === "One Way" || tripType === "Multicity") {
      const billKm = Math.max(130, km);
      return {
        slab: `${tripType} • ${billKm} km (Min 130 km)`,
        total: billKm * v.oneWayRate + v.bata,
        rateNote: `₹${v.oneWayRate}/km + ₹${v.bata} Bata`,
      };
    }
    if (tripType === "Round Trip") {
      const days = roundTripDays;
      const pHrs = parseHours(pickupTime);
      const estHrs = autoMinutes / 60;
      if (days === 2 && pHrs >= 15) {
        const extra = Math.max(0, km - 400);
        return {
          slab: "Slab D • 3 PM+ Overnight (400 km)",
          total: v.base30 + 120 * v.roundRate + 250 * v.roundRate + extra * v.roundRate + v.bata * 2,
          rateNote: "400 km incl. + 2-Day Bata",
        };
      }
      if (days >= 2) {
        const billKm = Math.max(days * 250, km);
        return {
          slab: `${days}-Day Round Trip (${days * 250} km min)`,
          total: billKm * v.roundRate + days * v.bata,
          rateNote: `₹${v.roundRate}/km + ${days}d Bata`,
        };
      }
      if (km > 150) {
        const billKm = Math.max(250, km);
        return {
          slab: "Slab C • 1-Day (250 km / 11:45 PM)",
          total: billKm * v.roundRate + v.bata,
          rateNote: `₹${v.roundRate}/km + ₹${v.bata} Bata`,
        };
      }
      if (estHrs > 5) {
        return {
          slab: "Slab B • 8-Hr / 150 km Slab",
          total: v.base30 + 120 * v.roundRate + v.bata,
          rateNote: `150 km incl. + ₹${v.bata} Bata`,
        };
      }
      const billKm = Math.max(100, km);
      return {
        slab: `Slab A • Mini Round Trip (${billKm} km)`,
        total: v.base30 + (billKm - 30) * v.roundRate + v.bata,
        rateNote: `Base 30 km + ₹${v.roundRate}/km`,
      };
    }
    if (tripType === "Rental") {
      const h = rentalHours;
      return {
        slab: `Rental • ${h} ${h === 1 ? "Hr" : "Hrs"} / ${h * 10} km`,
        total: v.rental1Hr + (h - 1) * v.rentalPerHr,
        rateNote: `Includes ${h * 10} km`,
      };
    }
    const baseFlat = tripType === "Airport" ? v.base30 + 600 : v.base30 + 350;
    const extra = Math.max(0, km - 30);
    return {
      slab: `${tripType} • Standard Rate`,
      total: baseFlat + extra * v.oneWayRate,
      rateNote: `30 km base + ₹${v.oneWayRate}/km`,
    };
  };

  // Run calculation
  const handleCalculate = (e?: FormEvent) => {
    e?.preventDefault();
    setNotice(null);
    const p = pickupInput.trim();
    const d = dropInput.trim();
    if (!p) {
      setNotice("Please enter a pickup location.");
      return;
    }
    if (tripType !== "Rental" && !d) {
      setNotice("Please enter a drop location.");
      return;
    }
    calculateDistance();
    setCalculated(true);
  };

  // Swap pickup & drop
  const handleSwap = () => {
    setSpinSwap(true);
    setTimeout(() => setSpinSwap(false), 350);
    const tmp = pickupInput;
    setPickupInput(dropInput);
    setDropInput(tmp);
    if (calculated) {
      calculateDistance();
    }
  };

  // Clear Calculator
  const handleClear = () => {
    setPickupInput("");
    setDropInput("");
    setViaStops([]);
    setCalculated(false);
    setNotice(null);
  };

  // Try Sample shortcut
  const handleTrySample = () => {
    setPickupInput("Coimbatore");
    setDropInput("Madurai");
    setTripType("One Way");
    setAutoKm(215);
    setAutoMinutes(270);
    setCalculated(true);
    setNotice(null);
  };

  // Copy All 6 Fares for WhatsApp
  const handleCopyAllFares = () => {
    const lines = DESK_VEHICLES.map((v) => {
      const c = computeVehicleFare(v);
      return { name: v.name, seats: v.seats, fare: c.total };
    });
    const msg = formatWhatsAppQuote({
      brandName: DESK_BRANDS[brand].name,
      route: currentRouteStr,
      dateStr: dateDisplayStr,
      timeStr: pickupTime,
      vehicleLines: lines,
    });
    navigator.clipboard.writeText(msg).then(() => {
      setCopyAllStatus("Copied for WhatsApp!");
      setTimeout(() => setCopyAllStatus("Copy All for WhatsApp"), 2000);
    });
  };

  // Follow-Up modal opener
  const openFollowUpModal = (vehicleId = "sedan") => {
    setFuActiveVehicleId(vehicleId);
    setFuReminderMins(15);
    const target = new Date(Date.now() + 15 * 60000);
    setFuScheduleDate(toIsoDate(target));
    setFuScheduleTime(toHhMm(target));
    setFuMobile("");
    setFuName("");
    setFuNote("");
    setFuModalOpen(true);
  };

  // Synchronize scheduled date/time from preset minutes
  const handleFuReminderMinsChange = (mins: number) => {
    setFuReminderMins(mins);
    const target = new Date(Date.now() + mins * 60000);
    setFuScheduleDate(toIsoDate(target));
    setFuScheduleTime(toHhMm(target));
  };

  // Set tomorrow preset
  const handleFuTomorrowPreset = (hour24: number, labelText: string) => {
    const tmrw = new Date();
    tmrw.setDate(tmrw.getDate() + 1);
    setFuScheduleDate(toIsoDate(tmrw));
    setFuScheduleTime(`${String(hour24).padStart(2, "0")}:00`);
    if (!fuNote.trim()) {
      setFuNote(`Customer said will book ${labelText}`);
    }
  };

  // Caller Lookup Badge detection
  const fuCallerMatch = useMemo(() => {
    const digits = fuMobile.replace(/\D/g, "").slice(0, 10);
    return CALLER_DIRECTORY.find((c) => c.phone === digits) || null;
  }, [fuMobile]);

  const cbCallerMatch = useMemo(() => {
    const digits = cbMobile.replace(/\D/g, "").slice(0, 10);
    return CALLER_DIRECTORY.find((c) => c.phone === digits) || null;
  }, [cbMobile]);

  // Submit Follow-Up
  const handleSaveFollowUp = async (e: FormEvent) => {
    e.preventDefault();
    const phone = fuMobile.replace(/\D/g, "").slice(0, 10);
    if (phone.length < 10) {
      showToast("Please enter a valid 10-digit mobile number.");
      return;
    }
    const v = DESK_VEHICLES.find((x) => x.id === fuActiveVehicleId) || DESK_VEHICLES[1];
    const calc = computeVehicleFare(v);

    let targetTs = Date.now() + fuReminderMins * 60000;
    if (fuScheduleDate) {
      const parsed = new Date(`${fuScheduleDate}T${fuScheduleTime || "09:00"}:00`);
      if (!Number.isNaN(parsed.getTime())) targetTs = parsed.getTime();
    }
    const isImmediate = targetTs <= Date.now() + 5000;
    const formattedSched = formatScheduledDisplay(fuScheduleDate, fuScheduleTime);

    const newId = "FU-" + Math.floor(200 + Math.random() * 799);
    const item: FollowUpItem = {
      id: newId,
      name: fuName.trim() || fuCallerMatch?.name || "Enquiry Caller",
      phone,
      brand: DESK_BRANDS[brand].name,
      tripType,
      route: currentRouteStr,
      pickup: pickupInput.trim() || "Coimbatore",
      drop: dropInput.trim() || "Madurai",
      date: dateDisplayStr,
      time: pickupTime,
      followUpDateTime: formattedSched,
      vehicleId: v.id,
      vehicleName: v.name,
      fare: calc.total,
      note: fuNote.trim() || "Asked for fare quote",
      status: isImmediate ? "due" : "upcoming",
      dueLabel: isImmediate ? "Due Now" : formattedSched,
      dueTimestamp: targetTs,
    };

    setFollowUps((prev) => [item, ...prev]);
    setFuModalOpen(false);

    // Save to Firestore in background
    try {
      await saveEnquiry({
        pickup: item.pickup,
        drop: item.drop,
        brand: DESK_BRANDS[brand].name,
        service: tripType,
        tripType,
        vehicle: v.name,
        categoryId: v.id,
        estimate: calc.total,
        customerName: item.name,
        phone: item.phone,
        note: item.note,
        followUpDateTime: formattedSched,
        followUpAt: { toMillis: () => targetTs } as never,
      });
      onEnquirySaved?.();
    } catch {
      // offline/fallback kept in local state
    }

    showToast(isImmediate ? "Follow-up Alert triggered immediately!" : `Follow-up scheduled for ${formattedSched}`);
  };

  // Open Confirm Modal
  const openConfirmModal = (payload: ConfirmPayload) => {
    setConfirmPayload(payload);
    setCbPayPlan("later");
    setCbMobile(payload.customerPhone || "");
    setCbName(payload.customerName || "");
    setCbError(null);
    setCbSuccess(false);
    setConfirmModalOpen(true);
  };

  // Confirm booking submission
  const handleFinalConfirmBooking = async () => {
    const phone = cbMobile.replace(/\D/g, "").slice(0, 10);
    const name = cbName.trim() || cbCallerMatch?.name || "";
    if (phone.length < 10) {
      setCbError("Please enter a valid 10-digit customer mobile number.");
      return;
    }
    if (!name) {
      setCbError("Please enter the customer name.");
      return;
    }
    if (!confirmPayload) return;

    const rand = Math.floor(1000 + Math.random() * 9000);
    const bookingCode = `#NSM-2611-${rand}`;
    const p = { ...confirmPayload, bookingId: bookingCode, customerPhone: phone, customerName: name };
    setConfirmPayload(p);

    // Update follow-up status if converted
    if (p.followUpId) {
      setFollowUps((prev) =>
        prev.map((f) => (f.id === p.followUpId ? { ...f, status: "booked" as const, dueLabel: "Booked" } : f))
      );
      markEnquiryConverted(p.followUpId, bookingCode).catch(() => null);
    }

    // Call payment link if partial / full
    if (cbPayPlan === "partial" || cbPayPlan === "full") {
      const amt = cbPayPlan === "partial" ? Math.round(p.fare * 0.25) : p.fare;
      createBookingPaymentLink(bookingCode, amt, cbPayPlan === "partial" ? "advance" : "full").catch(() => null);
    }

    setCbSuccess(true);
    showToast(`Booking ${bookingCode} confirmed successfully!`);
  };

  // Copy WhatsApp Confirmation
  const handleCopyWaConfirmation = () => {
    if (!confirmPayload) return;
    const msg = formatWhatsAppBooking({
      brandName: DESK_BRANDS[brand].name,
      bookingId: confirmPayload.bookingId || "#NSM-2611-1001",
      customerName: confirmPayload.customerName,
      phone: confirmPayload.customerPhone,
      route: confirmPayload.route,
      dateStr: confirmPayload.date,
      timeStr: confirmPayload.time,
      vehicleName: confirmPayload.vehicle.name,
      fare: confirmPayload.fare,
    });
    navigator.clipboard.writeText(msg).then(() => {
      setCbCopyWaText("Copied!");
      setTimeout(() => setCbCopyWaText("Copy WhatsApp Confirmation"), 2000);
    });
  };

  // Snooze follow-up +15m
  const handleSnooze = async (fuId: string) => {
    const item = followUps.find((f) => f.id === fuId);
    if (!item) return;
    const newTs = Date.now() + 15 * 60000;
    setFollowUps((prev) =>
      prev.map((f) =>
        f.id === fuId
          ? {
              ...f,
              status: "upcoming" as const,
              dueLabel: "Snoozed +15m",
              dueTimestamp: newTs,
            }
          : f
      )
    );
    snoozeEnquiry(fuId, 15).catch(() => null);
    showToast(`Follow-up snoozed +15m for ${item.name}`);
  };

  // Reveal number submission
  const handleRevealSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!revealCategory || revealNote.trim().length < 10) {
      showToast("Please select a reason and enter at least 10 characters.");
      return;
    }
    const item = followUps.find((f) => f.id === pendingRevealFuId);
    if (!item) return;

    setRevealedIds((prev) => new Set(prev).add(item.id));
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const who = currentStaff();
    const staffName = `${who.name} (@${who.uid.slice(0, 8) || "staff"})`;

    const logEntry: RevealLog = {
      id: "rev-" + Date.now(),
      staff: staffName,
      caller: `${item.name} (${item.id})`,
      reason: `${revealCategory} — ${revealNote.trim()}`,
      time: timeStr,
    };
    setRevealLogs((prev) => [logEntry, ...prev]);
    setRevealModalOpen(false);

    revealEnquiryNumber(item.id, revealCategory, revealNote.trim()).catch(() => null);
    showToast(`Caller number revealed & logged (${item.name})`);
  };

  // Mark lost submission
  const handleLostSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const item = followUps.find((f) => f.id === pendingLostFuId);
    if (!item) return;

    setFollowUps((prev) =>
      prev.map((f) => (f.id === item.id ? { ...f, status: "lost" as const, lostReason: lostReasonSelected } : f))
    );
    setLostModalOpen(false);
    markEnquiryLost(item.id, lostReasonSelected).catch(() => null);
    showToast(`Marked ${item.name} as Lost (${lostReasonSelected})`);
  };

  // Due items & Top Due Item for Banner
  const dueItems = useMemo(() => followUps.filter((f) => f.status === "due"), [followUps]);
  const dueCount = dueItems.length;
  const topDueItem = dueItems[0] || null;

  // Filtered Queue
  const filteredFollowUps = useMemo(() => {
    if (fuFilter === "all") return followUps;
    return followUps.filter((f) => f.status === fuFilter);
  }, [followUps, fuFilter]);

  const sampleSedanFare = useMemo(() => computeVehicleFare(DESK_VEHICLES[1]), [autoKm, tripType, roundTripDays, rentalHours, pickupTime]);

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
        {/* LIVE FOLLOW-UP ALERT BANNER (POPS UP WHEN DUE)            */}
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
                      {topDueItem.name} ({revealedIds.has(topDueItem.id) ? `+91 ${topDueItem.phone}` : maskPhone(topDueItem.phone)})
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5 truncate">
                    {topDueItem.route} • {topDueItem.vehicleName} ({formatINR(topDueItem.fare)}) — &ldquo;{topDueItem.note}&rdquo;
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleSnooze(topDueItem.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors"
                >
                  Snooze +15m
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const v = DESK_VEHICLES.find((x) => x.id === topDueItem.vehicleId) || DESK_VEHICLES[1];
                    openConfirmModal({
                      route: topDueItem.route,
                      tripType: topDueItem.tripType,
                      date: topDueItem.date,
                      time: topDueItem.time,
                      vehicle: v,
                      fare: topDueItem.fare,
                      slab: topDueItem.tripType,
                      customerPhone: topDueItem.phone,
                      customerName: topDueItem.name,
                      followUpId: topDueItem.id,
                    });
                  }}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors flex items-center gap-1.5"
                >
                  <Icon name="check-circle-2" size={14} />
                  <span>Fare OK • Book Now</span>
                </button>
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
              {/* Exact 6 Trip Type Tabs */}
              <div role="tablist" aria-label="Trip Type" className="bg-[#F1F5F9] p-1 rounded-xl grid grid-cols-3 gap-1">
                {TRIP_SERVICES.map((s) => {
                  const active = tripType === s.key;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => {
                        setTripType(s.key);
                        if (s.key === "Multicity" && viaStops.length === 0) setViaStops([""]);
                      }}
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

              {/* Route Inputs with Visual Track & Swap */}
              <div className="relative flex items-stretch gap-2.5">
                <div className="w-4 flex flex-col items-center py-5 shrink-0 select-none" aria-hidden="true">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-50 shrink-0"></span>
                  {tripType !== "Rental" && <div className="flex-1 w-0 border-l-2 border-dashed border-slate-300 my-1.5"></div>}
                  {tripType !== "Rental" && <Icon name="map-pin" size={14} className="text-[#991B1B] shrink-0 fill-crimson-50" />}
                </div>

                <div className="flex-1 space-y-2.5 relative">
                  {/* Pickup */}
                  <div className="h-[54px] px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white focus-within:border-[#991B1B] focus-within:ring-2 focus-within:ring-[#991B1B]/15 transition-all flex flex-col justify-center">
                    <label htmlFor="qfPickupInput" className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 leading-none mb-1">
                      Pickup Location
                    </label>
                    <input
                      type="text"
                      id="qfPickupInput"
                      value={pickupInput}
                      onChange={(e) => {
                        setPickupInput(e.target.value);
                        setNotice(null);
                      }}
                      placeholder="e.g., Coimbatore"
                      className="w-full text-sm font-medium text-slate-800 placeholder:text-slate-400 placeholder:font-normal bg-transparent focus:outline-none pr-8"
                    />
                  </div>

                  {/* Optional Stops for Round Trip & Multicity */}
                  {(tripType === "Round Trip" || tripType === "Multicity") && (
                    <div className="space-y-2 fade-slide-in">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (viaStops.length < 4) setViaStops([...viaStops, ""]);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#991B1B] bg-crimson-50/70 border border-crimson-200/70 hover:bg-crimson-50"
                        >
                          <Icon name="plus" size={12} />
                          <span>{tripType === "Round Trip" ? "Add Itinerary Stop" : "Add Via-Stop"}</span>
                        </button>
                        {tripType === "Round Trip" && (
                          <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                            Itinerary Lock
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {viaStops.map((stop, idx) => (
                          <div key={idx} className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={stop}
                              onChange={(e) => {
                                const next = [...viaStops];
                                next[idx] = e.target.value;
                                setViaStops(next);
                              }}
                              placeholder="Enter stop city..."
                              className="flex-1 h-9 px-3 text-xs font-medium text-slate-800 bg-slate-50 border border-dashed border-slate-300 rounded-lg focus:bg-white focus:border-[#991B1B] focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const next = [...viaStops];
                                next.splice(idx, 1);
                                setViaStops(next);
                              }}
                              className="w-8 h-8 rounded-lg border border-slate-200 text-slate-400 hover:text-[#991B1B] flex items-center justify-center"
                            >
                              <Icon name="x" size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Swap Button */}
                  {tripType !== "Rental" && viaStops.length === 0 && (
                    <button
                      type="button"
                      onClick={handleSwap}
                      aria-label="Swap pickup and drop"
                      className={`absolute right-3 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-white border border-slate-200 shadow-sm text-slate-500 hover:text-[#991B1B] hover:border-[#991B1B] flex items-center justify-center transition-colors ${
                        spinSwap ? "swap-spin" : ""
                      }`}
                    >
                      <Icon name="arrow-up-down" size={14} />
                    </button>
                  )}

                  {/* Drop */}
                  {tripType !== "Rental" && (
                    <div className="h-[54px] px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white focus-within:border-[#991B1B] focus-within:ring-2 focus-within:ring-[#991B1B]/15 transition-all flex flex-col justify-center">
                      <label htmlFor="qfDropInput" className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 leading-none mb-1">
                        {tripType === "Multicity" ? "Final Drop Location" : "Drop Location"}
                      </label>
                      <input
                        type="text"
                        id="qfDropInput"
                        value={dropInput}
                        onChange={(e) => {
                          setDropInput(e.target.value);
                          setNotice(null);
                        }}
                        placeholder="e.g., Madurai"
                        className="w-full text-sm font-medium text-slate-800 placeholder:text-slate-400 placeholder:font-normal bg-transparent focus:outline-none pr-8"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Conditional: Rental Duration Card */}
              {tripType === "Rental" && (
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
                          {rentalHours} hours • {rentalHours * 10} km included
                        </p>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-crimson-50 text-[#991B1B] border border-crimson-200/70 shrink-0">
                      Change
                    </span>
                  </button>
                </div>
              )}

              {/* Date & Time Row */}
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
                      value={pickupDateNative}
                      onChange={(e) => setPickupDateNative(e.target.value)}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="qfTimeSelect" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Pickup Time
                  </label>
                  <div className="relative h-11 rounded-xl border border-slate-200 bg-white focus-within:border-[#991B1B] flex items-center">
                    <select
                      id="qfTimeSelect"
                      value={pickupTime}
                      onChange={(e) => setPickupTime(e.target.value)}
                      className="w-full h-full pl-3 pr-8 text-xs sm:text-sm font-medium text-slate-800 bg-transparent appearance-none focus:outline-none cursor-pointer"
                    >
                      <option value="6:00 AM">6:00 AM</option>
                      <option value="7:00 AM">7:00 AM</option>
                      <option value="8:00 AM">8:00 AM</option>
                      <option value="9:00 AM">9:00 AM</option>
                      <option value="10:00 AM">10:00 AM</option>
                      <option value="12:00 PM">12:00 PM</option>
                      <option value="2:00 PM">2:00 PM</option>
                      <option value="3:00 PM">3:00 PM</option>
                      <option value="4:00 PM">4:00 PM</option>
                      <option value="6:00 PM">6:00 PM</option>
                      <option value="8:00 PM">8:00 PM</option>
                      <option value="10:00 PM">10:00 PM</option>
                    </select>
                    <Icon name="clock" size={16} className="text-slate-400 absolute right-3 pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Conditional: Round Trip Days Stepper */}
              {tripType === "Round Trip" && (
                <div className="fade-slide-in">
                  <div className="px-3.5 py-2.5 rounded-xl border border-blue-200/80 bg-blue-50/20 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900">Days</p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {roundTripDays === 1
                          ? "Same day"
                          : roundTripDays === 2
                          ? "Returns tomorrow • 11:45 PM"
                          : `${roundTripDays}-day round trip • 11:45 PM`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-200 bg-white shrink-0">
                      <button
                        type="button"
                        disabled={roundTripDays <= 1}
                        onClick={() => setRoundTripDays(Math.max(1, roundTripDays - 1))}
                        className="w-8 h-8 rounded-lg bg-blue-50 text-[#2563EB] hover:bg-blue-100 disabled:opacity-40 flex items-center justify-center"
                      >
                        <Icon name="minus" size={14} />
                      </button>
                      <span className="min-w-[56px] text-center text-xs font-bold text-slate-900">
                        {roundTripDays} {roundTripDays === 1 ? "day" : "days"}
                      </span>
                      <button
                        type="button"
                        disabled={roundTripDays >= 15}
                        onClick={() => setRoundTripDays(Math.min(15, roundTripDays + 1))}
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
                <div className="px-3 py-2 rounded-xl text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-2">
                  <Icon name="info" size={14} className="shrink-0" />
                  <span>{notice}</span>
                </div>
              )}

              {/* Primary CTA */}
              <div className="pt-1 mt-auto">
                <button
                  type="submit"
                  className="w-full bg-[#991B1B] hover:bg-[#7F1D1D] active:scale-[0.99] text-white font-semibold text-sm py-3 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2"
                >
                  <Icon name="calculator" size={16} />
                  <span>Get Fare</span>
                </button>
              </div>
            </form>
          </section>

          {/* RIGHT COLUMN (7/12): FARES LIST + FOLLOW-UP & BOOK ACTIONS */}
          <section className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 shadow-sm flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                  <Icon name="car" size={16} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-slate-900">Vehicle Fares</h2>
                  <p className="text-[11px] text-slate-500 truncate">
                    {calculated ? `${dateDisplayStr} • ${pickupTime}` : "The fare for every vehicle appears here"}
                  </p>
                </div>
              </div>

              {calculated && (
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
                    onClick={() => openFollowUpModal("sedan")}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 transition-colors flex items-center gap-1.5"
                  >
                    <Icon name="bell-plus" size={14} />
                    <span>Save Follow-up</span>
                  </button>
                </div>
              )}
            </div>

            {/* Empty State */}
            {!calculated && (
              <div className="flex-1 p-8 sm:p-12 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                  <Icon name="calculator" size={24} />
                </div>
                <p className="text-sm font-bold text-slate-800">No fare calculated yet</p>
                <p className="text-xs text-slate-500 mt-1 max-w-xs">
                  Enter pickup, drop, and date on the left, then click <strong>Get Fare</strong> to view all 6 vehicle prices.
                </p>
                <button
                  type="button"
                  onClick={handleTrySample}
                  className="mt-4 px-3.5 py-2 rounded-xl text-xs font-semibold text-[#991B1B] bg-crimson-50 hover:bg-crimson-100/80 border border-crimson-200/70 transition-colors"
                >
                  Try Sample: Coimbatore → Madurai
                </button>
              </div>
            )}

            {/* Populated Fares State */}
            {calculated && (
              <div className="flex-1 flex flex-col fade-slide-in">
                {/* Route & Slab Meta Bar */}
                <div className="px-5 py-2.5 bg-slate-50/90 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-slate-800 truncate">{currentRouteStr}</span>
                    <span className="text-[11px] font-medium text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full shrink-0">
                      {tripType === "Rental"
                        ? `${rentalHours}h / ${rentalHours * 10} km`
                        : `Est. ${autoKm} km • ~${formatDuration(autoMinutes)}`}
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/70 shrink-0">
                    {sampleSedanFare.slab}
                  </span>
                </div>

                {/* 6 Vehicle Fare Rows */}
                <div className="divide-y divide-slate-100 flex-1 overflow-y-auto">
                  {DESK_VEHICLES.map((v) => {
                    const calc = computeVehicleFare(v);
                    return (
                      <div
                        key={v.id}
                        className="px-5 py-3.5 hover:bg-slate-50/80 transition-colors flex flex-wrap sm:flex-nowrap items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-900">{v.name}</span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                              {v.category}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {v.seats} • {v.bags} • {calc.rateNote}
                          </p>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <div className="text-right mr-1">
                            <p className="text-base font-bold text-slate-900">{formatINR(calc.total)}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => openFollowUpModal(v.id)}
                            title="Save follow-up for this cab"
                            className="h-8 px-2.5 rounded-lg text-[11px] font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 transition-colors flex items-center gap-1"
                          >
                            <Icon name="bell-plus" size={14} />
                            <span className="hidden sm:inline">Follow-up</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              openConfirmModal({
                                route: currentRouteStr,
                                tripType,
                                date: dateDisplayStr,
                                time: pickupTime,
                                vehicle: v,
                                fare: calc.total,
                                slab: calc.slab,
                                customerPhone: "",
                                customerName: "",
                                followUpId: null,
                              })
                            }
                            className="h-8 px-3 rounded-lg text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs transition-colors flex items-center gap-1"
                          >
                            <Icon name="check" size={14} />
                            <span>Book</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Footer Note */}
                <div className="px-5 py-2.5 bg-slate-50/70 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span>Includes Driver Bata • Excludes Toll, Parking &amp; State Permit Tax (Actuals)</span>
                  <span className="font-medium text-slate-700">Click <strong>Book</strong> if customer says OK</span>
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
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
              {QUEUE_FILTERS.map((f) => {
                const active = fuFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFuFilter(f.id)}
                    className={`px-3 py-1 rounded-lg text-xs transition-all ${
                      active ? "font-semibold bg-white text-slate-900 shadow-xs" : "font-medium text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Queue Cards Container */}
          <div className="divide-y divide-slate-100">
            {filteredFollowUps.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">No follow-ups in this filter.</div>
            ) : (
              filteredFollowUps.map((item) => {
                const isRev = revealedIds.has(item.id);
                const displayPhone = isRev ? `+91 ${item.phone}` : maskPhone(item.phone);

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
                            Lost • {item.lostReason || "Closed"}
                          </span>
                        )}
                        {item.status === "upcoming" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                            <Icon name="calendar-clock" size={12} />
                            {item.followUpDateTime || item.dueLabel}
                          </span>
                        )}

                        <span className="text-sm font-bold text-slate-900">{item.name}</span>
                        <span className={`text-xs font-semibold ${isRev ? "text-emerald-700" : "text-slate-600"}`}>
                          {displayPhone}
                        </span>

                        {!isRev && (
                          <button
                            type="button"
                            onClick={() => {
                              setPendingRevealFuId(item.id);
                              setRevealCategory("");
                              setRevealNote("");
                              setRevealModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80"
                          >
                            <Icon name="eye" size={12} />
                            <span>View #</span>
                          </button>
                        )}

                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          {item.brand}
                        </span>
                      </div>

                      <p className="text-xs text-slate-700 font-medium">
                        {item.route} • <span className="text-slate-500">{item.date}, {item.time}</span> •{" "}
                        <strong className="text-[#991B1B]">{item.vehicleName} ({formatINR(item.fare)})</strong>
                      </p>
                      <p className="text-[11px] text-slate-500 italic">&ldquo;{item.note}&rdquo;</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      {item.status === "due" || item.status === "upcoming" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setPendingLostFuId(item.id);
                              setLostModalOpen(true);
                            }}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-red-700 bg-red-50 hover:bg-red-100"
                          >
                            Lost
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSnooze(item.id)}
                            className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50"
                          >
                            Snooze +15m
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const v = DESK_VEHICLES.find((x) => x.id === item.vehicleId) || DESK_VEHICLES[1];
                              openConfirmModal({
                                route: item.route,
                                tripType: item.tripType,
                                date: item.date,
                                time: item.time,
                                vehicle: v,
                                fare: item.fare,
                                slab: item.tripType,
                                customerPhone: item.phone,
                                customerName: item.name,
                                followUpId: item.id,
                              });
                            }}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs flex items-center gap-1"
                          >
                            <Icon name="check-circle-2" size={14} />
                            <span>Fare OK • Book</span>
                          </button>
                        </>
                      ) : item.status === "booked" ? (
                        <span className="text-xs font-semibold text-emerald-700">Converted to Booking</span>
                      ) : (
                        <span className="text-xs font-medium text-slate-400">Closed ({item.lostReason || "Lost"})</span>
                      )}
                    </div>
                  </div>
                );
              })
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
              100% Audited
            </span>
          </div>
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
        </section>
      </main>

      {/* ========================================================= */}
      {/* MODAL 1: SAVE FOLLOW-UP & SET ALERT                       */}
      {/* ========================================================= */}
      {fuModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden fade-slide-in">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
                  <Icon name="bell-plus" size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Save Follow-Up &amp; Set Alert</h3>
                  <p className="text-[11px] text-slate-500">
                    {currentRouteStr} • {DESK_VEHICLES.find((x) => x.id === fuActiveVehicleId)?.category} (
                    {formatINR(computeVehicleFare(DESK_VEHICLES.find((x) => x.id === fuActiveVehicleId) || DESK_VEHICLES[1]).total)})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFuModalOpen(false)}
                className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveFollowUp} className="p-5 space-y-4">
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
                      value={fuMobile}
                      onChange={(e) => {
                        const d = e.target.value.replace(/\D/g, "").slice(0, 10);
                        setFuMobile(d);
                        const match = CALLER_DIRECTORY.find((c) => c.phone === d);
                        if (match && !fuName) setFuName(match.name);
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
                    value={fuName}
                    onChange={(e) => setFuName(e.target.value)}
                    placeholder="e.g., Ramesh"
                    className="w-full h-10 px-3 text-sm font-medium text-slate-800 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
                  />
                </div>
              </div>

              {fuCallerMatch && (
                <p className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/70 px-3 py-1.5 rounded-lg">
                  Existing Caller: {fuCallerMatch.name} • {fuCallerMatch.trips} completed trip
                  {fuCallerMatch.trips === 1 ? "" : "s"} (Pref: {fuCallerMatch.prefCab})
                </p>
              )}

              {/* Scheduled Follow-Up Date & Time */}
              <div className="p-3 rounded-xl bg-slate-50/90 border border-slate-200/80 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                    <Icon name="calendar-clock" size={14} className="text-amber-600" />
                    <span>Follow-Up Date &amp; Time</span>
                  </label>
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
                      value={fuScheduleDate}
                      onChange={(e) => setFuScheduleDate(e.target.value)}
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
                      onChange={(e) => setFuScheduleTime(e.target.value)}
                      className="w-full h-9 px-2.5 text-xs font-semibold text-slate-800 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#991B1B]"
                    />
                  </div>
                </div>
              </div>

              {/* Quick Reminder Time Chips */}
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Follow-Up Alert Time
                </label>
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
                        onClick={() => handleFuReminderMinsChange(chip.mins)}
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
                  value={fuNote}
                  onChange={(e) => setFuNote(e.target.value)}
                  placeholder="e.g., Asking family, will confirm by evening"
                  className="w-full h-10 px-3 text-xs sm:text-sm text-slate-800 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm py-3 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2"
              >
                <Icon name="bell-ring" size={16} />
                <span>Save Follow-Up &amp; Activate Alert</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 2: CONFIRM BOOKING (FARE APPROVED)                  */}
      {/* ========================================================= */}
      {confirmModalOpen && confirmPayload && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col fade-slide-in">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <Icon name="check-circle-2" size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Confirm Booking (Fare Approved)</h3>
                  <p className="text-[11px] text-slate-500">
                    {DESK_BRANDS[brand].name} • {confirmPayload.date} at {confirmPayload.time}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmModalOpen(false)}
                className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center"
              >
                <Icon name="x" size={16} />
              </button>
            </div>

            {/* Modal Form View */}
            {!cbSuccess ? (
              <div className="p-5 space-y-4 overflow-y-auto">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">{confirmPayload.route}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {confirmPayload.vehicle.name} ({confirmPayload.vehicle.category})
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-bold text-[#991B1B]">{formatINR(confirmPayload.fare)}</p>
                    <span className="text-[10px] font-medium text-slate-400">+ Toll/Permit</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="cbMobileInp" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                      Customer Mobile *
                    </label>
                    <div className="flex items-center h-10 bg-white border border-slate-200 rounded-xl overflow-hidden focus-within:border-[#991B1B]">
                      <span className="px-2.5 text-xs font-semibold text-slate-500 bg-slate-50 h-full flex items-center border-r border-slate-200">
                        +91
                      </span>
                      <input
                        type="tel"
                        id="cbMobileInp"
                        maxLength={10}
                        value={cbMobile}
                        onChange={(e) => {
                          const d = e.target.value.replace(/\D/g, "").slice(0, 10);
                          setCbMobile(d);
                          setCbError(null);
                          const match = CALLER_DIRECTORY.find((c) => c.phone === d);
                          if (match && !cbName) setCbName(match.name);
                        }}
                        placeholder="10-digit mobile"
                        className="w-full h-full px-2.5 text-sm font-medium text-slate-800 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="cbNameInp" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                      Customer Name *
                    </label>
                    <input
                      type="text"
                      id="cbNameInp"
                      value={cbName}
                      onChange={(e) => {
                        setCbName(e.target.value);
                        setCbError(null);
                      }}
                      placeholder="Enter customer name"
                      className="w-full h-10 px-3 text-sm font-medium text-slate-800 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
                    />
                  </div>
                </div>

                {cbCallerMatch && (
                  <p className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/70 px-3 py-1.5 rounded-lg">
                    Existing Caller: {cbCallerMatch.name} • {cbCallerMatch.trips} completed trip
                    {cbCallerMatch.trips === 1 ? "" : "s"} (Pref: {cbCallerMatch.prefCab})
                  </p>
                )}

                {/* Compact Payment Plan */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Payment Mode</span>
                    <span className="text-[11px] font-semibold text-[#2563EB]">Powered by Razorpay</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setCbPayPlan("later")}
                      className={`p-2.5 rounded-xl text-left transition-all ${
                        cbPayPlan === "later"
                          ? "border-2 border-[#2563EB] bg-blue-50/30"
                          : "border border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <p className="text-xs font-bold text-slate-900">Pay Later</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">₹0 Now</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCbPayPlan("partial")}
                      className={`p-2.5 rounded-xl text-left transition-all ${
                        cbPayPlan === "partial"
                          ? "border-2 border-[#2563EB] bg-blue-50/30"
                          : "border border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <p className="text-xs font-bold text-slate-900">25% Advance</p>
                      <p className="text-[10px] text-[#2563EB] font-semibold mt-0.5">
                        {formatINR(Math.round(confirmPayload.fare * 0.25))} Link
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCbPayPlan("full")}
                      className={`p-2.5 rounded-xl text-left transition-all ${
                        cbPayPlan === "full"
                          ? "border-2 border-[#2563EB] bg-blue-50/30"
                          : "border border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <p className="text-xs font-bold text-slate-900">100% Online</p>
                      <p className="text-[10px] text-[#2563EB] font-semibold mt-0.5">
                        {formatINR(confirmPayload.fare)} Link
                      </p>
                    </button>
                  </div>
                </div>

                {cbError && (
                  <div className="px-3 py-2 rounded-xl text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
                    {cbError}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleFinalConfirmBooking}
                  className={`w-full font-semibold text-sm py-3.5 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 ${
                    cbPayPlan === "later"
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : "bg-[#2563EB] hover:bg-blue-700 text-white"
                  }`}
                >
                  <Icon name="check-circle-2" size={16} />
                  <span>
                    {cbPayPlan === "later"
                      ? "Confirm Booking (Pay Later)"
                      : `Confirm & Send Razorpay Link (${formatINR(
                          cbPayPlan === "partial" ? Math.round(confirmPayload.fare * 0.25) : confirmPayload.fare
                        )})`}
                  </span>
                </button>
              </div>
            ) : (
              /* Modal Success View */
              <div className="p-6 text-center space-y-4 fade-slide-in">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center mx-auto">
                  <Icon name="check-circle-2" size={28} />
                </div>
                <div>
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                    {confirmPayload.bookingId}
                  </span>
                  <h4 className="text-base font-bold text-slate-900 mt-2">Booking Confirmed!</h4>
                  <p className="text-xs text-slate-500 mt-1">
                    {confirmPayload.customerName} • {confirmPayload.route} • {confirmPayload.vehicle.name} (
                    {formatINR(confirmPayload.fare)}) —{" "}
                    {cbPayPlan === "later"
                      ? "Pay Later to Driver"
                      : `Razorpay Link (${formatINR(
                          cbPayPlan === "partial" ? Math.round(confirmPayload.fare * 0.25) : confirmPayload.fare
                        )}) sent to +91 ${confirmPayload.customerPhone}`}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2.5 justify-center pt-1">
                  <button
                    type="button"
                    onClick={handleCopyWaConfirmation}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 flex items-center justify-center gap-1.5"
                  >
                    <Icon name="copy" size={14} />
                    <span>{cbCopyWaText}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmModalOpen(false);
                      if (onSelectBooking && confirmPayload.bookingId) {
                        onSelectBooking(confirmPayload.bookingId);
                      }
                    }}
                    className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-[#991B1B] text-white hover:bg-[#7F1D1D]"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 3: RENTAL DURATION (1 TO 15 HOURS)                  */}
      {/* ========================================================= */}
      {rentalModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden fade-slide-in">
            <div className="pt-3 pb-1 flex justify-center">
              <span className="w-11 h-1 rounded-full bg-slate-300/80"></span>
            </div>
            <div className="px-5 pt-2 pb-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-bold text-slate-900">Rental duration</h3>
                <button
                  type="button"
                  onClick={() => setRentalModalOpen(false)}
                  className="w-8 h-8 rounded-full text-slate-500 hover:bg-slate-100 flex items-center justify-center"
                >
                  <Icon name="x" size={20} />
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">Choose from 1 to 15 hours to calculate instant rental fares.</p>
              <div className="grid grid-cols-3 gap-2.5 mt-4">
                {Array.from({ length: 15 }, (_, i) => i + 1).map((h) => {
                  const active = rentalHours === h;
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => {
                        setRentalHours(h);
                        setRentalModalOpen(false);
                        if (calculated) calculateDistance();
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
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
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
                onClick={() => setRevealModalOpen(false)}
                className="w-8 h-8 rounded-full text-slate-400 hover:bg-slate-100 flex items-center justify-center"
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            <form onSubmit={handleRevealSubmit} className="p-5 space-y-3.5 text-xs">
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
                  placeholder="e.g., Calling back caller to confirm Madurai Sedan booking"
                  className="w-full h-9 px-3 border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-[#991B1B] hover:bg-[#7F1D1D] text-white font-semibold py-2.5 rounded-xl transition-colors"
              >
                Log Reason &amp; Reveal Number
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL 5: MARK FOLLOW-UP AS LOST (REASON TRACKER)          */}
      {/* ========================================================= */}
      {lostModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden fade-slide-in">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Mark Enquiry as Lost</h3>
                <p className="text-[11px] text-slate-500">Select why caller did not book</p>
              </div>
              <button
                type="button"
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
              <button
                type="submit"
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 rounded-xl transition-colors"
              >
                Save Lost Reason
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toastText && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl text-xs font-medium flex items-center gap-2.5 fade-slide-in">
          <Icon name="bell-ring" size={16} className="text-amber-400 shrink-0" />
          <span>{toastText}</span>
        </div>
      )}
    </div>
  );
}
