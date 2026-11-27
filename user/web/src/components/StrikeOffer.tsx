import { formatINR } from '@core/utils/format';
import './strikeOffer.css';

/**
 * The struck-out higher price above a fare, with how much lower the fare is than it ("13% OFF").
 * Display only (admin → Service & Fare Settings → Strike out price). Both amounts are on the same basis as the price shown.
 */
export function StrikeOffer({ was, now }: { was: number; now: number }) {
  if (!(now > 0 && was > now)) return null;
  const off = Math.round(((was - now) / was) * 100);
  return (
    <span className="stk">
      <del className="stk__was">{formatINR(was)}</del>
      {off > 0 ? <span className="stk__tag">{off}% OFF</span> : null}
    </span>
  );
}
