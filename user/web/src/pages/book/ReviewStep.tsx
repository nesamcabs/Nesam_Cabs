// Step 3 — review & book: trip, fare, contact, payment and the booking request itself. The server
// re-prices and refuses a fare that changed; a new request waits for NESAM's review, so it is never
// described as confirmed here.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { FareBreakdown as Fare } from '@core/types';
import { useCustomerData } from '@/state/CustomerData';
import { createRideRequest } from '@core/services/rideService';
import { buildFareBreakup } from '@core/utils/fareBreakup';
import { scheduleProblem, whatsappProblem } from '@core/utils/bookingRules';
import { formatDate, formatDistance, formatINR, formatPhone, formatTime, isValidEmail, isValidIndianMobile } from '@core/utils/format';
import { describeError } from '@core/utils/retry';
import { CUSTOMER_PAYMENTS_ENABLED, SCHEDULED_CANCELLATION_FEE, SCHEDULED_FREE_CANCEL_BEFORE_MS, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { BackButton, Button, Checkbox, Notice, PageHead, TextField } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useBooking, useBookingQuote } from '@/state/Booking';
import { useAuth } from '@/state/Auth';
import { useOnline } from '@/lib/hooks';
import { composeNotes, notesRoom } from '@/lib/notes';
import { categoryName } from '@/lib/categories';
import { BarIconButton, FareDialog, FlowBar, PaymentChoice, PromoControl } from './parts';

