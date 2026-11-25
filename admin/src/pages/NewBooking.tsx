import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Customer, VehicleCategory, MasterLocation } from "../types";
import { subscribeCustomers } from "../services/adminFirestoreService";
import {
  COUNTRY_CODES, PAYMENT_METHODS, createAdminBooking, emailError, emptyManualBooking, newRequestId, normalizePhone, pointFromLocation, quoteAdminBooking, whatsappError,
  type CreatedAdminBooking, type ManualBookingForm,
} from "../services/adminBookingService";
import { ActionError } from "../services/callables";
import { createBookingPaymentLink, markEnquiryConverted, isMulticityEnquiry, MULTICITY_CONVERSION_MESSAGE, type Enquiry } from "../services/enquiryService";
import { getTripPaymentOptions } from "../services/bookingOpsService";
import { useCan, useStaffFlag } from "../components/AccessContext";
import { Toast, useToast } from "../components/Feedback";
import { type PickedPoint } from "../components/MapLocationPicker";
import MapPickerDialog from "../components/quickFareDesk/MapPickerDialog";
import { PlaceField } from "../components/booking/QuickFare";
import "../styles/quickFareDesk.css";
import { pickedForBooking, pinNeedsAddress } from "../domain/bookingPoints";
import { Icon } from "../components/ui";
import {
  SaveEnquiryDialog, emptyTrip, estimateAll,
  tripPickupAt, tripEndAt, useQuickData, validateTrip, type CategoryEstimate, type QuickTrip,
} from "../components/booking/QuickFare";
import { rupee } from "../domain/officeStage";
import { cabCategoryBadge, cabDisplayName } from "../domain/categoryLabel";
import { formatClock12, isoDateIST } from "../utils/time";
import { copyText } from "../utils/clipboard";
import { ArrowRight, Calculator, Check, Fuel, Leaf } from "lucide-react";

export interface NewBookingDraft {
  trip?: QuickTrip;
  categoryId?: string;
  estimates?: CategoryEstimate[];
  enquiry?: Enquiry;
  /** Opened from the Customers Directory: this existing customer is selected. Their number never reaches a Staff ID; the server books on the saved one. */
  customer?: { id: string; name: string; email: string; phoneMasked: string; preferredCab?: string; preferredDriver?: string };
  /** Booking source the trip was quoted under (e.g. from the Quick Fare desk), so the booking keeps the same brand and prices. */
  channel?: ManualBookingForm["channel"];
}

type Step = 1 | 2 | 3 | 4;

type BrandId = ManualBookingForm["channel"];
const BRANDS: { id: BrandId; label: string; dotClass: string }[] = [
  { id: "nesam", label: "Nesam Cabs", dotClass: "bg-[#9F1212] ring-crimson-100" },
  { id: "onewaycarrentals", label: "One Way Car Rentals", dotClass: "bg-blue-600 ring-blue-100" },
  { id: "people_taxi", label: "People Taxi", dotClass: "bg-emerald-600 ring-emerald-100" },
];

export type TripTypeTab = "One Way" | "Round Trip" | "Multicity" | "Airport" | "Rental" | "Local";

const TRIP_TABS: { id: TripTypeTab; label: string; icon: "arrow-right" | "arrow-left-right" | "route" | "plane" | "clock" | "map-pin" }[] = [
  { id: "One Way", label: "One Way", icon: "arrow-right" },
  { id: "Round Trip", label: "Round Trip", icon: "arrow-left-right" },
  { id: "Multicity", label: "Multicity", icon: "route" },
  { id: "Airport", label: "Airport", icon: "plane" },
  { id: "Rental", label: "Rental", icon: "clock" },
  { id: "Local", label: "Local", icon: "map-pin" },
];

/** A typed place → the matching saved location (Service & Fare Settings › Locations) in the booking's point format; null when none matches. */
function placeFor(text: string, locations?: MasterLocation[]): PickedPoint | null {
  const lower = (text || "").toLowerCase().trim();
  if (!lower || !locations?.length) return null;
  const loc = locations.find((l) => l.name.toLowerCase() === lower) ?? locations.find((l) => l.name.toLowerCase().includes(lower) || lower.includes(l.name.toLowerCase()));
  return loc && typeof loc.lat === "number" && typeof loc.lng === "number" ? pointFromLocation(loc) : null;
}


function formatDuration(totalMins: number): string {
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

function formatDateDDMMYYYY(isoDate: string): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  return `${d}-${m}-${y}`;
}

