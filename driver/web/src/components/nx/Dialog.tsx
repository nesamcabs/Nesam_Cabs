import React, { useEffect, useRef } from 'react';
import { Icon } from './Icon';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Blocks Escape / backdrop dismissal while something is saving. */
  locked?: boolean;
}

/** The reference's modal: a native <dialog>, closed by Escape, the ✕ button or a click on the backdrop. */
export const Dialog: React.FC<DialogProps> = ({ open, onClose, eyebrow, title, children, footer, locked = false }) => {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  const handleClose = () => {
    if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus({ preventScroll: true });
    onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onClose={handleClose}
      onCancel={(e) => {
        if (locked) e.preventDefault();
      }}
      onClick={(e) => {
        if (locked || e.target !== ref.current) return;
        const r = ref.current!.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) ref.current!.close();
      }}
    >
      {open && (
        <div className="dialog-layout">
          <div className="dialog-header">
            <div>
              <div className="eyebrow">{eyebrow}</div>
              <h2 id="dialog-title">{title}</h2>
            </div>
            <button type="button" className="icon-button" onClick={() => !locked && ref.current?.close()} aria-label="Close dialog" disabled={locked}>
              <Icon name="close" />
            </button>
          </div>
          <div className="dialog-body">{children}</div>
          {footer ? <div className="dialog-footer">{footer}</div> : null}
        </div>
      )}
    </dialog>
  );
};
