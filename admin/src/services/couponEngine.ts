import {
  MasterCoupon,
  CouponValidationContext,
  CouponValidationResult,
  CouponStatus,
} from "../types";

/**
 * Normalize coupon code for uniform comparison (uppercase, trimmed, no inner spaces)
 */
export function normalizeCouponCode(code: string): string {
  return (code || "").trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Evaluate effective coupon status based on current date and validity dates
 */
export function getEffectiveCouponStatus(
  coupon: MasterCoupon,
  now: Date = new Date()
): CouponStatus {
  if (coupon.status === "Inactive" || coupon.status === "Draft" || coupon.status === "Archived") {
    return coupon.status;
  }

  const todayStr = now.toISOString().split("T")[0];

  if (coupon.validFrom && todayStr < coupon.validFrom) {
    return "Scheduled";
  }

  if (coupon.validUntil && todayStr > coupon.validUntil) {
    return "Expired";
  }

  return "Active";
}

/**
 * CENTRAL COUPON VALIDATION & DISCOUNT CALCULATION ENGINE
 * Authoritative source of truth for coupon eligibility across Bookings and Customer app.
 */
export function validateAndCalculateCoupon(
  couponsList: MasterCoupon[],
  inputCode: string,
  context: CouponValidationContext
): CouponValidationResult {
  const normInput = normalizeCouponCode(inputCode);
  const eligibleSubtotal = Math.max(0, context.eligibleSubtotal || 0);

  if (!normInput) {
    return {
      valid: false,
      reasonCode: "EMPTY_CODE",
      message: "Please enter a coupon code.",
      coupon: null,
      discountAmount: 0,
      finalPayableAmount: eligibleSubtotal,
    };
  }

  // Find matching coupon by normalized code
  const targetCoupon = couponsList.find(
    (c) => normalizeCouponCode(c.code) === normInput
  );

  if (!targetCoupon) {
    return {
      valid: false,
      reasonCode: "NOT_FOUND",
      message: `Invalid coupon code "${inputCode}". Please check for typos.`,
      coupon: null,
      discountAmount: 0,
      finalPayableAmount: eligibleSubtotal,
    };
  }

  const now = context.currentDate || new Date();
  const effectiveStatus = getEffectiveCouponStatus(targetCoupon, now);

  // Status check
  if (effectiveStatus !== "Active") {
    let msg = `Coupon "${targetCoupon.code}" is currently inactive.`;
    if (effectiveStatus === "Expired") {
      msg = `Coupon "${targetCoupon.code}" expired on ${targetCoupon.validUntil}.`;
    } else if (effectiveStatus === "Scheduled") {
      msg = `Coupon "${targetCoupon.code}" is scheduled to start on ${targetCoupon.validFrom}.`;
    }

    return {
      valid: false,
      reasonCode: effectiveStatus,
      message: msg,
      coupon: targetCoupon,
      discountAmount: 0,
      finalPayableAmount: eligibleSubtotal,
    };
  }

  // Global Usage Limit Check
  if (
    targetCoupon.totalUsageLimit &&
    targetCoupon.totalUsageLimit > 0 &&
    (targetCoupon.usedCount || 0) >= targetCoupon.totalUsageLimit
  ) {
    return {
      valid: false,
      reasonCode: "LIMIT_EXHAUSTED",
      message: `Coupon "${targetCoupon.code}" has reached its maximum global usage limit.`,
      coupon: targetCoupon,
      discountAmount: 0,
      finalPayableAmount: eligibleSubtotal,
    };
  }

  // Minimum Booking Amount Check
  if (
    targetCoupon.minimumBookingAmount &&
    eligibleSubtotal < targetCoupon.minimumBookingAmount
  ) {
    return {
      valid: false,
      reasonCode: "MIN_AMOUNT_NOT_MET",
      message: `Coupon "${targetCoupon.code}" requires a minimum booking subtotal of ₹${targetCoupon.minimumBookingAmount.toLocaleString()}.`,
      coupon: targetCoupon,
      discountAmount: 0,
      finalPayableAmount: eligibleSubtotal,
    };
  }

  // Service Restrictions Check
  if (
    targetCoupon.serviceNames &&
    targetCoupon.serviceNames.length > 0 &&
    context.serviceName
  ) {
    const serviceMatch = targetCoupon.serviceNames.some(
      (srv) => srv.toLowerCase() === context.serviceName?.toLowerCase()
    );
    if (!serviceMatch) {
      return {
        valid: false,
        reasonCode: "SERVICE_RESTRICTED",
        message: `Coupon "${targetCoupon.code}" is only valid for: ${targetCoupon.serviceNames.join(", ")}.`,
        coupon: targetCoupon,
        discountAmount: 0,
        finalPayableAmount: eligibleSubtotal,
      };
    }
  }

  // Vehicle Category Restrictions Check
  if (
    targetCoupon.vehicleCategoryIds &&
    targetCoupon.vehicleCategoryIds.length > 0 &&
    context.vehicleCategoryId
  ) {
    if (!targetCoupon.vehicleCategoryIds.includes(context.vehicleCategoryId)) {
      return {
        valid: false,
        reasonCode: "VEHICLE_RESTRICTED",
        message: `Coupon "${targetCoupon.code}" is not valid for the selected vehicle category.`,
        coupon: targetCoupon,
        discountAmount: 0,
        finalPayableAmount: eligibleSubtotal,
      };
    }
  }

  // First Booking Only Check
  if (targetCoupon.firstBookingOnly && context.isFirstBooking === false) {
    return {
      valid: false,
      reasonCode: "FIRST_BOOKING_ONLY",
      message: `Coupon "${targetCoupon.code}" is exclusive to first-time customer bookings.`,
      coupon: targetCoupon,
      discountAmount: 0,
      finalPayableAmount: eligibleSubtotal,
    };
  }

  // CALCULATE DISCOUNT AMOUNT
  let calculatedDiscount = 0;

  if (targetCoupon.discountType === "FIXED_AMOUNT") {
    calculatedDiscount = Math.min(targetCoupon.discountValue || 0, eligibleSubtotal);
  } else if (targetCoupon.discountType === "PERCENTAGE") {
    const pct = Math.min(100, Math.max(0, targetCoupon.discountValue || 0)) / 100;
    const rawDiscount = eligibleSubtotal * pct;
    if (targetCoupon.maximumDiscount && targetCoupon.maximumDiscount > 0) {
      calculatedDiscount = Math.min(rawDiscount, targetCoupon.maximumDiscount);
    } else {
      calculatedDiscount = rawDiscount;
    }
  }

  const finalDiscount = Math.round(Math.max(0, calculatedDiscount));
  const finalPayable = Math.max(0, eligibleSubtotal - finalDiscount);

  return {
    valid: true,
    message: `Coupon "${targetCoupon.code}" applied successfully! Saved ₹${finalDiscount.toLocaleString()}.`,
    coupon: targetCoupon,
    discountAmount: finalDiscount,
    finalPayableAmount: finalPayable,
  };
}
