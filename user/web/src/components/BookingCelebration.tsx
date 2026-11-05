import { SuccessBurst } from './SuccessBurst';
import './bookingCelebration.css';

/**
 * Decorative only: rendered after the booking API succeeds, never while submitting.
 * Shared by all three customer sites; each passes its own logo, so the brand is the first thing seen on a confirmed booking.
 */
export function BookingCelebration({ label, logo }: { label: string; logo?: { src: string; alt: string } }) {
  return (
    <div className="booking-celebration" role="img" aria-label={label}>
      <div aria-hidden="true">
        {logo ? (
          <div className="booking-celebration__brand">
            <span className="booking-celebration__logo">
              <img src={logo.src} alt="" height={44} />
            </span>
            <span className="booking-celebration__rule" />
            <span className="booking-celebration__caption">Booking confirmed</span>
          </div>
        ) : null}
        <SuccessBurst label="" />
        <div className="booking-celebration__journey">
          <span className="booking-celebration__pin" />
          <span className="booking-celebration__road" />
          <span className="booking-celebration__cab">
            <svg viewBox="0 0 80 48" fill="none" focusable="false">
              <path d="m9 24 9-14h30l14 14 9 4v11H5V28l4-4Z" fill="currentColor" />
              <path d="m22 14-6 10h17V14H22Zm16 0v10h18L46 14h-8Z" fill="white" fillOpacity=".9" />
              <rect x="30" y="5" width="15" height="5" rx="2" fill="currentColor" />
              <path d="M7 30h9m47 0h6" stroke="#ffc53d" strokeWidth="4" strokeLinecap="round" />
              <circle cx="21" cy="38" r="8" fill="#182339" />
              <circle cx="57" cy="38" r="8" fill="#182339" />
              <circle cx="21" cy="38" r="3.5" fill="white" />
              <circle cx="57" cy="38" r="3.5" fill="white" />
            </svg>
          </span>
          <span className="booking-celebration__destination">
            <svg viewBox="0 0 24 24" fill="none" focusable="false">
              <path d="m6 12 4 4 8-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}
