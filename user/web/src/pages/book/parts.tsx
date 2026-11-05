import { useEffect, useState, type ReactNode } from 'react';
import type { FareBreakdown as Fare, FareLine, PaymentMethod } from '@core/types';
import type { FareBreakup } from '@core/utils/fareBreakup';
import { formatINR } from '@core/utils/format';
import { Button, Dialog } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { FareBreakdown } from '@/components/FareBreakdown';

/** One way to pay: book now, pay the driver at the end of the trip. Recorded as Cash, whatever an older draft held. */
export function PaymentChoice({
  value,
  onChange,
  disabled,
}: {
  value: PaymentMethod;
  onChange: (m: PaymentMethod) => void;
  disabled?: boolean;
}) {
  useEffect(() => {
    if (value !== 'Cash') onChange('Cash');
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pay-opts" role="radiogroup" aria-label="Payment mode">
      <label className="pay-opt is-selected">
        <input type="radio" name="pay" value="Cash" checked readOnly disabled={disabled} />
        <div className="pay-opt__text">
          <strong>Book now, pay later</strong>
          <small>Pay your driver at the end of the trip.</small>
        </div>
        <Icon name="wallet" size={20} />
      </label>
    </div>
  );
}

export function PromoControl({
  code,
  applied,
  onApply,
  onRemove,
  disabled,
}: {
  code: string;
  applied: boolean;
  onApply: (code: string) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const [val, setVal] = useState(code);
  const [open, setOpen] = useState(false);

  if (applied && code) {
    return (
      <div className="promo">
        <span className="promo-chip">
          <Icon name="tag" size={14} />
          <strong>{code.toUpperCase()}</strong> applied
          <button type="button" onClick={onRemove} disabled={disabled} aria-label="Remove coupon">
            <Icon name="close" size={12} />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="promo">
      {!open ? (
        <button type="button" className="btn btn--text" onClick={() => setOpen(true)} disabled={disabled}>
          <Icon name="tag" size={14} /> Have a coupon code?
        </button>
      ) : (
        <form
          className="promo-form"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = val.trim();
            if (trimmed) onApply(trimmed);
          }}
        >
          <input
            type="text"
            className="input"
            placeholder="Enter promo code"
            value={val}
            onChange={(e) => setVal(e.target.value.toUpperCase())}
            autoFocus
          />
          <Button type="submit" variant="secondary" size="sm" disabled={!val.trim() || disabled}>
            Apply
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </form>
      )}
    </div>
  );
}

export function FareDialog({
  title = 'Fare Breakup & Exclusions',
  lines,
  total,
  fare,
  estimated,
  note,
  onClose,
}: {
  title?: string;
  lines?: FareLine[];
  total?: number;
  fare?: FareBreakup | Fare | null;
  estimated?: boolean;
  note?: ReactNode;
  onClose: () => void;
}) {
  const finalLines: FareLine[] = lines ?? ((fare as any)?.lines ?? []);
  const finalTotal: number = total ?? ((fare as any)?.packageTotal ?? (fare as any)?.total ?? 0);
  return (
    <Dialog title={title} onClose={onClose} variant="sheet">
      {note ? <p className="fare-note">{note}</p> : null}
      <FareBreakdown lines={finalLines} total={finalTotal} estimated={estimated} />
    </Dialog>
  );
}

export function FlowBar({
  onBack,
  onNext,
  backLabel = 'Back',
  nextLabel = 'Book Now',
  nextDisabled = false,
  nextLoading = false,
  total,
  secondary,
  showBack = false,
  hideFare = false,
  onHome,
  above,
}: {
  onBack?: () => void;
  onNext?: () => void;
  backLabel?: string;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextLoading?: boolean;
  total?: number;
  secondary?: React.ReactNode;
  showBack?: boolean;
  /** Keep the button, drop the fare text: used where each card already shows its own price. */
  hideFare?: boolean;
  /** Adds a Home icon button to the right of the main button (with onBack, a Back icon button to its left). */
  onHome?: () => void;
  /** Shown directly above the main button, inside the bar (the terms checkbox). */
  above?: ReactNode;
}) {
  return (
    <div className="flow-bar">
      {above}
      {total !== undefined && onNext ? (
        <div className={`flow-bar__total ${hideFare ? 'flow-bar__total--solo' : ''} ${hideFare && (onBack || onHome) ? 'flow-bar__total--with-icons' : ''}`}>
          {hideFare && onBack ? (
            <button type="button" className="flow-bar__icon" aria-label={backLabel} title={backLabel} onClick={onBack}>
              <Icon name="arrow-left" size={20} />
            </button>
          ) : null}
          {hideFare ? null : (
            <div>
              <small>Estimated Fare</small>
              <strong>{formatINR(total)}</strong>
            </div>
          )}
          <Button
            variant="primary"
            size="lg"
            disabled={nextDisabled}
            loading={nextLoading}
            onClick={onNext}
          >
            {nextLabel}
          </Button>
          {hideFare && onHome ? (
            <button type="button" className="flow-bar__icon" aria-label="Home" title="Home" onClick={onHome}>
              <Icon name="home" size={20} />
            </button>
          ) : null}
        </div>
      ) : null}

      {(showBack && onBack) || (total === undefined && onBack) || secondary ? (
        <div className="flow-bar__nav">
          {onBack ? (
            <Button variant="secondary" size="md" onClick={onBack} icon="arrow-left">
              {backLabel}
            </Button>
          ) : null}
          {secondary}
          {total === undefined && onNext ? (
            <Button
              variant="primary"
              size="md"
              disabled={nextDisabled}
              loading={nextLoading}
              onClick={onNext}
              iconTrailing="arrow-right"
            >
              {nextLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
