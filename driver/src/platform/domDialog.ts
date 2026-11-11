// Browser-only dialog primitive (plain DOM, no React). react-native-web ships
// `Alert.alert` as a no-op and the native date picker has no web build, so the
// web build replaces both with this one accessible modal (see webSetup.web.ts
// and shims/datetimepicker.ts). Never imported on Android / iOS.

export interface DialogButton {
  text: string;
  /** 'cancel' buttons are muted and also run when the dialog is dismissed. */
  style?: 'default' | 'cancel' | 'destructive';
  /** Return false to keep the dialog open (used for validation). */
  onPress?: () => boolean | void;
}

export interface DialogOptions {
  title: string;
  message?: string;
  /** Extra content (e.g. a date input) rendered between the message and the buttons. */
  content?: HTMLElement;
  buttons: DialogButton[];
  /** Backdrop click / Escape dismiss the dialog. Default true. */
  cancelable?: boolean;
  onDismiss?: () => void;
}

const BRAND = '#E31E24';
const INK = '#111111';
const MUTED = '#6B7280';
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Opens the dialog and returns a function that closes it. */
export function showDialog(options: DialogOptions): () => void {
  const { title, message, content, buttons, cancelable = true, onDismiss } = options;
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const overlay = el(
    'div',
    `position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:rgba(17,17,17,0.55);font-family:${FONT};`,
  );
  const card = el(
    'div',
    'width:100%;max-width:340px;max-height:90vh;overflow:auto;background:#fff;border-radius:16px;padding:20px;box-sizing:border-box;box-shadow:0 20px 50px rgba(0,0,0,0.3);',
  );
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', title);
  card.appendChild(el('div', `font-size:17px;font-weight:800;color:${INK};line-height:1.3;`, title));
  if (message) card.appendChild(el('div', `margin-top:8px;font-size:14px;color:#374151;line-height:1.45;white-space:pre-wrap;`, message));
  if (content) {
    const wrap = el('div', 'margin-top:14px;');
    wrap.appendChild(content);
    card.appendChild(wrap);
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    try {
      previouslyFocused?.focus?.();
    } catch {
      /* element may be gone */
    }
  };
  const dismiss = () => {
    if (closed) return;
    close();
    // A dismissed dialog behaves like its cancel button, as on Android.
    const cancel = buttons.find((b) => b.style === 'cancel');
    if (cancel?.onPress) cancel.onPress();
    onDismiss?.();
  };
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && cancelable) {
      e.stopPropagation();
      dismiss();
    }
  }
  document.addEventListener('keydown', onKey, true);

  const row = el('div', `margin-top:18px;display:flex;flex-direction:${buttons.length > 2 ? 'column' : 'row'};gap:8px;justify-content:flex-end;`);
  const buttonEls = buttons.map((b) => {
    const isPrimary = b.style !== 'cancel';
    const color = b.style === 'destructive' ? '#D92D20' : isPrimary ? '#fff' : MUTED;
    const bg = b.style === 'destructive' ? '#FEF2F2' : isPrimary ? BRAND : '#F3F4F6';
    const node = el(
      'button',
      `flex:${buttons.length > 2 ? 'none' : '1'};min-height:44px;padding:0 16px;border:0;border-radius:12px;cursor:pointer;font:700 14px ${FONT};color:${color};background:${bg};`,
      b.text,
    );
    node.type = 'button';
    node.addEventListener('click', () => {
      const keepOpen = b.onPress ? b.onPress() === false : false;
      if (!keepOpen) close();
    });
    row.appendChild(node);
    return node;
  });
  card.appendChild(row);
  overlay.appendChild(card);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay && cancelable) dismiss();
  });
  document.body.appendChild(overlay);

  // Focus the first field in `content`, otherwise the last (primary) button.
  const field = content?.querySelector<HTMLElement>('input,select,textarea');
  (field ?? buttonEls[buttonEls.length - 1])?.focus();
  return close;
}
