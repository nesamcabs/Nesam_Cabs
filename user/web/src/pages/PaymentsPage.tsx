import { Link } from 'react-router-dom';
import { useCustomerData } from '@core/context/CustomerData';
import { formatDate, formatINR } from '@core/utils/format';
import { paymentRows } from '@core/utils/tripView';
import { Button, EmptyState, LinkButton, PageHead } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useAuth } from '@/state/Auth';
import { useSeo } from '@/lib/seo';
import { PolicyLinks } from '@/pages/PolicySections';

export function PaymentsPage() {
  useSeo({ title: 'Payments & Refunds', noindex: true });
  const { trips, profile } = useCustomerData();
  const { openLoginModal } = useAuth();

  if (!profile) {
    return (
      <>
        <PageHead
          eyebrow="Account"
          title="Payments"
          back={
            <Link to="/account" className="back-link">
              <Icon name="arrow-left" size={18} /> Account
            </Link>
          }
        >
          What each trip cost, what you’ve paid and any refunds.
        </PageHead>
        <div className="page">
          <div className="card card--center">
            <EmptyState
              art="welcome"
              title="Sign in to view payments"
              action={
                <Button variant="primary" onClick={() => openLoginModal({ title: 'Sign in to view payments' })}>
                  Sign in
                </Button>
              }
            >
              Sign in with your mobile number to view payment history, receipts and refund balances.
            </EmptyState>
          </div>
          <PolicyLinks ids={['payment', 'refund']} />
        </div>
      </>
    );
  }

  const rows = paymentRows(trips);
  const refunds = trips.filter((t) => t.refund && t.refund.amount > 0);

  const paidTrips = rows.filter((t) => t.status === 'Completed').length;

  return (
    <>
      <PageHead
        eyebrow="Account"
        title="Payments"
        back={
          <Link to="/account" className="back-link">
            <Icon name="arrow-left" size={18} /> Account
          </Link>
        }
      >
        What each trip cost, what you’ve paid and any refunds.
      </PageHead>

      <div className="page">
        <section className="tiles" aria-label="Summary">
          <div className="tile tile--dark">
            <Icon name="wallet" size={28} />
            <p className="eyebrow">Refund credits</p>
            <strong className="num">{formatINR(profile.walletBalance)}</strong>
            <p className="small">
              {refunds.length ? `${refunds.length} refund${refunds.length === 1 ? '' : 's'} recorded on cancelled bookings.` : 'Refunds for cancelled bookings appear here when they are recorded.'}
            </p>
          </div>
          <div className="tile">
            <Icon name="success" size={28} />
            <p className="eyebrow">Completed trips</p>
            <strong className="num">{paidTrips}</strong>
            <p className="small muted">Receipts are kept with each trip.</p>
          </div>
          <div className="tile">
            <Icon name="receipt" size={28} />
            <p className="eyebrow">Payments to date</p>
            <strong className="num">{rows.length}</strong>
            <p className="small muted">Completed and cancelled bookings with a charge.</p>
          </div>
        </section>
        <PolicyLinks ids={['payment', 'refund']} />

        {rows.length === 0 ? (
          <div className="card card--center">
            <EmptyState
              art="no-payments"
              title="No payments yet"
              action={
                <LinkButton variant="primary" to="/book">
                  Book a ride
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
              const completed = t.status === 'Completed';
              const total = completed ? (t.fareBreakdown?.total ?? t.fare) + t.tollCharges + (t.extraCharges ?? 0) : t.cancellationFee;
              return (
                <li key={t.id}>
                  <Link className="pay-row" to={`/trips/${t.id}`}>
                    <span className="pay-row__main">
                      <strong className="truncate">
                        {t.pickup.name} → {t.drop.name}
                      </strong>
                      <small className="muted">
                        {when ? formatDate(when) : t.date} · {t.bookingId}
                      </small>
                      <small className="muted">
                        {completed
                          ? `${t.paymentMethod} · ${t.paid ? `Paid ${formatINR(t.paid.totalPaid)}${t.paid.balanceDue > 0 ? `, balance ${formatINR(t.paid.balanceDue)}` : ''}` : t.paymentStatus}`
                          : 'Cancelled'}
                      </small>
                      {t.refund && t.refund.amount > 0 ? (
                        <small className="pay-row__refund">
                          Refund {t.refund.status.toLowerCase()}: {formatINR(t.refund.amount)}
                        </small>
                      ) : null}
                    </span>
                    <span className="pay-row__amount">
                      <strong className="num">{formatINR(total)}</strong>
                      <span className={`badge ${completed ? 'badge--green' : 'badge--red'}`}>{completed ? 'Completed' : 'Cancelled'}</span>
                    </span>
                    <Icon name="chevron-right" size={18} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