/** Pickup times offered at the desk: stored as 24-hour "HH:mm" (what the quote and booking expect), shown on a 12-hour clock. */
const TIME_VALUES = ["05:00", "06:00", "06:30", "07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "18:00", "20:00", "22:00"];

const PIN_ADDRESS_MESSAGE = "No address was found for this map pin. Open Map and type the address under the map, or choose the place from the list.";

const DISPOSAL_ID = "place-local-disposal";
const DISPOSAL_NAME = "Local City Disposal";
const disposalFor = (p: PickedPoint): PickedPoint => ({
  lat: p.lat + 0.04, lng: p.lng + 0.04, name: DISPOSAL_NAME, address: `${p.name} & City Limits (Within city disposal)`, type: "other", confirmed: true, placeId: DISPOSAL_ID,
});

/** Step icons (approved set), drawn inline: 20px, 1.75px rounded strokes in the current text colour. */
const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function StepGlyph({ kind, state }: { kind: "trip" | "cab" | "review"; state: "active" | "done" | "upcoming" }) {
  if (kind === "trip") {
    // Route path from an origin dot to a destination pin.
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="5.5" cy="18" r="2.25" {...STROKE} />
        <path d="M7.75 18h6.5a3.25 3.25 0 0 0 0-6.5h-4.5a3.25 3.25 0 0 1 0-6.5h1.5" {...STROKE} />
        <path d="M17.5 9.5c-1.9-1.85-2.85-3.3-2.85-4.4a2.85 2.85 0 0 1 5.7 0c0 1.1-.95 2.55-2.85 4.4Z" {...STROKE} />
        <circle cx="17.5" cy="5.1" r=".6" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "review") {
    // Checklist with a completed check.
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <rect x="5" y="4" width="14" height="17" rx="2.25" {...STROKE} />
        <path d="M9 3h6v2.5H9z" {...STROKE} />
        <path d="M8.5 10.5h7M8.5 14h3.5" {...STROKE} />
        <path d="m12.75 17.25 1.75 1.75 3.25-3.5" {...STROKE} />
      </svg>
    );
  }
  // Cab with a small fare badge.
  const badge = state === "active" ? "#ffffff" : state === "done" ? "#991b1b" : "#94a3b8";
  const glyph = state === "active" ? "#991b1b" : "#ffffff";
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M4 14.5v-3l1.6-4.2A2 2 0 0 1 7.47 6h7.06a2 2 0 0 1 1.87 1.3L18 11.5v3" {...STROKE} />
      <path d="M3 14.5h15v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" {...STROKE} />
      <path d="M6 18.5V20M15 18.5V20M5.5 11.5h11" {...STROKE} />
      <circle cx="6.5" cy="15.75" r=".75" fill="currentColor" />
      <circle cx="14.5" cy="15.75" r=".75" fill="currentColor" />
      <rect x="15.25" y="2.5" width="7.5" height="6.5" rx="1.75" fill={badge} />
      <path d="M17.4 4.4h3.2M17.4 5.8h3.2M18.9 4.4c.9 0 1.3.5 1.3 1.05 0 .6-.5 1.1-1.5 1.1h-.6l2 1.35" fill="none" stroke={glyph} strokeWidth={0.9} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function NewBooking({ draft, onCreated, onCancel, onEnquirySaved }: {
  draft?: NewBookingDraft | null;
  onCreated: (b: CreatedAdminBooking) => void;
  onCancel: () => void;
  onEnquirySaved: (e: Enquiry) => void;
}) {
  const data = useQuickData();
  const allLocations = useMemo(() => [...(data.pickups || []), ...(data.drops || [])], [data.pickups, data.drops]);
  const [brand, setBrand] = useState<BrandId>(() => draft?.channel ?? "nesam");
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const brandSwitcherRef = useRef<HTMLDivElement>(null);

  // Stepper state
  const [step, setStep] = useState<Step>(draft?.estimates ? 2 : 1);

  // Customer state
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerMobile, setCustomerMobile] = useState(() => draft?.enquiry?.phone?.replace(/^\+91/, "") ?? "");
  const [customerName, setCustomerName] = useState(() => draft?.customer?.name ?? draft?.enquiry?.customerName ?? "");
  const [phoneOnFile, setPhoneOnFile] = useState(() => draft?.customer?.phoneMasked ?? "");
  const [customerId, setCustomerId] = useState(() => draft?.customer?.id ?? "");
  const [customerEmail, setCustomerEmail] = useState(() => draft?.customer?.email ?? "");
  const [matchedCustomer, setMatchedCustomer] = useState<Customer | null>(null);
  const [mobileSuggestionsOpen, setMobileSuggestionsOpen] = useState(false);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  // Extra customer contact details
  const [whatsappSame, setWhatsappSame] = useState(true);
  const [waCountryCode, setWaCountryCode] = useState("+91");
  const [waNumber, setWaNumber] = useState("");
  const [someoneElse, setSomeoneElse] = useState(false);
  const [paxName, setPaxName] = useState("");
  const [paxPhone, setPaxPhone] = useState("");
  const [paxWhatsapp, setPaxWhatsapp] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropAddress, setDropAddress] = useState("");
  const [showOptionalCustomer, setShowOptionalCustomer] = useState(false);

  // Trip type & route
  const [tripType, setTripType] = useState<TripTypeTab>(() => {
    if (draft?.trip?.multicity || draft?.enquiry?.tripType === "Multicity") return "Multicity";
    if (draft?.trip?.tripType === "Local Rental" || draft?.enquiry?.tripType === "Rental") return "Rental";
    if (draft?.trip?.tripType === "Airport Taxi" || draft?.enquiry?.tripType === "Airport") return "Airport";
    if (draft?.trip?.tripType === "Round Trip" || draft?.enquiry?.tripType === "Round Trip") return "Round Trip";
    return "One Way";
  });
  const [pickupText, setPickupText] = useState(() => draft?.trip?.pickupText ?? draft?.enquiry?.pickup ?? "");
  const [dropText, setDropText] = useState(() => draft?.trip?.dropText ?? draft?.enquiry?.drop ?? "");
  const [pickupPoint, setPickupPoint] = useState<PickedPoint | null>(() => draft?.trip?.pickup ?? null);
  const [dropPoint, setDropPoint] = useState<PickedPoint | null>(() => draft?.trip?.drop ?? null);
  const [viaStops, setViaStops] = useState<string[]>(() => (draft?.trip?.stops ?? []).map((s) => s.text || s.point?.name || ""));
  /** The suggestion picked for each via stop, in the same order as `viaStops`. */
  const [stopPoints, setStopPoints] = useState<(PickedPoint | null)[]>(() => (draft?.trip?.stops ?? []).map((s) => s.point ?? null));
  const [flightNumber, setFlightNumber] = useState("");
  const [rentalHours, setRentalHours] = useState(() => draft?.trip?.rentalHours ?? 4);
  const [rentalModalOpen, setRentalModalOpen] = useState(false);
  const [roundTripDays, setRoundTripDays] = useState(() => draft?.trip?.days ?? 1);
  const [swapSpinning, setSwapSpinning] = useState(false);

  // Map picker (the shared admin map dialog) and pin address problems shown under each location field
  const [mapPickerTarget, setMapPickerTarget] = useState<"pickup" | "drop" | null>(null);
  const [pinError, setPinError] = useState<{ pickup?: string; drop?: string }>({});

  // Date & Time
  const tomorrowIso = useMemo(() => {
    const d = new Date(Date.now() + 86400000);
    return isoDateIST(d);
  }, []);
  const [pickupDate, setPickupDate] = useState(() => draft?.trip?.date || tomorrowIso);
  const [pickupTime, setPickupTime] = useState(() => draft?.trip?.time || "08:00");

  // Extras
  const [waitingHours, setWaitingHours] = useState(0);
  const [extraPickups, setExtraPickups] = useState(0);
  const [extraDrops, setExtraDrops] = useState(0);
  const [extraPDOpen, setExtraPDOpen] = useState(false);
  const [roofCarrier, setRoofCarrier] = useState(() => draft?.trip?.carrier ?? false);
  const [pets, setPets] = useState(() => draft?.trip?.pets ?? false);
  // CNG rate card when the quote came from the Quick Fare desk on CNG; cleared to price on the standard Diesel / Petrol rate.
  const [fuel, setFuel] = useState<"cng" | undefined>(() => (draft?.trip?.fuel === "cng" ? "cng" : undefined));

  // Vehicle selection & Fare
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(() => draft?.categoryId || "");
  const [customFare, setCustomFare] = useState<string>("");
  const [customFareReason, setCustomFareReason] = useState<string>("");
  const [estimates, setEstimates] = useState<CategoryEstimate[] | null>(draft?.estimates ?? null);
  const [quoting, setQuoting] = useState(false);

  // Step 3 Review & Payment
  const [driverSlipNote, setDriverSlipNote] = useState(() => (draft?.customer?.preferredDriver ? `Preferred driver: ${draft.customer.preferredDriver}` : ""));
  const [paymentPlan, setPaymentPlan] = useState<"later" | "partial" | "full">("later");
  /** Online payments and the advance share, from Service & Fare Settings › Payment options (null until checked). */
  const [payOptions, setPayOptions] = useState<{ online: boolean; partPercent: number; recommended: string } | null>(null);
  const [payOptionsError, setPayOptionsError] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discount: number } | null>(null);
  const [couponMsg, setCouponMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(true);
  const [advanceEnabled, setAdvanceEnabled] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceMethod, setAdvanceMethod] = useState("UPI");
  const [advanceReference, setAdvanceReference] = useState("");

  // Step 4 Confirmation
  const [confirmedBooking, setConfirmedBooking] = useState<{
    id: string;
    bookingId: string;
    fare: number;
    paymentBadge: string;
    /** Real payment link (createBookingPaymentLink) and whether the server reports it as delivered. */
    paymentLink?: { url: string; delivered: boolean } | null;
    /** Why the payment link could not be created (the booking itself is saved). */
    paymentLinkError?: string;
    route: string;
    dateTime: string;
    vehicle: string;
    flight?: string;
    driverNote?: string;
  } | null>(null);

  // General state
  const [busy, setBusy] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [saveEnquiryOpen, setSaveEnquiryOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [copyLinkFeedback, setCopyLinkFeedback] = useState<string | null>(null);
  const [mobileSuggestionsLabel] = useState("Customers");

  const requestId = useRef(newRequestId());
  const canOverride = useCan("finance");
  const canDiscount = useCan("finance") || useCan("pricing");
  const canApplyCoupon = useStaffFlag("partnerRights", "applyCoupon");
  const canSeePayout = useStaffFlag("sensitive", "vendorPayout");
  const { toast, show: showToast } = useToast(7000);

  // Subscribe to real customers
  useEffect(() => {
    const unsub = subscribeCustomers(setCustomers);
    return () => unsub();
  }, []);

  // Handle click outside brand switcher
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (brandSwitcherRef.current && !brandSwitcherRef.current.contains(e.target as Node)) {
        setBrandMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Text carried in with a draft or enquiry is matched to a saved location. Typed text is left alone: matching it here
  // would pick a place mid-word and close the suggestions.
  const [prefill] = useState(() => ({ pickup: pickupText, drop: dropText }));
  useEffect(() => {
    if (!pickupPoint && pickupText && pickupText === prefill.pickup) {
      const p = placeFor(pickupText, allLocations);
      if (p) setPickupPoint(p);
    }
  }, [pickupText, pickupPoint, allLocations]);

  useEffect(() => {
    if (!dropPoint && dropText && dropText === prefill.drop && tripType !== "Rental") {
      const d = placeFor(dropText, allLocations);
      if (d) setDropPoint(d);
    }
  }, [dropText, dropPoint, tripType, allLocations]);

  // Handle phone lookup from customer list
  useEffect(() => {
    const digits = customerMobile.replace(/\D/g, "").slice(-10);
    if (digits.length === 10) {
      const found = customers.find((c) => (c.phone || "").replace(/\D/g, "").slice(-10) === digits);
      if (found) {
        setMatchedCustomer(found);
        setCustomerId(found.id);
        if (!customerName) setCustomerName(found.name);
        if (!customerEmail) setCustomerEmail(found.email || "");
        if (found.preferredDriver && !driverSlipNote) setDriverSlipNote(`Preferred driver: ${found.preferredDriver}`);
      } else {
        setMatchedCustomer(null);
        if (!phoneOnFile) setCustomerId("");
      }
    } else {
      setMatchedCustomer(null);
      if (!phoneOnFile) setCustomerId("");
    }
  }, [customerMobile, customers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quick trip builder
  const currentQuickTrip = useMemo((): QuickTrip => {
    const baseTrip = emptyTrip();
    const mappedType: QuickTrip["tripType"] =
      tripType === "Round Trip"
        ? "Round Trip"
        : tripType === "Rental"
        ? "Local Rental"
        : tripType === "Airport"
        ? "Airport Taxi"
        : "One Way";

    const effectiveDropPoint = tripType === "Rental" && pickupPoint ? disposalFor(pickupPoint) : dropPoint;

    return {
      ...baseTrip,
      tripType: mappedType,
      multicity: tripType === "Multicity",
      local: tripType === "Local",
      pickupText,
      dropText: tripType === "Rental" ? DISPOSAL_NAME : dropText,
      pickup: pickupPoint,
      drop: effectiveDropPoint,
      stops: (tripType === "Round Trip" || tripType === "Multicity")
        ? viaStops.map((text, i) => ({ text, point: stopPoints[i] ?? placeFor(text, allLocations) }))
        : [],
      date: pickupDate,
      time: pickupTime,
      days: roundTripDays,
      rentalHours: tripType === "Rental" ? rentalHours : undefined,
      carrier: roofCarrier,
      pets,
      fuel,
      waitingMin: String(waitingHours * 60),
    };
  }, [tripType, pickupText, dropText, pickupPoint, dropPoint, viaStops, stopPoints, pickupDate, pickupTime, roundTripDays, rentalHours, roofCarrier, pets, fuel, waitingHours, allLocations]);

  // The selected cab and its server quote (every price comes from the booking server; nothing is priced locally).
  const selectedEstimate = useMemo(() => estimates?.find((e) => e.category.id === selectedVehicleId) ?? null, [estimates, selectedVehicleId]);
  const liveQuote = selectedEstimate?.quote ? selectedEstimate : null;
  const currentCalc = useMemo(() => {
    if (!liveQuote?.quote) return null;
    const q = liveQuote.quote;
    return {
      slabName: q.service || tripType,
      total: q.quote.total,
      breakdown: q.breakup?.lines.map((l) => ({ label: l.label, amount: l.amount ?? 0 })) || [],
    };
  }, [liveQuote, tripType]);
  /** Customer-facing cab name (Vehicle categories › Display Text), the same as Quick Fare shows; the category id is unchanged. */
  const vehicleName = selectedEstimate ? cabDisplayName(selectedEstimate.category) : "";
  /** CNG can be chosen once at least one bookable category has CNG turned on (Vehicle categories). */
  const cngOffered = data.categories.some((c) => c.cngEnabled === true);
  /** Road distance and time from the server quote (never estimated in the browser). */
  const routeText = useMemo(() => {
    if (tripType === "Rental") return `${rentalHours} ${rentalHours === 1 ? "hour" : "hours"}`;
    const q = liveQuote?.quote;
    if (!q?.roadKm) return "";
    return `${Math.round(q.roadKm)} km${tripType === "Round Trip" ? " (up & down)" : ""}${q.roadMinutes ? ` • ~${formatDuration(Math.round(q.roadMinutes))}` : ""}`;
  }, [liveQuote, tripType, rentalHours]);

  // Calculated and final fares
  const calculatedBaseFare = useMemo(() => {
    if (customFare && Number(customFare) > 0) return Number(customFare);
    return currentCalc?.total ?? 0;
  }, [customFare, currentCalc]);

  const discountAmount = useMemo(() => {
    if (appliedCoupon) return appliedCoupon.discount;
    return 0;
  }, [appliedCoupon]);

  const finalNetFare = useMemo(() => {
    return Math.max(0, calculatedBaseFare - discountAmount);
  }, [calculatedBaseFare, discountAmount]);

  /** Advance share: the configured "pay part now" percentage, else the desk's standard 25%. */
  const partPercent = payOptions?.partPercent ?? 25;
  /** Online plans are offered only when online payments are switched on (unknown status keeps them available). */
  const onlineBlocked = !!payOptions && !payOptions.online;
  const payNowAmount = useMemo(() => {
    if (paymentPlan === "later") return 0;
    if (paymentPlan === "partial") return Math.round((finalNetFare * partPercent) / 100);
    return finalNetFare;
  }, [paymentPlan, finalNetFare, partPercent]);

  // Return formatted route string
  const formattedRouteString = useMemo(() => {
    if (tripType === "Rental") return `Pickup: ${pickupText}`;
    const validStops = viaStops.map((s) => s.trim()).filter(Boolean);
    if (tripType === "Round Trip") {
      return validStops.length > 0
        ? `${pickupText} → ${validStops.join(" → ")} → ${dropText} → ${pickupText}`
        : `${pickupText} ⇄ ${dropText}`;
    }
    if (tripType === "Multicity") {
      return validStops.length > 0
        ? `${pickupText} → ${validStops.join(" → ")} → ${dropText}`
        : `${pickupText} → ${dropText}`;
    }
    return `${pickupText} → ${dropText}`;
  }, [tripType, pickupText, dropText, viaStops]);

  // Return formatted schedule string
  const formattedScheduleString = useMemo(() => {
    const dt = formatDateDDMMYYYY(pickupDate);
    const time12 = formatClock12(pickupTime);
    if (tripType === "Round Trip") {
      const days = roundTripDays;
      if (days === 1) return `${dt} • ${time12} (1 day, Same day)`;
      const endD = new Date(pickupDate + "T00:00:00");
      endD.setDate(endD.getDate() + (days - 1));
      const endFormatted = `${String(endD.getDate()).padStart(2, "0")}-${String(endD.getMonth() + 1).padStart(2, "0")}-${endD.getFullYear()}`;
      return `${dt} • ${time12} (${days} days • Returns ${endFormatted}, 11:45 PM)`;
    }
    return `${dt} at ${time12}`;
  }, [pickupDate, pickupTime, tripType, roundTripDays]);

  /**
   * The map dialog reports the pin as it moves and again once its address is found. The field shows that address's
   * short name; a pin without an address shows its coordinates and asks for the address (never a generic label).
   */
  const applyPickedPoint = (side: "pickup" | "drop", picked: PickedPoint | null) => {
    const { point: p, label } = pickedForBooking(picked);
    if (side === "pickup") { setPickupPoint(p); setPickupText(label); }
    else { setDropPoint(p); setDropText(label); }
    setPinError((e) => ({ ...e, [side]: undefined }));
    setEstimates(null);
  };

  // Swap locations handler
  const handleSwapLocations = () => {
    setSwapSpinning(true);
    setEstimates(null);
    const tempT = pickupText;
    const tempP = pickupPoint;
    setPickupText(dropText);
    setPickupPoint(dropPoint);
    setDropText(tempT);
    setDropPoint(tempP);
    setPinError((e) => ({ pickup: e.drop, drop: e.pickup }));
    setTimeout(() => setSwapSpinning(false), 350);
  };

  /** Prices every bookable cab for this trip on the server; keeps the chosen cab when it is still priced. */
  const runQuotes = async (trip: QuickTrip): Promise<boolean> => {
    if (!data.categories.length) {
      setErrorNotice("No cab categories are set up for booking yet. Add them in Service & Fare Settings › Vehicle categories.");
      return false;
    }
    setQuoting(true);
    try {
      const list = await estimateAll(trip, data.categories, brand);
      setEstimates(list);
      const priced = list.filter((x) => x.quote);
      const pref = matchedCustomer?.preferredCab?.toLowerCase();
      const keep = priced.find((x) => x.category.id === selectedVehicleId)
        ?? (pref ? priced.find((x) => x.category.name.toLowerCase().includes(pref) || pref.includes(x.category.name.toLowerCase())) : undefined)
        ?? priced[0];
      setSelectedVehicleId(keep?.category.id ?? "");
      return true;
    } catch (err) {
      setErrorNotice(err instanceof ActionError ? err.message : "Fares could not be loaded. Check your connection and try again.");
      return false;
    } finally {
      setQuoting(false);
    }
  };

  // View Cab Fares (Step 1 -> Step 2): the same checks as before, then real server prices.
  const handleGetEstimate = async (e?: FormEvent) => {
    e?.preventDefault();
    setErrorNotice(null);

    if (draft?.enquiry && isMulticityEnquiry(draft.enquiry) && viaStops.length === 0) {
      setErrorNotice(MULTICITY_CONVERSION_MESSAGE);
      return;
    }
    if (!pickupText.trim()) {
      setErrorNotice("Please enter a pickup location to continue.");
      return;
    }
    if (tripType !== "Rental" && !dropText.trim()) {
      setErrorNotice("Please enter a drop destination to continue.");
      return;
    }
    if (tripType === "Multicity" && viaStops.filter((s) => s.trim()).length === 0) {
      setErrorNotice("Add at least one via-stop city between your pickup and final drop.");
      return;
    }

    // Places resolve from the saved locations or a map pick; an unknown place is never given made-up coordinates.
    let pPt = pickupPoint;
    if (!pPt) {
      pPt = placeFor(pickupText, allLocations);
      if (pPt) setPickupPoint(pPt);
    }
    if (!pPt) {
      setErrorNotice("Choose the pickup from the list or set it on the map.");
      return;
    }
    if (pinNeedsAddress(pPt)) {
      setPinError((e) => ({ ...e, pickup: PIN_ADDRESS_MESSAGE }));
      setErrorNotice("Add the pickup address for the map pin before viewing fares.");
      return;
    }
    let dPt = dropPoint;
    if (tripType === "Rental") {
      dPt = disposalFor(pPt);
      setDropPoint(dPt);
    } else if (!dPt) {
      dPt = placeFor(dropText, allLocations);
      if (dPt) setDropPoint(dPt);
    }
    if (!dPt) {
      setErrorNotice("Choose the drop from the list or set it on the map.");
      return;
    }
    if (pinNeedsAddress(dPt)) {
      setPinError((e) => ({ ...e, drop: PIN_ADDRESS_MESSAGE }));
      setErrorNotice("Add the drop address for the map pin before viewing fares.");
      return;
    }
    const trip: QuickTrip = { ...currentQuickTrip, pickup: pPt, drop: dPt };
    const problem = validateTrip(trip);
    if (problem) {
      setErrorNotice(problem);
      return;
    }

    setBusy(true);
    try {
      if (await runQuotes(trip)) setStep(2);
    } finally {
      setBusy(false);
    }
  };

  // Online payments and the advance share for this trip (Service & Fare Settings › Payment options), checked on Review.
  useEffect(() => {
    if (step !== 3) return;
    let live = true;
    setPayOptionsError(false);
    getTripPaymentOptions(pickupPoint, pickupDate && pickupTime ? `${pickupDate}T${pickupTime}` : "")
      .then((r) => {
        if (!live) return;
        const part = r.choices.find((c) => c.id === "part");
        setPayOptions({ online: r.online, partPercent: part && part.percent > 0 && part.percent < 100 ? part.percent : 25, recommended: r.choices.find((c) => c.recommended)?.id ?? "" });
        if (!r.online) setPaymentPlan("later");
      })
      .catch(() => { if (live) setPayOptionsError(true); });
    return () => { live = false; };
  }, [step, pickupPoint, pickupDate, pickupTime]);

  /** Step 2 → 3 only with a priced cab. */
  const handleContinueToReview = () => {
    if (!currentCalc) {
      setErrorNotice("Choose a cab that has a fare to continue.");
      return;
    }
    setErrorNotice(null);
    setStep(3);
  };

  /** The stepper: going back keeps every entry; going forward runs the same checks as the buttons. */
  const goToStep = (n: 1 | 2 | 3) => {
    if (step === 4 || busy || quoting || n === step) return;
    if (n < step) { setErrorNotice(null); setStep(n); return; }
    if (n === 2 && step === 1) { void handleGetEstimate(); return; }
    if (n === 3 && step === 2) handleContinueToReview();
  };

  // Select vehicle in Step 2
  const handleSelectVehicle = (vehId: string) => {
    setSelectedVehicleId(vehId);
    setErrorNotice(null);
  };

  /** Diesel ⇄ CNG: re-prices every cab on that fuel's configured rates; trip and customer inputs stay as entered. */
  const handleChangeFuel = async (next: "cng" | undefined) => {
    if (next === fuel || quoting) return;
    setFuel(next);
    // A coupon was checked against the old fare: it is re-applied by the operator on the new one.
    setAppliedCoupon(null);
    setCouponMsg(null);
    setErrorNotice(null);
    await runQuotes({ ...currentQuickTrip, pickup: pickupPoint, drop: tripType === "Rental" && pickupPoint ? disposalFor(pickupPoint) : dropPoint, fuel: next });
  };

  // Apply Coupon
  const handleApplyCoupon = async () => {
    const code = couponCode.trim().toUpperCase();
    if (!code) {
      setCouponMsg({ ok: false, text: "Enter a coupon code." });
      return;
    }
    setCheckingCoupon(true);
    try {
      // The booking server checks the code against Offers & Coupons for this trip and fare.
      const testForm = bookingForm();
      testForm.couponCode = code;
      const fresh = await quoteAdminBooking(testForm, newRequestId());
      const disc = fresh.couponDiscount ?? 0;
      if (!fresh.couponCode || disc <= 0) {
        setAppliedCoupon(null);
        setCouponMsg({ ok: false, text: `${code} does not give a discount on this trip.` });
      } else {
        setAppliedCoupon({ code: fresh.couponCode, discount: disc });
        setCouponMsg({ ok: true, text: `${fresh.couponCode} applied · ${rupee(disc)} off` });
      }
    } catch (err) {
      setAppliedCoupon(null);
      setCouponMsg({ ok: false, text: err instanceof ActionError ? err.message : "The coupon could not be checked. Try again." });
    } finally {
      setCheckingCoupon(false);
    }
  };

  // Build full booking form for submission
  const bookingForm = (): ManualBookingForm => {
    const base = emptyManualBooking();
    const mappedType: ManualBookingForm["tripType"] =
      tripType === "Round Trip"
        ? "Round Trip"
        : tripType === "Rental"
        ? "Local Rental"
        : tripType === "Airport"
        ? "Airport Taxi"
        : tripType === "Multicity"
        ? "Multicity"
        : "One Way";

    const pickupIso = pickupDate && pickupTime ? `${pickupDate}T${pickupTime}` : "";
    const endIso =
      mappedType === "Round Trip"
        ? `${pickupDate}T23:59`
        : "";

    return {
      ...base,
      channel: brand,
      customerId,
      customerName: customerName.trim(),
      customerPhone: phoneOnFile ? phoneOnFile : customerMobile,
      whatsappSame,
      whatsappCountryCode: waCountryCode,
      whatsappNumber: waNumber,
      email: customerEmail,
      pickup: pickupPoint,
      drop: tripType === "Rental" && pickupPoint ? disposalFor(pickupPoint) : dropPoint,
      stops: (tripType === "Round Trip" || tripType === "Multicity")
        ? viaStops.map((t, i) => {
            return stopPoints[i] ?? placeFor(t, allLocations) ?? ({ lat: 0, lng: 0, name: t, address: t, type: "other", confirmed: false } as PickedPoint);
          }).filter((p) => p.confirmed)
        : [],
      pickupAddress: pickupAddress.trim(),
      dropAddress: dropAddress.trim(),
      categoryId: selectedVehicleId,
      tripType: mappedType,
      multicity: tripType === "Multicity",
      rentalHours: tripType === "Rental" ? rentalHours : undefined,
      tripDays: roundTripDays,
      pickupAt: pickupIso,
      tripEndAt: endIso,
      paymentMethod: paymentPlan === "later" ? "Cash" : "UPI",
      // Only an advance actually received is recorded; an online payment is marked paid by the verified Razorpay webhook.
      advanceEnabled,
      advanceAmount: advanceEnabled ? advanceAmount : "",
      advanceMethod: advanceEnabled ? advanceMethod : "UPI",
      advanceReference: advanceEnabled ? advanceReference : "",
      notes: [driverSlipNote.trim(), flightNumber ? `Flight: ${flightNumber}` : ""].filter(Boolean).join(" • "),
      flightNumber: flightNumber.trim() || undefined,
      driverSlipNote: driverSlipNote.trim() || undefined,
      waitingHours,
      extraPickups,
      extraDrops,
      overrideEnabled: !!(customFare && Number(customFare) > 0 && Number(customFare) !== (currentCalc?.total ?? 0)),
      overrideFare: customFare,
      overrideReason: customFareReason || "Agreed phone tariff",
      couponCode: appliedCoupon?.code,
      fuelType: fuel,
    };
  };

  // Confirm booking: success is shown only after the server saved it. An online plan then creates a real payment link.
  const handleConfirmBooking = async () => {
    if (!termsAccepted) {
      setErrorNotice("Please accept the booking terms to confirm.");
      return;
    }
    if (!currentCalc) {
      setErrorNotice("Choose a cab with a fare before confirming.");
      return;
    }
    setBusy(true);
    setErrorNotice(null);

    let created: CreatedAdminBooking;
    try {
      created = await createAdminBooking(bookingForm(), requestId.current, currentCalc.total, {
        passenger: someoneElse ? { name: paxName.trim(), phone: paxPhone, whatsapp: paxWhatsapp.trim() } : null,
        enquirySource: "Phone",
        flightNumber: flightNumber.trim() || undefined,
        driverSlipNote: driverSlipNote.trim() || undefined,
        tripExtras: {
          hillTravel: false,
          roofCarrier,
          pets,
          waitingMinutes: waitingHours * 60,
          waitingHours,
          extraPickups,
          extraDrops,
        },
        termsAccepted: true,
      });
    } catch (err) {
      setErrorNotice(err instanceof ActionError ? err.message : "The booking was not saved. Check your connection and try again; retrying will not create a duplicate.");
      setBusy(false);
      return;
    }

    if (draft?.enquiry) {
      await markEnquiryConverted(draft.enquiry.id, created.bookingId).catch(() => undefined);
    }

    let paymentLink: { url: string; delivered: boolean } | null = null;
    let paymentLinkError = "";
    if (paymentPlan !== "later" && payNowAmount > 0) {
      try {
        const link = await createBookingPaymentLink(created.id, payNowAmount, paymentPlan === "full" ? "full" : "advance");
        paymentLink = { url: link.shortUrl, delivered: link.delivered === true };
      } catch (err) {
        paymentLinkError = err instanceof ActionError ? err.message : "The payment link could not be created.";
      }
    }

    let badge = "Pay later to driver";
    if (paymentPlan !== "later") {
      badge = paymentLink
        ? paymentLink.delivered ? `Payment link sent (${rupee(payNowAmount)})` : `Payment link created (${rupee(payNowAmount)})`
        : "Payment link not created";
    }

    setConfirmedBooking({
      id: created.id,
      bookingId: created.bookingId || created.id,
      fare: finalNetFare,
      paymentBadge: badge,
      paymentLink,
      paymentLinkError: paymentLinkError || undefined,
      route: formattedRouteString,
      dateTime: formattedScheduleString,
      vehicle: `${vehicleName}${fuel === "cng" ? " (CNG)" : ""}`,
      flight: flightNumber,
      driverNote: driverSlipNote,
    });
    setStep(4);
    setBusy(false);
  };

  // Copy WhatsApp slip
  const handleCopyWhatsApp = () => {
    if (!confirmedBooking) return;
    const { bookingId, route, dateTime, vehicle, fare, paymentBadge, driverNote, flight, paymentLink } = confirmedBooking;
    const flightLine = flight ? `\nFlight / Terminal: ${flight}` : "";
    const noteLine = driverNote ? `\nDriver Slip Note: ${driverNote}` : "";
    const linkLine = paymentLink ? `\nPayment Link: ${paymentLink.url}` : "";
    const brandName = BRANDS.find((b) => b.id === brand)?.label || "Nesam Cabs";

    const msg = `*${brandName} — Booking Confirmed*\nBooking ID: ${bookingId}\nCustomer: ${customerName || "Customer"}\nPlan: ${currentCalc?.slabName ?? tripType}\nRoute: ${route}${flightLine}\nPickup: ${dateTime}\nCab: ${vehicle}\nFare: ${rupee(fare)} (+ Toll/Parking/Permit actuals)\nPayment: ${paymentBadge}${noteLine}${linkLine}\nThank you for booking with us!`;

    void copyText(msg).then((ok) => {
      setCopyFeedback(ok ? "Copied — not sent" : "Copy failed");
      setTimeout(() => setCopyFeedback(null), 2500);
    });
  };

  // Copy Razorpay link
  const handleCopyLink = () => {
    if (!confirmedBooking?.paymentLink) return;
    void copyText(confirmedBooking.paymentLink.url).then((ok) => {
      setCopyLinkFeedback(ok ? "Copied!" : "Copy failed");
      setTimeout(() => setCopyLinkFeedback(null), 2000);
    });
  };

  // Reset to brand new booking
  const handleResetNewBooking = () => {
    setStep(1);
    setConfirmedBooking(null);
    setCustomerMobile("");
    setCustomerName("");
    setPhoneOnFile("");
    setCustomerId("");
    setMatchedCustomer(null);
    setPickupText("");
    setDropText("");
    setPickupPoint(null);
    setDropPoint(null);
    setViaStops([]);
    setStopPoints([]);
    setTripType("One Way");
    setRoundTripDays(1);
    setRentalHours(4);
    setCustomFare("");
    setDriverSlipNote("");
    setPaymentPlan("later");
    setEstimates(null);
    setCouponCode("");
    setAppliedCoupon(null);
    setCouponMsg(null);
    setFlightNumber("");
    setSelectedVehicleId("");
    requestId.current = newRequestId();
  };

  const STEPS: { n: 1 | 2 | 3; label: string; icon: "trip" | "cab" | "review" }[] = [
    { n: 1, label: "Trip Details", icon: "trip" },
    { n: 2, label: "Cab & Fare", icon: "cab" },
    { n: 3, label: "Review & Confirm", icon: "review" },
  ];

  return (
    <div className="w-full min-w-0 text-slate-900 selection:bg-crimson-100 selection:text-crimson-800">
      <Toast toast={toast} />

      <div className="@container w-full min-w-0 bg-white rounded-2xl border border-slate-200/90 shadow-sm">
          {/* Card header: title + booking source */}
          <div className="px-4 sm:px-6 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
            <h1 className="text-lg font-bold text-slate-900 leading-tight">New Booking</h1>

            {/* Sleek Custom Brand Source Switcher */}
            <div className="relative shrink-0" ref={brandSwitcherRef}>
              <button
                type="button"
                onClick={() => setBrandMenuOpen(!brandMenuOpen)}
                aria-haspopup="listbox"
                aria-expanded={brandMenuOpen}
                className="h-9 pl-2.5 pr-3 rounded-xl bg-slate-50 hover:bg-slate-100/90 border border-slate-200/90 flex items-center gap-2 transition-all focus:outline-none focus:ring-2 focus:ring-[#9F1212]/15 focus:border-[#9F1212]"
              >
                <span className={`w-2 h-2 rounded-full ring-2 shrink-0 ${BRANDS.find((b) => b.id === brand)?.dotClass}`} />
                <span className="text-[11px] font-medium text-slate-400 hidden sm:inline">Source:</span>
                <span className="text-xs font-semibold text-slate-800 max-w-[130px] sm:max-w-none truncate">
                  {BRANDS.find((b) => b.id === brand)?.label}
                </span>
                <Icon name="chevrons-up-down" size={14} className="text-slate-400 shrink-0" />
              </button>

              {/* Floating Brand Menu */}
              {brandMenuOpen && (
                <div role="listbox" className="absolute right-0 top-[calc(100%+6px)] z-40 w-56 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 fade-slide-in">
                  <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Booking Source</p>
                  {BRANDS.map((b) => {
                    const isSelected = b.id === brand;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => { setBrand(b.id); setBrandMenuOpen(false); setEstimates(null); }}
                        className={`w-full px-2.5 py-2 rounded-lg flex items-center justify-between gap-2 text-left transition-colors ${
                          isSelected ? "bg-crimson-50/70 text-[#9F1212]" : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span className={`w-2 h-2 rounded-full ring-2 shrink-0 ${b.dotClass}`} />
                          <span className={`text-xs truncate ${isSelected ? "font-semibold" : "font-medium"}`}>{b.label}</span>
                        </span>
                        {isSelected && <Icon name="check" size={14} className="text-[#9F1212] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Stepper: Trip Details → Cab & Fare → Review & Confirm (forward steps run the same checks as the buttons) */}
          {step !== 4 && (
            <nav aria-label="Booking steps" className="px-4 sm:px-6 py-4 border-b border-slate-100">
              <ol className="flex items-center">
                {STEPS.map((st, i) => {
                  const done = step > st.n;
                  const active = step === st.n;
                  const reachable = st.n < step || st.n === step + 1;
                  return (
                    <li key={st.n} className={`flex items-center min-w-0 ${i < STEPS.length - 1 ? "flex-1" : ""}`}>
                      <button
                        type="button"
                        onClick={() => goToStep(st.n)}
                        disabled={!reachable && !active}
                        aria-current={active ? "step" : undefined}
                        className="group flex flex-col @min-[560px]:flex-row items-center gap-1.5 @min-[560px]:gap-2.5 min-w-0 rounded-xl p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#991B1B]/40 disabled:cursor-default"
                      >
                        <span className={`relative w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-colors ${
                          active ? "bg-[#991B1B] text-white ring-4 ring-crimson-100" : done ? "bg-crimson-50 text-[#991B1B] border border-crimson-200" : "bg-white text-slate-400 border border-slate-300"
                        }`}>
                          <StepGlyph kind={st.icon} state={active ? "active" : done ? "done" : "upcoming"} />
                          {done && (
                            <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-600 text-white ring-2 ring-white flex items-center justify-center" aria-hidden="true">
                              <Check className="w-2.5 h-2.5" strokeWidth={3} />
                            </span>
                          )}
                        </span>
                        <span className={`text-[11px] @min-[560px]:text-sm font-semibold whitespace-nowrap ${active ? "text-[#991B1B]" : done ? "text-slate-800" : "text-slate-500"}`}>
                          {st.label}
                          {done && <span className="sr-only"> (completed)</span>}
                        </span>
                      </button>
                      {i < STEPS.length - 1 && (
                        <span aria-hidden="true" className={`flex-1 h-0.5 mx-2 @min-[560px]:mx-4 rounded-full min-w-4 ${step > st.n ? "bg-[#991B1B]" : "bg-slate-200"}`} />
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
          )}

          {/* ========================================================= */}
          {/* STEP 1: PLAN                                              */}
          {/* ========================================================= */}
          {step === 1 && (
            <div className="px-4 sm:px-6 py-5 space-y-5 fade-slide-in">
              {/* 1. Trip Type Segmented Tabs */}
              <div role="tablist" aria-label="Trip Type" className="bg-[#F1F5F9] p-1 rounded-xl grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-1">
                {TRIP_TABS.map((tab) => {
                  const isActive = tripType === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => {
                        setTripType(tab.id);
                        if (tab.id === "Multicity" && viaStops.length === 0) setViaStops([""]);
                        setEstimates(null);
                      }}
                      className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs transition-all whitespace-nowrap ${
                        isActive ? "bg-white text-[#991B1B] shadow-sm font-semibold" : "text-slate-600 hover:text-slate-900 font-medium"
                      }`}
                    >
                      <Icon name={tab.icon} size={14} className="shrink-0" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 gap-5 @min-[1080px]:grid-cols-2 @min-[1080px]:gap-6 items-start">
              <div className="min-w-0 space-y-5">
              {/* 2. SMART CUSTOMER ROW + CUSTOMER PREFERENCE HINT */}
              <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Icon name="user-check" size={14} className="text-slate-400" />
                    Customer Details
                  </span>

                  {/* Auto-Detected Status Pill */}
                  {phoneOnFile ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                      Phone on file (Authorized Staff)
                    </span>
                  ) : matchedCustomer ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                      Existing customer{typeof (matchedCustomer as { tripsCompleted?: unknown }).tripsCompleted === "number" ? ` • ${(matchedCustomer as { tripsCompleted?: number }).tripsCompleted} trips` : ""}
                    </span>
                  ) : customerMobile.length === 10 ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-sky-50 text-sky-700 border border-sky-200/80">
                      New Customer (Auto-save)
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
                      Auto-detects existing or new
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Mobile Number with Live Lookup Dropdown */}
                  <div className="relative">
                    <div className="flex items-center h-11 bg-white border border-slate-200 rounded-xl overflow-hidden focus-within:border-[#9F1212] focus-within:ring-2 focus-within:ring-[#9F1212]/15 transition-all">
                      <span className="px-3 h-full flex items-center text-xs font-semibold text-slate-500 bg-slate-50 border-r border-slate-200 select-none">
                        +91
                      </span>
                      <input
                        ref={mobileInputRef}
                        type="tel"
                        maxLength={10}
                        autoComplete="off"
                        value={phoneOnFile || customerMobile}
                        placeholder="Enter 10-digit mobile"
                        onFocus={() => !phoneOnFile && setMobileSuggestionsOpen(true)}
                        onChange={(e) => {
                          if (phoneOnFile) return;
                          const clean = e.target.value.replace(/\D/g, "").slice(0, 10);
                          setCustomerMobile(clean);
                          setMobileSuggestionsOpen(clean.length < 10);
                        }}
                        className="w-full h-full px-3 text-sm font-medium text-slate-800 placeholder:text-slate-400 placeholder:font-normal bg-transparent focus:outline-none"
                      />
                      {(customerMobile || phoneOnFile) && (
                        <button
                          type="button"
                          onClick={() => {
                            setCustomerMobile("");
                            setPhoneOnFile("");
                            setCustomerId("");
                            setMatchedCustomer(null);
                            setCustomerName("");
                            setCustomerEmail("");
                            mobileInputRef.current?.focus();
                          }}
                          className="pr-3 text-slate-400 hover:text-slate-600"
                          aria-label="Clear mobile number"
                        >
                          <Icon name="x" size={14} />
                        </button>
                      )}
                    </div>

                    {/* Auto-Suggest Dropdown */}
                    {mobileSuggestionsOpen && !phoneOnFile && (
                      <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden fade-slide-in">
                        <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            {customerMobile ? "Matching customers" : mobileSuggestionsLabel}
                          </span>
                          <span className="text-[10px] text-slate-400">Click to auto-fill</span>
                        </div>
                        <div className="divide-y divide-slate-100 max-h-44 overflow-y-auto">
                          {customers
                            .filter((c) => !customerMobile || (c.phone || "").includes(customerMobile) || c.name.toLowerCase().includes(customerMobile.toLowerCase()))
                            .slice(0, 5)
                            .map((cust) => {
                              const initials = cust.name ? cust.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() : "CU";
                              return (
                                <button
                                  key={cust.id}
                                  type="button"
                                  onClick={() => {
                                    setMatchedCustomer(cust);
                                    setCustomerId(cust.id);
                                    setCustomerName(cust.name);
                                    setCustomerMobile(cust.phone.replace(/\D/g, "").slice(-10));
                                    setCustomerEmail(cust.email || "");
                                    setMobileSuggestionsOpen(false);
                                  }}
                                  className="w-full px-3 py-2.5 flex items-center justify-between hover:bg-slate-50 transition-colors text-left"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <span className="w-7 h-7 rounded-full bg-crimson-50 text-[#9F1212] text-[11px] font-semibold flex items-center justify-center shrink-0">
                                      {initials}
                                    </span>
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold text-slate-800 truncate">{cust.name}</p>
                                      <p className="text-[11px] text-slate-500">+91 {cust.phone}</p>
                                    </div>
                                  </div>
                                  {typeof (cust as { tripsCompleted?: unknown }).tripsCompleted === "number" && (
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 shrink-0">
                                      {(cust as { tripsCompleted?: number }).tripsCompleted} trips
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Customer Name */}
                  <div className="relative">
                    <Icon name="user" size={16} className="text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      autoComplete="off"
                      placeholder="Customer name"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full h-11 pl-10 pr-3.5 text-sm font-medium text-slate-800 placeholder:text-slate-400 placeholder:font-normal bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#9F1212] focus:ring-2 focus:ring-[#9F1212]/15 transition-all"
                    />
                  </div>
                </div>

                {/* Customer preference hint */}
                {matchedCustomer && (matchedCustomer.preferredDriver || matchedCustomer.preferredCab) && (
                  <div className="mt-2.5 px-3 py-2 rounded-xl bg-amber-50/95 border border-amber-200/80 flex items-center justify-between gap-2 text-xs fade-slide-in">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon name="sparkles" size={14} className="text-amber-600 shrink-0" />
                      <span className="font-medium text-amber-950 truncate">
                        {matchedCustomer.preferredDriver ? `Preferred driver: ${matchedCustomer.preferredDriver}` : "Existing customer"}
                      </span>
                    </div>
                    {matchedCustomer.preferredCab && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-white text-amber-900 border border-amber-200 shrink-0">
                        Preferred: {matchedCustomer.preferredCab}
                      </span>
                    )}
                  </div>
                )}

                {/* Optional Expandable Customer Fields (Email, WhatsApp, Passenger) */}
                <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowOptionalCustomer(!showOptionalCustomer)}
                    className="text-[11px] font-semibold text-slate-500 hover:text-[#991B1B] flex items-center gap-1 transition-colors"
                  >
                    <Icon name={showOptionalCustomer ? "chevron-up" : "chevron-down"} size={14} />
                    <span>{showOptionalCustomer ? "Hide optional passenger / WhatsApp details" : "Add email, passenger details, or alternate WhatsApp"}</span>
                  </button>
                </div>

                {showOptionalCustomer && (
                  <div className="mt-2.5 space-y-3 pt-2 border-t border-slate-200/50 fade-slide-in">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Email (Optional)</label>
                        <input
                          type="email"
                          value={customerEmail}
                          onChange={(e) => setCustomerEmail(e.target.value)}
                          placeholder="customer@example.com"
                          className="w-full h-10 px-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#9F1212]"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">WhatsApp Number</label>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 text-xs text-slate-700 select-none cursor-pointer">
                            <input
                              type="checkbox"
                              checked={whatsappSame}
                              onChange={(e) => setWhatsappSame(e.target.checked)}
                              className="w-3.5 h-3.5 accent-[#991B1B]"
                            />
                            <span>Same as mobile</span>
                          </label>
                          {!whatsappSame && (
                            <div className="flex-1 flex gap-1">
                              <select
                                value={waCountryCode}
                                onChange={(e) => setWaCountryCode(e.target.value)}
                                className="h-9 px-2 text-xs bg-white border border-slate-200 rounded-lg"
                              >
                                {COUNTRY_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <input
                                type="tel"
                                value={waNumber}
                                onChange={(e) => setWaNumber(e.target.value)}
                                placeholder="WhatsApp mobile"
                                className="flex-1 h-9 px-2 text-xs bg-white border border-slate-200 rounded-lg"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={someoneElse}
                        onChange={(e) => setSomeoneElse(e.target.checked)}
                        className="w-4 h-4 accent-[#991B1B]"
                      />
                      <span>Booking for someone else? (Enter passenger details)</span>
                    </label>

                    {someoneElse && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-white border border-slate-200 rounded-xl fade-slide-in">
                        <div>
                          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Passenger Name</label>
                          <input
                            type="text"
                            value={paxName}
                            onChange={(e) => setPaxName(e.target.value)}
                            placeholder="Full passenger name"
                            className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-[#9F1212]"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Passenger Mobile</label>
                          <input
                            type="tel"
                            maxLength={10}
                            value={paxPhone}
                            onChange={(e) => setPaxPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                            placeholder="10-digit mobile"
                            className="w-full h-9 px-3 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-[#9F1212]"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              </div>
              <div className="min-w-0 space-y-5">
              {/* 3. Route Section (Pickup, Drop & Optional Airport Flight No.) */}
              <div className="relative flex items-stretch gap-3">
                {/* Left Route Visual Track */}
                <div className="w-5 flex flex-col items-center py-5 shrink-0 select-none" aria-hidden="true">
                  <span className="w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-emerald-50 shrink-0" />
                  {tripType !== "Rental" && <div className="flex-1 w-0 border-l-2 border-dashed border-slate-300 my-1.5" />}
                  {tripType !== "Rental" && <Icon name="map-pin" size={16} className="text-[#9F1212] shrink-0 fill-crimson-50" />}
                </div>

                {/* Stacked Compact Location Inputs */}
                <div className="flex-1 space-y-2.5 relative">
                  {/* Pickup Location Box */}
                  <div data-place-field className="h-[58px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white focus-within:border-[#9F1212] focus-within:ring-2 focus-within:ring-[#9F1212]/15 transition-all flex flex-col justify-center relative">
                    <div className="flex items-center justify-between">
                      <label htmlFor="pickupInput" className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 leading-none mb-1 cursor-pointer">
                        Pickup Location
                      </label>
                      <button
                        type="button"
                        onClick={() => setMapPickerTarget("pickup")}
                        className="text-[10px] text-slate-400 hover:text-[#9F1212] flex items-center gap-1"
                        title="Pick location on map"
                      >
                        <Icon name="map" size={12} />
                        <span>Map</span>
                      </button>
                    </div>
                    <PlaceField
                      variant="desk"
                      inputId="pickupInput"
                      inputClassName="pr-10"
                      label="Pickup location"
                      placeholder={tripType === "Airport" ? "Enter airport terminal or pickup address" : "Enter pickup city, airport, or address"}
                      text={pickupText}
                      value={pickupPoint}
                      saved={allLocations}
                      near={null}
                      onChange={(text, point) => {
                        setPickupText(text);
                        setPickupPoint(point);
                        setPinError((x) => ({ ...x, pickup: undefined }));
                        setEstimates(null);
                      }}
                    />
                  </div>
                  {pinError.pickup && <p role="alert" className="-mt-1 px-1 text-[11px] font-medium text-red-700">{pinError.pickup}</p>}

                  {/* Conditional: Multicity & Round Trip Stops Container */}
                  {(tripType === "Round Trip" || tripType === "Multicity") && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (viaStops.length < 5) setViaStops([...viaStops, ""]);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#991B1B] bg-crimson-50/70 border border-crimson-200/70 hover:bg-crimson-50 transition-colors"
                        >
                          <Icon name="plus" size={14} />
                          <span>{tripType === "Round Trip" ? "Add Itinerary Stop" : "Add Via-Stop City"}</span>
                        </button>
                        {tripType === "Round Trip" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200/80">
                            <Icon name="lock" size={12} className="text-slate-400" />
                            <span>Itinerary Lock</span>
                          </span>
                        )}
                      </div>

                      <div className="space-y-2">
                        {viaStops.map((stopVal, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <div data-place-field className="relative flex-1 min-w-0 h-[50px] px-3.5 py-1.5 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 focus-within:border-[#9F1212] focus-within:bg-white transition-all flex flex-col justify-center">
                              <label className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 leading-none mb-0.5">
                                {tripType === "Round Trip" ? `Itinerary Stop ${idx + 1}` : `Via-Stop ${idx + 1} (Drop & Halt Point)`}
                              </label>
                              <PlaceField
                                variant="desk"
                                label={tripType === "Round Trip" ? `Itinerary stop ${idx + 1}` : `Via-stop ${idx + 1}`}
                                placeholder={tripType === "Round Trip" ? "e.g., Kodaikanal or Dindigul" : "e.g., Tiruvannamalai"}
                                text={stopVal}
                                value={stopPoints[idx] ?? null}
                                saved={allLocations}
                                near={pickupPoint}
                                onChange={(text, point) => {
                                  setViaStops(viaStops.map((s, i) => (i === idx ? text : s)));
                                  setStopPoints(viaStops.map((_, i) => (i === idx ? point : stopPoints[i] ?? null)));
                                  setEstimates(null);
                                }}
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setViaStops(viaStops.filter((_, i) => i !== idx));
                                setStopPoints(stopPoints.filter((_, i) => i !== idx));
                                setEstimates(null);
                              }}
                              className="w-9 h-9 rounded-xl border border-slate-200 text-slate-400 hover:text-[#9F1212] hover:border-crimson-200 flex items-center justify-center shrink-0"
                              aria-label="Remove stop"
                            >
                              <Icon name="x" size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Interactive Circular Swap Button */}
                  {tripType !== "Rental" && (!viaStops.length || tripType !== "Multicity") && (
                    <button
                      type="button"
                      onClick={handleSwapLocations}
                      title="Swap pickup and drop locations"
                      aria-label="Swap pickup and drop locations"
                      className={`absolute right-3.5 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-white border border-slate-200 shadow-sm text-slate-500 hover:text-[#9F1212] hover:border-[#9F1212] hover:bg-crimson-50/40 flex items-center justify-center transition-colors ${
                        swapSpinning ? "swap-spin" : ""
                      }`}
                    >
                      <Icon name="arrow-up-down" size={14} />
                    </button>
                  )}

                  {/* Drop Location Box (hidden for Rental) */}
                  {tripType !== "Rental" && (
                    <div data-place-field className="h-[58px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white focus-within:border-[#9F1212] focus-within:ring-2 focus-within:ring-[#9F1212]/15 transition-all flex flex-col justify-center relative">
                      <div className="flex items-center justify-between">
                        <label htmlFor="dropInput" className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 leading-none mb-1 cursor-pointer">
                          {tripType === "Multicity" ? "Final Drop Location" : "Drop Location"}
                        </label>
                        <button
                          type="button"
                          onClick={() => setMapPickerTarget("drop")}
                          className="text-[10px] text-slate-400 hover:text-[#9F1212] flex items-center gap-1"
                          title="Pick location on map"
                        >
                          <Icon name="map" size={12} />
                          <span>Map</span>
                        </button>
                      </div>
                      <PlaceField
                        variant="desk"
                        inputId="dropInput"
                        inputClassName="pr-10"
                        label={tripType === "Multicity" ? "Final drop location" : "Drop location"}
                        placeholder={tripType === "Multicity" ? "e.g., Trichy (Final Drop)" : tripType === "Airport" ? "Enter destination hotel, city, or airport" : "Enter drop destination (e.g., Madurai)"}
                        text={dropText}
                        value={dropPoint}
                        saved={allLocations}
                        near={pickupPoint}
                        onChange={(text, point) => {
                          setDropText(text);
                          setDropPoint(point);
                          setPinError((x) => ({ ...x, drop: undefined }));
                          setEstimates(null);
                        }}
                      />
                    </div>
                  )}
                  {tripType !== "Rental" && pinError.drop && <p role="alert" className="-mt-1 px-1 text-[11px] font-medium text-red-700">{pinError.drop}</p>}

                  {/* FEATURE 2: Conditional Airport Flight Number Optional Field */}
                  {tripType === "Airport" && (
                    <div className="px-3.5 py-2.5 rounded-xl border border-sky-200/90 bg-sky-50/40 focus-within:border-sky-500 focus-within:bg-white transition-all flex items-center gap-2.5 fade-slide-in">
                      <Icon name="plane-takeoff" size={16} className="text-sky-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <label htmlFor="flightNumberInput" className="block text-[9px] font-semibold uppercase tracking-wider text-sky-700 leading-none mb-1">
                          Flight No. / Terminal / Hotel Landmark (Optional)
                        </label>
                        <input
                          id="flightNumberInput"
                          type="text"
                          value={flightNumber}
                          onChange={(e) => setFlightNumber(e.target.value)}
                          placeholder="e.g., IndiGo 6E-512 • Terminal 1 Arrival"
                          className="w-full text-xs font-medium text-slate-800 placeholder:text-slate-400 bg-transparent focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 4. Conditional: Rental Duration Trigger Card */}
              {tripType === "Rental" && (
                <div className="fade-slide-in">
                  <button
                    type="button"
                    onClick={() => setRentalModalOpen(true)}
                    className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 bg-white hover:border-[#B91C1C]/50 hover:bg-crimson-50/20 transition-all flex items-center justify-between gap-3 text-left shadow-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-crimson-50 text-[#991B1B] flex items-center justify-center shrink-0">
                        <Icon name="clock" size={20} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Rental duration</p>
                        <p className="text-sm font-bold text-slate-900 mt-0.5 truncate">{rentalHours} {rentalHours === 1 ? "hour" : "hours"}</p>
                      </div>
                    </div>
                    <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-crimson-50 text-[#991B1B] border border-crimson-200/70 shrink-0">
                      Change
                    </span>
                  </button>
                </div>
              )}

              {/* 5. Date & Time Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* Pickup Date */}
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <label htmlFor="pickupDateNative" className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Pickup Date
                    </label>
                    {pickupDate === tomorrowIso ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/70">
                        Tomorrow
                      </span>
                    ) : pickupDate === isoDateIST(new Date()) ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70">
                        Today
                      </span>
                    ) : null}
                  </div>
                  <div className="relative h-12 px-3.5 rounded-xl border border-slate-200 bg-white focus-within:border-[#9F1212] focus-within:ring-2 focus-within:ring-[#9F1212]/15 transition-all flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-800 text-left">{formatDateDDMMYYYY(pickupDate)}</span>
                    <Icon name="calendar" size={16} className="text-slate-400 pointer-events-none shrink-0" />
                    <input
                      id="pickupDateNative"
                      type="date"
                      value={pickupDate}
                      onChange={(e) => {
                        setPickupDate(e.target.value);
                        setEstimates(null);
                      }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                </div>

                {/* Pickup Time */}
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <label htmlFor="pickupTimeSelect" className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Pickup Time
                    </label>
                  </div>
                  <div className="relative h-12 rounded-xl border border-slate-200 bg-white focus-within:border-[#9F1212] focus-within:ring-2 focus-within:ring-[#9F1212]/15 transition-all flex items-center">
                    <select
                      id="pickupTimeSelect"
                      value={pickupTime}
                      onChange={(e) => {
                        setPickupTime(e.target.value);
                        setEstimates(null);
                      }}
                      className="w-full h-full pl-3.5 pr-10 text-sm font-medium text-slate-800 bg-transparent appearance-none focus:outline-none cursor-pointer text-left"
                    >
                      {(TIME_VALUES.includes(pickupTime) ? TIME_VALUES : [pickupTime, ...TIME_VALUES]).map((t) => (
                        <option key={t} value={t}>{formatClock12(t)}</option>
                      ))}
                    </select>
                    <Icon name="clock" size={16} className="text-slate-400 absolute right-3.5 pointer-events-none" />
                  </div>
                </div>

                {/* Conditional: Round Trip Days Stepper Card */}
                {tripType === "Round Trip" && (
                  <div className="sm:col-span-2 fade-slide-in">
                    <div className="px-4 py-3.5 rounded-2xl border border-blue-200/80 bg-white shadow-xs flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 leading-tight">Days</p>
                        <p className="text-xs text-slate-500 mt-1 truncate">
                          {roundTripDays === 1 ? "Same day" : roundTripDays === 2 ? "Returns tomorrow • 11:45 PM" : `Returns on ${formatDateDDMMYYYY(pickupDate)} • 11:45 PM`}
                        </p>
                      </div>

                      {/* Rounded Stepper */}
                      <div className="flex items-center gap-1 p-1 rounded-2xl border border-slate-200 bg-slate-50/60 shrink-0">
                        <button
                          type="button"
                          disabled={roundTripDays <= 1}
                          onClick={() => {
                            if (roundTripDays > 1) {
                              setRoundTripDays(roundTripDays - 1);
                              setEstimates(null);
                            }
                          }}
                          className="w-9 h-9 rounded-xl bg-blue-50/70 text-[#2563EB] hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                        >
                          <Icon name="minus" size={14} />
                        </button>
                        <span className="min-w-[68px] text-center text-sm font-bold text-slate-900 select-none">
                          {roundTripDays} {roundTripDays === 1 ? "day" : "days"}
                        </span>
                        <button
                          type="button"
                          disabled={roundTripDays >= 15}
                          onClick={() => {
                            if (roundTripDays < 15) {
                              setRoundTripDays(roundTripDays + 1);
                              setEstimates(null);
                            }
                          }}
                          className="w-9 h-9 rounded-xl bg-blue-50 text-[#2563EB] hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                        >
                          <Icon name="plus" size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 5B. COMPACT OPTIONAL ADD-ONS */}
              {(tripType === "One Way" || tripType === "Multicity") && (
                <div className="space-y-2.5">
                  {/* Multicity Stop Waiting Row */}
                  {tripType === "Multicity" && (
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-slate-50/80 border border-slate-200/80 fade-slide-in">
                      <div>
                        <label htmlFor="waitingHoursInput" className="block text-xs font-semibold text-slate-700">Stop Point Waiting</label>
                        <span className="text-[11px] text-slate-400">Waiting at via-stops</span>
                      </div>
                      <div className="flex items-center h-9 w-28 bg-white border border-slate-200 rounded-lg overflow-hidden focus-within:border-[#991B1B]">
                        <input
                          id="waitingHoursInput"
                          type="number"
                          min="0"
                          max="48"
                          value={waitingHours}
                          onChange={(e) => {
                            setWaitingHours(Math.max(0, parseInt(e.target.value, 10) || 0));
                            setEstimates(null);
                          }}
                          className="w-full h-full px-2.5 text-sm font-semibold text-slate-800 focus:outline-none"
                        />
                        <span className="px-2 text-[11px] font-semibold text-slate-400 bg-slate-50 h-full flex items-center border-l border-slate-200">hrs</span>
                      </div>
                    </div>
                  )}

                  {/* Expandable Toggle for Extra Pickup / Drop */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setExtraPDOpen(!extraPDOpen)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-[#991B1B] transition-colors"
                    >
                      <Icon name="plus-circle" size={14} />
                      <span>{extraPDOpen ? "Hide Extra Pickup / Drop" : "Add Extra Pickup / Drop"}</span>
                    </button>

                    {extraPDOpen && (
                      <div className="mt-2.5 p-3 rounded-xl bg-slate-50/80 border border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 gap-3 fade-slide-in">
                        <div>
                          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                            Extra Pickup
                          </label>
                          <select
                            value={extraPickups}
                            onChange={(e) => {
                              setExtraPickups(parseInt(e.target.value, 10) || 0);
                              setEstimates(null);
                            }}
                            className="w-full h-10 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl"
                          >
                            <option value={0}>None (Direct)</option>
                            <option value={1}>+1 Pickup</option>
                            <option value={2}>+2 Pickups</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                            Extra Drop
                          </label>
                          <select
                            value={extraDrops}
                            onChange={(e) => {
                              setExtraDrops(parseInt(e.target.value, 10) || 0);
                              setEstimates(null);
                            }}
                            className="w-full h-10 px-3 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl"
                          >
                            <option value={0}>None (Direct)</option>
                            <option value={1}>+1 Drop</option>
                            <option value={2}>+2 Drops</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              </div>
              </div>

              {/* Notice / Errors */}
              {errorNotice && (
                <div role="alert" className="px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2 bg-amber-50 text-amber-800 border border-amber-200 fade-slide-in">
                  <Icon name="circle-alert" size={16} className="text-amber-600 shrink-0" />
                  <span>{errorNotice}</span>
                </div>
              )}

              {/* 6. Primary action */}
              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  disabled={busy || quoting}
                  onClick={handleGetEstimate}
                  className="group w-full @min-[640px]:w-auto @min-[640px]:min-w-[280px] h-12 bg-[#991B1B] hover:bg-[#B91C1C] active:scale-[0.99] text-white font-semibold text-sm px-6 rounded-xl shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#991B1B] disabled:opacity-60"
                >
                  <Calculator className="w-[18px] h-[18px]" strokeWidth={1.75} aria-hidden="true" />
                  <span>{busy || quoting ? "Loading cab fares…" : "View Cab Fares"}</span>
                  <ArrowRight className="w-[18px] h-[18px] transition-transform duration-200 group-hover:translate-x-1 group-disabled:translate-x-0" strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* STEP 2: CHOOSE VEHICLE & FARE REVIEW                      */}
          {/* ========================================================= */}
          {step === 2 && (
            <div className="px-4 sm:px-6 py-5 space-y-5 fade-slide-in">
              {/* Trip summary */}
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-crimson-50 text-[#9F1212]">{currentCalc?.slabName ?? tripType}</span>
                    <span className="text-xs font-medium text-slate-600">{formattedScheduleString}</span>
                    {routeText && <span className="text-xs font-medium text-slate-500">• {routeText}</span>}
                  </div>
                  <p className="text-sm font-semibold text-slate-900 mt-1 break-words">{formattedRouteString}</p>
                </div>
                <button
                  type="button"
                  onClick={() => goToStep(1)}
                  className="h-9 px-3 rounded-lg text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition-colors shrink-0"
                >
                  Edit Trip
                </button>
              </div>

              {/* Fuel: prices come from the configured Diesel or CNG rates of each category */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Fuel className="w-4 h-4 text-slate-400" strokeWidth={2} aria-hidden="true" />Fuel
                  </span>
                  <div role="radiogroup" aria-label="Fuel" className="inline-flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200">
                    {([
                      { id: undefined, label: "Diesel", icon: <Fuel className="w-4 h-4" strokeWidth={2} aria-hidden="true" />, on: "text-amber-800" },
                      { id: "cng" as const, label: "CNG", icon: <Leaf className="w-4 h-4" strokeWidth={2} aria-hidden="true" />, on: "text-emerald-700" },
                    ]).map((f) => {
                      const selected = fuel === f.id;
                      const cngMissing = f.id === "cng" && !cngOffered;
                      return (
                        <button
                          key={f.label}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          disabled={quoting || (cngMissing && !selected)}
                          onClick={() => void handleChangeFuel(f.id)}
                          title={cngMissing ? "No vehicle category offers CNG yet. Turn on CNG in Vehicle categories." : `Price on the ${f.label} rates`}
                          className={`h-9 px-4 rounded-lg text-xs flex items-center gap-1.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#991B1B]/40 disabled:opacity-50 disabled:cursor-not-allowed ${
                            selected ? `bg-white shadow-xs font-bold ${f.on}` : "font-semibold text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          {f.icon}<span>{f.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {quoting && <span role="status" className="text-xs font-medium text-slate-500">Updating fares…</span>}
              </div>

              {/* Cabs and their server fares */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2.5">Select Cab</p>
                {!estimates || estimates.length === 0 ? (
                  <div role="status" className="p-6 rounded-xl border border-dashed border-slate-300 text-center text-xs text-slate-500">
                    {quoting ? "Loading cab fares…" : "No cab fares yet. Go back to Trip Details and choose View Cab Fares."}
                  </div>
                ) : (
                  <div className={`grid grid-cols-1 @min-[640px]:grid-cols-2 @min-[1080px]:grid-cols-3 gap-3 ${quoting ? "opacity-60 pointer-events-none" : ""}`} role="radiogroup" aria-label="Cab">
                    {estimates.map((est) => {
                      const cat = est.category;
                      const priced = !!est.quote;
                      const isSelected = priced && cat.id === selectedVehicleId;
                      const pref = matchedCustomer?.preferredCab?.toLowerCase();
                      const isPreferred = !!pref && (cat.name.toLowerCase().includes(pref) || pref.includes(cat.name.toLowerCase()));
                      const title = cabDisplayName(cat);
                      const badge = cabCategoryBadge(cat, title);
                      const seats = Number(cat.seatingCapacity) > 0 ? Number(cat.seatingCapacity) : null;
                      const bags = cat.luggageCapacity != null && String(cat.luggageCapacity).trim() !== "" ? String(cat.luggageCapacity).trim() : "";
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          disabled={!priced}
                          onClick={() => handleSelectVehicle(cat.id)}
                          className={`p-3.5 rounded-xl text-left transition-all flex items-center justify-between gap-3 min-w-0 disabled:cursor-not-allowed ${
                            isSelected ? "border-2 border-[#9F1212] bg-[#FEF2F2]/60" : priced ? "border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50" : "border border-dashed border-slate-200 bg-slate-50/60"
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-sm font-bold break-words ${isSelected ? "text-[#9F1212]" : priced ? "text-slate-900" : "text-slate-500"}`}>{title}</span>
                              {badge && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-slate-100 text-slate-600">{badge}</span>}
                              {isPreferred && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-200">Customer favourite</span>}
                              {fuel === "cng" && priced && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">CNG</span>}
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1">
                              {priced ? ([seats ? `${seats} seats` : "", bags ? `${/^\d+$/.test(bags) ? `${bags} bags` : bags}` : ""].filter(Boolean).join(" • ") || "\u00a0") : est.error || "Not available for this trip"}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            {priced ? (
                              <>
                                <p className={`text-sm font-bold ${isSelected ? "text-[#9F1212]" : "text-slate-900"}`}>{rupee(est.quote!.quote.total)}</p>
                                <span className={`text-[10px] font-semibold ${isSelected ? "text-[#9F1212]" : "text-slate-400"}`}>{isSelected ? "Selected" : "Select"}</span>
                              </>
                            ) : (
                              <span className="text-[10px] font-semibold text-slate-400">Unavailable</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 @min-[1080px]:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] items-start">
                {/* Fare breakdown from the server quote */}
                <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Fare Breakdown</span>
                    {routeText && <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{routeText}</span>}
                  </div>
                  {currentCalc ? (
                    <>
                      <div className="space-y-1.5 text-xs text-slate-600 pt-1">
                        {currentCalc.breakdown.map((r, i) => (
                          <div key={i} className="flex items-center justify-between gap-3">
                            <span className="min-w-0">{r.label}</span>
                            <span className="font-semibold text-slate-800 shrink-0">{rupee(r.amount)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-3 text-[11px] text-slate-500">
                        <span>{vehicleName}{fuel === "cng" ? " • CNG" : ""} • excludes toll, parking &amp; permit (actuals)</span>
                        <span className="text-sm font-bold text-[#991B1B] shrink-0">{rupee(currentCalc.total)}</span>
                      </div>
                    </>
                  ) : (
                    <p role="status" className="text-xs text-slate-500 py-2">Choose a cab with a fare to see its breakdown.</p>
                  )}
                </div>

                {/* Permitted override of the quoted fare */}
                {canOverride && (
                  <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-2 min-w-0">
                    <label htmlFor="nb-custom-fare" className="block text-xs font-semibold text-slate-800">Custom fare (optional)</label>
                    <div className="flex items-center h-10 w-full bg-white border border-slate-200 rounded-xl overflow-hidden focus-within:border-[#9F1212] focus-within:ring-2 focus-within:ring-[#9F1212]/15">
                      <span className="px-3 text-xs font-semibold text-slate-500 bg-slate-50 h-full flex items-center border-r border-slate-200">₹</span>
                      <input
                        id="nb-custom-fare"
                        type="number"
                        min="0"
                        value={customFare}
                        onChange={(e) => setCustomFare(e.target.value)}
                        placeholder="Quoted fare"
                        className="w-full h-full px-3 text-sm font-semibold text-slate-800 placeholder:text-slate-400 placeholder:font-normal focus:outline-none"
                      />
                    </div>
                    {customFare && Number(customFare) > 0 && (
                      <input
                        type="text"
                        aria-label="Reason for the custom fare"
                        value={customFareReason}
                        onChange={(e) => setCustomFareReason(e.target.value)}
                        placeholder="Reason (e.g., agreed phone tariff)"
                        className="w-full h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#9F1212]"
                      />
                    )}
                  </div>
                )}
              </div>

              {errorNotice && (
                <div role="alert" className="px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2 bg-amber-50 text-amber-800 border border-amber-200">
                  <Icon name="circle-alert" size={16} className="text-amber-600 shrink-0" />
                  <span>{errorNotice}</span>
                </div>
              )}

              {/* Step 2 navigation */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => goToStep(1)}
                  className="h-11 px-4 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200/80 transition-colors flex items-center gap-1.5"
                >
                  <Icon name="arrow-left" size={16} />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  disabled={quoting || !currentCalc}
                  onClick={handleContinueToReview}
                  className="flex-1 @min-[640px]:flex-none @min-[640px]:min-w-[240px] h-11 bg-[#9F1212] hover:bg-[#820E0E] active:scale-[0.99] text-white font-semibold text-sm px-6 rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>Continue to Review</span>
                  <ArrowRight className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* STEP 3: REVIEW, QUICK DRIVER SLIP NOTE & PAYMENT          */}
          {/* ========================================================= */}
          {step === 3 && (
            <div className="px-4 sm:px-6 py-5 space-y-5 fade-slide-in">
              {/* Compact Trip & Customer Summary */}
              <div className="grid grid-cols-1 @min-[760px]:grid-cols-2 gap-3.5">
                {/* Trip & Cab Box */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Trip &amp; Cab</span>
                    <span className="flex items-center gap-1 min-w-0">
                      {fuel === "cng" && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">CNG</span>}
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-crimson-50 text-[#9F1212] truncate">
                        {currentCalc?.slabName ?? tripType}
                      </span>
                    </span>
                  </div>
                  <p className="text-sm font-bold text-slate-900 leading-snug break-words">{formattedRouteString}</p>
                  {flightNumber && (
                    <p className="text-[11px] font-semibold text-sky-700">Flight / Terminal: {flightNumber}</p>
                  )}
                  {routeText && <p className="text-[11px] font-medium text-emerald-700">{routeText}</p>}
                  <p className="text-xs text-slate-600">{formattedScheduleString}</p>
                  <div className="pt-2 border-t border-slate-200/70 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800 min-w-0 break-words">{vehicleName}{fuel === "cng" ? " • CNG" : ""}</span>
                    <span className="text-base font-bold text-[#9F1212]">{rupee(finalNetFare)}</span>
                  </div>
                </div>

                {/* Customer, Source & Quick Driver Slip Note Box */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2 flex flex-col justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Customer &amp; Source</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200/70 text-slate-700">
                        {BRANDS.find((b) => b.id === brand)?.label}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-slate-900">{customerName || "Customer"}</p>
                    <p className="text-xs text-slate-600">{phoneOnFile ? `Phone: ${phoneOnFile}` : `+91 ${customerMobile}`}</p>
                    <span className="inline-block text-[11px] font-medium text-emerald-700">
                      {phoneOnFile ? "Staff Authorized Booking" : matchedCustomer ? "Existing customer" : "New customer (saved with the booking)"}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-slate-200/70 space-y-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <label htmlFor="dispatchNotesInput" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                        <Icon name="clipboard-list" size={12} className="text-slate-400" />
                        <span>Quick Driver / Cab Note</span>
                      </label>
                      <span className="text-[9px] font-semibold text-slate-400">Prints on Driver Slip</span>
                    </div>
                    <input
                      id="dispatchNotesInput"
                      type="text"
                      value={driverSlipNote}
                      onChange={(e) => setDriverSlipNote(e.target.value)}
                      placeholder="e.g., Morning 5 AM pickup — call 15 mins before"
                      className="w-full h-9 px-3 text-xs text-slate-800 placeholder:text-slate-400 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#9F1212]"
                    />
                    {/* One-Click Presets */}
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {[
                        { label: "+ Call 15m before", note: "Call 15 mins before pickup" },
                        { label: "+ Placard", note: "Placard at Arrival Gate" },
                        { label: "+ Extra luggage", note: "Extra luggage — keep carrier ready" },
                      ].map((chip) => (
                        <button
                          key={chip.label}
                          type="button"
                          onClick={() => {
                            const cur = driverSlipNote.trim();
                            setDriverSlipNote(cur ? `${cur} • ${chip.note}` : chip.note);
                          }}
                          className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-white border border-slate-200 text-slate-600 hover:border-[#9F1212] hover:text-[#9F1212] transition-colors"
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Exact Pickup / Drop Addresses & Meeting Points */}
              <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="rvPickupAddress" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                    Pickup Exact Door / Landmark
                  </label>
                  <input
                    id="rvPickupAddress"
                    type="text"
                    value={pickupAddress}
                    onChange={(e) => setPickupAddress(e.target.value)}
                    placeholder="e.g., Door #4, 1st Cross, Gandhipuram"
                    className="w-full h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#9F1212]"
                  />
                </div>
                {tripType !== "Rental" && (
                  <div>
                    <label htmlFor="rvDropAddress" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      Drop Exact Door / Landmark
                    </label>
                    <input
                      id="rvDropAddress"
                      type="text"
                      value={dropAddress}
                      onChange={(e) => setDropAddress(e.target.value)}
                      placeholder="e.g., Hotel Tamil Nadu, Near Bus Stand"
                      className="w-full h-9 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#9F1212]"
                    />
                  </div>
                )}
              </div>

              {/* MODERN SECURE PAYMENT SECTION (RAZORPAY) */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Payment</span>
                  {payOptions && !payOptions.online && (
                    <span role="status" className="text-[11px] font-medium text-amber-800">Online payments are not set up, so only Pay Later is available.</span>
                  )}
                  {payOptionsError && (
                    <span role="status" className="text-[11px] font-medium text-slate-500">Online payment settings could not be checked.</span>
                  )}
                </div>

                <div className="grid grid-cols-1 @min-[900px]:grid-cols-3 gap-2.5">
                  {/* Option 1: Book Now, Pay Later */}
                  <label
                    onClick={() => setPaymentPlan("later")}
                    className={`flex items-center justify-between gap-3 p-4 rounded-2xl cursor-pointer transition-all ${
                      paymentPlan === "later" ? "border-2 border-[#2563EB] bg-blue-50/20 shadow-sm" : "border border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 bg-white ${
                        paymentPlan === "later" ? "border-[#2563EB]" : "border-slate-300"
                      }`}>
                        {paymentPlan === "later" && <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB]" />}
                      </span>
                      <div>
                        <p className="text-sm font-bold text-slate-900">Book Now, Pay Later</p>
                        <p className="text-xs text-slate-500 mt-0.5">Customer pays the driver after the trip</p>
                      </div>
                    </div>
                    <span className="px-3.5 py-2 rounded-xl bg-blue-50 text-slate-900 text-sm font-bold shrink-0">₹0</span>
                  </label>

                  {/* Option 2: Pay 25% Now */}
                  <label
                    aria-disabled={onlineBlocked}
                    onClick={() => !onlineBlocked && setPaymentPlan("partial")}
                    className={`flex items-center justify-between gap-3 p-4 rounded-2xl cursor-pointer transition-all ${
                      paymentPlan === "partial" ? "border-2 border-[#2563EB] bg-blue-50/20 shadow-sm" : onlineBlocked ? "border border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed" : "border border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 bg-white ${
                        paymentPlan === "partial" ? "border-[#2563EB]" : "border-slate-300"
                      }`}>
                        {paymentPlan === "partial" && <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB]" />}
                      </span>
                      <div>
                        <p className="text-sm font-bold text-slate-900">Pay {partPercent}% Now</p>
                        {payOptions?.recommended === "part" && (
                          <span className="inline-flex items-center gap-1 mt-1 px-2.5 py-0.5 rounded-full bg-[#2563EB] text-white text-[10px] font-semibold">Recommended</span>
                        )}
                        <p className="text-xs text-slate-500 mt-1">Balance {100 - partPercent}% after the trip</p>
                      </div>
                    </div>
                    <div className="text-right pl-3 border-l border-slate-100 shrink-0">
                      <p className="text-[11px] font-medium text-slate-400">Pay now</p>
                      <p className="text-base font-bold text-slate-900 mt-0.5">{rupee(Math.round((finalNetFare * partPercent) / 100))}</p>
                    </div>
                  </label>

                  {/* Option 3: Pay 100% Now */}
                  <label
                    aria-disabled={onlineBlocked}
                    onClick={() => !onlineBlocked && setPaymentPlan("full")}
                    className={`flex items-center justify-between gap-3 p-4 rounded-2xl cursor-pointer transition-all ${
                      paymentPlan === "full" ? "border-2 border-[#2563EB] bg-blue-50/20 shadow-sm" : onlineBlocked ? "border border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed" : "border border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 bg-white ${
                        paymentPlan === "full" ? "border-[#2563EB]" : "border-slate-300"
                      }`}>
                        {paymentPlan === "full" && <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB]" />}
                      </span>
                      <div>
                        <p className="text-sm font-bold text-slate-900">Pay 100% Now</p>
                        <p className="text-xs text-slate-500 mt-0.5">Full fare by payment link</p>
                      </div>
                    </div>
                    <div className="text-right pl-3 border-l border-slate-100 shrink-0">
                      <p className="text-[11px] font-medium text-slate-400">Total Payable</p>
                      <p className="text-base font-bold text-slate-900 mt-0.5">{rupee(finalNetFare)}</p>
                    </div>
                  </label>
                </div>

                {/* Coupon Code Box */}
                <div className="p-3 rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/20">
                  <div className="flex items-center gap-2.5">
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <Icon name="ticket" size={20} className="text-[#2563EB] shrink-0 ml-1" />
                      <div className="h-5 w-px bg-blue-200 shrink-0" />
                      <input
                        type="text"
                        value={couponCode}
                        onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                        placeholder="Coupon code"
                        className="w-full text-xs sm:text-sm font-medium text-slate-800 placeholder:text-slate-400 bg-transparent focus:outline-none uppercase"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={checkingCoupon}
                      onClick={handleApplyCoupon}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-[#2563EB] bg-white border border-blue-200 hover:bg-blue-50 transition-colors shrink-0 disabled:opacity-50"
                    >
                      {checkingCoupon ? "…" : "Apply"}
                    </button>
                  </div>
                  {couponMsg && (
                    <div className="mt-2 pt-2 border-t border-blue-100 flex items-center justify-between text-xs">
                      <span className={couponMsg.ok ? "font-semibold text-emerald-700" : "font-medium text-crimson-700"}>
                        {couponMsg.text}
                      </span>
                      {appliedCoupon && (
                        <button
                          type="button"
                          onClick={() => {
                            setAppliedCoupon(null);
                            setCouponCode("");
                            setCouponMsg(null);
                          }}
                          className="text-[11px] font-semibold text-crimson-700 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {paymentPlan !== "later" && (
                  <p className="text-[11px] text-slate-600 px-1">
                    A Razorpay payment link for {rupee(payNowAmount)} is created after the booking is saved. The booking is marked paid only after Razorpay confirms the payment.
                  </p>
                )}

                {/* Auto-notify & Terms checkboxes */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200/80 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(e) => setTermsAccepted(e.target.checked)}
                      className="w-4 h-4 accent-[#991B1B] rounded"
                    />
                    <span className="text-xs font-medium text-slate-700">
                      Customer accepts the fare, extra charges and cancellation policy
                    </span>
                  </label>
                </div>
              </div>

              {/* Notice / Errors */}
              {errorNotice && (
                <div role="alert" className="px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center gap-2 bg-amber-50 text-amber-800 border border-amber-200 fade-slide-in">
                  <Icon name="circle-alert" size={16} className="text-amber-600 shrink-0" />
                  <span>{errorNotice}</span>
                </div>
              )}

              {/* Step 3 navigation and confirmation */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="px-4 py-3 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200/80 transition-colors flex items-center gap-1.5"
                >
                  <Icon name="arrow-left" size={16} />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  disabled={busy || !currentCalc}
                  onClick={() => void handleConfirmBooking()}
                  className={`flex-1 @min-[640px]:flex-none @min-[640px]:min-w-[280px] h-12 text-white font-semibold text-sm px-6 rounded-xl shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${
                    paymentPlan === "later" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-[#2563EB] hover:bg-blue-700"
                  }`}
                >
                  <Icon name="check-circle-2" size={16} />
                  <span>
                    {busy
                      ? "Saving booking…"
                      : paymentPlan === "later"
                      ? "Confirm Booking"
                      : `Confirm & Create Payment Link (${rupee(payNowAmount)})`}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* STEP 4: BOOKING CONFIRMED SUCCESS VIEW                    */}
          {/* ========================================================= */}
          {step === 4 && confirmedBooking && (
            <div className="p-6 sm:p-8 text-center space-y-5 fade-slide-in">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-200/80 flex items-center justify-center mx-auto">
                <Icon name="check-circle-2" size={32} />
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-center gap-2 mb-2">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700">
                    {confirmedBooking.bookingId}
                  </span>
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/70">
                    {confirmedBooking.paymentBadge}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-slate-900">Booking saved</h2>
                <p className="text-xs text-slate-500 mt-1">Saved under {BRANDS.find((b) => b.id === brand)?.label}.</p>
              </div>

              {/* Real payment link (created by the server after the booking was saved) */}
              {confirmedBooking.paymentLink && (
                <div className="max-w-xl mx-auto p-3 rounded-xl bg-blue-50/70 border border-blue-200 flex items-center justify-between gap-2 text-left">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-600">
                      Razorpay payment link · {confirmedBooking.paymentLink.delivered ? "sent to the customer" : "not sent automatically — copy and share it"}
                    </p>
                    <p className="text-xs font-semibold text-slate-800 truncate">{confirmedBooking.paymentLink.url}</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#2563EB] hover:bg-blue-700 text-white shrink-0 transition-colors"
                  >
                    {copyLinkFeedback || "Copy Link"}
                  </button>
                </div>
              )}
              {confirmedBooking.paymentLinkError && (
                <div role="alert" className="max-w-xl mx-auto p-3 rounded-xl bg-amber-50 border border-amber-200 text-left text-xs text-amber-900">
                  The booking is saved, but the payment link was not created: {confirmedBooking.paymentLinkError} Create it later from the booking.
                </div>
              )}

              {/* Booking Summary Box */}
              <div className="max-w-xl mx-auto p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-left space-y-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Route</span>
                  <span className="font-semibold text-slate-800 text-right">{confirmedBooking.route}</span>
                </div>
                {confirmedBooking.flight && (
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Flight / Terminal</span>
                    <span className="font-semibold text-sky-700 text-right">{confirmedBooking.flight}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Pickup</span>
                  <span className="font-semibold text-slate-800 text-right">{confirmedBooking.dateTime}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Vehicle</span>
                  <span className="font-semibold text-slate-800 text-right">{confirmedBooking.vehicle}</span>
                </div>
                {confirmedBooking.driverNote && (
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-500">Driver Slip Note</span>
                    <span className="font-semibold text-amber-800 text-right">{confirmedBooking.driverNote}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2 pt-1.5 border-t border-slate-200/70">
                  <span className="text-slate-500">Total Fare</span>
                  <span className="font-bold text-emerald-700 text-sm text-right">
                    {rupee(confirmedBooking.fare)}{paymentPlan !== "later" ? ` (link for ${rupee(payNowAmount)})` : ""}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleCopyWhatsApp}
                  className="w-full sm:w-auto px-5 py-3 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors flex items-center justify-center gap-2"
                >
                  <Icon name="copy" size={16} />
                  <span>{copyFeedback || "Copy WhatsApp & Driver Slip"}</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetNewBooking}
                  className="w-full sm:w-auto px-5 py-3 rounded-xl text-xs font-semibold bg-[#9F1212] hover:bg-[#820E0E] text-white shadow-sm transition-colors flex items-center justify-center gap-2"
                >
                  <Icon name="plus" size={16} />
                  <span>New Booking</span>
                </button>
                <button
                  type="button"
                  onClick={() => onCreated({ id: confirmedBooking.id, bookingId: confirmedBooking.bookingId, fare: confirmedBooking.fare })}
                  className="w-full sm:w-auto px-5 py-3 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 transition-colors flex items-center justify-center gap-2"
                >
                  <span>View in Bookings</span>
                </button>
              </div>
            </div>
          )}
        </div>

      {/* ========================================================= */}
      {/* RENTAL DURATION MODAL / BOTTOM-SHEET                      */}
      {/* ========================================================= */}
      {rentalModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden fade-slide-in">
            <div className="pt-3 pb-1 flex justify-center">
              <span className="w-11 h-1 rounded-full bg-slate-300/80" />
            </div>

            <div className="px-5 pt-2 pb-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-900">Rental duration</h2>
                <button
                  type="button"
                  onClick={() => setRentalModalOpen(false)}
                  className="w-8 h-8 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center justify-center transition-colors"
                >
                  <Icon name="x" size={20} />
                </button>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-1.5 leading-relaxed">
                Choose 1 to 15 hours.
              </p>

              <div className="grid grid-cols-3 gap-2.5 mt-4">
                {Array.from({ length: 15 }, (_, i) => i + 1).map((h) => {
                  const isSelected = h === rentalHours;
                  return (
                    <button
                      key={h}
                      type="button"
                      onClick={() => {
                        setRentalHours(h);
                        setRentalModalOpen(false);
                        setEstimates(null);
                      }}
                      className={`py-3 px-2 rounded-2xl text-xs sm:text-sm transition-all ${
                        isSelected
                          ? "font-bold border border-[#B91C1C] bg-[#FEF2F2] text-[#991B1B] shadow-xs"
                          : "font-semibold border border-slate-200/90 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50"
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

      {/* Pickup / drop on the map: the shared admin map dialog (same provider, search and reverse geocoding as Quick Fare). */}
      {mapPickerTarget !== null && (
        <MapPickerDialog
          side={mapPickerTarget}
          value={mapPickerTarget === "pickup" ? pickupPoint : dropPoint}
          startNear={mapPickerTarget === "drop" ? pickupPoint : dropPoint}
          saved={allLocations}
          onChange={(p) => applyPickedPoint(mapPickerTarget, p)}
          onClose={() => setMapPickerTarget(null)}
        />
      )}

      {/* Save Enquiry Dialog (retained from production) */}
      {saveEnquiryOpen && liveQuote && (
        <SaveEnquiryDialog
          trip={currentQuickTrip}
          estimate={liveQuote}
          serviceName={tripType}
          onClose={() => setSaveEnquiryOpen(false)}
          onSaved={(e) => {
            setSaveEnquiryOpen(false);
            onEnquirySaved(e);
          }}
        />
      )}
    </div>
  );
}

export const todayIst = () => isoDateIST(new Date());
