import {
  FareRule,
  FareCalculationInput,
  FareCalculationResult,
  FareBreakdownItem,
  VehicleCategory,
} from "../types";

/**
 * Checks if a given time string "HH:MM" falls within a night window (e.g. "22:00" to "05:00")
 * Handles windows crossing midnight correctly.
 */
export function isNightTime(pickupTime?: string, startTime = "22:00", endTime = "05:00"): boolean {
  if (!pickupTime) return false;
  
  const parseMinutes = (t: string) => {
    const [h, m] = t.split(":").map((n) => parseInt(n, 10) || 0);
    return h * 60 + m;
  };

  const current = parseMinutes(pickupTime);
  const start = parseMinutes(startTime);
  const end = parseMinutes(endTime);

  if (start > end) {
    // Window crosses midnight (e.g., 22:00 to 05:00)
    return current >= start || current <= end;
  } else {
    // Normal window (e.g., 01:00 to 05:00)
    return current >= start && current <= end;
  }
}

/** YYYY-MM-DD of the given date in local time. */
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Active and within its effective-from / effective-until window on `onDate`. */
export function isRuleEffective(r: FareRule, onDate = new Date()): boolean {
  if (r.status !== "Active") return false;
  const day = isoDay(onDate);
  if (r.effectiveFrom && day < r.effectiveFrom) return false;
  if (r.effectiveUntil && day > r.effectiveUntil) return false;
  return true;
}

/**
 * Find the best matching FareRule using deterministic precedence:
 * 1. Origin + Destination + Vehicle Category (Fixed Route)
 * 2. Service + Vehicle Category
 * 3. Vehicle Category
 * Within a level, the lowest `priority` number wins (1 = highest).
 */
export function findMatchingFareRule(
  rules: FareRule[],
  input: FareCalculationInput,
  onDate = new Date(),
): FareRule | null {
  const activeRules = rules
    .filter((r) => isRuleEffective(r, onDate))
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

  // 1. Exact Route Match
  if (input.originLocationId && input.destinationLocationId) {
    const routeMatch = activeRules.find(
      (r) =>
        r.pricingType === "FIXED_ROUTE" &&
        r.vehicleCategoryId === input.vehicleCategoryId &&
        r.originLocationId === input.originLocationId &&
        r.destinationLocationId === input.destinationLocationId
    );
    if (routeMatch) return routeMatch;
  }

  // 2. Service + Vehicle Category Match
  if (input.serviceId || input.serviceName) {
    const serviceMatch = activeRules.find(
      (r) =>
        (r.serviceId === input.serviceId || (input.serviceName && r.serviceName === input.serviceName)) &&
        r.vehicleCategoryId === input.vehicleCategoryId
    );
    if (serviceMatch) return serviceMatch;
  }

  // 3. Vehicle Category Specific Rule
  const categoryMatch = activeRules.find(
    (r) => r.vehicleCategoryId === input.vehicleCategoryId
  );
  if (categoryMatch) return categoryMatch;

  return null;
}

/**
 * QUOTATION RATE-CARD ENGINE (admin / phone bookings)
 * Pure, deterministic fare calculation from fare rules, falling back to the
 * vehicle category's own fare. Returns null when neither is configured —
 * a price is never invented. App bookings are priced by bookingFareEngine.
 */