export function ReviewStep() {
  const navigate = useNavigate();
  const { profile } = useCustomerData();
  const { openLoginModal } = useAuth();
  const { draft, update, route, adjustment } = useBooking();
  const q = useBookingQuote();
  const { online } = useOnline();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [tried, setTried] = useState(false);
  const [serverQuote, setServerQuote] = useState<{ key: string; fare: Fare } | null>(null);
  const [showFare, setShowFare] = useState(false);
  const [justSignedIn, setJustSignedIn] = useState(false);
  const submittingRef = useRef(false);
  const termsRef = useRef<HTMLDivElement>(null);

  const { pickup, drop, tripType, scheduledAt, tripEndAt, payment, notes, waSame, waCode, waNumber, email, forOther, passengerName, passengerMobile, flight } = draft;
  const category = q.category;

  // Signing in from here returns to this page; nothing is submitted until the rider taps again.
  const hadProfile = useRef(!!profile);
  useEffect(() => {
    if (profile && !hadProfile.current) {
      setJustSignedIn(true);
      // The booking server prices trips for signed-in customers only: ask again now.
      q.retryQuote();
    }
    hadProfile.current = !!profile;
  }, [profile]); // eslint-disable-line react-hooks/exhaustive-deps -- reacts to signing in only

  if (!pickup || !drop || !category || !q.quote) {
    return (
      <div className="flow-page">
        <div className="wrap flow-page__wrap review-missing">
          <PageHead backTo="/book/ride" title="Review & book" />
          {q.quoteLoading ? (
            <Notice>Confirming your fare with NESAM…</Notice>
          ) : (
            <Notice
              tone="warning"
              action={
                <Button size="sm" variant="secondary" onClick={() => navigate('/book/ride')}>
                  Choose your cab
                </Button>
              }
            >
              Your trip details changed. Go back and choose your cab again.
            </Notice>
          )}
        </div>
      </div>
    );
  }

  // Display only: a higher struck-out price above the fare (set in admin → Pricing → Base rates).
  const strikeOf = (draft.fuelType === 'cng' ? q.entries.get(category.id)?.cng?.strikeTotal : q.entries.get(category.id)?.strikeTotal) ?? 0;
  const priceKey = JSON.stringify([pickup.lat, pickup.lng, drop.lat, drop.lng, tripType, scheduledAt?.toISOString() ?? null, category.id, q.coupon?.code, adjustment?.id, adjustment?.percent]);
  const quote = serverQuote?.key === priceKey ? serverQuote.fare : q.quote;
  const breakup = q.breakup ?? buildFareBreakup(category, quote, q.outstation);
  const airport = tripType === 'Airport Taxi';

  const emailError = email.trim() && !isValidEmail(email) ? 'Enter a valid email address or leave it blank.' : '';
  const waError = whatsappProblem(waSame, waCode, waNumber);
  const passengerError = forOther ? (!passengerName.trim() ? 'Enter the passenger’s name.' : !isValidIndianMobile(passengerMobile.replace(/\s+/g, '')) ? 'Enter the passenger’s 10-digit mobile number.' : '') : '';
  const room = notesRoom({ flight: airport ? flight : '', passengerName: forOther ? passengerName : '', passengerMobile: forOther ? passengerMobile : '' });
  const termsError = tried && !termsAccepted ? 'Accept the fare and cancellation policy to continue.' : '';
  const blocker = !online
    ? 'You’re offline. Reconnect to book.'
    : scheduleProblem(scheduledAt) ||
      (profile && !q.authoritative ? (q.quoteLoading ? 'Confirming your fare with NESAM…' : q.quoteError || 'We need to confirm your fare before you can submit.') : '') ||
      (waError || emailError || passengerError ? 'Check the contact details above.' : '');

  const submit = async () => {
    setTried(true);
    if (!termsAccepted) {
      termsRef.current?.querySelector('input')?.focus();
      return;
    }
    if (!profile) {
      openLoginModal({ title: 'Continue with mobile', subtitle: 'Sign in to send your booking request. You’ll come back to this page to submit it.' });
      return;
    }
    if (blocker || submittingRef.current || !route) {
      if (!route && !blocker) setSubmitError('We’re still calculating your route. Please try again in a moment.');
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await createRideRequest({
        fuelType: draft.fuelType === 'cng' ? 'cng' : undefined,
        profile,
        pickup,
        drop,
        stops: tripType === 'Round Trip' ? draft.stops : [],
        category,
        route,
        fare: quote,
        tripType,
        multicity: draft.multicity && tripType === 'Round Trip',
        // With payment options switched off every booking is pay-later (recorded as Cash, settled after the trip).
        paymentMethod: CUSTOMER_PAYMENTS_ENABLED ? payment : 'Cash',
        couponCode: q.coupon?.code ?? '',
        notes: composeNotes({ flight: airport ? flight : '', passengerName: forOther ? passengerName : '', passengerMobile: forOther ? passengerMobile : '', notes }),
        scheduledAt,
        tripEndAt: tripType === 'Round Trip' ? tripEndAt : null,
        rentalHours: tripType === 'Local Rental' ? draft.rentalHours : null,
        termsAccepted,
        whatsapp: waSame ? { sameAsMobile: true } : { sameAsMobile: false, countryCode: waCode.trim(), number: waNumber.replace(/[\s()-]/g, '') },
        email: email.trim(),
        source: 'nesam',
        bookingSource: 'nesam',
        brand: 'nesam',
      });
      // The confirmation page clears the draft once it is showing (clearing it here would make this
      // step redirect to /book before the navigation lands).
      navigate(`/book/done/${encodeURIComponent(res.id)}`, { replace: true, state: { fresh: true } });
    } catch (e) {
      const currentFare = (e as { details?: { fare?: Fare } }).details?.fare;
      if (currentFare && Number.isFinite(currentFare.total)) setServerQuote({ key: priceKey, fare: currentFare });
      setSubmitError(currentFare ? `The fare is now ${formatINR(currentFare.total)}. Review it and submit your booking request again.` : describeError(e, 'We couldn’t place your booking. Please try again.'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const freeHours = Math.round(SCHEDULED_FREE_CANCEL_BEFORE_MS / 3600000);
  const when = scheduledAt ? `${formatDate(scheduledAt)} · ${formatTime(scheduledAt)} IST` : 'Pickup time not chosen';
  // A Round Trip always ends back at the pickup: the drop is simply the last place visited.
  const sameAsPickup = Math.abs(pickup.lat - drop.lat) < 0.0001 && Math.abs(pickup.lng - drop.lng) < 0.0001;
  const roundVia = tripType === 'Round Trip' ? [...draft.stops, ...(sameAsPickup ? [] : [drop])] : [];
  const dropName = tripType === 'Round Trip' ? pickup.name : drop.id === 'place-local-disposal' ? 'Within the city' : drop.name;

  const summary = (
    <section className="card rv-sum" aria-label="Trip and fare">
      <p className="route-title route-title--lg">
        <span>{pickup.name}</span>
        <Icon name="arrow-right" size={17} />
        <span>{dropName}</span>
      </p>
      {roundVia.length ? <p className="trip-sum__when">Via {roundVia.map((stop) => stop.name).join(' → ')}</p> : null}
      <ul className="rv-meta">
        <li>
          <Icon name="calendar" size={16} />
          <span>
            {when}
            {tripType === 'Round Trip' && tripEndAt ? ` · Return ${formatDate(tripEndAt)}, ${formatTime(tripEndAt)}` : ''}
          </span>
        </li>
        {route ? (
          <li>
            <Icon name="route" size={16} />
            <span>{formatDistance(route.totalDistanceKm ?? route.distanceKm)}</span>
          </li>
        ) : null}
        <li>
          <Icon name="car" size={16} />
          <span>
            <strong>{categoryName(category)}</strong>{draft.fuelType === 'cng' ? ' (CNG)' : ''} · {category.seats} passengers
          </span>
        </li>
      </ul>
      <div className="rv-sum__total">
        <div>
          <strong>{q.authoritative ? 'Total fare' : 'Estimated fare'}</strong>
          <small>{q.authoritative ? '' : profile ? 'Confirming with NESAM · ' : 'Confirmed after you sign in · '}GST included{q.coupon ? ` · ${q.coupon.code} −${formatINR(q.coupon.discount)}` : ''}</small>
          <small>Includes base fare, driver bata &amp; discounts</small>
          <small>Toll, State Tax &amp; Parking extra (as per actuals)</small>
          <button type="button" className="link-btn" onClick={() => setShowFare(true)}>
            View fare details
          </button>
        </div>
        <span style={{ display: "grid", justifyItems: "end" }}>
          {strikeOf > 0 ? <s className="cab__strike">{formatINR(strikeOf)}</s> : null}
          <strong className="num rv-sum__amount">{formatINR(quote.total)}</strong>
        </span>
      </div>
    </section>
  );

  const action = (
    <section className="card rv-act" aria-label="Book">
      <div ref={termsRef} className="rv-terms--page">
        <Checkbox checked={termsAccepted} onChange={(v) => setTermsAccepted(v)} invalid={!!termsError}>
          I accept the fare, extra charges and <Link to="/legal">cancellation policy</Link>, and understand NESAM reviews this request before confirming it.
        </Checkbox>
        {termsError ? (
          <p className="field__error" role="alert">
            {termsError}
          </p>
        ) : null}
      </div>
      {justSignedIn && !submitError ? <Notice tone="success">You’re signed in. Check the details and submit your booking request.</Notice> : null}
      {submitError ? <Notice tone="error">{submitError}</Notice> : blocker && tried ? <Notice tone="warning">{blocker}</Notice> : null}
      <Button className="rv-act__submit" block size="lg" loading={submitting} disabled={submitting || (!!blocker && termsAccepted && tried)} onClick={() => void submit()}>
        {submitting ? 'Sending request…' : profile ? 'Submit booking request' : 'Sign in & continue'}
      </Button>
      <p className="rv-act__note">
        <Icon name="lock" size={13} /> Nothing is charged now · {CUSTOMER_PAYMENTS_ENABLED ? `pay your driver by ${payment === 'UPI' ? 'UPI' : 'cash'} after the trip` : 'pay after the trip'}
      </p>
    </section>
  );

  return (
    <div className="flow-page">
      <div className="wrap flow-page__wrap">
        <div className="flow-back">
          <BackButton to="/book/ride" label="Back to vehicles" />
          <h1 className="sr-only">Review and book</h1>
        </div>
        <div className="review">
          <div className="review__main">
            <div className="only-narrow">{summary}</div>

            <section className="card" aria-labelledby="rv-contact">
              <header className="card__head">
                <h2 id="rv-contact">Booking contact</h2>
              </header>
              {profile ? (
                <dl className="kv">
                  <div>
                    <dt>Passenger name</dt>
                    <dd>{profile.name}</dd>
                  </div>
                  <div>
                    <dt>Mobile number</dt>
                    <dd className="num">{formatPhone(profile.phone)}</dd>
                  </div>
                  <div>
                    <dt>WhatsApp number</dt>
                    <dd className="num">{waSame ? 'Same as mobile' : waNumber ? `${waCode} ${waNumber}` : 'Not provided'}</dd>
                  </div>
                </dl>
              ) : (
                <div className="rv-guest">
                  <p>Sign in with your mobile number to book. Your details are filled in from your NESAM account.</p>
                  <Button variant="secondary" icon="profile" onClick={() => openLoginModal({ title: 'Continue with mobile', subtitle: 'Sign in to send your booking request.' })}>
                    Sign in
                  </Button>
                </div>
              )}

              <Checkbox checked={forOther} onChange={(v) => update({ forOther: v })}>
                Book for someone else
              </Checkbox>
              {forOther ? (
                <div className="rv-grid">
                  <TextField label="Passenger name" value={passengerName} onChange={(e) => update({ passengerName: e.target.value.slice(0, 60) })} autoComplete="off" error={tried ? (passengerName.trim() ? '' : 'Enter the passenger’s name.') : ''} />
                  <TextField
                    label="Passenger mobile"
                    prefix="+91"
                    value={passengerMobile}
                    onChange={(e) => update({ passengerMobile: e.target.value.replace(/[^\d\s]/g, '').slice(0, 11) })}
                    inputMode="tel"
                    autoComplete="off"
                    error={tried && passengerName.trim() && passengerError ? passengerError : ''}
                    hint="Shared with the driver for pickup."
                  />
                </div>
              ) : null}

              <Checkbox checked={waSame} onChange={(v) => update({ waSame: v })}>
                Send WhatsApp updates to {profile ? 'my mobile number' : 'the mobile number I sign in with'}
              </Checkbox>
              {!waSame ? (
                <div className="rv-grid rv-grid--wa">
                  <TextField label="Code" value={waCode} onChange={(e) => update({ waCode: e.target.value })} inputMode="tel" autoComplete="off" maxLength={4} />
                  <TextField label="WhatsApp number" value={waNumber} onChange={(e) => update({ waNumber: e.target.value })} inputMode="tel" autoComplete="off" maxLength={16} placeholder="10-digit number" error={waError} />
                </div>
              ) : null}
              <TextField
                label="Email (optional)"
                type="email"
                value={email}
                onChange={(e) => update({ email: e.target.value })}
                autoComplete="email"
                placeholder={profile?.email || 'name@example.com'}
                hint={profile?.email ? 'Leave blank to use your account email.' : 'For your booking confirmation and receipt.'}
                error={emailError}
              />
              {airport ? <TextField label="Flight number (optional)" value={flight} onChange={(e) => update({ flight: e.target.value.toUpperCase().slice(0, 12) })} autoComplete="off" placeholder="e.g. 6E 2041" hint="Shared with NESAM and your driver." /> : null}
            </section>

            <section className="card" aria-labelledby="rv-pay">
              <header className="card__head">
                <h2 id="rv-pay">{CUSTOMER_PAYMENTS_ENABLED ? 'Choose payment' : 'Promo code'}</h2>
              </header>
              {CUSTOMER_PAYMENTS_ENABLED ? (
                <>
                  <PaymentChoice value={payment} onChange={(m) => update({ payment: m })} />
                  <p className="muted small">Online payment and advance payment are not available yet. Your driver collects the fare after the trip.</p>
                </>
              ) : null}
              <PromoControl />
            </section>

            <p className="rv-fine">Toll, parking &amp; state tax are extra, paid separately against receipts.</p>
            <details className="card rv-policy">
              <summary>Cancellation policy</summary>
              <p>
                Cancel from My Bookings. Cancelling more than {freeHours} hour{freeHours === 1 ? '' : 's'} before pickup is free; after that a {formatINR(SCHEDULED_CANCELLATION_FEE)} fee applies. The
                screen shows any fee before you confirm. Need help? Call <a href={`tel:${SUPPORT_PHONE}`}>{SUPPORT_PHONE_DISPLAY}</a>.
              </p>
            </details>

            <div className="only-narrow">{action}</div>
          </div>

          <aside className="review__aside only-wide">
            <div className="review__sticky">
              {summary}
              {action}
            </div>
          </aside>
        </div>
      </div>

      <FlowBar className="flow-bar--review">
        <div className="flow-bar__terms">
          <Checkbox checked={termsAccepted} onChange={(v) => setTermsAccepted(v)} invalid={!!termsError}>
            I accept the fare, extra charges and <Link to="/legal" target="_blank" rel="noopener">cancellation policy</Link>.
          </Checkbox>
          {termsError ? (
            <p className="field__error" role="alert">
              {termsError}
            </p>
          ) : null}
        </div>
        <div className="flow-bar__total flow-bar__total--solo flow-bar__total--icons">
          <BarIconButton icon="arrow-left" label="Back to vehicles" onClick={() => navigate('/book/ride')} />
          <Button size="lg" loading={submitting} disabled={submitting || (!!blocker && termsAccepted && tried)} onClick={() => void submit()}>
            {profile ? 'Book & Confirm' : 'Sign in & continue'}
          </Button>
          <BarIconButton icon="home" label="Home" onClick={() => navigate('/book')} />
        </div>
      </FlowBar>

      {showFare ? <FareDialog title={`${categoryName(category)} · fare details`} lines={breakup.lines} total={quote.total} estimated={!q.authoritative} onClose={() => setShowFare(false)} /> : null}
    </div>
  );
}
