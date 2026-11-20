// "Choose Payment Option": book now and pay later, pay a part now (the office sets the percentage), or pay everything now.
// Which of them appear is the office's decision per pickup district and date (Service & Fare Settings › Payment options); the server
// sends the list and checks the choice again when the booking is made.
import type { ReactElement } from 'react';
import { choiceText, type PayChoice, type PayChoiceId } from '@core/services/paymentService';
import { formatINR } from '@core/utils/format';
import './paymentChoice.css';

const svg = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;

function CardIcon() {
  return <svg {...svg}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h3" /></svg>;
}
function CalendarIcon() {
  return <svg {...svg}><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16" /><path d="M8.5 14h.01M12 14h.01M15.5 14h.01M8.5 17h.01M12 17h.01" strokeWidth="2.4" /></svg>;
}
function CoinsIcon() {
  return <svg {...svg}><ellipse cx="9" cy="7" rx="5.5" ry="2.5" /><path d="M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V7" /><path d="M3.5 11v4c0 1.4 2.5 2.5 5.5 2.5 1.2 0 2.3-.2 3.2-.5" /><ellipse cx="16" cy="14" rx="5" ry="2.3" /><path d="M11 14v3.5c0 1.3 2.2 2.3 5 2.3s5-1 5-2.3V14" /></svg>;
}
function ShieldIcon() {
  return <svg {...svg} width={20} height={20}><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2.2 2.2L15.5 10" /></svg>;
}

const ICONS: Record<PayChoiceId, () => ReactElement> = { later: CalendarIcon, part: CoinsIcon, full: CardIcon };

export function PaymentChoice({ choices, value, onChange, total, disabled }: { choices: PayChoice[]; value: PayChoiceId; onChange: (id: PayChoiceId) => void; total: number; disabled?: boolean }) {
  return (
    <section className="pc" aria-labelledby="pc-title">
      <header className="pc__head">
        <span className="pc__headicon" aria-hidden="true"><CardIcon /></span>
        <div className="pc__headtext">
          <h2 id="pc-title">Choose Payment Option</h2>
          <p>Select how you’d like to pay for this trip</p>
        </div>
        <span className="pc__secure"><ShieldIcon />Secure Payment</span>
      </header>
      <div className="pc__list" role="radiogroup" aria-labelledby="pc-title">
        {choices.map((c) => {
          const t = choiceText(c, total);
          const Icon = ICONS[c.id];
          const on = c.id === value;
          return (
            <label key={c.id} className={`pc__opt${on ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`}>
              <input className="pc__input" type="radio" name="payment-choice" value={c.id} checked={on} disabled={disabled} onChange={() => onChange(c.id)} />
              <span className="pc__dot" aria-hidden="true" />
              <span className="pc__icon" aria-hidden="true"><Icon /></span>
              <span className="pc__text">
                <strong>{t.title}{c.recommended ? <em className="pc__badge"><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="m12 2.8 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17l-5.6 3 1.1-6.2L3 9.4l6.2-.9z" /></svg>Recommended</em> : null}</strong>
                <small>{t.subtitle}</small>
              </span>
              {c.id === 'later' ? (
                <span className="pc__pill" aria-label={`Pay ${formatINR(0)} now`}>{formatINR(0)}</span>
              ) : (
                <span className="pc__amt">
                  <small>{t.label}</small>
                  <strong className="num">{formatINR(t.amount)}</strong>
                </span>
              )}
            </label>
          );
        })}
      </div>
    </section>
  );
}
