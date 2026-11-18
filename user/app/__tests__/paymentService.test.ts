import { checkoutHtml, parseCheckoutMessage, paymentErrorText } from '../src/services/paymentService';
import { ActionError } from '../src/services/callables';

const order = { orderId: 'order_ABC', amount: 125000, currency: 'INR', keyId: 'rzp_test_KEY' };

describe('checkout page', () => {
  it('opens Checkout for exactly the server order and escapes text so a name cannot break the page', () => {
    const html = checkoutHtml(order, { name: 'NESAM </script><script>alert(1)</script>', description: 'Booking NC-1', color: '#C8181F' });
    expect(html).toContain('"order_id":"order_ABC"');
    expect(html).toContain('"amount":125000');
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('checkout.razorpay.com/v1/checkout.js');
  });
});

describe('checkout messages', () => {
  it('accepts a complete success, a dismissal and a failure; ignores anything else', () => {
    expect(parseCheckoutMessage('{"ok":true,"orderId":"o","paymentId":"p","signature":"s"}')).toEqual({ ok: true, orderId: 'o', paymentId: 'p', signature: 's' });
    expect(parseCheckoutMessage('{"dismissed":true}')).toEqual({ dismissed: true });
    expect(parseCheckoutMessage('{"failed":true,"reason":"Card declined"}')).toEqual({ failed: true, reason: 'Card declined' });
    expect(parseCheckoutMessage('{"ok":true,"orderId":"o"}')).toBeNull();
    expect(parseCheckoutMessage('not json')).toBeNull();
    expect(parseCheckoutMessage(null)).toBeNull();
  });
});

describe('payment errors', () => {
  it('turns server codes into words a rider can act on', () => {
    expect(paymentErrorText(new ActionError('PAYMENT_NOT_CONFIGURED'))).toMatch(/not available yet/);
    expect(paymentErrorText(new ActionError('ONLINE_PAYMENTS_OFF'))).toMatch(/switched off/);
    expect(paymentErrorText(new ActionError('This booking is already fully paid.'))).toBe('This booking is already fully paid.');
  });
});
