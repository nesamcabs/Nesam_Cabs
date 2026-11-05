import type { ReactNode } from 'react';

/** Pickup → destination as a connected pair (green dot, dotted line, red square). */
export function RoutePoints({ pickup, drop, pickupAddress, dropAddress, compact = false, trailing }: {
  pickup: string;
  drop: string;
  pickupAddress?: string;
  dropAddress?: string;
  compact?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <ol className={`route-points ${compact ? 'route-points--compact' : ''}`}>
      <li>
        <span className="route-points__mark route-points__mark--pickup" aria-hidden="true" />
        <div className="route-points__text">
          <span className="route-points__label">Pickup</span>
          <strong className={compact ? 'truncate' : ''}>{pickup}</strong>
          {!compact && pickupAddress && pickupAddress !== pickup ? <small>{pickupAddress}</small> : null}
        </div>
        {trailing}
      </li>
      <li>
        <span className="route-points__mark route-points__mark--drop" aria-hidden="true" />
        <div className="route-points__text">
          <span className="route-points__label">Destination</span>
          <strong className={compact ? 'truncate' : ''}>{drop}</strong>
          {!compact && dropAddress && dropAddress !== drop ? <small>{dropAddress}</small> : null}
        </div>
      </li>
    </ol>
  );
}
