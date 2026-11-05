import type { ReactNode } from 'react';
import './cabParts.css';

// Colourful icons and the fuel picker used on the vehicle cards of all three customer sites. Plain React and inline SVG only,
// so NESAM, One Way Car Rentals and People Taxi can share it (it imports nothing from any site).

export type CabIconKind = 'seat' | 'ac' | 'bag' | 'driver' | 'road' | 'cng' | 'diesel' | 'info';

const PAL: Record<CabIconKind, { bg: string; fg: string }> = {
  seat: { bg: '#e8f0ff', fg: '#2f6df6' },
  ac: { bg: '#e0f6fb', fg: '#0aa4c4' },
  bag: { bg: '#fff1d6', fg: '#d98a00' },
  driver: { bg: '#e6ecff', fg: '#3b4fd8' },
  road: { bg: '#ffe9e0', fg: '#e8590c' },
  cng: { bg: '#e2f6e9', fg: '#1a9d52' },
  diesel: { bg: '#fff0dc', fg: '#e07a00' },
  info: { bg: '#eef0f4', fg: '#5b6578' },
};

const PATHS: Record<CabIconKind, ReactNode> = {
  seat: (
    <>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 19c.6-3.4 3.2-5.2 6.5-5.2s5.9 1.8 6.5 5.2" />
    </>
  ),
  ac: (
    <>
      <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
      <path d="m9.6 4.6 2.4 1.9 2.4-1.9M9.6 19.4l2.4-1.9 2.4 1.9" />
    </>
  ),
  bag: (
    <>
      <rect x="5" y="8" width="14" height="11.5" rx="2.4" />
      <path d="M9.2 8V6.4A1.6 1.6 0 0 1 10.8 4.8h2.4a1.6 1.6 0 0 1 1.6 1.6V8M5 13h14" />
    </>
  ),
  driver: (
    <>
      <circle cx="12" cy="9" r="3.1" />
      <path d="M8.2 6.4c.5-2 2-3 3.8-3s3.3 1 3.8 3M5.8 19.5c.5-3.3 3-5.1 6.2-5.1s5.7 1.8 6.2 5.1" />
    </>
  ),
  road: (
    <>
      <path d="M8.2 20 10 4M15.8 20 14 4" />
      <path d="M12 6.5v2.2M12 11.2v2.4M12 16v2.2" />
    </>
  ),
  cng: (
    <>
      <rect x="6.4" y="9" width="11.2" height="10.6" rx="3.2" />
      <path d="M10 9V6.6h4V9" />
      <path d="M12 17.2c-1.7 0-2.6-1-2.6-2.3 0-1.6 1.4-2.3 1.7-3.6.9.7 1.4 1.7 1.4 2.5.4-.3.6-.8.6-1.3 1 .8 1.5 1.7 1.5 2.7 0 1.2-1 2-2.6 2Z" />
    </>
  ),
  diesel: (
    <>
      <rect x="5.2" y="4.6" width="8.4" height="14.9" rx="1.8" />
      <path d="M7.6 8.6h3.6M13.6 9.4h1.7c1 0 1.9.8 1.9 1.9v4.2c0 .8.6 1.4 1.4 1.4s1.4-.6 1.4-1.4V9.2l-2.3-2.3M4 19.5h11" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 11v5M12 7.9v.1" />
    </>
  ),
};

/** A rounded square in a soft tint with a coloured line icon on it. */
export function CabIcon({ kind, size = 24 }: { kind: CabIconKind; size?: number }) {
  const { bg, fg } = PAL[kind];
  return (
    <span className="cabx-ico" style={{ width: size, height: size, background: bg, color: fg }} aria-hidden="true">
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.68)} height={Math.round(size * 0.68)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false">
        {PATHS[kind]}
      </svg>
    </span>
  );
}

export type FuelChoice = 'cng' | 'diesel';

/** "Select Fuel Type": CNG or Diesel as two radio pills. Clicking one never selects or deselects the card around it twice. */
export function FuelPick({ name, value, onChange }: { name: string; value: FuelChoice; onChange: (v: FuelChoice) => void }) {
  const opts: { id: FuelChoice; label: string }[] = [
    { id: 'cng', label: 'CNG' },
    { id: 'diesel', label: 'Diesel' },
  ];
  return (
    <div className="cabx-fuel" role="radiogroup" aria-label="Fuel type" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <span className="cabx-fuel__title">Select fuel type</span>
      <div className="cabx-fuel__opts">
        {opts.map((o) => (
          <label key={o.id} className={`cabx-fuel__opt cabx-fuel__opt--${o.id} ${value === o.id ? 'is-on' : ''}`}>
            <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} />
            <CabIcon kind={o.id} size={22} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** "Fuel type" above the cab list: Diesel / Petrol or CNG, as two buttons. */
export function FuelBar({ value, onChange }: { value: FuelChoice; onChange: (v: FuelChoice) => void }) {
  const opts: { id: FuelChoice; label: string }[] = [
    { id: 'diesel', label: 'Diesel / Petrol' },
    { id: 'cng', label: 'CNG' },
  ];
  return (
    <div className="cabx-fuelbar" role="radiogroup" aria-label="Fuel type">
      {opts.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={`cabx-fuelbar__btn cabx-fuelbar__btn--${o.id} ${value === o.id ? 'is-on' : ''}`} onClick={() => onChange(o.id)}>
          <CabIcon kind={o.id} size={20} />
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Up and down arrows side by side: the swap pickup / drop button. */
export function SwapIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M8 20V5M4 9l4-4 4 4M16 4v15M12 15l4 4 4-4" />
    </svg>
  );
}

/** A solid clock, for the pickup time. */
export function ClockIcon({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10.5" fill="currentColor" />
      <path d="M12 6.5V12l3.6 2.2" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A red map pin, for places along the way ("Add city"). */
export function PinIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M12 2.2c-4 0-7.2 3.1-7.2 7.1 0 5.2 7.2 12.5 7.2 12.5s7.2-7.3 7.2-12.5c0-4-3.2-7.1-7.2-7.1Z" fill="#e8344c" />
      <circle cx="12" cy="9.3" r="2.8" fill="#fff" />
    </svg>
  );
}
