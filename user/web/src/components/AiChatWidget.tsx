// The AI travel assistant chat, shared by NESAM Cabs, One Way Car Rentals and People Taxi: each site
// passes its own brand text (see its AiChatbot.tsx) and icon set. English and Tamil.
import { useEffect, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import { callFunction } from '@core/services/callables';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';

export type ChatLang = 'en' | 'ta';

export interface ChatBrand {
  /** Sent to the server so it answers as this brand. */
  id: 'nesam' | 'onewaycarrentals' | 'people_taxi';
  /** Colour theme class suffix: floating-ai-launcher--{variant}. */
  variant: 'nesam' | 'oneway' | 'people';
  assistantName: string;
  welcome: Record<ChatLang, string>;
  prompts: Record<ChatLang, string[]>;
  placeholder: Record<ChatLang, string>;
}

type IconComponent = ComponentType<{ name: string; size?: number }>;

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  time: string;
  localOnly?: boolean;
}

/** The chat window's own words, per language. */
const UI: Record<ChatLang, Record<string, string>> = {
  en: {
    online: 'Travel help',
    groq: 'Powered by Groq AI',
    quick: 'Basic answers · AI unavailable',
    ready: 'Ask about your journey',
    limited: 'AI is unavailable right now. These are basic travel answers; detailed follow-ups may need our support team.',
    open: 'Open AI Travel Assistant',
    close: 'Close AI Travel Assistant',
    closeChat: 'Close chat',
    askAi: 'Ask AI',
    send: 'Send message',
    language: 'Language',
    callLabel: 'Call support',
    offline: "You're offline. Check your connection and try again.",
    fail: `I couldn't reach the assistant just now. You can call our 24/7 desk on **${SUPPORT_PHONE_DISPLAY}** or use the booking form on the home page.`,
    busy: 'You are sending messages too quickly. Please wait a moment.',
  },
  ta: {
    online: 'பயண உதவி',
    groq: 'Groq AI இயக்கம்',
    quick: 'அடிப்படை பதில்கள் · AI கிடைக்கவில்லை',
    ready: 'உங்கள் பயணம் பற்றிக் கேளுங்கள்',
    limited: 'AI இப்போது கிடைக்கவில்லை. இவை அடிப்படை பயண பதில்கள்; கூடுதல் உதவிக்கு எங்கள் குழுவைத் தொடர்புகொள்ளுங்கள்.',
    open: 'AI பயண உதவியாளரைத் திறக்க',
    close: 'AI பயண உதவியாளரை மூட',
    closeChat: 'அரட்டையை மூடு',
    askAi: 'AI உதவி',
    send: 'செய்தியை அனுப்பு',
    language: 'மொழி',
    callLabel: 'ஆதரவை அழைக்க',
    offline: 'இணைய இணைப்பு இல்லை. இணைப்பைச் சரிபார்த்து மீண்டும் முயலவும்.',
    fail: `உதவியாளரை இப்போது அடைய முடியவில்லை. எங்கள் 24/7 எண் **${SUPPORT_PHONE_DISPLAY}** ஐ அழைக்கவும் அல்லது முகப்புப் பக்கத்தின் புக்கிங் படிவத்தைப் பயன்படுத்தவும்.`,
    busy: 'மிக வேகமாகச் செய்திகளை அனுப்புகிறீர்கள். சிறிது நேரம் காத்திருக்கவும்.',
  },
};

const LANG_KEY = 'nesam.chat.lang';
const readLang = (): ChatLang => {
  try {
    return localStorage.getItem(LANG_KEY) === 'ta' ? 'ta' : 'en';
  } catch {
    return 'en';
  }
};

const formatTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// ── Safe formatting ──────────────────────────────────────────────────────────
// The assistant's text is shown as React elements, never as HTML: **bold**, [links](https://…) and
// bullet lines are recognised, and only web, phone and email links are made clickable.

const SAFE_LINK = /^(https?:|tel:|mailto:)/i;

