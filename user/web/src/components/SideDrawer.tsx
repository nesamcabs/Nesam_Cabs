// The profile drawer, opened by the header's menu button: the compact profile row and the account menu (the same
// content as /account). Tapping the pencil or Emergency contact widens the drawer and shows that edit form in place,
// with a way back to the menu.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { AccountPage, type ProfileEditView } from '@/pages/AccountPage';
import { EmergencyContactForm, PersonalDetailsForm } from './ProfileForms';

const FOCUSABLE = 'a[href],button:not([disabled]),summary,input:not([type="hidden"]):not([hidden])';
const TITLE: Record<ProfileEditView, string> = { details: 'Edit profile', emergency: 'Emergency contact' };

export function SideDrawer({ open, onClose, brand }: { open: boolean; onClose: () => void; brand: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ProfileEditView | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
      setView(null);
    };
  }, [open]);

  // The form's first editable field takes the focus when it opens.
  useEffect(() => {
    if (!view) return undefined;
    const t = window.setTimeout(() => panel.current?.querySelector<HTMLElement>('.simple-form input:not([readonly])')?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [view]);

  if (!open) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (view) setView(null);
      else onClose();
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
      <div className={`drawer__panel ${view ? 'drawer__panel--wide' : ''}`} role="dialog" aria-modal="true" aria-label={view ? TITLE[view] : 'Profile'} ref={panel}>
        <div className="drawer__head">
          {view ? (
            <>
              <button type="button" className="drawer__back" onClick={() => setView(null)} aria-label="Back to profile menu">
                <Icon name="arrow-left" size={18} />
              </button>
              <strong className="drawer__title">{TITLE[view]}</strong>
            </>
          ) : (
            <span onClick={onClose}>{brand}</span>
          )}
          <button type="button" className="drawer__close" onClick={onClose} aria-label="Close profile" data-autofocus>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="drawer__body">
          {view === 'details' ? <PersonalDetailsForm onDone={() => setView(null)} onCancel={() => setView(null)} /> : null}
          {view === 'emergency' ? <EmergencyContactForm onDone={() => setView(null)} onCancel={() => setView(null)} /> : null}
          {view ? null : <AccountPage variant="drawer" onEdit={setView} />}
        </div>
      </div>
    </div>
  );
}
