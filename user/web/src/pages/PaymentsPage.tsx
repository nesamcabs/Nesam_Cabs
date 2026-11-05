import { Link } from 'react-router-dom';
import { useCustomerData } from '@/state/CustomerData';
import { formatDate, formatINR } from '@core/utils/format';
import { paymentRows } from '@core/utils/tripView';
import { Badge, EmptyState, LinkButton, PageHead } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { AccountLayout, SignInPrompt } from '@/components/AccountLayout';
import { useSeo } from '@/lib/seo';

export function PaymentsPage() {
  useSeo({ title: 'Payments & Refunds', noindex: true });
  const { trips, profile } = useCustomerData();

  if (!profile) {
    return (
      <AccountLayout>
        <PageHead backTo="/account" title="Payments & Refunds">
          Trip payments, balances and refunds.
        </PageHead>
        <SignInPrompt title="Sign in to view payments" text="Sign in with your mobile number to view payment history, receipts and refunds." />
      </AccountLayout>
    );
  }

  const rows = paymentRows(trips);
  const refunds = trips.filter((t) => t.refund && t.refund.amount > 0);
  const completed = rows.filter((t) => t.status === 'Completed').length;
  const balance = trips.filter((t) => t.status === 'Completed' && t.paid && t.paid.balanceDue > 0).reduce((s, t) => s + (t.paid?.balanceDue ?? 0), 0);

  return (
    <AccountLayout>
      <PageHead backTo="/account" title="Payments & Refunds">
        Trip payments, balances and refunds.
      </PageHead>

      <section className="pay-tiles" aria-label="Summary">
        <div className="pay-tile">
          <small>Refund credits</small>
          <strong className="num">{formatINR(profile.walletBalance)}</strong>
          <span>{refunds.length ? `${refunds.length} refund${refunds.length === 1 ? '' : 's'} recorded` : 'Refunds for cancelled bookings appear here'}</span>
        </div>
        <div className="pay-tile">
          <small>Balance due</small>
          <strong className="num">{formatINR(balance)}</strong>
          <span>{balance > 0 ? 'Pay your driver or call NESAM' : 'Nothing outstanding'}</span>
        </div>
        <div className="pay-tile">
          <small>Completed trips</small>
          <strong className="num">{completed}</strong>
          <span>Receipts are kept with each trip</span>
        </div>
      </section>

      <p className="muted small pay-note">You pay your driver in cash or by UPI after each trip. Online payment is not available on the website yet.</p>

      {rows.length === 0 ? (
        <div className="card card--center">
          <EmptyState
            icon="wallet"
            title="No payments yet"
            action={
              <LinkButton variant="primary" to="/book" icon="add">
                Book a cab
              </LinkButton>
            }
          >
            Completed trips and any refunds will be listed here.
          </EmptyState>
        </div>
      ) : (
        <ul className="card card--list pay-list">
          {rows.map((t) => {
            const when = t.completedAt ?? t.cancelledAt ?? t.createdAt;
            const done = t.status === 'Completed';
            const total = done ? (t.fareBreakdown?.total ?? t.fare) + t.tollCharges + (t.extraCharges ?? 0) : t.cancellationFee;
            return (
              <li key={t.id}>
                <Link className="pay-row" to={`/trips/${t.id}`}>
                  <span className="pay-row__main">
                    <strong>
                      {t.pickup.name} → {t.drop.id === 'place-local-disposal' ? 'Within the city' : t.drop.name}
                    </strong>
                    <small>
                      {when ? formatDate(when) : t.date} · {t.bookingId}
                    </small>
                    <small>
                      {done ? `${t.paymentMethod} · ${t.paid ? `Paid ${formatINR(t.paid.totalPaid)}${t.paid.balanceDue > 0 ? `, balance ${formatINR(t.paid.balanceDue)}` : ''}` : t.paymentStatus}` : 'Cancelled'}
                    </small>
                    {t.refund && t.refund.amount > 0 ? (
                      <small className="pay-row__refund">
                        Refund {t.refund.status.toLowerCase()}: {formatINR(t.refund.amount)}
                      </small>
                    ) : null}
                  </span>
                  <span className="pay-row__amount">
                    <strong className="num">{formatINR(total)}</strong>
                    <Badge tone={done ? 'green' : 'red'}>{done ? 'Completed' : 'Cancelled'}</Badge>
                  </span>
                  <Icon name="chevron-right" size={16} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </AccountLayout>
  );
}
