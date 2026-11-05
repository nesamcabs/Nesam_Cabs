import { useEffect, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import './bookingConfirmed.css';

// The full-screen "Booking confirmed" moment shown right after a booking is made. The whole screen turns the site's
// accent colour, the brand logo drops in on a white badge, a white disc pops with a tick that draws itself and bursts
// into sparkles, confetti rains, the headline rises word by word, a cab drives in along the road and the booking ID and
// the next steps settle into place. Shared by NESAM, One Way Car Rentals and People Taxi (each passes its own logo;
// the colour comes from the site's own accent), so it imports nothing from any site.

const FALLING = 44;
const BURST = 26;
const BURST_COLOURS = ['#ffffff', '#ffd23f', '#ff7aa2', '#7cf0c2', '#8ec5ff'];

export function BookingConfirmedOverlay({
  logo,
  code,
  title = 'Booking confirmed!',
  message,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onClose,
}: {
  logo?: { src: string; alt: string };
  code?: string;
  title?: string;
  message: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel: string;
  onClose: () => void;
}) {
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primary.current?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const words = title.split(' ');

  return createPortal(
    <div className="bcx" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bcx__rings" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>

      <div className="bcx__confetti" aria-hidden="true">
        {Array.from({ length: FALLING }, (_, i) => (
          <i
            key={i}
            className={`bcx__bit bcx__bit--${i % 5} ${i % 3 === 0 ? 'is-round' : ''}`}
            style={
              {
                '--x': `${(i * 37) % 100}%`,
                '--d': `${((i * 53) % 110) / 100 + 0.9}s`,
                '--t': `${2.4 + ((i * 29) % 18) / 10}s`,
                '--r': `${((i * 71) % 720) - 360}deg`,
                '--s': `${7 + ((i * 13) % 8)}px`,
              } as CSSProperties
            }
          />
        ))}
      </div>

      <div className="bcx__stage">
        {logo ? (
          <div className="bcx__logo">
            <img src={logo.src} alt={logo.alt} height={52} />
          </div>
        ) : null}

        <div className="bcx__check" aria-hidden="true">
          <span className="bcx__halo" />
          <span className="bcx__halo bcx__halo--2" />
          <div className="bcx__burst">
            {Array.from({ length: BURST }, (_, i) => (
              <i
                key={i}
                className={i % 3 === 0 ? 'is-star' : i % 3 === 1 ? 'is-dot' : 'is-bar'}
                style={
                  {
                    '--a': `${(360 / BURST) * i}deg`,
                    '--dist': `${96 + ((i * 17) % 5) * 16}px`,
                    '--c': BURST_COLOURS[i % BURST_COLOURS.length],
                    '--z': `${6 + ((i * 7) % 6)}px`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <svg viewBox="0 0 120 120" focusable="false">
            <circle className="bcx__disc" cx="60" cy="60" r="52" />
            <path className="bcx__tick" d="M36 62l16 16 32-36" pathLength="100" />
          </svg>
        </div>

        <h2 className="bcx__title">
          {words.map((w, i) => (
            <span key={i} className="bcx__word" style={{ '--i': i } as CSSProperties}>
              {w}
            </span>
          ))}
        </h2>

        {code ? (
          <p className="bcx__code">
            <span>Booking ID</span>
            <strong>{code}</strong>
          </p>
        ) : null}
        <p className="bcx__msg">{message}</p>

        <div className="bcx__road" aria-hidden="true">
          <span className="bcx__line" />
          <svg className="bcx__car" viewBox="0 0 120 52" focusable="false">
            <path className="bcx__car-body" d="M6 36c0-4 2-6 6-7l14-3 14-14c2-2 4-3 7-3h26c4 0 7 1 9 4l11 13 12 3c4 1 6 3 6 7v4c0 2-2 4-4 4h-8a11 11 0 0 0-22 0H46a11 11 0 0 0-22 0H10c-2 0-4-2-4-4Z" />
            <path className="bcx__car-glass" d="M40 26l9-10c1-1 2-2 4-2h22c2 0 3 1 4 2l8 10Z" />
            <circle className="bcx__wheel" cx="35" cy="42" r="8.5" />
            <circle className="bcx__wheel" cx="95" cy="42" r="8.5" />
            <circle className="bcx__hub" cx="35" cy="42" r="3" />
            <circle className="bcx__hub" cx="95" cy="42" r="3" />
          </svg>
        </div>
      </div>

      <div className="bcx__actions">
        <button ref={primary} type="button" className="bcx__btn bcx__btn--primary" onClick={onPrimary}>
          {primaryLabel}
        </button>
        <button type="button" className="bcx__btn bcx__btn--ghost" onClick={onClose}>
          {secondaryLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