export function calculateCentralFare(
  input: FareCalculationInput,
  fareRules: FareRule[],
  vehicleCategories: VehicleCategory[] = [],
  onDate = new Date(),
): FareCalculationResult | null {
  const matchedRule = findMatchingFareRule(fareRules, input, onDate);

  // Fallback to the vehicle category's configured fare if no rule matched.
  const fallbackCat = vehicleCategories.find((c) => c.id === input.vehicleCategoryId);
  let ruleToUse: Partial<FareRule> | null = matchedRule;

  let fallbackUsed = false;
  if (!ruleToUse && fallbackCat?.fare && Number(fallbackCat.fare.perKmRate) > 0) {
    fallbackUsed = true;
    const f = fallbackCat.fare;
    // Same policy as the booking server: driver allowance only on outstation
    // trips (over 40 km one way) and the night allowance from 22:00 to 06:00.
    const outstation = (input.distanceKm || 0) > 40;
    ruleToUse = {
      name: `${fallbackCat.name} category fare`,
      pricingType: "BASE_PLUS_PER_KM",
      baseFare: f.baseFare || 0,
      baseKm: f.baseKm || 0,
      perKmRate: outstation && f.outstationPerKmRate ? f.outstationPerKmRate : f.perKmRate,
      minimumFare: f.minimumFare || 0,
      driverBatta: outstation ? f.outstationDriverBattaPerDay || f.driverAllowance || 0 : 0,
      nightChargeEnabled: (f.nightAllowance || 0) > 0,
      nightChargeType: "Fixed",
      nightChargeValue: f.nightAllowance || 0,
      nightStartTime: "22:00",
      nightEndTime: "05:59",
      waitingChargePerHour: f.waitingChargePerHour || 0,
      tollMode: f.tollIncluded ? "Included" : "Excluded",
      parkingMode: f.parkingIncluded ? "Included" : "Excluded",
      permitCharge: f.permitCharge || 0,
      status: "Active",
    };
  }

  if (!ruleToUse) return null;

  const breakdown: FareBreakdownItem[] = [];
  const days = Math.max(1, input.tripDays || 1);
  const distance = Math.max(0, input.distanceKm || 0);

  let baseFare = 0;
  let distanceFare = 0;
  let extraKmCharge = 0;
  let extraHourCharge = 0;
  let billableDistanceKm = distance;

  const pricingType = ruleToUse.pricingType || "BASE_PLUS_PER_KM";

  switch (pricingType) {
    case "FIXED_ROUTE": {
      baseFare = Math.round(ruleToUse.baseFare || 0);
      breakdown.push({
        label: `Fixed Route Base Fare (${input.originLocationName || "Origin"} → ${input.destinationLocationName || "Destination"})`,
        amount: baseFare,
      });
      break;
    }

    case "PER_KM": {
      const minKmDaily = ruleToUse.minimumKmPerDay || 0;
      const minKmTotal = minKmDaily * days;
      billableDistanceKm = Math.max(distance, minKmTotal);
      distanceFare = Math.round(billableDistanceKm * (ruleToUse.perKmRate || 0));

      if (minKmTotal > distance) {
        breakdown.push({
          label: `Min Distance Fare (${days} days @ ${minKmDaily} km/day = ${minKmTotal} km @ ₹${ruleToUse.perKmRate}/km)`,
          amount: distanceFare,
        });
      } else {
        breakdown.push({
          label: `Distance Fare (${billableDistanceKm} km @ ₹${ruleToUse.perKmRate}/km)`,
          amount: distanceFare,
        });
      }
      break;
    }

    case "HOURLY_RENTAL": {
      baseFare = Math.round(ruleToUse.baseFare || 0);
      const incKm = ruleToUse.baseKm || 0;
      const incHrs = ruleToUse.includedHours || 0;

      breakdown.push({
        label: `Package Base (${incHrs} hrs / ${incKm} km)`,
        amount: baseFare,
      });

      // Extra KM
      if (distance > incKm) {
        const extraKm = distance - incKm;
        extraKmCharge = Math.round(extraKm * (ruleToUse.extraKmRate || ruleToUse.perKmRate || 0));
        breakdown.push({
          label: `Extra KM Charge (${extraKm} km @ ₹${ruleToUse.extraKmRate || ruleToUse.perKmRate || 0}/km)`,
          amount: extraKmCharge,
        });
      }

      // Extra Hours
      const hrs = input.tripHours ?? incHrs;
      if (hrs > incHrs) {
        const extraHrs = hrs - incHrs;
        extraHourCharge = Math.round(extraHrs * (ruleToUse.extraHourRate || ruleToUse.waitingChargePerHour || 0));
        breakdown.push({
          label: `Extra Hours Charge (${extraHrs} hrs @ ₹${ruleToUse.extraHourRate || ruleToUse.waitingChargePerHour || 0}/hr)`,
          amount: extraHourCharge,
        });
      }
      break;
    }

    case "PER_DAY": {
      const minKmDaily = ruleToUse.minimumKmPerDay || 0;
      const minKmTotal = minKmDaily * days;
      billableDistanceKm = Math.max(distance, minKmTotal);
      distanceFare = Math.round(billableDistanceKm * (ruleToUse.perKmRate || 0));

      breakdown.push({
        label: `Outstation Distance Fare (${billableDistanceKm} km @ ₹${ruleToUse.perKmRate}/km)`,
        amount: distanceFare,
      });
      break;
    }

    case "BASE_PLUS_PER_KM":
    default: {
      baseFare = Math.round(ruleToUse.baseFare || 0);
      const baseKm = ruleToUse.baseKm || 0;
      breakdown.push({
        label: baseKm > 0 ? `Base Fare (includes first ${baseKm} km)` : "Base Fare",
        amount: baseFare,
      });

      if (distance > baseKm) {
        const extraKm = distance - baseKm;
        distanceFare = Math.round(extraKm * (ruleToUse.perKmRate || 0));
        breakdown.push({
          label: `Additional Distance (${extraKm} km @ ₹${ruleToUse.perKmRate}/km)`,
          amount: distanceFare,
        });
      }
      break;
    }
  }

  // Driver Batta / Allowance
  let driverBatta = 0;
  if (ruleToUse.driverBatta && ruleToUse.driverBatta > 0) {
    driverBatta = Math.round(ruleToUse.driverBatta * days);
    breakdown.push({
      label: `Driver Batta (${days} day${days > 1 ? "s" : ""} @ ₹${ruleToUse.driverBatta}/day)`,
      amount: driverBatta,
    });
  }

  // Night Surcharge
  let nightCharge = 0;
  if (
    ruleToUse.nightChargeEnabled &&
    isNightTime(input.pickupTime, ruleToUse.nightStartTime || "22:00", ruleToUse.nightEndTime || "05:00")
  ) {
    if (ruleToUse.nightChargeType === "Percentage") {
      const pct = (ruleToUse.nightChargeValue || 0) / 100;
      nightCharge = Math.round((baseFare + distanceFare) * pct);
      breakdown.push({
        label: `Night Surcharge (${ruleToUse.nightChargeValue}% for pickup between ${ruleToUse.nightStartTime || "22:00"}-${ruleToUse.nightEndTime || "05:00"})`,
        amount: nightCharge,
      });
    } else {
      nightCharge = Math.round(ruleToUse.nightChargeValue || 0);
      breakdown.push({
        label: `Night Allowance (Fixed ₹${nightCharge})`,
        amount: nightCharge,
      });
    }
  }

  // Waiting Charges
  let waitingCharge = 0;
  if (input.waitingMinutes && input.waitingMinutes > (ruleToUse.freeWaitingMinutes || 0)) {
    const billableMins = input.waitingMinutes - (ruleToUse.freeWaitingMinutes || 0);
    const billableHrs = Math.ceil(billableMins / 60);
    waitingCharge = Math.round(billableHrs * (ruleToUse.waitingChargePerHour || 0));
    breakdown.push({
      label: `Waiting Charge (${billableHrs} hrs @ ₹${ruleToUse.waitingChargePerHour || 0}/hr)`,
      amount: waitingCharge,
    });
  }

  // Toll, Parking, Permit
  // "Included" means the rate already covers it, so nothing is added on top.
  let tollAmount = ruleToUse.tollMode === "Included" ? 0 : input.tollAmount || 0;
  if (ruleToUse.tollMode === "Fixed" && ruleToUse.fixedTollAmount) {
    tollAmount = ruleToUse.fixedTollAmount;
  }
  if (tollAmount > 0) {
    breakdown.push({ label: "Toll Charges", amount: tollAmount });
  }

  let parkingAmount = ruleToUse.parkingMode === "Included" ? 0 : input.parkingAmount || 0;
  if (ruleToUse.parkingMode === "Fixed" && ruleToUse.fixedParkingAmount) {
    parkingAmount = ruleToUse.fixedParkingAmount;
  }
  if (parkingAmount > 0) {
    breakdown.push({ label: "Parking Charges", amount: parkingAmount });
  }

  let permitAmount = input.permitAmount || ruleToUse.permitCharge || 0;
  if (permitAmount > 0) {
    breakdown.push({ label: "Interstate Permit Charge", amount: permitAmount });
  }

  // Minimum fare (on the fare itself, before pass-through charges and discount)
  const fareBeforeExtras = baseFare + distanceFare + extraKmCharge + extraHourCharge + driverBatta + nightCharge + waitingCharge;
  const minimumFareAdjustment = Math.max(0, Math.round(ruleToUse.minimumFare || 0) - fareBeforeExtras);
  if (minimumFareAdjustment > 0) {
    breakdown.push({ label: `Minimum fare adjustment (minimum ₹${ruleToUse.minimumFare})`, amount: minimumFareAdjustment });
  }

  // Discount
  const discountAmount = Math.max(0, input.discountAmount || 0);
  if (discountAmount > 0) {
    breakdown.push({ label: "Discount Applied", amount: -discountAmount });
  }

  // Subtotal & GST (5% standard transport GST)
  const subtotal = Math.max(
    0,
    baseFare +
      distanceFare +
      extraKmCharge +
      extraHourCharge +
      driverBatta +
      nightCharge +
      waitingCharge +
      minimumFareAdjustment +
      tollAmount +
      parkingAmount +
      permitAmount -
      discountAmount
  );

  const gstAmount = Math.round(subtotal * 0.05); // 5% GST
  const grandTotal = subtotal + gstAmount;

  breakdown.push({ label: "GST (5%)", amount: gstAmount });

  return {
    matchedRule: fallbackUsed ? null : matchedRule,
    baseFare,
    distanceFare,
    driverBatta,
    nightCharge,
    waitingCharge,
    extraKmCharge,
    extraHourCharge,
    tollAmount,
    parkingAmount,
    permitAmount,
    discountAmount,
    subtotal,
    gstAmount,
    grandTotal,
    billableDistanceKm,
    breakdown,
    fallbackUsed,
  };
}