function inline(line: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const key = `${keyBase}-${n++}`;
    if (m[1] !== undefined) out.push(<strong key={key}>{m[1]}</strong>);
    else if (SAFE_LINK.test(m[3]!)) {
      out.push(
        <a key={key} href={m[3]} className="chat-link" target="_blank" rel="noopener noreferrer">
          {m[2]}
        </a>,
      );
    } else out.push(m[2]);
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

function renderChat(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let bullets: ReactNode[] = [];
  const flush = (key: string) => {
    if (bullets.length) nodes.push(<ul key={`ul-${key}`} className="chat-list">{bullets}</ul>);
    bullets = [];
  };
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    const bullet = /^([•\-*]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(<li key={`li-${i}`} className="chat-bullet">{inline(bullet[2]!, `b${i}`)}</li>);
      return;
    }
    flush(String(i));
    if (!line) nodes.push(<div key={`sp-${i}`} className="chat-spacer" />);
    else nodes.push(<p key={`p-${i}`} className="chat-paragraph">{inline(line, `p${i}`)}</p>);
  });
  flush('end');
  return nodes;
}

/** The assistant's sparkle mark: a drawn icon, so it looks the same on every phone (no emoji font). */
function Sparkle({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className="ai-glyph">
      <path d="M10 3l2 6.2 6.2 2-6.2 2-2 6.2-2-6.2-6.2-2 6.2-2z" />
      <path d="M19 2l.9 2.1L22 5l-2.1.9L19 8l-.9-2.1L16 5l2.1-.9z" />
    </svg>
  );
}

// ── The widget ───────────────────────────────────────────────────────────────

