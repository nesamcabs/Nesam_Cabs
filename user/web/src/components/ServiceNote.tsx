// The one-line note under a service's tabs (Customer UX 9.0) and its "Details" dialog: what the service includes, what it does not,
// and which charges are extra. The words live in `@core/data/serviceCopy`; no price is ever written here.
import { useState } from 'react';
import { SERVICE_COPY, type ServiceNoteKind } from '@core/data/serviceCopy';
import { Icon } from '@/components/Icon';
import { Dialog } from '@/components/ui';
import './serviceNote.css';

export function ServiceNote({ kind, className = '' }: { kind: ServiceNoteKind; className?: string }) {
  const [open, setOpen] = useState(false);
  const copy = SERVICE_COPY[kind];
  return (
    <>
      <div className={`svc-note ${className}`} role="note">
        <Icon name="info" size={18} className="svc-note__icon" />
        <div className="svc-note__text">
          <strong>{copy.title}</strong>
          <span>{copy.sub}</span>
        </div>
        <button type="button" className="svc-note__more" aria-haspopup="dialog" aria-label={`${copy.heading} service details`} onClick={() => setOpen(true)}>
          Details
        </button>
      </div>
      {open ? (
        <Dialog title={copy.heading} onClose={() => setOpen(false)} className="svc-dialog" footer={<button type="button" className="svc-dialog__ok" onClick={() => setOpen(false)}>Got it</button>}>
          <p className="svc-dialog__intro">{copy.intro}</p>
          <ul className="svc-dialog__list">
            {copy.items.map(([label, text]) => {
              const no = label === 'Not included';
              return (
                <li key={label}>
                  <span className={`svc-dialog__mark ${no ? 'is-no' : ''}`} aria-hidden="true">
                    <Icon name={no ? 'cross' : 'check'} size={13} />
                  </span>
                  <div>
                    <strong>{label}</strong>
                    <p>{text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Dialog>
      ) : null}
    </>
  );
}
