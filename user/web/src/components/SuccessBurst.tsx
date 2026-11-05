// The "booking successful" mark shown on the booking-done page of all three customer sites: a ring that
// draws itself, a filled circle that pops in, a tick that is stroked on, soft ripples and a burst of
// confetti. It is plain HTML and CSS (each site's stylesheet sets the colours and the motion); without
// motion the finished mark is simply shown. Shared by NESAM, One Way Car Rentals and People Taxi, so it
// imports nothing but React types.
import type { CSSProperties } from 'react';

const BITS = 16;

export function SuccessBurst({ label = 'Booking successful' }: { label?: string }) {
  return (
    <div className="success-burst" role="img" aria-label={label}>
      <span className="success-burst__ripple" />
      <span className="success-burst__ripple success-burst__ripple--late" />
      <svg className="success-burst__svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <circle className="success-burst__halo" cx="60" cy="60" r="54" />
        <circle className="success-burst__disc" cx="60" cy="60" r="43" />
        <path className="success-burst__tick" d="M40 62.5l14.5 14.5L82 47" />
      </svg>
      {Array.from({ length: BITS }, (_, i) => (
        <i
          key={i}
          className={`success-burst__bit success-burst__bit--${i % 4}`}
          style={
            {
              '--a': `${Math.round((360 / BITS) * i)}deg`,
              '--d': `${64 + (i % 3) * 14}px`,
              '--t': `${0.45 + (i % 5) * 0.04}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

export default SuccessBurst;
