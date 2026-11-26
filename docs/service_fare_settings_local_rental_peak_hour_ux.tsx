import React, { useState, useMemo } from "react";
import {
  MapPin,
  Search,
  Layers,
  ShieldCheck,
  Calculator,
  CheckCircle2,
  Building2,
  Hash,
  RotateCcw,
  Save,
  Clock,
  ChevronDown,
  Zap,
  AlertCircle,
  Sliders,
  Moon,
  Tag,
} from "lucide-react";

type ServiceMode = "pickup_drop" | "hourly_rental";
type RateScopeTab = "district" | "zone" | "village";
type FarePartyTab = "customer" | "partner";
type PeakChargeMode = "percentage" | "fixed";

interface VillageNode {
  id: string;
  name: string;
  tamilName: string;
  pincode: string;
  withinLocalCoverage: boolean;
}

interface ServiceZoneNode {
  id: string;
  name: string;
  villages: VillageNode[];
}

interface DistrictNode {
  id: string;
  name: string;
  localCoverageRadiusKm: number;
  zones: ServiceZoneNode[];
}

interface StateNode {
  id: string;
  name: string;
  districts: DistrictNode[];
}

interface VehicleCategory {
  id: string;
  name: string;
  subtitle: string;
}

export interface PricingHierarchyManagerProps {
  geoTree?: StateNode[];
  vehicles?: VehicleCategory[];
  initialBrand?: string;
}

// Local Pickup & Drop Rule (Distinct Minimum Fare vs Base Fare + Waiting)
interface LocalTariffRule {
  minimumFare: number; // Floor bill amount (Bill never goes below this)
  baseFare: number; // Initial fare up to Included KM
  includedKm: number;
  extraPerKm: number;
  freeWaitMins: number;
  waitPerMin: number;
}

// Hourly Rental Package Row (1 to 15 Hours)
interface RentalPackageRow {
  hours: number;
  customerFare: number;
  partnerPayout: number;
  includedKm: number;
  extraKmRate: number;
  extraHourRate: number;
}

interface PeakHourRule {
  id: string;
  label: string;
  startHour24: number;
  endHour24: number;
  displayWindow: string;
  chargeMode: PeakChargeMode;
  value: number; // % or ₹
  maxCap: number; // Maximum extra ₹ cap
  active: boolean;
}

const DEFAULT_GEO_TREE: StateNode[] = [
  {
    id: "tn",
    name: "Tamil Nadu",
    districts: [
      {
        id: "theni",
        name: "Theni",
        localCoverageRadiusKm: 35,
        zones: [
          {
            id: "theni_zone",
            name: "Theni Zone",
            villages: [
              { id: "koduvilarpatty", name: "Koduvilarpatty", tamilName: "கொடுவிலார்பட்டி", pincode: "625534", withinLocalCoverage: true },
              { id: "allinagaram", name: "Theni / Allinagaram", tamilName: "அல்லிநகரம்", pincode: "625531", withinLocalCoverage: true },
              { id: "palanichettipatti", name: "Palanichettipatti", tamilName: "பழனிசெட்டிபட்டி", pincode: "625531", withinLocalCoverage: true },
              { id: "veerapandi", name: "Veerapandi", tamilName: "வீரபாண்டி", pincode: "625534", withinLocalCoverage: true },
            ],
          },
          {
            id: "bodi_zone",
            name: "Bodinayakanur (Bodi) Zone",
            villages: [
              { id: "bodi_town", name: "Bodinayakanur Town", tamilName: "போடிநாயக்கனூர்", pincode: "625513", withinLocalCoverage: true },
              { id: "bodimettu", name: "Bodimettu Hill", tamilName: "போடிமெட்டு", pincode: "625582", withinLocalCoverage: false },
            ],
          },
          {
            id: "uthamapalayam_zone",
            name: "Uthamapalayam & Chinnamanur Zone",
            villages: [
              { id: "uthamapalayam", name: "Uthamapalayam", tamilName: "உத்தமபாளையம்", pincode: "625533", withinLocalCoverage: true },
              { id: "chinnamanur", name: "Chinnamanur", tamilName: "சின்னமனூர்", pincode: "625515", withinLocalCoverage: true },
            ],
          },
          {
            id: "cumbum_suruli_zone",
            name: "Cumbum & Suruli Zone",
            villages: [
              { id: "cumbum", name: "Cumbum Town", tamilName: "கம்பம்", pincode: "625516", withinLocalCoverage: true },
              { id: "surulipatti", name: "Surulipatti / Suruli Falls", tamilName: "சுருளிப்பட்டி", pincode: "625516", withinLocalCoverage: false },
            ],
          },
          {
            id: "periyakulam_zone",
            name: "Periyakulam Zone",
            villages: [
              { id: "periyakulam", name: "Periyakulam", tamilName: "பெரியகுளம்", pincode: "625601", withinLocalCoverage: true },
              { id: "devadanapatti", name: "Devadanapatti", tamilName: "தேவதானப்பட்டி", pincode: "625602", withinLocalCoverage: true },
            ],
          },
          {
            id: "andipatti_zone",
            name: "Andipatti Zone",
            villages: [
              { id: "andipatti", name: "Andipatti", tamilName: "ஆண்டிபட்டி", pincode: "625512", withinLocalCoverage: true },
              { id: "kadamalaikundu", name: "Kadamalaikundu", tamilName: "கடமலைக்குண்டு", pincode: "625579", withinLocalCoverage: false },
            ],
          },
        ],
      },
    ],
  },
];

const DEFAULT_VEHICLES: VehicleCategory[] = [
  { id: "hatchback", name: "Hatchback", subtitle: "Wagon R Or Similar" },
  { id: "sedan", name: "Sedan", subtitle: "Dzire / Etios Or Similar" },
  { id: "suv", name: "SUV", subtitle: "Ertiga Or Similar" },
  { id: "muv", name: "MUV", subtitle: "Kia Carens Or Similar" },
  { id: "innova", name: "Innova", subtitle: "Toyota Innova 7-Seater" },
  { id: "crysta", name: "Crysta", subtitle: "Innova Crysta" },
];

const EMPTY_LOCAL_RULE: LocalTariffRule = {
  minimumFare: 0,
  baseFare: 0,
  includedKm: 0,
  extraPerKm: 0,
  freeWaitMins: 0,
  waitPerMin: 0,
};

function buildEmptyLocalMap(vehicles: VehicleCategory[]): Record<string, LocalTariffRule> {
  const map: Record<string, LocalTariffRule> = {};
  vehicles.forEach((v) => {
    map[v.id] = { ...EMPTY_LOCAL_RULE };
  });
  return map;
}

