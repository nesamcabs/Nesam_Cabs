import type { ReactNode } from 'react';
import type { FareLine } from '@core/types';
import { formatINR } from '@core/utils/format';
import './additionalCharges.css';

// The "Additional charges" card of the fare breakup: what is payable separately and not in the total.
// Extra KM and waiting are shown as two rate tiles; toll, parking, permit and the rest as chips (their actual
// amount is paid on the day). Shared by NESAM, One Way Car Rentals and People Taxi, so it imports only React
// types and @core; each site's own colour (--brand) and font are used.

const RATE = /₹\s?[\d,]+(?:\.\d+)?/;
const money = (n: number) => (n < 0 ? `−${formatINR(-n)}` : formatINR(n));

const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

const ICONS: Record<string, ReactNode> = {
  extraKm: (
    <Svg>
      <circle cx="6" cy="17" r="2.2" />
      <path d="M8.2 17h5.3a3 3 0 0 0 0-6H11" strokeDasharray="2 2.4" />
      <path d="M18 3.5a3 3 0 0 0-3 3c0 2.2 3 5 3 5s3-2.8 3-5a3 3 0 0 0-3-3Z" />
      <circle cx="18" cy="6.5" r=".9" />
    </Svg>
  ),
  waiting: (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  ),
  toll: (
    <Svg>
      <path d="M4 20V9" />
      <path d="M2.5 20h3" />
      <path d="M4 9.5 20 5.5v3.2L4 12.7Z" />
      <path d="M9 8.3v3.2M13 7.3v3.2M17 6.3v3.2" />
    </Svg>
  ),
  parking: (
    <Svg>
      <rect x="4" y="4" width="16" height="16" rx="3.5" />
      <path d="M10 16.5V8h3.2a2.6 2.6 0 0 1 0 5.2H10" />
    </Svg>
  ),
  stateTax: (
    <Svg>
      <path d="M6.5 3.5h7l4 4v13h-11Z" />
      <path d="M13.5 3.5v4h4M9.5 12h5M9.5 15.5h5" />
    </Svg>
  ),
  hill: (
    <Svg>
      <path d="m3 19 6-10 4 6.5 2.5-3.5L21 19Z" />
    </Svg>
  ),
  carrier: (
    <Svg>
      <rect x="4" y="8" width="16" height="11" rx="2.5" />
      <path d="M9 8V5.5h6V8" />
    </Svg>
  ),
};

const iconFor = (key: string) => ICONS[key] ?? ICONS.stateTax;

/** "₹15 per KM beyond the 333.9 KM included" → { value: "₹15", unit: "/ km" }. Only the rate is shown. */
function rateTile(l: FareLine): { value: string; unit: string; sub: string } | null {
  const unit = l.key === 'extraKm' ? '/ km' : '/ hour';
  if (l.amount !== null) return { value: money(l.amount), unit: '', sub: '' };
  const rate = l.detail ? RATE.exec(l.detail)?.[0].replace(/\s/g, '') : null;
  if (!rate) return null;
  return { value: rate, unit, sub: '' };
}

export function AdditionalCharges({ lines, policy, footnote }: { lines: FareLine[]; policy?: ReactNode; footnote?: string }) {
  const tiles = lines.filter((l) => (l.key === 'extraKm' || l.key === 'waiting') && rateTile(l));
  // The carrier / luggage charge is not shown in this card.
  const chips = lines.filter((l) => !tiles.includes(l) && l.key !== 'carrier');
  return (
    <section className="addl" aria-label="Extra Charges">
      <span className="addl__bar" aria-hidden="true" />
      <h3 className="addl__title">Extra Charges</h3>
      <p className="addl__sub">Payable separately • Not included in total</p>

      {tiles.length ? (
        <div className="addl__tiles">
          {tiles.map((l) => {
            const t = rateTile(l)!;
            return (
              <div key={l.key} className="addl__tile">
                <span className="addl__tile-icon">{iconFor(l.key)}</span>
                <span className="addl__tile-label">{l.label}</span>
                <strong className="addl__tile-value num">
                  {t.value}
                  {t.unit ? <small>{t.unit}</small> : null}
                </strong>
                <span className="addl__tile-sub">{t.sub}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {chips.length ? (
        <div className="addl__group">
          <strong className="addl__group-title">Extra Charges</strong>
          <span className="addl__group-sub">Actual amount payable separately</span>
          <ul className="addl__chips">
            {chips.map((l) => {
              const actuals = l.amount === null && (!l.detail || /at actuals/i.test(l.detail));
              const note = l.amount !== null ? money(l.amount) : actuals ? '' : l.detail ?? '';
              return (
                <li key={l.key} className="addl__chip">
                  <span className="addl__chip-icon">{iconFor(l.key)}</span>
                  <span className="addl__chip-text">
                    <span>{l.label.replace(/\s*\/\s*permit/i, '')}</span>
                    {note ? <small className="num">{note}</small> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {policy ? <div className="addl__policy-row">{policy}</div> : null}
      {footnote ? <p className="addl__foot">{footnote}</p> : null}
    </section>
  );
}
