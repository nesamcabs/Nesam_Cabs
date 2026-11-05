// Step 3 — review & confirm: trip, vehicle, contact, payment and booking request submission.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FareBreakdown as Fare } from '@core/types';
import { useCustomerData } from '@/state/customer';
import { createRideRequest } from '@core/services/rideService';
import { buildFareBreakup } from '@core/utils/fareBreakup';
import { scheduleProblem, whatsappProblem } from '@core/utils/bookingRules';
import { formatDate, formatDistance, formatDuration, formatINR, formatPhone, formatTime, isValidEmail, isValidIndianMobile } from '@core/utils/format';
import { describeError } from '@core/utils/retry';
import { BackButton, Button, Checkbox, Notice, PageHead, TextField } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useBooking, useBookingQuote } from '@/state/Booking';
import { useAuth } from '@/state/Auth';
import { useOnline } from '@/lib/hooks';
import { composeNotes, notesRoom } from '@/lib/notes';
import { PolicyLinks } from '@/pages/PolicySections';
import { categoryName, categoryPhoto } from '@/lib/categories';
import { FareDialog, FlowBar, PaymentChoice, PromoControl } from './parts';

export function ReviewStep() {
  const navigate = useNavigate();
  const { profile } = useCustomerData();
  const { openLoginModal } = useAuth();
  const { draft, update, reset, route, adjustment } = useBooking();
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

  const {
    pickup,
    drop,
    tripType,
    scheduledAt,
    tripEndAt,
    payment,
    notes,
    waCode,
    waNumber,
    email,
    forOther,
    passengerName,
    passengerMobile,
    flight,
  } = draft;
  const waSame = true; // trip updates go to the same mobile number
  const category = q.category;

  const hadProfile = useRef(!!profile);
  useEffect(() => {
    if (profile && !hadProfile.current) setJustSignedIn(true);
    hadProfile.current = !!profile;
  }, [profile]);

  if (!pickup || !drop || !category || !q.quote) {
    return (
      <div className="flow-page">
        <div className="wrap flow-page__wrap review-missing">
          <PageHead
            back={<BackButton to="/book/ride" label="Back to vehicles" />}
            title="Review & Confirm"
          />
          {q.quoteLoading ? (
            <Notice>Confirming fare with NESAM Cabs server…</Notice>
          ) : (
            <Notice
              variant="warning"
              action={
                <Button size="sm" variant="secondary" onClick={() => navigate('/book/ride')}>
                  Choose your vehicle
                </Button>
              }
            >
              Your trip details changed. Please go back and select your vehicle again.
            </Notice>
          )}
        </div>
      </div>
    );
  }

  // Display only: a higher struck-out price above the fare (set in admin → Pricing → Base rates).
  const strikeOf = (draft.fuelType === 'cng' ? q.entries.get(category.id)?.cng?.strikeTotal : q.entries.get(category.id)?.strikeTotal) ?? 0;
  const priceKey = JSON.stringify([
    pickup.lat,
    pickup.lng,
    drop.lat,
    drop.lng,
    tripType,
    scheduledAt?.toISOString() ?? null,
    category.id,
    q.coupon?.code,
    adjustment?.id,
    adjustment?.percent,
  ]);
  const quote = serverQuote?.key === priceKey ? serverQuote.fare : q.quote;
  const breakup = q.breakup ?? buildFareBreakup(category, quote, q.outstation);
  const airport = tripType === 'Airport Taxi';

  const emailError = email.trim() && !isValidEmail(email) ? 'Enter a valid email address or leave it blank.' : '';
  const waError = whatsappProblem(waSame, waCode, waNumber);
  const passengerError = forOther
    ? !passengerName.trim()
      ? 'Enter the passenger’s name.'
      : !isValidIndianMobile(passengerMobile.replace(/\s+/g, ''))
        ? 'Enter the passenger’s 10-digit mobile number.'
        : ''
    : '';
  const room = notesRoom({
    flight: airport ? flight : '',
    passengerName: forOther ? passengerName : '',
    passengerMobile: forOther ? passengerMobile : '',
  });
  const termsError = tried && !termsAccepted ? 'Please accept the fare and cancellation terms to confirm.' : '';
  const blocker = !online
    ? 'You’re offline. Reconnect to book.'
    : scheduleProblem(scheduledAt) ||
      (!q.authoritative
        ? q.quoteLoading
          ? 'Confirming fare with NESAM Cabs…'
          : q.quoteError || 'Fare confirmation required.'
        : '') ||
      (waError || emailError || passengerError ? 'Check your contact details below.' : '');

  const submit = async () => {
    setTried(true);
    if (!termsAccepted) {
      termsRef.current?.querySelector('input')?.focus();
      return;
    }
    if (!profile) {
      openLoginModal({
        title: 'Sign in to complete booking',
        subtitle: 'Enter your mobile number to send your ride request.',
      });
      return;
    }
    if (blocker || submittingRef.current || !route) {
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError('');
    try {
      const fullNotes = composeNotes({
        flight: airport ? flight : '',
        passengerName: forOther ? passengerName : '',
        passengerMobile: forOther ? passengerMobile : '',
        notes,
      });
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
        paymentMethod: payment,
        couponCode: q.coupon?.code ?? '',
        notes: fullNotes,
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
      // The confirmation page clears the draft once it is showing: clearing it here would make the booking page
      // redirect home before this navigation lands, and the confirmation would never appear.
      navigate(`/book/done/${res.id}`, { replace: true, state: { confirmed: true } });
    } catch (e: unknown) {
      const err = e as { code?: string; fare?: Fare };
      if (err.code === 'fare-changed' && err.fare) {
        setServerQuote({ key: priceKey, fare: err.fare });
        setSubmitError('The fare for this route has updated. Review the updated amount and tap Confirm Booking to proceed.');
        return;
      }
      setSubmitError(describeError(e, 'We couldn’t submit your booking request. Please check your connection and try again.'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="flow-page flow-page--review">
      <div className="wrap flow-page__wrap">
        <h1 className="sr-only">Review and confirm booking</h1>

        <div className="review">
          <div className="review__main">
            <section className="card" aria-labelledby="rv-who-head">
              <h2 id="rv-who-head">Passenger &amp; Contact Details</h2>

              <div className="rv-grid">
                <TextField
                  label="Mobile number"
                  value={profile?.phone ? formatPhone(profile.phone) : 'Sign in on booking'}
                  readOnly
                  disabled
                />
                <TextField
                  label="Email Address"
                  type="email"
                  placeholder="name@example.com (optional)"
                  value={email}
                  error={emailError}
                  onChange={(e) => update({ email: e.target.value })}
                />
              </div>

              <div className="rv-fold">
                <Checkbox
                  label="Booking this ride for someone else?"
                  checked={forOther}
                  onChange={(checked) => update({ forOther: checked })}
                />
                {forOther ? <PolicyLinks lead="Add a passenger’s or another WhatsApp number only with their permission." ids={['privacy']} newTab /> : null}
                {forOther ? (
                  <div className="rv-grid" style={{ marginTop: 10 }}>
                    <TextField
                      label="Passenger Name"
                      placeholder="Full name"
                      value={passengerName}
                      error={forOther && !passengerName.trim() ? 'Passenger name is required' : ''}
                      onChange={(e) => update({ passengerName: e.target.value })}
                    />
                    <TextField
                      label="Passenger 10-digit Mobile"
                      placeholder="9876543210"
                      value={passengerMobile}
                      error={passengerError}
                      onChange={(e) => update({ passengerMobile: e.target.value })}
                    />
                  </div>
                ) : null}
              </div>

              {airport ? (
                <div className="rv-fold">
                  <TextField
                    label="Flight Number (Optional)"
                    placeholder="e.g. 6E 214"
                    value={flight}
                    hint="Our driver will track flight delays and adjust pickup time automatically."
                    onChange={(e) => update({ flight: e.target.value.toUpperCase() })}
                  />
                </div>
              ) : null}

            </section>

            <section className="card rv-policy rv-policy--page" ref={termsRef}>
              <Checkbox
                label="I accept the fare, extra charges and cancellation policy."
                checked={termsAccepted}
                onChange={setTermsAccepted}
              />
              <PolicyLinks ids={['terms']} newTab />
              {termsError ? <p className="bf-error">{termsError}</p> : null}
            </section>

            {submitError ? (
              <Notice variant="error" icon="warning">
                {submitError}
              </Notice>
            ) : null}
          </div>

          <aside className="review__sticky">
            <section className="card" aria-labelledby="rv-pay-head">
              <h2 id="rv-pay-head">Payment Method</h2>
              <PaymentChoice value={payment} onChange={(p) => update({ payment: p })} />
              <div className="rv-pay-promo">
                <PromoControl
                  code={draft.promoCode}
                  applied={quote.discount > 0}
                  onApply={(code) => update({ promoCode: code })}
                  onRemove={() => update({ promoCode: '' })}
                />
              </div>
            </section>

            <div className="card sel-card sel-card--sum">
              <div className="sel-card__total">
                <span className="rv-total-label">
                  Total Payable
                  <button type="button" className="rv-info-btn" onClick={() => setShowFare(true)} aria-label="Fare details" title="Fare details">
                    <Icon name="info" size={18} />
                  </button>
                </span>
                <span style={{ display: "grid", justifyItems: "end" }}>
                  {strikeOf > 0 ? <s className="cab__strike">{formatINR(strikeOf)}</s> : null}
                  <strong className="num">{formatINR(quote.total)}</strong>
                </span>
              </div>

              <ul className="rv-sum__notes">
                {draft.fuelType === 'cng' ? <li>Fuel type: CNG</li> : null}
                <li>Includes base fare, driver bata &amp; discounts</li>
                <li>Toll, State Tax &amp; Parking extra (as per actuals)</li>
              </ul>

              <div className="rv-act">
                <Button
                  variant="primary"
                  size="lg"
                  block
                  disabled={submitting}
                  loading={submitting}
                  onClick={submit}
                  iconTrailing="check"
                >
                  {profile ? 'Confirm & Book Ride' : 'Sign in to Confirm'}
                </Button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      <FlowBar
        onNext={submit}
        nextLabel={profile ? 'Book & Confirm' : 'Sign in & Book'}
        nextDisabled={submitting}
        nextLoading={submitting}
        total={quote.total}
        hideFare
        onBack={() => navigate('/book/ride')}
        backLabel="Back to vehicles"
        onHome={() => navigate('/')}
        above={
          <div className="flow-bar__terms">
            <Checkbox label="I accept the fare, extra charges and cancellation policy." checked={termsAccepted} onChange={setTermsAccepted} />
            {termsError ? <p className="bf-error">{termsError}</p> : null}
          </div>
        }
      />

      {showFare ? <FareDialog fare={breakup} onClose={() => setShowFare(false)} /> : null}
    </div>
  );
}
export default ReviewStep;
