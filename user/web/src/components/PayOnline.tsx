// "Pay online" for a booking's balance (Razorpay: UPI, cards, net banking, wallets). Shown only when the office has online payment
// switched on and something is still owed. The amount comes from the server; the booking updates by itself once the server has
// verified the payment, so this only reports progress.
import { useEffect, useState } from 'react';
import type { TripRecord } from '@core/types';
import { COMPANY_NAME } from '@core/config/constants';
import { createBookingPayment, getPaymentOptions, paymentErrorText, verifyBookingPayment } from '@core/services/paymentService';
import { formatINR } from '@core/utils/format';
import { Button, Notice } from '@/components/ui';
import { useAuth } from '@/state/Auth';
import { amountDue } from '@/lib/tripMoney';
import { brandColor, openCheckout } from '@/lib/razorpayCheckout';
import './payOnline.css';

type Msg = { tone: 'info' | 'success' | 'error' | 'warning'; text: string } | null;

export function PayOnline({ trip, compact = false }: { trip: TripRecord; compact?: boolean }) {
  const { state } = useAuth();
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    let alive = true;
    void getPaymentOptions().then((o) => { if (alive) setOnline(o.online); });
    return () => { alive = false; };
  }, []);

  const due = amountDue(trip);
  const blocked = trip.status === 'Cancelled' || trip.status === 'Rejected';
  if (!online || due < 1 || blocked) return msg?.tone === 'success' ? <Notice tone="success">{msg.text}</Notice> : null;

  const profile = state.status === 'ready' || state.status === 'on-hold' ? state.profile : null;
  const pay = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const order = await createBookingPayment(trip.id);
      const result = await openCheckout(
        order,
        {
          name: COMPANY_NAME,
          description: `Booking ${trip.bookingId}`,
          color: brandColor(),
          prefill: { name: profile?.name || undefined, contact: profile?.phone || undefined, email: profile?.email || undefined },
        },
        (reason) => setMsg({ tone: 'warning', text: `${reason} You can try again in the payment window.` }),
      );
      if (result === 'dismissed') { setMsg(null); return; }
      setMsg({ tone: 'info', text: 'Confirming your payment…' });
      const v = await verifyBookingPayment(trip.id, result);
      if (v.status === 'paid') {
        setMsg({ tone: 'success', text: v.balanceDue && v.balanceDue > 0 ? `Payment received. Balance ${formatINR(v.balanceDue)}.` : 'Payment received. Thank you!' });
      } else {
        setMsg({ tone: 'info', text: v.message || 'Your payment is being confirmed. It will show on the booking shortly.' });
      }
    } catch (e) {
      setMsg({ tone: 'error', text: paymentErrorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`pay-online ${compact ? 'pay-online--compact' : ''}`}>
      <Button size={compact ? 'sm' : 'md'} block={!compact} loading={busy} onClick={() => void pay()} icon="wallet">
        Pay {formatINR(due)} online
      </Button>
      {compact ? null : <p className="pay-online__fine">UPI, cards, net banking and wallets · Secured by Razorpay</p>}
      {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
    </div>
  );
}
