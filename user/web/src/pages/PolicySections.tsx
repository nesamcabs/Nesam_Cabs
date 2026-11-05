// Public customer policies shown on /legal (readable before sign-in), plus the links other screens
// use to point at one section. Fees and windows come from the shared booking constants.
import { Fragment, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  COMPANY_LEGAL_NAME,
  FREE_CANCEL_AFTER_ASSIGN_MS,
  INSTANT_CANCELLATION_FEE,
  SCHEDULED_CANCELLATION_FEE,
  SCHEDULED_FREE_CANCEL_BEFORE_MS,
  SUPPORT_PHONE,
  SUPPORT_PHONE_DISPLAY,
} from '@core/config/constants';

const BRAND = 'NESAM';

export type PolicyId = 'terms' | 'privacy' | 'cancellation' | 'refund' | 'payment' | 'safety' | 'deletion';

export const POLICY_TITLES: Record<PolicyId, string> = {
  terms: 'Terms & Conditions',
  privacy: 'Privacy & Location Policy',
  cancellation: 'Cancellation Policy',
  refund: 'Refund Policy',
  payment: 'Fare & Payment Policy',
  safety: 'Passenger Safety & Support',
  deletion: 'Account & Data Deletion',
};

const hours = SCHEDULED_FREE_CANCEL_BEFORE_MS / 3600000;
/** The scheduled free-cancellation window, e.g. "1 hour". */
export const FREE_CANCEL_WINDOW = `${hours} hour${hours === 1 ? '' : 's'}`;

/**
 * Links to policy sections. `newTab` keeps an in-progress form or dialog intact (the policy page
 * is public, so it opens in any state).
 */
export function PolicyLinks({ ids, lead, newTab = false, className = '' }: { ids: PolicyId[]; lead?: string; newTab?: boolean; className?: string }) {
  return (
    <p className={`policy-links small muted ${className}`}>
      {lead ? `${lead} ` : null}
      {ids.map((id, i) => (
        <Fragment key={id}>
          {i ? ' · ' : null}
          <Link to={`/legal#${id}`} {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}>
            {POLICY_TITLES[id]}
            {newTab ? <span className="sr-only"> (opens in a new tab)</span> : null}
          </Link>
        </Fragment>
      ))}
    </p>
  );
}

