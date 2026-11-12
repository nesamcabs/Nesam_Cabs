// The profile drawer, opened by the header's menu button: the compact profile row and the account menu (the same
// content as /account). Tapping the pencil or Emergency contact expands that edit form right below it, in the drawer.
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { AccountPage } from '@/pages/AccountPage';

const FOCUSABLE = 'a[href],button:not([disabled]),summary,input:not([type="hidden"]):not([hidden])';

export function SideDrawer({ open, onClose, brand }: { open: boolean; onClose: () => void; brand: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="drawer drawer--profile" onKeyDown={onKey}>
      <div className="drawer__backdrop" onClick={onClose} />
      <div className="drawer__panel" role="dialog" aria-modal="true" aria-label="Profile" ref={panel}>
        <div className="drawer__head">
          <span onClick={onClose}>{brand}</span>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="Close profile" data-autofocus>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="drawer__body">
          <AccountPage variant="drawer" onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