export function AiChatWidget({ brand, Icon, closeIcon = 'close' }: { brand: ChatBrand; Icon: IconComponent; closeIcon?: string }) {
  const [lang, setLang] = useState<ChatLang>(readLang);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState('');
  const [messages, setMessages] = useState<Message[]>(() => [{ id: 'welcome', role: 'assistant', content: brand.welcome[readLang()], time: formatTime() }]);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const win = useRef<HTMLDivElement>(null);
  const t = UI[lang];

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    inputRef.current?.focus({ preventScroll: true });
  }, [open, messages, loading]);

  // On a phone the window floats above the on-screen keyboard: the keyboard's height and the visible
  // height are handed to the stylesheet, and the latest message stays in view.
  useEffect(() => {
    if (!open) return undefined;
    const vv = window.visualViewport;
    const el = win.current;
    if (!vv || !el) return undefined;
    const fit = () => {
      el.style.setProperty('--kb', `${Math.round(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))}px`);
      el.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      endRef.current?.scrollIntoView({ block: 'end' });
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
    };
  }, [open]);

  // Escape closes the chat.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const chooseLang = (next: ChatLang) => {
    if (next === lang) return;
    setLang(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* the choice just isn't remembered */
    }
    // Until the rider has said something, the greeting follows the language.
    setMessages((cur) => (cur.length === 1 && cur[0]!.id === 'welcome' ? [{ ...cur[0]!, content: brand.welcome[next] }] : cur));
  };

  const reply = (content: string, id: string, localOnly = false) => setMessages((prev) => [...prev, { id, role: 'assistant', content, time: formatTime(), localOnly }]);

  const send = async (textToSend?: string) => {
    const q = (textToSend ?? input).trim();
    if (!q || loading) return;
    const history = [...messages, { id: `u_${Date.now()}`, role: 'user' as const, content: q, time: formatTime() }];
    setMessages(history);
    setInput('');

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setProvider('fallback_error');
      reply(t.offline!, `err_${Date.now()}`, true);
      return;
    }
    setLoading(true);
    console.info('[AI Chat] Sending message', { brand: brand.id, language: lang, historyLength: history.length });
    try {
      const res = await callFunction<
        { brand: string; language: ChatLang; messages: Array<{ role: 'user' | 'assistant'; content: string }> },
        { message: string; provider: string }
      >('chatWithBot', {
        brand: brand.id,
        language: lang,
        // The greeting is scripted, not part of the conversation.
        messages: history.filter((m) => m.id !== 'welcome' && !m.localOnly).slice(-20).map((m) => ({ role: m.role, content: m.content })),
      });
      setProvider(res?.provider ?? '');
      console.info('[AI Chat] Response received', { brand: brand.id, provider: res?.provider ?? 'unknown' });
      reply(res?.message || t.fail!, `a_${Date.now()}`, res?.provider !== 'groq');
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      console.error('[AI Chat] Request failed', { brand: brand.id, code, message: (err as Error)?.message });
      setProvider('fallback_error');
      reply(code.includes('resource-exhausted') ? t.busy! : t.fail!, `err_${Date.now()}`, true);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };

  return (
    <>
      <button
        type="button"
        className={`floating-ai-launcher floating-ai-launcher--${brand.variant} ${open ? 'is-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? t.close : t.open}
        aria-expanded={open}
        title={brand.assistantName}
      >
        <span className="floating-ai-launcher__sparkle" aria-hidden="true">
          {open ? <Icon name={closeIcon} size={20} /> : <Sparkle size={22} />}
        </span>
        <span className="floating-ai-launcher__text">{open ? t.closeChat : t.askAi}</span>
        {!open && <span className="floating-ai-launcher__pulse" aria-hidden="true" />}
      </button>

      {open && (
        <div ref={win} className={`ai-chat-window ai-chat-window--${brand.variant}`} role="dialog" aria-label={brand.assistantName}>
          <div className="ai-chat-head">
            <div className="ai-chat-brand">
              <span className="ai-chat-avatar">
                <Sparkle size={17} />
              </span>
              <div>
                <strong>{brand.assistantName}</strong>
                <span className="ai-status">
                  <span className="ai-status-dot" /> {t.online} · {provider === 'groq' ? t.groq : provider ? t.quick : t.ready}
                </span>
              </div>
            </div>
            <div className="ai-chat-actions">
              <div className="ai-chat-lang" role="group" aria-label={t.language}>
                <button type="button" aria-pressed={lang === 'en'} onClick={() => chooseLang('en')}>EN</button>
                <button type="button" aria-pressed={lang === 'ta'} onClick={() => chooseLang('ta')} lang="ta">தமிழ்</button>
              </div>
              <a href={`tel:${SUPPORT_PHONE}`} className="ai-chat-call" title={`${t.callLabel}: ${SUPPORT_PHONE_DISPLAY}`} aria-label={`${t.callLabel}: ${SUPPORT_PHONE_DISPLAY}`}>
                <Icon name="phone" size={16} />
              </a>
              <button type="button" className="ai-chat-close" onClick={() => setOpen(false)} aria-label={t.closeChat}>
                <Icon name={closeIcon} size={18} />
              </button>
            </div>
          </div>

          <div className="ai-chat-prompts">
            {brand.prompts[lang].map((prompt) => (
              <button key={prompt} type="button" className="ai-prompt-pill" onClick={() => void send(prompt)} disabled={loading}>
                {prompt}
              </button>
            ))}
          </div>

          <div className="ai-chat-body" role="log" aria-live="polite" aria-relevant="additions">
            {provider && provider !== 'groq' && <p role="status" className="chat-paragraph">{t.limited}</p>}
            {messages.map((m) => (
              <div key={m.id} className={`chat-bubble chat-bubble--${m.role}`} lang={lang === 'ta' && m.role === 'assistant' ? 'ta' : undefined}>
                <div className="chat-bubble__content">{renderChat(m.content)}</div>
                <span className="chat-bubble__time">{m.time}</span>
              </div>
            ))}
            {loading && (
              <div className="chat-bubble chat-bubble--assistant chat-bubble--typing" aria-label="…">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form className="ai-chat-foot" onSubmit={onSubmit}>
            <input
              ref={inputRef}
              type="text"
              className="ai-chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={brand.placeholder[lang]}
              maxLength={500}
              aria-label={brand.placeholder[lang]}
              disabled={loading}
            />
            <button type="submit" className="ai-chat-send" disabled={!input.trim() || loading} aria-label={t.send}>
              <Icon name="send" size={17} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

export default AiChatWidget;
