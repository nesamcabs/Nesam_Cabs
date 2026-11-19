import { beforeEach, describe, expect, it, vi } from 'vitest';

// The server and Razorpay Checkout are replaced: this tests what the rider is told for every way a payment can end.
const createBookingPayment = vi.fn();
const verifyBookingPayment = vi.fn();
const openCheckout = vi.fn();
vi.mock('@core/services/paymentService', () => ({
  createBookingPayment: (...a: unknown[]) => createBookingPayment(...a),
  verifyBookingPayment: (...a: unknown[]) => verifyBookingPayment(...a),
  getPaymentOptions: vi.fn(async () => ({ online: true, methods: [] })),
  paymentErrorText: (e: unknown) => (/PAYMENT_NOT_CONFIGURED/.test(String((e as Error)?.message)) ? 'Online payment is not available yet. Please pay your driver by cash or UPI.' : (e as Error)?.message || 'The payment could not be completed. You have not been charged; please try again.'),
}));
vi.mock('./razorpayCheckout', () => ({ brandColor: () => '#1665e8', openCheckout: (...a: unknown[]) => openCheckout(...a) }));

import { bookingAmountDue, payBookingOnline } from './onlinePayment';

const order = { orderId: 'order_1', amount: 117200, currency: 'INR', keyId: 'rzp_test_x' };
const success = { orderId: 'order_1', paymentId: 'pay_1', signature: 'sig' };

beforeEach(() => {
  createBookingPayment.mockReset().mockResolvedValue(order);
  verifyBookingPayment.mockReset();
  openCheckout.mockReset().mockResolvedValue(success);
});

describe('payBookingOnline', () => {
  it('a captured payment is reported as paid, and the server is asked to verify exactly what Checkout returned', async () => {
    verifyBookingPayment.mockResolvedValue({ verified: true, status: 'paid', balanceDue: 0 });
    const r = await payBookingOnline('bk1', 'Ride booking', { name: 'A' });
    expect(r).toEqual({ status: 'paid', message: 'Payment received. Thank you!' });
    expect(createBookingPayment).toHaveBeenCalledWith('bk1');
    expect(verifyBookingPayment).toHaveBeenCalledWith('bk1', success);
    expect(openCheckout.mock.calls[0][1]).toMatchObject({ name: 'NESAM Cabs', description: 'Ride booking', color: '#1665e8' });
  });

  it('a part payment says what is still owed', async () => {
    verifyBookingPayment.mockResolvedValue({ verified: true, status: 'paid', balanceDue: 250 });
    expect((await payBookingOnline('bk1', 'x')).message).toBe('Payment received. Balance ₹250.');
  });

  it('closing the payment window charges nothing and keeps the booking', async () => {
    openCheckout.mockResolvedValue('dismissed');
    const r = await payBookingOnline('bk1', 'x');
    expect(r.status).toBe('dismissed');
    expect(r.message).toMatch(/not been charged/);
    expect(verifyBookingPayment).not.toHaveBeenCalled();
  });

  it('a payment the provider has not captured yet is "being confirmed", never "paid"', async () => {
    verifyBookingPayment.mockResolvedValue({ verified: true, status: 'pending', message: 'Your payment is being confirmed.' });
    expect(await payBookingOnline('bk1', 'x')).toEqual({ status: 'pending', message: 'Your payment is being confirmed.' });
  });

  it('online payment not set up on the server reads as pay-the-driver, and Checkout is never opened', async () => {
    createBookingPayment.mockRejectedValue(new Error('PAYMENT_NOT_CONFIGURED'));
    const r = await payBookingOnline('bk1', 'x');
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/cash or UPI/);
    expect(openCheckout).not.toHaveBeenCalled();
  });

  it('Checkout failing to load is an error the rider can act on', async () => {
    openCheckout.mockRejectedValue(new Error('The secure payment page could not load. Check your connection and try again.'));
    const r = await payBookingOnline('bk1', 'x');
    expect(r).toEqual({ status: 'error', message: 'The secure payment page could not load. Check your connection and try again.' });
  });

  it('if verification fails AFTER Checkout succeeded, the rider is never told "not charged" and never asked to pay twice', async () => {
    verifyBookingPayment.mockRejectedValue(new Error('network'));
    const r = await payBookingOnline('bk1', 'x');
    expect(r.status).toBe('pending');
    expect(r.message).toMatch(/do not pay again/);
    expect(r.message).not.toMatch(/not been charged/);
  });

  it('never throws, whatever happens', async () => {
    createBookingPayment.mockRejectedValue('boom');
    await expect(payBookingOnline('bk1', 'x')).resolves.toMatchObject({ status: 'error' });
  });
});

describe('bookingAmountDue', () => {
  const base = { fare: 1000, tollCharges: 0, extraCharges: undefined, fareBreakdown: null, paid: null };
  it('is the fare total with tolls and approved extras until a payment is recorded', () => {
    expect(bookingAmountDue({ ...base, fareBreakdown: { total: 1172 } as never, tollCharges: 50, extraCharges: 30 })).toBe(1252);
    expect(bookingAmountDue(base)).toBe(1000);
  });
  it("is the server's balance once payments are recorded, never below zero", () => {
    expect(bookingAmountDue({ ...base, paid: { totalPaid: 900, balanceDue: 272.4, status: 'Partially Paid' } })).toBe(272);
    expect(bookingAmountDue({ ...base, paid: { totalPaid: 1172, balanceDue: -3, status: 'Paid' } })).toBe(0);
  });
});