const POLICIES: { id: PolicyId; paragraphs: string[] }[] = [
  {
    id: 'terms',
    paragraphs: [
      `${BRAND} is a booking service of ${COMPANY_LEGAL_NAME}. Check your route, pickup time, passenger details, vehicle category and fare before confirming. A booking request is subject to availability; rely on the confirmation and status shown in your booking. Provide accurate contact details and obtain permission when booking for another passenger. Keep login OTPs private and share the boarding OTP only with the assigned driver at pickup.`,
      'One-way drops, round trips, airport transfers, hourly rentals and multicity trips follow the selected package. These services come with a driver unless expressly stated otherwise. Changes to stops, distance or hours may change the fare; contact support before changing your itinerary. Traffic and weather can affect arrival times, so allow time for onward connections.',
      'Indian law applies. These policies do not exclude statutory consumer rights, remedies for deficient service or liability that cannot lawfully be excluded. Read your booking confirmation and any versioned agreements below together with these policies.',
    ],
  },
  {
    id: 'cancellation',
    paragraphs: [
      `Cancel an eligible booking from My trips and review the fee shown before confirming. A scheduled booking is free to cancel while it is still Pending, or while pickup is more than ${FREE_CANCEL_WINDOW} away. Once it has been accepted and pickup is ${FREE_CANCEL_WINDOW} away or less, the current cancellation fee of ₹${SCHEDULED_CANCELLATION_FEE} applies.`,
      `An instant booking is free to cancel before a driver is assigned and for ${FREE_CANCEL_AFTER_ASSIGN_MS / 60000} minutes after assignment. After that, the current cancellation fee of ₹${INSTANT_CANCELLATION_FEE} applies. Once a trip is Ongoing, it can no longer be cancelled in the app; call support for help.`,
      'If the driver asks you to cancel, cannot arrive, or the operator cancels, contact support to review the reason and any incorrectly applied fee. Operator obligations under applicable law remain unaffected. Rescheduling is subject to availability and confirmation; do not assume a requested change is confirmed.',
    ],
  },
  {
    id: 'refund',
    paragraphs: [
      'A refund requires an actual payment. Submitting a booking request does not itself charge money. Cancelling an unpaid booking creates no refund balance. For a paid booking, support verifies the amount received, any disclosed cancellation fee and any agreed service already supplied before confirming the refundable balance.',
      'Report duplicate payments, overpayments, debits for failed transactions or a service not supplied with the booking ID, receipt and transaction reference. Payments collected by a driver or operator require verification of the collector and receipt. Approved refunds use the original payment method where possible, or another method agreed with the payer.',
      'Ask support for the approved amount, expected processing date and refund reference. Bank settlement times vary; no fixed processing time is promised here. A pending refund record does not mean funds have reached your bank. Follow up using the reference if delayed. Never share an OTP or UPI PIN to receive a refund. Statutory refund rights remain unaffected.',
    ],
  },
  {
    id: 'payment',
    paragraphs: [
      'Review the fare breakdown, package limits, allowances, night charges, tax and discounts before confirming. Tolls, parking fees and state entry permits are not included in the fare total; they are paid separately against receipts, as stated before you book. Extra distance, waiting and itinerary changes should be explained before additional charges are agreed.',
      'No payment is taken when you submit a booking request. Pay your driver by the cash or UPI method confirmed for the trip, verify the recipient, retain receipts and check the booking payment record. Contact support before repeating a disputed or missing payment. Offers apply only under their displayed eligibility and validity conditions. Raise fare disputes with the booking ID and receipts.',
    ],
  },
  {
    id: 'privacy',
    paragraphs: [
      `${BRAND} and ${COMPANY_LEGAL_NAME} use the details supplied for account access, bookings, trip fulfilment, payments, safety and support. These may include name, phone, email, passenger details, pickup and destination, trip history, payment references, profile photo, feedback and support messages.`,
      'If you allow device location it helps select pickup; you may deny permission and enter an address manually. Maps and route searches use configured mapping providers. Active trip features may display driver location, and an SOS alert sends your trip and current location to the operations team. Share trip links only with trusted people. Booking information needed for fulfilment is shared with assigned drivers, fleet partners and authorised operations staff. Hosting, authentication and communication providers process information needed to deliver their features.',
      'Browser storage supports sign-in and booking continuity. Browser settings control storage and location permissions; clearing storage may sign you out or remove an unfinished booking. WhatsApp updates use the supplied number; obtain permission before supplying another person’s number or passenger details. Contact support to change optional communications.',
      'Request access, correction, account deletion or withdrawal of optional permissions through support; you can request account deletion yourself under Account → Delete my account (see Account & Data Deletion below). Some booking, payment, tax and security records may need retention for legal obligations or unresolved disputes; ask support about applicable retention. Do not send OTPs, UPI PINs or unnecessary identity documents.',
    ],
  },
  {
    id: 'safety',
    paragraphs: [
      'Check driver and vehicle details before boarding, wear seat belts and stay within passenger and luggage capacity. Do not carry prohibited items. Children should travel with a responsible adult and legally required restraints. Confirm accessibility needs or special luggage with support before booking.',
      'For immediate danger call 112; booking support is not an emergency response service. During a trip, the Safety centre lets you call for help, share your trip and alert the operations team. For delays, lost belongings, complaints, refunds or privacy requests, contact support with your booking ID, date and relevant receipts. Ask for a complaint reference and expected response date.',
    ],
  },
  {
    id: 'deletion',
    paragraphs: [
      'You can ask us to delete your account and personal data at any time. Signed in: open Account and choose Delete my account (in the mobile app: Account → Settings → Delete my account). Not able to sign in: email support@nesamcabs.com or call the number below from the mobile number on the account, and quote that number.',
      'We verify the request, settle anything still open (live bookings, unpaid amounts, refunds) and then delete or anonymise your profile, saved places and contact details. Records we must keep by law or to resolve a dispute, such as bookings, invoices, payment and tax records, are retained for the period the law requires and are not used for marketing.',
      'Nothing is deleted the moment you tap the button: the request is recorded, our team confirms by phone or email, and you can ask support to withdraw it before it is processed. Once processed, an account cannot be restored.',
    ],
  },
  {
    id: 'deletion',
    paragraphs: [
      'You can ask us to delete your account and personal data at any time. Signed in: open Account and choose Delete my account (in the mobile app: Account → Settings → Delete my account). Not able to sign in: email support@nesamcabs.com or call the number below from the mobile number on the account, and quote that number.',
      'We verify the request, settle anything still open (live bookings, unpaid amounts, refunds) and then delete or anonymise your profile, saved places and contact details. Records we must keep by law or to resolve a dispute, such as bookings, invoices, payment and tax records, are retained for the period the law requires and are not used for marketing.',
      'Nothing is deleted the moment you tap the button: the request is recorded, our team confirms by phone or email, and you can ask support to withdraw it before it is processed. Once processed, an account cannot be restored.',
    ],
  },
];

export function PolicySections() {
  const { hash, key } = useLocation();
  // Runs on every navigation (key), so a section link opens its section even when the hash is
  // unchanged, on a fresh load and after this lazily loaded page mounts.
  useEffect(() => {
    if (!hash) return undefined;
    const frame = requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [hash, key]);

  return (
    <section className="stack policies" aria-label="Customer policies">
      <div className="card">
        <h2>{BRAND} customer policies</h2>
        <p>Updated 4 November 2026. Read alongside your booking confirmation and any versioned agreements below.</p>
        <nav aria-label="Policy contents" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
          {POLICIES.map((p) => (
            <Link key={p.id} to={`/legal#${p.id}`}>
              {POLICY_TITLES[p.id]}
            </Link>
          ))}
        </nav>
      </div>
      {POLICIES.map((p) => (
        <section className="card" key={p.id} id={p.id} aria-labelledby={`${p.id}-title`} style={{ scrollMarginTop: 120 }}>
          <h2 id={`${p.id}-title`}>{POLICY_TITLES[p.id]}</h2>
          {p.paragraphs.map((text, i) => (
            <p key={i} style={{ marginTop: 12, lineHeight: 1.75 }}>
              {text}
            </p>
          ))}
        </section>
      ))}
      <div className="card">
        <h2>Contact &amp; complaints</h2>
        <p>{COMPANY_LEGAL_NAME}, Theni, Tamil Nadu 625531, India</p>
        <p>
          Call <a href={`tel:${SUPPORT_PHONE}`}>{SUPPORT_PHONE_DISPLAY}</a>, email <a href="mailto:support@nesamcabs.com">support@nesamcabs.com</a> or <Link to="/support">open support</Link> for booking, refund, privacy and account deletion assistance.
        </p>
      </div>
    </section>
  );
}
