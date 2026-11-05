import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { Icon } from './Icon';

/** Floating direct calling button in the bottom right corner for instant booking and customer support. */
export function FloatingCallButton() {
  return (
    <a
      href={`tel:${SUPPORT_PHONE}`}
      className="floating-call-btn"
      aria-label={`Direct call NESAM Cabs support at ${SUPPORT_PHONE_DISPLAY}`}
      title={`Call NESAM Cabs: ${SUPPORT_PHONE_DISPLAY}`}
    >
      <span className="floating-call-btn__icon" aria-hidden="true">
        <Icon name="phone" size={18} />
      </span>
      <span className="floating-call-btn__label">
        <span className="floating-call-btn__label-main">Call Us</span>
        <span className="floating-call-btn__label-sub">24/7 Booking</span>
      </span>
    </a>
  );
}

export default FloatingCallButton;

