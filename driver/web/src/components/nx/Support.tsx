import React from 'react';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { SUPPORT_PHONE } from '../../screens/VerificationStatusScreen';

export interface SupportContext {
  /** A trip code when help is opened from a trip. */
  tripCode?: string;
  /** The trip has started: changes go through the office. */
  started?: boolean;
}

/** "+919025099990" → "+91 90250 99990". */
const display = (tel: string) => {
  const d = tel.replace(/\D/g, '').slice(-10);
  return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
};

/**
 * Help and emergency options. The reference offers the NESAM office number; production adds the police number that the
 * old SOS button carried, so no safety feature is lost. Cancellation requests are not offered because the backend has
 * no driver cancellation workflow — the office handles them by phone.
 */
export const SupportDialog: React.FC<{ open: boolean; onClose: () => void; context: SupportContext }> = ({ open, onClose, context }) => {
  const number = display(SUPPORT_PHONE);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      eyebrow={context.tripCode ?? 'NESAM driver support'}
      title={context.tripCode ? (context.started ? 'Trip started · Office help' : 'Help & office') : 'A helping hand, whenever needed.'}
      footer={
        <>
          <a className="button primary full nx-office-call" href={`tel:${SUPPORT_PHONE}`} aria-label={`Call NESAM office on ${number}`}>
            <Icon name="phone" />
            Call NESAM office
          </a>
          <p className="nx-office-number">{number}</p>
          <p className="nx-office-note">{context.started ? 'Call the office for trip changes or an urgent issue.' : 'Keep your trip ID ready so our team can help.'}</p>
        </>
      }
    >
      <p className="nx-help-intro">
        {context.tripCode
          ? context.started
            ? 'For changes after starting your duty, call the NESAM office. Our team will handle the next steps.'
            : 'For a duty change or cancellation, call the NESAM office. Any change is made by the NESAM team.'
          : 'For assigned duty changes, documents or settlement questions, contact the NESAM office.'}
      </p>
      <a className="nx-help-choice" href="tel:112" aria-label="Call police emergency number 112">
        <span>
          <Icon name="alert" />
          Emergency: police (112)
          <small>In danger or an accident, call 112 first.</small>
        </span>
        <Icon name="chevron" />
      </a>
    </Dialog>
  );
};
