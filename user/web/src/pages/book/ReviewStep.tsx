// Step 3 — "Complete your booking": contact & passenger details, add-ons, payment, coupon, terms and submission.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { FareBreakdown as Fare } from '@core/types';
import { useCustomerData } from '@/state/customer';
import { createRideRequest } from '@core/services/rideService';
import { buildFareBreakup } from '@core/utils/fareBreakup';
import { scheduleProblem } from '@core/utils/bookingRules';
import { formatDate, formatDistance, formatDuration, formatINR, formatTime, isValidEmail, isValidIndianMobile } from '@core/utils/format';
import { describeError } from '@core/utils/retry';
import { BackButton, Button, Notice, PageHead } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useBooking, useBookingQuote } from '@/state/Booking';
import { useAuth } from '@/state/Auth';
import { useOnline } from '@/lib/hooks';
import { composeNotes, notesRoom } from '@/lib/notes';
import { PolicyLinks } from '@/pages/PolicySections';
import { categoryName, categoryPhoto } from '@/lib/categories';
import { FareDialog } from './parts';
import { DIAL_CODES, splitPhone } from '@/lib/countryCodes';
import './review.css';

const UNIQUE_DIAL_CODES = [...new Set(DIAL_CODES.map((item) => item.code))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

export function ReviewStep() {
  const navigate = useNavigate();
  const { profile } = useCustomerData();
  const { openLoginModal } = useAuth();
  const { draft, update, reset, route, adjustment } = useBooking();
  const liveQ = useBookingQuote();
  // Changing an add-on or coupon re-prices on the server, and the quote is empty while that loads. Keep showing the
  // last confirmed quote meanwhile (the form must not vanish); it is not authoritative, so booking stays blocked until the new fare arrives.
  const lastQ = useRef(liveQ);
  if (liveQ.quote) lastQ.current = liveQ;
  const q = !liveQ.quote && liveQ.quoteLoading && lastQ.current.quote ? { ...lastQ.current, quoteLoading: true, authoritative: false } : liveQ;
  const { online } = useOnline();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [tried, setTried] = useState(false);
  const [serverQuote, setServerQuote] = useState<{ key: string; fare: Fare } | null>(null);
  const [showFare, setShowFare] = useState(false);
  const [justSignedIn, setJustSignedIn] = useState(false);
  const [couponText, setCouponText] = useState('');
  const initialPhone = splitPhone(profile?.phone ?? '');
  const [contactCode, setContactCode] = useState(initialPhone.code);
  const [contactNumber, setContactNumber] = useState(initialPhone.local);
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
    email,
    customerName,
    forOther,
    passengerName,
    passengerMobile,
    flight,
  } = draft;
  const category = q.category;

  // An add-on is offered only when this vehicle has a price for it (admin → vehicle specs). No price, no option.
  const rates = q.category ? q.entries.get(q.category.id)?.addOnRates : undefined;
  const carrierCharge = rates?.carrierCharge ?? q.category?.fare.extras?.carrierCharge ?? 0;
  const petCharge = rates?.petCharge ?? 0;
  const hasCarrier = carrierCharge > 0;
  const hasPets = petCharge > 0;
  useEffect(() => {
    if (!q.quote) return;
    const patch: { roofCarrier?: boolean; pets?: boolean } = {};
    if (!hasCarrier && draft.roofCarrier) patch.roofCarrier = false;
    if (!hasPets && draft.pets) patch.pets = false;
    if (patch.roofCarrier !== undefined || patch.pets !== undefined) update(patch);
  }, [hasCarrier, hasPets, !!q.quote]); // eslint-disable-line react-hooks/exhaustive-deps

  const hadProfile = useRef(!!profile);
  useEffect(() => {
    if (profile && !hadProfile.current) setJustSignedIn(true);
    hadProfile.current = !!profile;
  }, [profile]);
  // Prefill the name from the signed-in profile (never overwrites something the rider already typed).
  useEffect(() => {
    if (profile?.name && !draft.customerName) update({ customerName: profile.name });
  }, [profile?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  // One way to pay: book now, pay the driver at the end of the trip (recorded as Cash, whatever an older draft held).
  useEffect(() => {
    if (payment !== 'Cash') update({ payment: 'Cash' });
  }, [payment]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!profile?.phone) return;
    const phone = splitPhone(profile.phone);
    setContactCode(phone.code);
    setContactNumber(phone.local);
  }, [profile?.phone]);

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
    draft.roofCarrier,
    draft.pets,
    q.coupon?.code,
    adjustment?.id,
    adjustment?.percent,
  ]);
  const quote = serverQuote?.key === priceKey ? serverQuote.fare : q.quote;
  const breakup = q.breakup ?? buildFareBreakup(category, quote, q.outstation);
  const airport = tripType === 'Airport Taxi';

  const addOnsConfirmed = (!draft.roofCarrier || quote.addOns?.roofCarrier === true) && (!draft.pets || quote.addOns?.pets === true);
  const nameError = customerName.trim().length < 2 ? 'Enter your name.' : '';
  // Sent in the notes only when it differs from the name on the signed-in profile (the server already has that one).
  const bookerNote = customerName.trim().toLowerCase() === (profile?.name ?? '').trim().toLowerCase() ? '' : customerName.trim();
  const emailError = email.trim() && !isValidEmail(email) ? 'Enter a valid email address or leave it blank.' : '';
  const contactError = contactNumber.length < 6 || contactNumber.length > 14 ? 'Enter a valid mobile number.' : '';
  const passengerError = forOther
    ? !passengerName.trim()
      ? 'Enter the passenger’s name.'
      : !isValidIndianMobile(passengerMobile.replace(/\s+/g, ''))
        ? 'Enter the passenger’s 10-digit mobile number.'
        : ''
    : '';
  const room = notesRoom({
    customerName: bookerNote,
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
      (!addOnsConfirmed ? 'Confirming carrier and pet charges. Please retry if pricing is unavailable.' : nameError || contactError || emailError || passengerError ? 'Check your contact details below.' : '');

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
        customerName: bookerNote,
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
        addOns: { roofCarrier: draft.roofCarrier, pets: draft.pets },
        whatsapp: { sameAsMobile: false, countryCode: contactCode, number: contactNumber },
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


  const applied = quote.discount > 0 && !!draft.promoCode;
  const showBlocker = tried && !!blocker && !submitting;

  return (
    <div className="flow-page flow-page--review cb">
      <div className="cb__wrap">
        <h1 className="sr-only">Complete your booking</h1>

        <section className="cb__section" aria-label="Passenger & Contact Details">
          <div className={`cb-field${nameError && tried ? ' is-invalid' : ''}`}>
            <label className="cb-field__label" htmlFor="booking-name">Name</label>
            <input
              id="booking-name"
              className="cb-input"
              type="text"
              autoComplete="name"
              autoCapitalize="words"
              placeholder="Your full name"
              maxLength={60}
              value={customerName}
              aria-invalid={!!nameError && tried}
              onChange={(e) => update({ customerName: e.target.value })}
            />
          </div>
          {tried && nameError ? <p className="cb-error">{nameError}</p> : null}

          <div className={`cb-field${contactError && tried ? ' is-invalid' : ''}`}>
            <div className="cb-phone">
              <div className="cb-phone__cell cb-phone__cell--code">
                <label className="cb-field__label" htmlFor="booking-country-code">Country code</label>
                <div className="cb-phone__code">
                  <select id="booking-country-code" value={contactCode} onChange={(e) => setContactCode(e.target.value)}>
                    {UNIQUE_DIAL_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
                  </select>
                  <Icon name="chevron-down" size={16} />
                </div>
              </div>
              <span className="cb-phone__sep" aria-hidden="true" />
              <div className="cb-phone__cell cb-phone__cell--num">
                <label className="cb-field__label" htmlFor="booking-mobile">Mobile number</label>
                <input
                  id="booking-mobile"
                  className="cb-input"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="Mobile number"
                  value={contactNumber}
                  aria-invalid={!!contactError && tried}
                  onChange={(e) => setContactNumber(e.target.value.replace(/\D/g, '').slice(0, 14))}
                />
              </div>
            </div>
          </div>
          {tried && contactError ? <p className="cb-error">{contactError}</p> : null}

          <div className={`cb-field${emailError ? ' is-invalid' : ''}`}>
            <label className="cb-field__label" htmlFor="booking-email">Email address (optional)</label>
            <input
              id="booking-email"
              className="cb-input"
              type="email"
              autoComplete="email"
              placeholder="name@example.com"
              value={email}
              aria-invalid={!!emailError}
              onChange={(e) => update({ email: e.target.value })}
            />
          </div>
          {emailError ? <p className="cb-error">{emailError}</p> : null}

          <div className="cb-switch-row">
            <span id="cb-other-label">Booking for someone else</span>
            <button
              type="button"
              role="switch"
              aria-checked={forOther}
              aria-labelledby="cb-other-label"
              className="cb-switch"
              onClick={() => update({ forOther: !forOther })}
            >
              <span className="cb-switch__thumb" />
            </button>
          </div>

          {forOther ? (
            <div className="cb-other">
              <PolicyLinks lead="Add another passenger’s mobile number only with their permission." ids={['privacy']} newTab />
              <div className={`cb-field${tried && !passengerName.trim() ? ' is-invalid' : ''}`}>
                <label className="cb-field__label" htmlFor="booking-pax-name">Passenger name</label>
                <input id="booking-pax-name" className="cb-input" placeholder="Full name" value={passengerName} onChange={(e) => update({ passengerName: e.target.value })} />
              </div>
              <div className={`cb-field${tried && passengerError ? ' is-invalid' : ''}`}>
                <label className="cb-field__label" htmlFor="booking-pax-mobile">Passenger 10-digit mobile</label>
                <input id="booking-pax-mobile" className="cb-input" type="tel" inputMode="numeric" placeholder="9876543210" value={passengerMobile} onChange={(e) => update({ passengerMobile: e.target.value })} />
              </div>
              {tried && passengerError ? <p className="cb-error">{passengerError}</p> : null}
            </div>
          ) : null}

          {airport ? (
            <div className="cb-field">
              <label className="cb-field__label" htmlFor="booking-flight">Flight number (optional)</label>
              <input id="booking-flight" className="cb-input" placeholder="e.g. 6E 214" value={flight} onChange={(e) => update({ flight: e.target.value.toUpperCase() })} />
              <p className="cb-field__hint">Our driver will track flight delays and adjust pickup time automatically.</p>
            </div>
          ) : null}
        </section>

        <hr className="cb__rule" />

        {hasCarrier || hasPets ? (
          <>
            <section className="cb__section cb__section--addons" aria-labelledby="cb-addons-head">
              <h2 id="cb-addons-head" className="cb__h2">Travel add-ons</h2>
              {hasCarrier ? (
                <label className="cb-addon">
                  <input type="checkbox" role="switch" className="cb-mini" checked={draft.roofCarrier} onChange={(e) => update({ roofCarrier: e.target.checked })} />
                  <span className="cb-addon__name">Roof carrier</span>
                  <span className="cb-addon__price">+{formatINR(carrierCharge)}</span>
                </label>
              ) : null}
              {hasPets ? (
                <label className="cb-addon">
                  <input type="checkbox" role="switch" className="cb-mini" checked={draft.pets} onChange={(e) => update({ pets: e.target.checked })} />
                  <span className="cb-addon__name">Travelling with pets</span>
                  <span className="cb-addon__price">+{formatINR(petCharge)}</span>
                </label>
              ) : null}
              <p className="cb__note">Charges are added once per trip and included in your final bill.</p>
            </section>

            <hr className="cb__rule" />
          </>
        ) : null}

        <section className="cb__section" aria-label="Payment">
          <div className="cb-pay" role="radiogroup" aria-label="Payment mode">
            <span className="cb-pay__icon" aria-hidden="true"><Icon name="wallet" size={26} /></span>
            <span className="cb-pay__sep" aria-hidden="true" />
            <span className="cb-pay__text">
              <strong>Book now, pay later</strong>
              <small>Pay your driver at the end of the trip.</small>
            </span>
            <input type="radio" className="cb-radio" name="pay" value="Cash" checked readOnly aria-label="Book now, pay later" />
          </div>

          {applied ? (
            <div className="cb-coupon cb-coupon--applied">
              <TicketIcon />
              <span className="cb-coupon__applied"><strong>{draft.promoCode.toUpperCase()}</strong> applied</span>
              <button type="button" className="cb-coupon__btn" onClick={() => { update({ promoCode: '' }); setCouponText(''); }}>Remove</button>
            </div>
          ) : (
            <form
              className="cb-coupon"
              onSubmit={(e) => {
                e.preventDefault();
                const code = couponText.trim();
                if (code) update({ promoCode: code });
              }}
            >
              <TicketIcon />
              <span className="cb-coupon__sep" aria-hidden="true" />
              <input className="cb-input cb-coupon__input" placeholder="Enter coupon code" aria-label="Coupon code" value={couponText} onChange={(e) => setCouponText(e.target.value.toUpperCase())} />
              <button type="submit" className="cb-coupon__btn" disabled={!couponText.trim()}>Apply</button>
            </form>
          )}

          {draft.fuelType === 'cng' ? (
            <ul className="cb__notes">
              <li>Fuel type: CNG</li>
            </ul>
          ) : null}

          {showBlocker ? <p className="cb-error cb-error--block" role="alert">{blocker}</p> : null}
          {submitError ? (
            <Notice variant="error" icon="warning">
              {submitError}
            </Notice>
          ) : null}
        </section>
      </div>

      <div className="cb-bar">
        <div className="cb-bar__in">
          <div className={`cb-terms${termsAccepted ? ' is-on' : ''}${termsError ? ' is-error' : ''}`} ref={termsRef}>
            <label className="cb-terms__row">
              <input type="checkbox" className="cb-tick" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
              <span className="cb-terms__text">
                I accept the fare, extra charges and{' '}
                <Link to="/legal#terms" target="_blank" rel="noopener">cancellation policy<span className="sr-only"> (opens in a new tab)</span></Link>
              </span>
            </label>
            {termsError ? <p className="cb-error" role="alert">{termsError}</p> : null}
          </div>
          <div className="cb-bar__row">
            <button type="button" className="cb-iconbtn" aria-label="Back to vehicles" title="Back to vehicles" onClick={() => navigate('/book/ride')}>
              <Icon name="arrow-left" size={22} />
            </button>
            <button type="button" className={`cb-total${q.quoteLoading ? ' is-loading' : ''}`} aria-busy={q.quoteLoading} onClick={() => setShowFare(true)} aria-label={`Total ${formatINR(quote.total)}. View fare details`}>
              <small>Total <Icon name="info" size={13} /></small>
              <strong key={quote.total} className="num">{formatINR(quote.total)}</strong>
              {strikeOf > 0 ? <s>{formatINR(strikeOf)}</s> : null}
            </button>
            <button type="button" className="cb-confirm" disabled={submitting} onClick={submit}>
              {submitting ? <span className="cb-confirm__spin" aria-hidden="true" /> : null}
              <span>{profile ? 'Confirm' : 'Sign in'}</span>
              <span className="cb-confirm__arrow" aria-hidden="true"><Icon name="arrow-right" size={20} /></span>
            </button>
          </div>
        </div>
      </div>

      {showFare ? <FareDialog fare={breakup} onClose={() => setShowFare(false)} /> : null}
    </div>
  );
}

const iconProps = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function TicketIcon() {
  return (
    <svg className="cb-coupon__icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h15A1.5 1.5 0 0 1 21 8.5V10a2 2 0 0 0 0 4v1.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5V14a2 2 0 0 0 0-4Z" />
      <path d="M14 7v2.5M14 14.5V17M14 11.5v1" />
    </svg>
  );
}
export default ReviewStep;