// Build empty 1 to 15 hour Rental Packages per vehicle (to be hydrated from backend)
function buildEmptyRentalPackages(): RentalPackageRow[] {
  return Array.from({ length: 15 }, (_, idx) => ({
    hours: idx + 1,
    customerFare: 0,
    partnerPayout: 0,
    includedKm: 0,
    extraKmRate: 0,
    extraHourRate: 0,
  }));
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function PricingHierarchyManager({
  geoTree = DEFAULT_GEO_TREE,
  vehicles = DEFAULT_VEHICLES,
  initialBrand = "All brands (shared)",
}: PricingHierarchyManagerProps) {
  // Brand & Service Mode ("pickup_drop" | "hourly_rental") — NO fuel split for Local/Rental
  const [selectedBrand, setSelectedBrand] = useState(initialBrand);
  const [serviceMode, setServiceMode] = useState<ServiceMode>("pickup_drop");

  // 5-Level Location Selector
  const [selectedStateId, setSelectedStateId] = useState(geoTree[0]?.id || "tn");
  const [selectedDistrictId, setSelectedDistrictId] = useState(
    geoTree[0]?.districts[0]?.id || "theni"
  );
  const [selectedZoneId, setSelectedZoneId] = useState("all_zones");
  const [selectedVillageId, setSelectedVillageId] = useState("all_villages");
  const [pinSearchInput, setPinSearchInput] = useState("");
  const [pinDropdownOpen, setPinDropdownOpen] = useState(false);

  // 3 Rate Scope Tabs ("district" | "zone" | "village") & Party Sub-tabs ("customer" | "partner")
  const [activeScopeTab, setActiveScopeTab] = useState<RateScopeTab>("district");
  const [farePartyTab, setFarePartyTab] = useState<FarePartyTab>("customer");

  // Local Pickup & Drop Tariffs (District Default + Zone/Area Overrides — hydrated from backend)
  const [districtLocalCustomer, setDistrictLocalCustomer] = useState(() =>
    buildEmptyLocalMap(vehicles)
  );
  const [districtLocalPartner, setDistrictLocalPartner] = useState(() =>
    buildEmptyLocalMap(vehicles)
  );
  const [zoneLocalOverrides, setZoneLocalOverrides] = useState<
    Record<string, { customer?: Record<string, LocalTariffRule>; partner?: Record<string, LocalTariffRule> }>
  >({});
  const [villageLocalOverrides, setVillageLocalOverrides] = useState<
    Record<string, { customer?: Record<string, LocalTariffRule>; partner?: Record<string, LocalTariffRule> }>
  >({});

  // Hourly Rental Packages (1–15 Hours per Vehicle — hydrated from backend)
  const [rentalSelectedVehicleId, setRentalSelectedVehicleId] = useState(
    vehicles[1]?.id || vehicles[0]?.id || "sedan"
  );
  const [districtRentalPackages, setDistrictRentalPackages] = useState<
    Record<string, RentalPackageRow[]>
  >(() => {
    const map: Record<string, RentalPackageRow[]> = {};
    vehicles.forEach((v) => {
      map[v.id] = buildEmptyRentalPackages();
    });
    return map;
  });

  // Scheduled Peak-Hour Pricing State (Separate Local & Rental ON/OFF, Weekdays, IST Windows, Cap)
  const [peakLocalEnabled, setPeakLocalEnabled] = useState(false);
  const [peakRentalEnabled, setPeakRentalEnabled] = useState(false);
  const [peakWeekdays, setPeakWeekdays] = useState<string[]>([
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
  ]);
  const [peakRules, setPeakRules] = useState<PeakHourRule[]>([
    {
      id: "morning_rush",
      label: "Morning Peak",
      startHour24: 7,
      endHour24: 10,
      displayWindow: "07:00 AM – 10:00 AM IST",
      chargeMode: "percentage",
      value: 0,
      maxCap: 0,
      active: false,
    },
    {
      id: "evening_rush",
      label: "Evening Peak",
      startHour24: 17,
      endHour24: 20,
      displayWindow: "05:00 PM – 08:00 PM IST",
      chargeMode: "percentage",
      value: 0,
      maxCap: 0,
      active: false,
    },
  ]);

  // Collapsible Shared Sections
  const [openAccordion, setOpenAccordion] = useState<"peak" | "additional" | "night" | "display" | null>(null);
  const [tollPassThrough, setTollPassThrough] = useState(true);
  const [localServiceEnabled, setLocalServiceEnabled] = useState(true);
  const [outstationServiceEnabled, setOutstationServiceEnabled] = useState(true);
  const [autoAddRouteTollLocal, setAutoAddRouteTollLocal] = useState(false);
  const [tollSourceMode, setTollSourceMode] = useState<"mapped_rate" | "route_api" | "at_actuals">("mapped_rate");
  const [localRouteTollAmount, setLocalRouteTollAmount] = useState(0);
  const [localAirportEntryEnabled, setLocalAirportEntryEnabled] = useState(false);
  const [localAirportEntryFee, setLocalAirportEntryFee] = useState(0);
  const [parkingPassThrough, setParkingPassThrough] = useState(true);
  const [nightSurchargePercent, setNightSurchargePercent] = useState(0);
  const [gstPercent, setGstPercent] = useState(5);

  // Test Quote Simulator State (Right Rail)
  const [testPickupAreaId, setTestPickupAreaId] = useState("");
  const [testVehicleId, setTestVehicleId] = useState(vehicles[1]?.id || "sedan");
  const [testDistanceKm, setTestDistanceKm] = useState<string>("");
  const [testRentalHours, setTestRentalHours] = useState<number>(4);
  const [testDatePreset, setTestDatePreset] = useState<"today" | "tomorrow">("today");
  const [testScheduledHour, setTestScheduledHour] = useState<number>(8);
  const [testWeekday, setTestWeekday] = useState<string>("Wed");
  const [testWaitMins, setTestWaitMins] = useState<number>(0);
  const [testRouteHasToll, setTestRouteHasToll] = useState<boolean>(false);
  const [testIsAirportTrip, setTestIsAirportTrip] = useState<boolean>(false);

  // Bottom Audit Reason & Save Feedback
  const [reasonForChange, setReasonForChange] = useState("");
  const [saveBanner, setSaveBanner] = useState<string | null>(null);

  // Derived Location Nodes
  const currentState = geoTree.find((s) => s.id === selectedStateId) || geoTree[0];
  const currentDistrict =
    currentState.districts.find((d) => d.id === selectedDistrictId) || currentState.districts[0];

  const isAllZones = selectedZoneId === "all_zones";
  const currentZone = isAllZones
    ? null
    : currentDistrict.zones.find((z) => z.id === selectedZoneId) || currentDistrict.zones[0];

  const availableVillages = useMemo(() => {
    if (isAllZones) return currentDistrict.zones.flatMap((z) => z.villages);
    return currentZone ? currentZone.villages : [];
  }, [isAllZones, currentDistrict, currentZone]);

  const isAllVillages = isAllZones || selectedVillageId === "all_villages";
  const currentVillage = isAllVillages
    ? null
    : availableVillages.find((v) => v.id === selectedVillageId) || availableVillages[0];

  const allVillagesIndex = useMemo(() => {
    const list: { district: DistrictNode; zone: ServiceZoneNode; village: VillageNode }[] = [];
    currentState.districts.forEach((d) =>
      d.zones.forEach((z) =>
        z.villages.forEach((v) => list.push({ district: d, zone: z, village: v }))
      )
    );
    return list;
  }, [currentState]);

  const pinMatches = useMemo(() => {
    const clean = pinSearchInput.replace(/\D/g, "");
    if (clean.length < 3) return [];
    return allVillagesIndex.filter((item) => item.village.pincode.startsWith(clean));
  }, [pinSearchInput, allVillagesIndex]);

  // Resolve Local Rule with Inheritance: Village Override -> Zone Override -> District Default
  const resolveLocalRule = (
    vehicleId: string,
    party: FarePartyTab,
    villageIdOverride?: string
  ): {
    rule: LocalTariffRule;
    source: "Area override" | "Zone override" | "District default";
  } => {
    const targetVillageId = villageIdOverride ?? currentVillage?.id;
    const targetEntry = targetVillageId
      ? allVillagesIndex.find((x) => x.village.id === targetVillageId)
      : undefined;
    const targetZoneId = targetEntry ? targetEntry.zone.id : currentZone?.id;

    const vRule = targetVillageId
      ? villageLocalOverrides[targetVillageId]?.[party]?.[vehicleId]
      : undefined;
    const zRule = targetZoneId
      ? zoneLocalOverrides[targetZoneId]?.[party]?.[vehicleId]
      : undefined;
    const dRule =
      party === "customer"
        ? districtLocalCustomer[vehicleId]
        : districtLocalPartner[vehicleId];

    if (activeScopeTab === "district" && !villageIdOverride) {
      return { rule: dRule, source: "District default" };
    }
    if (activeScopeTab === "zone" && !villageIdOverride) {
      if (zRule) return { rule: zRule, source: "Zone override" };
      return { rule: dRule, source: "District default" };
    }
    if (vRule) return { rule: vRule, source: "Area override" };
    if (zRule) return { rule: zRule, source: "Zone override" };
    return { rule: dRule, source: "District default" };
  };

  const handleLocalFieldEdit = (
    vehicleId: string,
    field: keyof LocalTariffRule,
    rawVal: string
  ) => {
    const num = Math.max(0, parseFloat(rawVal) || 0);
    const current = resolveLocalRule(vehicleId, farePartyTab).rule;
    const updated: LocalTariffRule = { ...current, [field]: num };

    if (activeScopeTab === "district") {
      if (farePartyTab === "customer") {
        setDistrictLocalCustomer((prev) => ({ ...prev, [vehicleId]: updated }));
      } else {
        setDistrictLocalPartner((prev) => ({ ...prev, [vehicleId]: updated }));
      }
    } else if (activeScopeTab === "zone") {
      const targetZones = isAllZones ? currentDistrict.zones : currentZone ? [currentZone] : [];
      setZoneLocalOverrides((prev) => {
        const next = { ...prev };
        targetZones.forEach((z) => {
          const existingParty = next[z.id]?.[farePartyTab] || {};
          next[z.id] = {
            ...next[z.id],
            [farePartyTab]: { ...existingParty, [vehicleId]: updated },
          };
        });
        return next;
      });
    } else {
      const targetVillages = isAllVillages
        ? availableVillages
        : currentVillage
        ? [currentVillage]
        : [];
      setVillageLocalOverrides((prev) => {
        const next = { ...prev };
        targetVillages.forEach((v) => {
          const existingParty = next[v.id]?.[farePartyTab] || {};
          next[v.id] = {
            ...next[v.id],
            [farePartyTab]: { ...existingParty, [vehicleId]: updated },
          };
        });
        return next;
      });
    }
  };

  const handleRentalPackageEdit = (
    hours: number,
    field: keyof Omit<RentalPackageRow, "hours">,
    rawVal: string
  ) => {
    const num = Math.max(0, parseFloat(rawVal) || 0);
    setDistrictRentalPackages((prev) => ({
      ...prev,
      [rentalSelectedVehicleId]: prev[rentalSelectedVehicleId].map((row) =>
        row.hours === hours ? { ...row, [field]: num } : row
      ),
    }));
  };

  // =========================================================================
  // TEST QUOTE CALCULATION ENGINE (WITH SCHEDULED PEAK-HOUR PRICING)
  // =========================================================================
  const resolvedTestDateMeta = useMemo(() => {
    const base = new Date();
    if (testDatePreset === "tomorrow") {
      base.setDate(base.getDate() + 1);
    }
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const weekdayShort = dayNames[base.getDay()];
    const formattedDate = `${String(base.getDate()).padStart(2, "0")} ${monthNames[base.getMonth()]} ${base.getFullYear()}`;
    return { weekdayShort, formattedDate };
  }, [testDatePreset]);

  const testQuoteSummary = useMemo(() => {
    const matchedEntry =
      allVillagesIndex.find((x) => x.village.id === testPickupAreaId) || allVillagesIndex[0];
    const isPeakApplicableService =
      serviceMode === "pickup_drop" ? peakLocalEnabled : peakRentalEnabled;
    const effectiveWeekday = testDatePreset === "tomorrow" ? resolvedTestDateMeta.weekdayShort : testWeekday;
    const isPeakDay = peakWeekdays.includes(effectiveWeekday);

    // Non-overlapping single matching peak rule based on scheduled pickup time
    const matchedPeakRule =
      isPeakApplicableService && isPeakDay
        ? peakRules.find(
            (r) =>
              r.active &&
              testScheduledHour >= r.startHour24 &&
              testScheduledHour < r.endHour24
          ) || null
        : null;

    if (serviceMode === "pickup_drop") {
      const distKm = Math.max(0, parseFloat(testDistanceKm) || 0);
      const resolved = resolveLocalRule(testVehicleId, "customer", matchedEntry.village.id);
      const r = resolved.rule;

      const extraKm = Math.max(0, distKm - r.includedKm);
      const extraKmCharge = extraKm * r.extraPerKm;
      const chargeableWaitMins = Math.max(0, testWaitMins - r.freeWaitMins);
      const waitingCharge = chargeableWaitMins * r.waitPerMin;

      const rawSubtotal = r.baseFare + extraKmCharge + waitingCharge;
      const eligibleRideFare = Math.max(r.minimumFare, rawSubtotal);
      const minimumApplied = rawSubtotal < r.minimumFare;

      // Local-only Auto-Add Route Toll & Airport Entry (excluded from peak % base)
      const appliedRouteToll =
        autoAddRouteTollLocal && testRouteHasToll ? localRouteTollAmount : 0;
      const appliedAirportEntry =
        localAirportEntryEnabled && testIsAirportTrip ? localAirportEntryFee : 0;

      // Night allowance check (10 PM - 5 AM IST, or 9 PM test slot)
      const isNightSlot = testScheduledHour >= 21 || testScheduledHour < 5;
      const nightAllowanceCharge = isNightSlot
        ? Math.round((eligibleRideFare * nightSurchargePercent) / 100)
        : 0;

      // Peak applies ONLY on eligible ride fare (never on Toll, Airport Entry, or Parking)
      let peakCharge = 0;
      if (matchedPeakRule) {
        const rawPeak =
          matchedPeakRule.chargeMode === "percentage"
            ? Math.round((eligibleRideFare * matchedPeakRule.value) / 100)
            : matchedPeakRule.value;
        peakCharge = Math.min(matchedPeakRule.maxCap, rawPeak);
      }

      const taxableSubtotal =
        eligibleRideFare + peakCharge + nightAllowanceCharge + appliedRouteToll + appliedAirportEntry;
      const gstAmount = Math.round((taxableSubtotal * gstPercent) / 100);
      const totalCustomerQuote = taxableSubtotal + gstAmount;

      return {
        matchedEntry,
        appliedRateLabel: `${resolved.source} (${currentDistrict.name})`,
        eligibleRideFare,
        minimumApplied,
        minimumFare: r.minimumFare,
        baseFare: r.baseFare,
        includedKm: r.includedKm,
        extraKm,
        extraKmCharge,
        chargeableWaitMins,
        waitingCharge,
        appliedRouteToll,
        appliedAirportEntry,
        nightAllowanceCharge,
        matchedPeakRule,
        peakCharge,
        gstAmount,
        totalCustomerQuote,
      };
    } else {
      const pkgList = districtRentalPackages[testVehicleId] || [];
      const pkg = pkgList.find((p) => p.hours === testRentalHours) || pkgList[3];
      const eligibleRideFare = pkg.customerFare;

      let peakCharge = 0;
      if (matchedPeakRule) {
        const rawPeak =
          matchedPeakRule.chargeMode === "percentage"
            ? Math.round((eligibleRideFare * matchedPeakRule.value) / 100)
            : matchedPeakRule.value;
        peakCharge = Math.min(matchedPeakRule.maxCap, rawPeak);
      }

      const taxableSubtotal = eligibleRideFare + peakCharge;
      const gstAmount = Math.round((taxableSubtotal * gstPercent) / 100);
      const totalCustomerQuote = taxableSubtotal + gstAmount;

      return {
        matchedEntry,
        appliedRateLabel: `District Rental Package (${pkg.hours} hr / ${pkg.includedKm} km)`,
        eligibleRideFare,
        minimumApplied: false,
        minimumFare: pkg.customerFare,
        baseFare: pkg.customerFare,
        includedKm: pkg.includedKm,
        extraKm: 0,
        extraKmCharge: 0,
        chargeableWaitMins: 0,
        waitingCharge: 0,
        appliedRouteToll: 0,
        appliedAirportEntry: 0,
        nightAllowanceCharge: 0,
        matchedPeakRule,
        peakCharge,
        gstAmount,
        totalCustomerQuote,
      };
    }
  }, [
    allVillagesIndex,
    testPickupAreaId,
    serviceMode,
    peakLocalEnabled,
    peakRentalEnabled,
    peakWeekdays,
    testWeekday,
    peakRules,
    testScheduledHour,
    testDatePreset,
    resolvedTestDateMeta.weekdayShort,
    testWeekday,
    testDistanceKm,
    testVehicleId,
    testWaitMins,
    gstPercent,
    nightSurchargePercent,
    districtRentalPackages,
    testRentalHours,
    districtLocalCustomer,
    zoneLocalOverrides,
    villageLocalOverrides,
    activeScopeTab,
    currentDistrict.name,
    autoAddRouteTollLocal,
    localRouteTollAmount,
    localAirportEntryEnabled,
    localAirportEntryFee,
    testRouteHasToll,
    testIsAirportTrip,
  ]);

  const handleSaveRules = () => {
    if (!reasonForChange.trim()) {
      setSaveBanner("Please enter a short Reason for change before saving fare rules.");
      return;
    }
    setSaveBanner(
      `Saved ${
        serviceMode === "pickup_drop" ? "Local Pickup & Drop" : "Hourly Rental (1–15h)"
      } rules for ${currentDistrict.name}. Confirmed bookings keep their saved fares.`
    );
    setReasonForChange("");
    setTimeout(() => setSaveBanner(null), 4000);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans pb-24">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 space-y-5">
        {/* ================================================================= */}
        {/* TOP HEADER & SERVICE MODE SWITCHER (PICKUP & DROP vs RENTAL)      */}
        {/* ================================================================= */}
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900">
                {serviceMode === "pickup_drop" ? "Local Pickup & Drop" : "Hourly Rental"}
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                No fuel split • Upfront quote
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {serviceMode === "pickup_drop"
                ? "Area-based fares • Base fare + Extra-km + Waiting + Scheduled Peak-Hour rules"
                : "1–15 hour packages • Edit Customer fare, Partner payout, Included km & Extra rates in one row"}
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Brand Selector */}
            <select
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:border-[#991B1B]"
            >
              <option>All brands (shared)</option>
              <option>Nesam Cabs</option>
              <option>People Taxi</option>
              <option>One Way Car Rentals</option>
            </select>

            {/* Service Switcher Pills */}
            <div className="inline-flex p-1 rounded-xl bg-slate-200/70 border border-slate-200">
              <button
                type="button"
                onClick={() => setServiceMode("pickup_drop")}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  serviceMode === "pickup_drop"
                    ? "bg-white text-[#991B1B] shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Local Pickup &amp; Drop
              </button>
              <button
                type="button"
                onClick={() => setServiceMode("hourly_rental")}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  serviceMode === "hourly_rental"
                    ? "bg-white text-[#991B1B] shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Hourly Rental (1–15h)
              </button>
            </div>
          </div>
        </header>

        {/* ================================================================= */}
        {/* 5-LEVEL LOCATION HIERARCHY BAR + PIN SEARCH                       */}
        {/* ================================================================= */}
        <section className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Breadcrumb Path */}
            <div className="flex items-center gap-1.5 text-xs font-bold text-[#991B1B] flex-wrap">
              <MapPin className="w-4 h-4 shrink-0" />
              <span>{currentState.name}</span>
              <span className="text-slate-300">/</span>
              <span>{currentDistrict.name}</span>
              <span className="text-slate-300">/</span>
              <span>{isAllZones ? "All zones" : currentZone?.name}</span>
              <span className="text-slate-300">/</span>
              <span>
                {isAllVillages
                  ? "All mapped areas"
                  : `${currentVillage?.name} (${currentVillage?.tamilName})`}
              </span>
            </div>

            {/* PIN Search Input */}
            <div className="relative w-full lg:w-72">
              <div className="flex items-center h-9 px-3 rounded-xl border border-slate-200 bg-slate-50/70 focus-within:bg-white focus-within:border-[#991B1B] gap-2">
                <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <input
                  type="text"
                  maxLength={6}
                  value={pinSearchInput}
                  onFocus={() => setPinDropdownOpen(true)}
                  onChange={(e) => {
                    setPinSearchInput(e.target.value.replace(/\D/g, "").slice(0, 6));
                    setPinDropdownOpen(true);
                  }}
                  placeholder="Search PIN..."
                  className="w-full text-xs font-semibold text-slate-800 placeholder:text-slate-400 placeholder:font-normal bg-transparent focus:outline-none"
                />
              </div>

              {pinDropdownOpen && pinMatches.length > 0 && (
                <div className="absolute right-0 left-0 top-[calc(100%+6px)] z-30 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
                  <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-[10px] font-bold uppercase text-slate-400">
                    Matched Areas ({pinMatches.length})
                  </div>
                  <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                    {pinMatches.map((m) => (
                      <button
                        key={m.village.id}
                        type="button"
                        onClick={() => {
                          setSelectedDistrictId(m.district.id);
                          setSelectedZoneId(m.zone.id);
                          setSelectedVillageId(m.village.id);
                          setTestPickupAreaId(m.village.id);
                          setPinSearchInput("");
                          setPinDropdownOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-red-50/40 flex items-center justify-between text-xs"
                      >
                        <div>
                          <p className="font-bold text-slate-900">
                            {m.village.name} ({m.village.tamilName})
                          </p>
                          <p className="text-[10px] text-slate-500">{m.zone.name}</p>
                        </div>
                        <span className="font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                          {m.village.pincode}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 5 Dropdown Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">State</label>
              <select
                value={selectedStateId}
                onChange={(e) => setSelectedStateId(e.target.value)}
                className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:border-[#991B1B]"
              >
                {geoTree.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">District</label>
              <select
                value={selectedDistrictId}
                onChange={(e) => {
                  setSelectedDistrictId(e.target.value);
                  setSelectedZoneId("all_zones");
                  setSelectedVillageId("all_villages");
                }}
                className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:border-[#991B1B]"
              >
                {currentState.districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                Service zone
              </label>
              <select
                value={selectedZoneId}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedZoneId(val);
                  setSelectedVillageId(val === "all_zones" ? "all_villages" : "all_villages");
                }}
                className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:border-[#991B1B]"
              >
                <option value="all_zones">All zones ({currentDistrict.zones.length})</option>
                {currentDistrict.zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">
                Area / Village
              </label>
              <select
                value={isAllVillages ? "all_villages" : currentVillage?.id || ""}
                onChange={(e) => {
                  setSelectedVillageId(e.target.value);
                  if (e.target.value !== "all_villages") {
                    setTestPickupAreaId(e.target.value);
                  }
                }}
                className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:border-[#991B1B]"
              >
                <option value="all_villages">All mapped areas ({availableVillages.length})</option>
                {availableVillages.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.tamilName})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">PIN code</label>
              <div className="h-9 px-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
                <span className="font-mono font-bold text-slate-800">
                  {currentVillage ? currentVillage.pincode : "Select an area"}
                </span>
                <Hash className="w-3.5 h-3.5 text-slate-400" />
              </div>
            </div>
          </div>

          {/* Service Coverage Strip */}
          <div className="px-3.5 py-2 rounded-xl bg-slate-50/90 border border-slate-200/70 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-semibold text-slate-700">Service coverage</span>
              <span className="px-2 py-0.5 rounded-md bg-red-50 text-[#991B1B] font-bold text-[11px] border border-red-200/70">
                {availableVillages.length} mapped areas
              </span>
              <button
                type="button"
                onClick={() => setLocalServiceEnabled((v) => !v)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors ${
                  localServiceEnabled
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-slate-100 text-slate-500 border-slate-200"
                }`}
              >
                Local: {localServiceEnabled ? "ON" : "OFF"}
              </button>
              <button
                type="button"
                onClick={() => setOutstationServiceEnabled((v) => !v)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors ${
                  outstationServiceEnabled
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-slate-100 text-slate-500 border-slate-200"
                }`}
              >
                Outstation: {outstationServiceEnabled ? "ON" : "OFF"}
              </button>
            </div>
            <span className="text-[11px] text-slate-400">
              Coverage is checked separately from fare inheritance.
            </span>
          </div>
        </section>

        {/* ================================================================= */}
        {/* MAIN 2-COLUMN WORKSPACE: RATE TABLE (LEFT) + TEST QUOTE (RIGHT)   */}
        {/* ================================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT 8 COLS: RATE CONFIGURATION */}
          <div className="lg:col-span-8 space-y-4">
            <section className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
              {/* 3 Scope Tabs: District default | Zone overrides | Area overrides */}
              <div className="px-5 pt-3 border-b border-slate-200 bg-slate-50/60 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  {(
                    [
                      { id: "district" as RateScopeTab, label: "District default" },
                      { id: "zone" as RateScopeTab, label: "Zone overrides" },
                      { id: "village" as RateScopeTab, label: "Area overrides" },
                    ] as const
                  ).map((tab) => {
                    const active = activeScopeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveScopeTab(tab.id)}
                        className={`px-4 py-2 rounded-t-xl text-xs font-bold transition-all ${
                          active
                            ? "bg-[#991B1B] text-white shadow-2xs"
                            : "text-slate-600 hover:text-slate-900 hover:bg-white/70"
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                <span className="text-[11px] text-slate-500 pb-1.5">
                  Inheritance: <strong>Area → Zone → {currentDistrict.name} Default</strong>
                </span>
              </div>

              {/* =========================================================== */}
              {/* MODE A: LOCAL PICKUP & DROP RATE TABLE                      */}
              {/* =========================================================== */}
              {serviceMode === "pickup_drop" ? (
                <div className="p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        {activeScopeTab === "district"
                          ? `${currentDistrict.name} district default`
                          : activeScopeTab === "zone"
                          ? `Zone overrides (${isAllZones ? "All zones" : currentZone?.name})`
                          : `Area overrides (${
                              isAllVillages ? "All mapped areas" : currentVillage?.name
                            })`}
                      </h2>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Minimum fare (bill floor) and Base fare (initial km package) are configured separately.
                      </p>
                    </div>

                    {/* Customer Fare vs Partner Payout Sub-Tabs */}
                    <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200/80">
                      <button
                        type="button"
                        onClick={() => setFarePartyTab("customer")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          farePartyTab === "customer"
                            ? "bg-white text-[#991B1B] shadow-2xs"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        Customer fare
                      </button>
                      <button
                        type="button"
                        onClick={() => setFarePartyTab("partner")}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                          farePartyTab === "partner"
                            ? "bg-white text-[#991B1B] shadow-2xs"
                            : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        Partner payout
                      </button>
                    </div>
                  </div>

                  {/* Rate Table */}
                  <div className="overflow-x-auto border border-slate-200/80 rounded-xl">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/90 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          <th className="py-2.5 px-3.5">Vehicle</th>
                          <th className="py-2.5 px-2.5">Min fare ₹</th>
                          <th className="py-2.5 px-2.5">Base fare ₹</th>
                          <th className="py-2.5 px-2.5">Included km</th>
                          <th className="py-2.5 px-2.5">Rate beyond min km</th>
                          <th className="py-2.5 px-2.5">Free wait / ₹/min</th>
                          <th className="py-2.5 px-3.5 text-right">Rate source</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {vehicles.map((veh) => {
                          const resolved = resolveLocalRule(veh.id, farePartyTab);
                          const r = resolved.rule;
                          const badgeStyle =
                            resolved.source === "Area override"
                              ? "bg-purple-50 text-purple-800 border-purple-200"
                              : resolved.source === "Zone override"
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200";

                          return (
                            <tr
                              key={veh.id}
                              onClick={() => setTestVehicleId(veh.id)}
                              className={`cursor-pointer transition-colors ${
                                testVehicleId === veh.id
                                  ? "bg-red-50/25"
                                  : "hover:bg-slate-50/80"
                              }`}
                            >
                              <td className="py-2.5 px-3.5">
                                <p className="font-bold text-slate-900">{veh.name}</p>
                                <p className="text-[10px] text-slate-400">{veh.subtitle}</p>
                              </td>

                              <td className="py-2.5 px-2.5" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="number"
                                  value={r.minimumFare}
                                  onChange={(e) =>
                                    handleLocalFieldEdit(veh.id, "minimumFare", e.target.value)
                                  }
                                  className="w-16 h-8 px-2 rounded-lg border border-slate-200 font-bold text-slate-800 bg-white focus:outline-none focus:border-[#991B1B]"
                                />
                              </td>

                              <td className="py-2.5 px-2.5" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="number"
                                  value={r.baseFare}
                                  onChange={(e) =>
                                    handleLocalFieldEdit(veh.id, "baseFare", e.target.value)
                                  }
                                  className="w-16 h-8 px-2 rounded-lg border border-slate-200 font-bold text-slate-800 bg-white focus:outline-none focus:border-[#991B1B]"
                                />
                              </td>

                              <td className="py-2.5 px-2.5" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="number"
                                  value={r.includedKm}
                                  onChange={(e) =>
                                    handleLocalFieldEdit(veh.id, "includedKm", e.target.value)
                                  }
                                  className="w-14 h-8 px-2 rounded-lg border border-slate-200 font-bold text-slate-800 bg-white focus:outline-none focus:border-[#991B1B]"
                                />
                              </td>

                              <td className="py-2.5 px-2.5" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="number"
                                  step="0.5"
                                  value={r.extraPerKm}
                                  onChange={(e) =>
                                    handleLocalFieldEdit(veh.id, "extraPerKm", e.target.value)
                                  }
                                  className="w-16 h-8 px-2 rounded-lg border border-slate-200 font-bold text-[#991B1B] bg-white focus:outline-none focus:border-[#991B1B]"
                                />
                              </td>

                              <td className="py-2.5 px-2.5" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    value={r.freeWaitMins}
                                    onChange={(e) =>
                                      handleLocalFieldEdit(veh.id, "freeWaitMins", e.target.value)
                                    }
                                    className="w-11 h-8 px-1.5 rounded-lg border border-slate-200 font-semibold text-slate-700 text-center"
                                    title="Free waiting minutes"
                                  />
                                  <span className="text-slate-400">m / ₹</span>
                                  <input
                                    type="number"
                                    step="0.5"
                                    value={r.waitPerMin}
                                    onChange={(e) =>
                                      handleLocalFieldEdit(veh.id, "waitPerMin", e.target.value)
                                    }
                                    className="w-12 h-8 px-1.5 rounded-lg border border-slate-200 font-semibold text-slate-700 text-center"
                                    title="Charge per minute after free wait"
                                  />
                                </div>
                              </td>

                              <td className="py-2.5 px-3.5 text-right">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeStyle}`}
                                >
                                  {resolved.source}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-[11px] text-slate-500">
                    Areas without overrides automatically inherit the{" "}
                    <strong>{currentDistrict.name} district default</strong>.
                  </p>
                </div>
              ) : (
                /* =========================================================== */
                /* MODE B: HOURLY RENTAL (1 TO 15 HOUR PACKAGES IN ONE ROW)    */
                /* =========================================================== */
                <div className="p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900">
                        Hourly Rental Packages (1–15 Hours)
                      </h2>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Edit Customer fare, Partner payout, Included km, Extra km &amp; Extra hour together per package row.
                      </p>
                    </div>

                    {/* Vehicle Category Pills */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {vehicles.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            setRentalSelectedVehicleId(v.id);
                            setTestVehicleId(v.id);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                            rentalSelectedVehicleId === v.id
                              ? "bg-slate-900 text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"
                          }`}
                        >
                          {v.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="overflow-x-auto border border-slate-200/80 rounded-xl max-h-[430px] overflow-y-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/90 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          <th className="py-2.5 px-3.5">Package</th>
                          <th className="py-2.5 px-3">Customer fare ₹</th>
                          <th className="py-2.5 px-3">Partner payout ₹</th>
                          <th className="py-2.5 px-3">Included km</th>
                          <th className="py-2.5 px-3">Extra km ₹</th>
                          <th className="py-2.5 px-3">Extra hour ₹</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {(districtRentalPackages[rentalSelectedVehicleId] || []).map((pkg) => (
                          <tr
                            key={pkg.hours}
                            onClick={() => setTestRentalHours(pkg.hours)}
                            className={`cursor-pointer transition-colors ${
                              testRentalHours === pkg.hours
                                ? "bg-red-50/30"
                                : "hover:bg-slate-50/80"
                            }`}
                          >
                            <td className="py-2 px-3.5 font-bold text-slate-900 whitespace-nowrap">
                              {pkg.hours} {pkg.hours === 1 ? "hour" : "hours"}
                            </td>
                            <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="number"
                                value={pkg.customerFare}
                                onChange={(e) =>
                                  handleRentalPackageEdit(pkg.hours, "customerFare", e.target.value)
                                }
                                className="w-20 h-8 px-2 rounded-lg border border-slate-200 font-bold text-slate-900 bg-white focus:outline-none focus:border-[#991B1B]"
                              />
                            </td>
                            <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="number"
                                value={pkg.partnerPayout}
                                onChange={(e) =>
                                  handleRentalPackageEdit(pkg.hours, "partnerPayout", e.target.value)
                                }
                                className="w-20 h-8 px-2 rounded-lg border border-slate-200 font-bold text-emerald-700 bg-white focus:outline-none focus:border-[#991B1B]"
                              />
                            </td>
                            <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="number"
                                value={pkg.includedKm}
                                onChange={(e) =>
                                  handleRentalPackageEdit(pkg.hours, "includedKm", e.target.value)
                                }
                                className="w-16 h-8 px-2 rounded-lg border border-slate-200 font-semibold text-slate-800 bg-white focus:outline-none focus:border-[#991B1B]"
                              />
                            </td>
                            <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="number"
                                value={pkg.extraKmRate}
                                onChange={(e) =>
                                  handleRentalPackageEdit(pkg.hours, "extraKmRate", e.target.value)
                                }
                                className="w-16 h-8 px-2 rounded-lg border border-slate-200 font-semibold text-slate-800 bg-white focus:outline-none focus:border-[#991B1B]"
                              />
                            </td>
                            <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="number"
                                value={pkg.extraHourRate}
                                onChange={(e) =>
                                  handleRentalPackageEdit(pkg.hours, "extraHourRate", e.target.value)
                                }
                                className="w-16 h-8 px-2 rounded-lg border border-slate-200 font-semibold text-slate-800 bg-white focus:outline-none focus:border-[#991B1B]"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            {/* ============================================================= */}
            {/* SCHEDULED PEAK-HOUR PRICING + SHARED ACCORDIONS               */}
            {/* ============================================================= */}
            <div className="space-y-2.5">
              {/* 1. Scheduled Peak-Hour Pricing Accordion */}
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenAccordion(openAccordion === "peak" ? null : "peak")}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Zap className="w-4 h-4 text-amber-600" />
                    <span className="text-xs font-bold text-slate-900">
                      Scheduled peak-hour pricing (IST)
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                      Local: {peakLocalEnabled ? "ON" : "OFF"} • Rental:{" "}
                      {peakRentalEnabled ? "ON" : "OFF"}
                    </span>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      openAccordion === "peak" ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {openAccordion === "peak" && (
                  <div className="px-5 pb-5 pt-2 border-t border-slate-100 space-y-4 text-xs">
                    {/* Separate Local & Rental ON/OFF + Weekday Selector */}
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPeakLocalEnabled((v) => !v)}
                          className={`px-3 py-1.5 rounded-xl font-bold border transition-all ${
                            peakLocalEnabled
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                              : "bg-slate-100 text-slate-500 border-slate-200"
                          }`}
                        >
                          Local Peak: {peakLocalEnabled ? "ON" : "OFF"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPeakRentalEnabled((v) => !v)}
                          className={`px-3 py-1.5 rounded-xl font-bold border transition-all ${
                            peakRentalEnabled
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                              : "bg-slate-100 text-slate-500 border-slate-200"
                          }`}
                        >
                          Rental Peak: {peakRentalEnabled ? "ON" : "OFF"}
                        </button>
                      </div>

                      {/* Weekday Chips */}
                      <div className="flex items-center gap-1 flex-wrap">
                        {WEEKDAYS.map((day) => {
                          const active = peakWeekdays.includes(day);
                          return (
                            <button
                              key={day}
                              type="button"
                              onClick={() =>
                                setPeakWeekdays((prev) =>
                                  prev.includes(day)
                                    ? prev.filter((d) => d !== day)
                                    : [...prev, day]
                                )
                              }
                              className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                                active
                                  ? "bg-[#991B1B] text-white"
                                  : "bg-slate-100 text-slate-500 hover:bg-slate-200/70"
                              }`}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Peak Slots Table (7-10 AM, 5-8 PM IST) */}
                    <div className="space-y-2.5">
                      {peakRules.map((rule) => (
                        <div
                          key={rule.id}
                          className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-wrap items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={rule.active}
                              onChange={(e) =>
                                setPeakRules((prev) =>
                                  prev.map((r) =>
                                    r.id === rule.id ? { ...r, active: e.target.checked } : r
                                  )
                                )
                              }
                              className="rounded border-slate-300 text-[#991B1B]"
                            />
                            <div>
                              <p className="font-bold text-slate-900">{rule.displayWindow}</p>
                              <p className="text-[11px] text-slate-500">{rule.label}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            <select
                              value={rule.chargeMode}
                              onChange={(e) =>
                                setPeakRules((prev) =>
                                  prev.map((r) =>
                                    r.id === rule.id
                                      ? { ...r, chargeMode: e.target.value as PeakChargeMode }
                                      : r
                                  )
                                )
                              }
                              className="h-8 px-2 rounded-lg border border-slate-200 bg-white font-semibold text-slate-700"
                            >
                              <option value="percentage">Percentage (%)</option>
                              <option value="fixed">Fixed Extra (₹)</option>
                            </select>

                            <div className="flex items-center gap-1">
                              <span className="text-slate-400 font-bold">+</span>
                              <input
                                type="number"
                                min={0}
                                value={rule.value}
                                onChange={(e) =>
                                  setPeakRules((prev) =>
                                    prev.map((r) =>
                                      r.id === rule.id
                                        ? { ...r, value: parseFloat(e.target.value) || 0 }
                                        : r
                                    )
                                  )
                                }
                                className="w-14 h-8 px-2 rounded-lg border border-slate-200 bg-white font-bold text-slate-900 text-center"
                              />
                              <span className="text-slate-500 font-semibold">
                                {rule.chargeMode === "percentage" ? "%" : "₹"}
                              </span>
                            </div>

                            <div className="flex items-center gap-1 pl-2 border-l border-slate-200">
                              <span className="text-[11px] text-slate-500">Max cap ₹</span>
                              <input
                                type="number"
                                min={0}
                                value={rule.maxCap}
                                onChange={(e) =>
                                  setPeakRules((prev) =>
                                    prev.map((r) =>
                                      r.id === rule.id
                                        ? { ...r, maxCap: parseFloat(e.target.value) || 0 }
                                        : r
                                    )
                                  )
                                }
                                className="w-16 h-8 px-2 rounded-lg border border-slate-200 bg-white font-bold text-[#991B1B] text-center"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Applies based on <strong>scheduled pickup time</strong> (single rule per quote; never doubles on overlap). Calculated on eligible ride fare only — never on Toll or Parking.
                    </p>
                  </div>
                )}
              </div>

              {/* 2. Additional Charges Accordion */}
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
                <button
                  type="button"
                  onClick={() =>
                    setOpenAccordion(openAccordion === "additional" ? null : "additional")
                  }
                  className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Sliders className="w-4 h-4 text-slate-500" />
                    <span className="text-xs font-bold text-slate-900">Additional charges</span>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      openAccordion === "additional" ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {openAccordion === "additional" && (
                  <div className="px-5 pb-4 pt-3 border-t border-slate-100 space-y-3 text-xs">
                    {/* Local Route Auto-Add Toll */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={autoAddRouteTollLocal}
                            onChange={(e) => setAutoAddRouteTollLocal(e.target.checked)}
                            className="rounded border-slate-300 text-[#991B1B]"
                          />
                          <div>
                            <span className="font-bold text-slate-800 block">
                              Local route toll — Auto-add when route hits toll plaza
                            </span>
                            <span className="text-[11px] text-slate-500">
                              System fetches toll only when pickup/drop corridor crosses a toll plaza
                            </span>
                          </div>
                        </label>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-slate-500 font-semibold">Fallback / Rate ₹</span>
                          <input
                            type="number"
                            min={0}
                            disabled={!autoAddRouteTollLocal || tollSourceMode === "at_actuals"}
                            value={localRouteTollAmount}
                            onChange={(e) =>
                              setLocalRouteTollAmount(Math.max(0, parseFloat(e.target.value) || 0))
                            }
                            className="w-20 h-8 px-2 rounded-lg border border-slate-200 bg-white font-bold text-slate-900 disabled:opacity-50"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70 text-[11px]">
                        <span className="font-semibold text-slate-600">How system gets toll amount:</span>
                        <select
                          value={tollSourceMode}
                          onChange={(e) =>
                            setTollSourceMode(
                              e.target.value as "mapped_rate" | "route_api" | "at_actuals"
                            )
                          }
                          className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white font-bold text-slate-800 focus:outline-none focus:border-[#991B1B]"
                        >
                          <option value="mapped_rate">Mapped route / plaza rate table</option>
                          <option value="route_api">Live route toll API (with fallback ₹)</option>
                          <option value="at_actuals">At actuals (receipt at trip end)</option>
                        </select>
                      </div>
                    </div>

                    {/* Local Airport Entry Charge */}
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={localAirportEntryEnabled}
                          onChange={(e) => setLocalAirportEntryEnabled(e.target.checked)}
                          className="rounded border-slate-300 text-[#991B1B]"
                        />
                        <div>
                          <span className="font-bold text-slate-800 block">
                            Local airport entry charge (Local rides only)
                          </span>
                          <span className="text-[11px] text-slate-500">
                            Applied automatically when local pickup or drop is an airport
                          </span>
                        </div>
                      </label>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-500 font-semibold">Entry ₹</span>
                        <input
                          type="number"
                          min={0}
                          disabled={!localAirportEntryEnabled}
                          value={localAirportEntryFee}
                          onChange={(e) =>
                            setLocalAirportEntryFee(Math.max(0, parseFloat(e.target.value) || 0))
                          }
                          className="w-20 h-8 px-2 rounded-lg border border-slate-200 bg-white font-bold text-slate-900 disabled:opacity-50"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 pt-1">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={tollPassThrough}
                          onChange={(e) => setTollPassThrough(e.target.checked)}
                          className="rounded border-slate-300 text-[#991B1B]"
                        />
                        <span className="font-medium text-slate-700">
                          Other unmapped tolls at actuals (excluded from peak %)
                        </span>
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={parkingPassThrough}
                          onChange={(e) => setParkingPassThrough(e.target.checked)}
                          className="rounded border-slate-300 text-[#991B1B]"
                        />
                        <span className="font-medium text-slate-700">
                          Parking charges at actuals
                        </span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. Night Allowance Accordion */}
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenAccordion(openAccordion === "night" ? null : "night")}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Moon className="w-4 h-4 text-slate-500" />
                    <span className="text-xs font-bold text-slate-900">
                      Night allowance · Shared settings
                    </span>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      openAccordion === "night" ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {openAccordion === "night" && (
                  <div className="px-5 pb-4 pt-2 border-t border-slate-100 flex items-center gap-3 text-xs">
                    <span className="text-slate-600">Night window (10:00 PM – 05:00 AM):</span>
                    <input
                      type="number"
                      value={nightSurchargePercent}
                      onChange={(e) => setNightSurchargePercent(parseFloat(e.target.value) || 0)}
                      className="w-16 h-8 px-2 rounded-lg border border-slate-200 font-bold text-slate-900"
                    />
                    <span className="text-slate-500">% extra</span>
                  </div>
                )}
              </div>

              {/* 4. Price Display & GST Accordion */}
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenAccordion(openAccordion === "display" ? null : "display")}
                  className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Tag className="w-4 h-4 text-slate-500" />
                    <span className="text-xs font-bold text-slate-900">
                      Price display &amp; GST ({gstPercent}%)
                    </span>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 transition-transform ${
                      openAccordion === "display" ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {openAccordion === "display" && (
                  <div className="px-5 pb-4 pt-2 border-t border-slate-100 flex items-center gap-3 text-xs">
                    <span className="text-slate-600">Applicable GST on ride fare + peak:</span>
                    <input
                      type="number"
                      value={gstPercent}
                      onChange={(e) => setGstPercent(parseFloat(e.target.value) || 0)}
                      className="w-16 h-8 px-2 rounded-lg border border-slate-200 font-bold text-slate-900"
                    />
                    <span className="text-slate-500">%</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* =============================================================== */}
          {/* RIGHT 4 COLS: LIVE TEST QUOTE CARD (MATCHED AREA + PEAK BREAKDOWN) */}
          {/* =============================================================== */}
          <aside className="lg:col-span-4 bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-red-50 text-[#991B1B] flex items-center justify-center">
                <Calculator className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-slate-900">Test quote</h2>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Pickup area
                </label>
                <select
                  value={testPickupAreaId}
                  onChange={(e) => setTestPickupAreaId(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-slate-200 bg-white font-semibold text-slate-900 focus:outline-none focus:border-[#991B1B]"
                >
                  {allVillagesIndex.map((item) => (
                    <option key={item.village.id} value={item.village.id}>
                      {item.village.name} ({item.village.pincode})
                    </option>
                  ))}
                </select>
              </div>

                <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Vehicle
                  </label>
                  <select
                    value={testVehicleId}
                    onChange={(e) => setTestVehicleId(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-xl border border-slate-200 bg-white font-semibold text-slate-900 focus:outline-none focus:border-[#991B1B]"
                  >
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>

                {serviceMode === "pickup_drop" ? (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Distance (km)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={testDistanceKm}
                      onChange={(e) => setTestDistanceKm(e.target.value)}
                      className="w-full h-9 px-3 rounded-xl border border-slate-200 font-bold text-slate-900 focus:outline-none focus:border-[#991B1B]"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Package hours
                    </label>
                    <select
                      value={testRentalHours}
                      onChange={(e) => setTestRentalHours(parseInt(e.target.value, 10))}
                      className="w-full h-9 px-2.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-900 focus:outline-none focus:border-[#991B1B]"
                    >
                      {Array.from({ length: 15 }, (_, i) => i + 1).map((h) => (
                        <option key={h} value={h}>
                          {h} {h === 1 ? "hour" : "hours"}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Scheduled Pickup Time & Waiting for Peak Rule Test */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-semibold text-slate-600">
                      Pickup day &amp; time
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const nextPreset = testDatePreset === "tomorrow" ? "today" : "tomorrow";
                        setTestDatePreset(nextPreset);
                        setTestWeekday(nextPreset === "tomorrow" ? "Thu" : "Wed");
                      }}
                      className="text-[10px] font-bold text-[#991B1B] hover:underline"
                    >
                      {testDatePreset === "tomorrow" ? "Tomorrow (Thu)" : "Today (Wed)"}
                    </button>
                  </div>
                  <select
                    value={testScheduledHour}
                    onChange={(e) => setTestScheduledHour(parseInt(e.target.value, 10))}
                    className="w-full h-9 px-2.5 rounded-xl border border-slate-200 bg-white font-semibold text-slate-900 focus:outline-none focus:border-[#991B1B]"
                  >
                    <option value={8}>08:00 AM (Peak)</option>
                    <option value={11}>11:00 AM (Normal)</option>
                    <option value={14}>02:00 PM (Normal)</option>
                    <option value={18}>06:00 PM (Peak)</option>
                    <option value={21}>09:00 PM (Normal)</option>
                  </select>
                </div>

                {serviceMode === "pickup_drop" ? (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Total wait (mins)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={testWaitMins}
                      onChange={(e) => setTestWaitMins(parseInt(e.target.value, 10) || 0)}
                      className="w-full h-9 px-3 rounded-xl border border-slate-200 font-bold text-slate-900 focus:outline-none focus:border-[#991B1B]"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Day of week
                    </label>
                    <select
                      value={testWeekday}
                      onChange={(e) => setTestWeekday(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-xl border border-slate-200 bg-white font-semibold text-slate-900"
                    >
                      {WEEKDAYS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Local Route Context Toggles (Toll Plaza Hit & Airport Ride) */}
              {serviceMode === "pickup_drop" && (
                <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[11px]">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={testRouteHasToll}
                      onChange={(e) => setTestRouteHasToll(e.target.checked)}
                      className="rounded border-slate-300 text-[#991B1B]"
                    />
                    <span>Route has toll</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={testIsAirportTrip}
                      onChange={(e) => setTestIsAirportTrip(e.target.checked)}
                      className="rounded border-slate-300 text-[#991B1B]"
                    />
                    <span>Airport pickup/drop</span>
                  </label>
                </div>
              )}
            </div>

            {/* Matched Area & Applied Rate Summary */}
            <div className="pt-3 border-t border-slate-100 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Pickup schedule</span>
                <span className="font-bold text-slate-800">
                  {resolvedTestDateMeta.formattedDate} ({resolvedTestDateMeta.weekdayShort})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Matched area</span>
                <span className="font-bold text-slate-900">
                  {testQuoteSummary.matchedEntry.village.name} (
                  {testQuoteSummary.matchedEntry.village.pincode})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Applied rate</span>
                <span className="font-bold text-[#991B1B]">
                  {testQuoteSummary.appliedRateLabel}
                </span>
              </div>
            </div>

            {/* Upfront Transparent Customer Breakdown */}
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-2 text-xs">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Customer Quote Breakdown
              </p>

              {serviceMode === "pickup_drop" ? (
                <>
                  <div className="flex justify-between text-slate-600">
                    <span>Base fare (incl. {testQuoteSummary.includedKm} km)</span>
                    <span className="font-semibold text-slate-900">
                      ₹{testQuoteSummary.baseFare}
                    </span>
                  </div>
                  {testQuoteSummary.extraKm > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>Extra distance ({testQuoteSummary.extraKm} km)</span>
                      <span className="font-semibold text-slate-900">
                        +₹{testQuoteSummary.extraKmCharge}
                      </span>
                    </div>
                  )}
                  {testQuoteSummary.chargeableWaitMins > 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>
                        Chargeable waiting ({testQuoteSummary.chargeableWaitMins} min)
                      </span>
                      <span className="font-semibold text-slate-900">
                        +₹{testQuoteSummary.waitingCharge}
                      </span>
                    </div>
                  )}
                  {testQuoteSummary.minimumApplied && (
                    <div className="flex justify-between text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded">
                      <span>Minimum fare floor applied</span>
                      <span>₹{testQuoteSummary.minimumFare}</span>
                    </div>
                  )}
                  {testQuoteSummary.appliedRouteToll > 0 && (
                    <div className="flex justify-between text-slate-700">
                      <span>Route toll (auto-added)</span>
                      <span className="font-semibold text-slate-900">
                        +₹{testQuoteSummary.appliedRouteToll}
                      </span>
                    </div>
                  )}
                  {testQuoteSummary.appliedAirportEntry > 0 && (
                    <div className="flex justify-between text-slate-700">
                      <span>Airport entry charge</span>
                      <span className="font-semibold text-slate-900">
                        +₹{testQuoteSummary.appliedAirportEntry}
                      </span>
                    </div>
                  )}
                  {testQuoteSummary.nightAllowanceCharge > 0 && (
                    <div className="flex justify-between text-slate-700">
                      <span>Night allowance ({nightSurchargePercent}%)</span>
                      <span className="font-semibold text-slate-900">
                        +₹{testQuoteSummary.nightAllowanceCharge}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex justify-between text-slate-600">
                  <span>
                    Package ({testRentalHours} hr / {testQuoteSummary.includedKm} km)
                  </span>
                  <span className="font-semibold text-slate-900">
                    ₹{testQuoteSummary.baseFare}
                  </span>
                </div>
              )}

              {/* Explicit Pre-Confirm Peak-Hour Charge Line */}
              {testQuoteSummary.peakCharge > 0 && testQuoteSummary.matchedPeakRule && (
                <div className="flex justify-between items-center text-amber-900 bg-amber-50 border border-amber-200/80 px-2.5 py-1.5 rounded-lg font-bold">
                  <span className="flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5 text-amber-600" />
                    <span>Peak-hour charge</span>
                  </span>
                  <span>+₹{testQuoteSummary.peakCharge}</span>
                </div>
              )}

              <div className="flex justify-between text-slate-600">
                <span>GST ({gstPercent}%)</span>
                <span className="font-semibold text-slate-900">
                  +₹{testQuoteSummary.gstAmount}
                </span>
              </div>

              <div className="pt-2 border-t border-slate-200 flex justify-between items-baseline">
                <span className="font-bold text-slate-900">Estimated Total</span>
                <span className="text-lg font-extrabold text-[#991B1B]">
                  ₹{testQuoteSummary.totalCustomerQuote.toLocaleString("en-IN")}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 pt-1">
                Confirmed bookings lock their saved fare even if rates or peak rules update later.
              </p>
            </div>
          </aside>
        </div>
      </div>

      {/* =================================================================== */}
      {/* STICKY BOTTOM SAVE BAR WITH MANDATORY AUDIT REASON                  */}
      {/* =================================================================== */}
      <footer className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 sm:px-8 py-3">
        <div className="max-w-[1440px] mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="text-xs">
            <p className="font-bold text-slate-900">
              {selectedBrand} ·{" "}
              {serviceMode === "pickup_drop" ? "Pickup & Drop" : "Hourly Rental"} ·{" "}
              {currentDistrict.name} district
            </p>
            <p className="text-[11px] text-slate-500">
              New quotes use updated rates. Confirmed bookings keep their saved fares.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-1 md:max-w-xl justify-end">
            <span className="text-xs font-semibold text-slate-600 shrink-0 hidden sm:inline">
              Reason for change
            </span>
            <input
              type="text"
              value={reasonForChange}
              onChange={(e) => setReasonForChange(e.target.value)}
              placeholder="Enter a reason for this change..."
              className="flex-1 h-9 px-3 rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white text-xs font-medium text-slate-900 focus:outline-none focus:border-[#991B1B]"
            />
            <button
              type="button"
              onClick={handleSaveRules}
              className="h-9 px-4 rounded-xl bg-[#991B1B] hover:bg-[#7F1D1D] text-white text-xs font-bold shadow-xs flex items-center gap-1.5 shrink-0 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save fare rules</span>
            </button>
          </div>
        </div>
      </footer>

      {/* Save Confirmation / Validation Toast */}
      {saveBanner && (
        <div className="fixed bottom-16 right-6 z-50 max-w-md bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{saveBanner}</span>
        </div>
      )}
    </div>
  );
}