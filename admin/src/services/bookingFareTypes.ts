/** The fare breakdown the server returns for a booking quote. The server (functions/src/quote.ts) is the only place a fare is calculated; prices come from Service & Fare Settings. */
export interface BookingFareBreakdown {
  addOns?: { roofCarrier: boolean; pets: boolean; carrierCharge: number; petCharge: number };
  subtotalBeforeAdjustment: number;
  globalAdjustment: { id: string; name: string; direction: "increase" | "decrease"; percent: number; amount: number } | null;
  discountDetail: { type: string; value: number; amount: number; source: string; reason: string } | null;
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  nightCharge: number;
  /** Scheduled peak-hour charge (taxable), Local Pickup & Drop / Hourly Rental. */
  peakCharge?: number;
  /** Local airport entry fee: a pass-through outside the taxable amount, included in the total. */
  airportEntry?: number;
  driverAllowance: number;
  minimumFareAdjustment: number;
  subtotal: number;
  discount: number;
  taxableAmount: number;
  gstRate: number;
  gst: number;
  total: number;
  distanceKm: number;
  durationMin: number;
  perKmRate: number;
  perMinuteRate: number;
}
