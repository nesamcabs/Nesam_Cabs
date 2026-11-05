import { useEffect, useMemo, useState } from 'react';
import type { Coupon } from '@core/types';
import { isCouponLive, subscribeToCoupons } from '@core/services/pricingService';
import { formatINR } from '@core/utils/format';
import { Button, EmptyState, LinkButton, PageHead } from '@/components/ui';
import { AccountLayout } from '@/components/AccountLayout';
import { Icon } from '@/components/Icon';
import { copyToClipboard } from '@/lib/share';
import { useSeo } from '@/lib/seo';
import { useBooking } from '@/state/Booking';
import { useNavigate } from 'react-router-dom';

export function OffersPage() {
  useSeo({
    title: 'Offers, Coupons & Promo Codes',
    description: 'Save on your next outstation cab or drop taxi booking with NESAM Cabs promo codes, festive discounts and new user coupons.',
    canonical: '/offers',
  });
  const navigate = useNavigate();
  const { update } = useBooking();
  const [coupons, setCoupons] = useState<Coupon[] | null>(null);
  const [copied, setCopied] = useState('');

  useEffect(() => subscribeToCoupons(setCoupons), []);
  useEffect(() => {
    if (!copied) return undefined;
    const t = window.setTimeout(() => setCopied(''), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const live = useMemo(() => (coupons ?? []).filter((c) => isCouponLive(c)), [coupons]);

  return (
    <AccountLayout>
      <PageHead backTo="/account" title="Offers">
        Promo codes for your next booking. The booking server checks every code against your trip.
      </PageHead>
      <div>
        {coupons === null ? (
          <div className="offer-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 232 }} />
            ))}
          </div>
        ) : live.length === 0 ? (
          <div className="card card--center">
            <EmptyState
              icon="offers"
              title="No offers right now"
              action={
                <LinkButton variant="primary" to="/book" icon="add">
                  Book a cab
                </LinkButton>
              }
            >
              Festival discounts and promo codes will show up here when they’re live.
            </EmptyState>
          </div>
        ) : (
          <ul className="offer-grid">
            {live.map((c) => (
              <li key={c.id} className="offer">
                <div className="offer__top">
                  <span className="offer__value">{c.discountType === 'PERCENTAGE' ? `${c.discountValue}% off` : `${formatINR(c.discountValue)} off`}</span>
                  {c.firstBookingOnly ? <span className="badge badge--blue">First ride</span> : null}
                </div>
                <p className="offer__desc">{c.description || c.name || (c.discountType === 'PERCENTAGE' ? `Save ${c.discountValue}% on your ride` : `Save ${formatINR(c.discountValue)} on your ride`)}</p>
                <p className="offer__terms">
                  {[
                    c.discountType === 'PERCENTAGE' && c.maximumDiscount ? `Up to ${formatINR(c.maximumDiscount)}` : '',
                    c.minimumBookingAmount ? `Min fare ${formatINR(c.minimumBookingAmount)}` : '',
                    c.validUntil ? `Valid till ${c.validUntil}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'No minimum fare'}
                </p>
                <div className="offer__code">
                  <code>{c.code}</code>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={copied === c.code ? 'check' : 'copy'}
                    onClick={() => void copyToClipboard(c.code).then((ok) => ok && setCopied(c.code))}
                    aria-label={`Copy code ${c.code}`}
                  >
                    {copied === c.code ? 'Copied' : 'Copy'}
                  </Button>
                </div>
                <Button
                  block
                  variant="primary"
                  onClick={() => {
                    update({ promoCode: c.code });
                    navigate('/book');
                  }}
                >
                  <Icon name="car" size={17} /> Use on a booking
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AccountLayout>
  );
}
