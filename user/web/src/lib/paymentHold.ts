// While a rider is paying online at checkout, the "Booking confirmed" popup is held back: a booking is confirmed to them only after the
// payment is complete (the server sends that notice once it records the payment). Older servers still send it when the booking is made.
let holding = false;
export const holdBookingConfirmed = (on: boolean): void => { holding = on; };
export const isHoldingBookingConfirmed = (): boolean => holding;
