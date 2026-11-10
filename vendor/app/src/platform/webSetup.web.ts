// One-time browser set-up. Imported first by index.ts, before the app renders.
//
// Everything here only closes gaps between React Native and a browser:
//   1. Alert.alert is a no-op in react-native-web — replace it with a real dialog.
//   2. Linking.openURL('tel:' | 'sms:' | 'mailto:' …) should hand off to the OS
//      handler, not open a blank tab; whatsapp:// becomes a wa.me web link.
//   3. Share.share falls back to the clipboard where the browser has no share sheet.
//   4. Page-level CSS: full-viewport height that survives mobile browser chrome,
//      no rubber-band scrolling, visible keyboard focus.
// (Responsive layout itself lives in theme/responsive.ts and components/layout.tsx.)
import { Alert, Linking, Share, type AlertButton, type AlertOptions, type ShareContent } from 'react-native';
import { showDialog } from './domDialog';

function installAlert(): void {
  Alert.alert = (title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions): void => {
    const list = buttons?.length ? buttons : [{ text: 'OK' }];
    // Keep native ordering semantics: cancel first on a row, otherwise as given.
    showDialog({
      title,
      message,
      cancelable: options?.cancelable ?? true,
      onDismiss: options?.onDismiss,
      buttons: list.map((b) => ({
        text: b.text ?? 'OK',
        style: b.style === 'cancel' ? 'cancel' : b.style === 'destructive' ? 'destructive' : 'default',
        onPress: () => {
          b.onPress?.();
        },
      })),
    });
  };
}

const OS_SCHEMES = /^(tel|sms|mailto|upi|geo|intent):/i;

function installLinking(): void {
  const open = Linking.openURL.bind(Linking);
  Linking.openURL = async (url: string): Promise<void> => {
    // whatsapp://send?phone=91…&text=… has no handler in most browsers; wa.me does.
    const wa = /^whatsapp:\/\/send\?(.*)$/i.exec(url);
    if (wa) {
      const query = new URLSearchParams(wa[1]);
      const phone = (query.get('phone') ?? '').replace(/\D/g, '');
      const text = query.get('text');
      return open(`https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`);
    }
    if (OS_SCHEMES.test(url)) {
      // Same-tab navigation to a non-http scheme opens the handler app (dialler,
      // mail client, UPI app…) without leaving the page.
      window.location.href = url;
      return;
    }
    return open(url);
  };
}

function installShare(): void {
  Share.share = async (content: ShareContent, options?: { dialogTitle?: string }) => {
    const text = [content.message, 'url' in content ? content.url : ''].filter(Boolean).join('\n');
    const title = content.title ?? options?.dialogTitle ?? '';
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text });
        return { action: Share.sharedAction };
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return { action: Share.dismissedAction };
        // Any other failure: fall through to the clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      Alert.alert('Copied', 'The details were copied to your clipboard — paste them into a message to share.');
    } catch {
      Alert.alert(title || 'Share', text);
    }
    return { action: Share.sharedAction };
  };
}

function installLayout(): void {
  const style = document.createElement('style');
  style.id = 'nesam-web-layout';
  style.textContent = `
    html, body { background: #F7F7F7; overscroll-behavior: none; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
    body { overflow: hidden; }
    /* 100dvh tracks the visible area on phones whose address bar collapses. */
    html, body, #root { height: 100%; }
    @supports (height: 100dvh) { html, body, #root { height: 100dvh; } }
    input, textarea, select, button { font-family: inherit; }
    /* Native inputs have an intrinsic width; without this a flex row of input + button overflows on narrow phones. */
    input, textarea, select { min-width: 0; }
    /* Keyboard users get a visible focus ring; mouse and touch users do not. */
    :focus { outline: none; }
    :focus-visible:not(input):not(textarea):not(select) { outline: 2px solid #E31E24; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
  `;
  document.head.appendChild(style);
}

installAlert();
installLinking();
installShare();
if (typeof document !== 'undefined') installLayout();
