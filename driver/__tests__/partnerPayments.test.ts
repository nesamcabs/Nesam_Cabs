import { duesOutcomeText, parseCheckoutMessage, partnerCheckoutHtml, partnerPaymentError } from '../src/services/partnerPayments';

const inr = (n: number) => `₹${n}`;
const order = { orderId: 'order_D1', amount: 50000, currency: 'INR', keyId: 'rzp_test_K', name: 'Ravi </script>', phone: '9876543210' };

describe('driver payments', () => {
  it('opens Checkout for exactly the server order and keeps names from breaking the page', () => {
    const html = partnerCheckoutHtml(order, 'Outstanding dues');
    expect(html).toContain('"order_id":"order_D1"');
    expect(html).toContain('"amount":50000');
    expect(html).not.toContain('Ravi </script>');
  });

  it('reads only well-formed checkout messages', () => {
    expect(parseCheckoutMessage('{"ok":true,"orderId":"o","paymentId":"p","signature":"s"}')).toEqual({ ok: true, orderId: 'o', paymentId: 'p', signature: 's' });
    expect(parseCheckoutMessage('{"failed":true,"reason":"Declined"}')).toEqual({ failed: true, fatal: false, reason: 'Declined' });
    expect(parseCheckoutMessage('{"failed":true,"fatal":true,"reason":"No network"}')).toEqual({ failed: true, fatal: true, reason: 'No network' });
    expect(parseCheckoutMessage('{"dismissed":true}')).toEqual({ dismissed: true });
    expect(parseCheckoutMessage('{"ok":true}')).toBeNull();
    expect(parseCheckoutMessage('garbage')).toBeNull();
  });

  it('never says paid unless an amount was applied to the dues', () => {
    expect(duesOutcomeText({ status: 'applied', applied: 500, captured: 500 }, inr)).toBe('₹500 paid. Your dues have been updated.');
    expect(duesOutcomeText({ status: 'applied', applied: 0, captured: 500 }, inr)).toMatch(/NESAM will review/);
    expect(duesOutcomeText({ status: 'partly_applied', applied: 300, captured: 500, held: 200 }, inr)).toMatch(/₹300 of your ₹500/);
    expect(duesOutcomeText({ status: 'pending' }, inr)).toMatch(/being confirmed/);
  });

  it('explains a gateway that is not switched on', () => {
    expect(partnerPaymentError(new Error('PAYMENT_NOT_CONFIGURED'))).toMatch(/not switched on yet/);
  });
});
