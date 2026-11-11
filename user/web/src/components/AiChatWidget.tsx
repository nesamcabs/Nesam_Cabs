// The AI travel assistant chat, shared by NESAM Cabs, One Way Car Rentals and People Taxi: each site
// passes its own brand text (see its AiChatbot.tsx) and icon set. English and Tamil.
import { useEffect, useId, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import { callFunction } from '@core/services/callables';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import {
  buildAiLeadSubmission,
  compactTripContext,
  detectClientConfusion,
  validateAiLeadField,
  validateAiLeadForm,
  type AiLeadCustomer,
  type AiLeadErrors,
  type AiLeadField,
  type AiLeadFormDraft,
  type AiLeadTripContext,
  type ChatLang,
} from '@/lib/aiChatLead';

export type { ChatLang };

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
  canOfferLead?: boolean;
}

interface LeadCaptureState {
  question: string;
  reply: string;
  reason: string;
}

/** The chat window's own words, per language. */
const UI: Record<ChatLang, Record<string, string>> = {
  en: {
    online: 'Travel help',
    groq: 'Powered by Groq AI',
    quick: 'Basic answers · AI unavailable',
    ready: 'Ask about your journey',
    limited: 'AI is unavailable right now. These are basic travel answers; leave your details below if you need personal help.',
    open: 'Open AI Travel Assistant',
    close: 'Close AI Travel Assistant',
    closeChat: 'Close chat',
    askAi: 'Ask AI',
    send: 'Send message',
    language: 'Language',
    callLabel: 'Call support',
    offline: "You're offline. Check your connection or leave your details once back online.",
    fail: `I couldn't reach the assistant just now. Leave your phone number below for a quick callback, or call **${SUPPORT_PHONE_DISPLAY}**.`,
    busy: 'You are sending messages too quickly. Please wait a moment.',
    leadTitle: 'Get a quick callback from our travel desk',
    leadSub: 'Share your contact details so our team can assist you directly.',
    leadName: 'Your name',
    leadNamePh: 'Enter your name',
    leadPhone: 'Mobile number',
    leadPhonePh: '+91 98765 43210',
    leadNotes: 'How can we help?',
    leadNotesPh: 'Route, date, car preference or question…',
    leadSubmit: 'Send to support team',
    leadSending: 'Sending…',
    leadDismiss: 'Dismiss form',
    leadAskHuman: 'Need human help? Request callback',
    leadFail: 'Could not submit right now. Please try again or call us directly.',
  },
  ta: {
    online: 'பயண உதவி',
    groq: 'Groq AI இயக்கம்',
    quick: 'அடிப்படை பதில்கள் · AI கிடைக்கவில்லை',
    ready: 'உங்கள் பயணம் பற்றிக் கேளுங்கள்',
    limited: 'AI இப்போது கிடைக்கவில்லை. தனிப்பட்ட உதவிக்கு கீழே உங்கள் விவரங்களை அனுப்பலாம்.',
    open: 'AI பயண உதவியாளரைத் திறக்க',
    close: 'AI பயண உதவியாளரை மூட',
    closeChat: 'அரட்டையை மூடு',
    askAi: 'AI உதவி',
    send: 'செய்தியை அனுப்பு',
    language: 'மொழி',
    callLabel: 'ஆதரவை அழைக்க',
    offline: 'இணைய இணைப்பு இல்லை. இணைப்பைச் சரிபார்த்து மீண்டும் முயலவும்.',
    fail: `உதவியாளரை இப்போது அடைய முடியவில்லை. கீழே உங்கள் எண்ணைப் பகிரவும் அல்லது **${SUPPORT_PHONE_DISPLAY}** ஐ அழைக்கவும்.`,
    busy: 'மிக வேகமாகச் செய்திகளை அனுப்புகிறீர்கள். சிறிது நேரம் காத்திருக்கவும்.',
    leadTitle: 'எங்கள் பயணக் குழுவிடமிருந்து உடனடி அழைப்பைப் பெறுங்கள்',
    leadSub: 'உங்கள் விவரங்களைப் பகிர்ந்தால் எங்கள் குழு நேரடியாக உதவும்.',
    leadName: 'உங்கள் பெயர்',
    leadNamePh: 'உங்கள் பெயரை உள்ளிடவும்',
    leadPhone: 'மொபைல் எண்',
    leadPhonePh: '+91 98765 43210',
    leadNotes: 'என்ன உதவி வேண்டும்?',
    leadNotesPh: 'பயண வழி, தேதி, கார் அல்லது கேள்வி…',
    leadSubmit: 'உதவி குழுவுக்கு அனுப்பு',
    leadSending: 'அனுப்புகிறது…',
    leadDismiss: 'படிவத்தை மூடு',
    leadAskHuman: 'நேரடி உதவி வேண்டுமா? கால்பேக் கேளுங்கள்',
    leadFail: 'இப்போது அனுப்ப முடியவில்லை. மீண்டும் முயலவும் அல்லது எங்களை அழைக்கவும்.',
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
    } else {
      out.push(m[2]);
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

function renderChat(text: string): ReactNode {
  return text.split('\n').map((raw, i) => {
    const bullet = /^\s*[•-]\s+(.*)$/.exec(raw);
    if (bullet) {
      return (
        <ul key={i} className="chat-list">
          <li className="chat-bullet">
            <span aria-hidden="true">•</span>
            <span>{inline(bullet[1]!, `b${i}`)}</span>
          </li>
        </ul>
      );
    }
    if (!raw.trim()) return <div key={i} className="chat-gap" />;
    return (
      <p key={i} className="chat-paragraph">
        {inline(raw, `p${i}`)}
      </p>
    );
  });
}

function Sparkle({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12 2l2.1 5.9L20 10l-5.9 2.1L12 18l-2.1-5.9L4 10l5.9-2.1z" />
      <path d="M19 2l.9 2.1L22 5l-2.1.9L19 8l-.9-2.1L16 5l2.1-.9z" />
    </svg>
  );
}

// ── The widget ───────────────────────────────────────────────────────────────

export function AiChatWidget({
  brand,
  Icon,
  closeIcon = 'close',
  open: controlledOpen,
  onOpenChange,
  hideLauncher = false,
  customer,
  tripContext,
}: {
  brand: ChatBrand;
  Icon: IconComponent;
  closeIcon?: string;
  /** When given, the page decides when the chat is open (for example from a header menu). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Drop the floating "Ask AI" button; something else opens the chat. */
  hideLauncher?: boolean;
  /** Optional signed-in profile hints used to pre-fill callback leads. */
  customer?: AiLeadCustomer;
  /** Optional active trip draft shown to the AI and recorded on escalated leads. */
  tripContext?: AiLeadTripContext;
}) {
  const [lang, setLang] = useState<ChatLang>(readLang);
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (next: boolean | ((cur: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next;
    setInnerOpen(value);
    onOpenChange?.(value);
  };
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState('');
  const [messages, setMessages] = useState<Message[]>(() => [{ id: 'welcome', role: 'assistant', content: brand.welcome[readLang()], time: formatTime() }]);

  const [leadCapture, setLeadCapture] = useState<LeadCaptureState | null>(null);
  const [leadDraft, setLeadDraft] = useState<AiLeadFormDraft>({
    name: customer?.name?.trim() ?? '',
    phone: customer?.phone?.trim() ?? '',
    notes: '',
  });
  const [leadTouched, setLeadTouched] = useState<Partial<Record<AiLeadField, boolean>>>({});
  const [leadAttempted, setLeadAttempted] = useState(false);
  const [submittingLead, setSubmittingLead] = useState(false);
  const [leadSubmitError, setLeadSubmitError] = useState('');
  const [honeypot, setHoneypot] = useState('');

  const uidPrefix = useId();
  const leadTitleId = `${uidPrefix}-lead-title`;
  const leadNameId = `${uidPrefix}-lead-name`;
  const leadPhoneId = `${uidPrefix}-lead-phone`;
  const leadNotesId = `${uidPrefix}-lead-notes`;

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const leadNameRef = useRef<HTMLInputElement>(null);
  const leadPhoneRef = useRef<HTMLInputElement>(null);
  const leadNotesRef = useRef<HTMLTextAreaElement>(null);
  const win = useRef<HTMLDivElement>(null);
  const t = UI[lang];

  // Pre-fill signed-in profile values when available without overwriting user edits.
  useEffect(() => {
    setLeadDraft((cur) => ({
      name: cur.name || customer?.name?.trim() || '',
      phone: cur.phone || customer?.phone?.trim() || '',
      notes: cur.notes,
    }));
  }, [customer?.name, customer?.phone]);

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [open, messages, loading, leadCapture]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [open]);

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

  const reply = (content: string, id: string, localOnly = false, canOfferLead = false) =>
    setMessages((prev) => [...prev, { id, role: 'assistant', content, time: formatTime(), localOnly, canOfferLead }]);

  const openLeadForm = (question: string, replyText: string, reason: string) => {
    setLeadCapture({ question, reply: replyText, reason });
    setLeadDraft((cur) => ({
      name: cur.name || customer?.name?.trim() || '',
      phone: cur.phone || customer?.phone?.trim() || '',
      notes: question.trim(),
    }));
    setLeadTouched({});
    setLeadAttempted(false);
    setLeadSubmitError('');
  };

  const send = async (textToSend?: string) => {
    const q = (textToSend ?? input).trim();
    if (!q || loading) return;
    const history = [...messages, { id: `u_${Date.now()}`, role: 'user' as const, content: q, time: formatTime() }];
    setMessages(history);
    setInput('');

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setProvider('fallback_error');
      reply(t.offline!, `err_${Date.now()}`, true, true);
      openLeadForm(q, t.offline!, 'offline');
      return;
    }
    setLoading(true);
    console.info('[AI Chat] Sending message', { brand: brand.id, language: lang, historyLength: history.length });
    const ctx = compactTripContext(tripContext);
    try {
      const res = await callFunction<
        { brand: string; language: ChatLang; context?: AiLeadTripContext; messages: Array<{ role: 'user' | 'assistant'; content: string }> },
        { message: string; provider: string; confused?: boolean; confusionReason?: string }
      >('chatWithBot', {
        brand: brand.id,
        language: lang,
        ...(ctx ? { context: ctx } : {}),
        // The greeting is scripted, not part of the conversation.
        messages: history.filter((m) => m.id !== 'welcome' && !m.localOnly).slice(-20).map((m) => ({ role: m.role, content: m.content })),
      });
      const replyText = res?.message || t.fail!;
      setProvider(res?.provider ?? '');
      console.info('[AI Chat] Response received', { brand: brand.id, provider: res?.provider ?? 'unknown', confused: res?.confused });
      const confusion = detectClientConfusion({
        serverConfused: res?.confused,
        confusionReason: res?.confusionReason,
        replyText,
        userQuery: q,
      });
      reply(replyText, `a_${Date.now()}`, res?.provider !== 'groq', !confusion.confused);
      if (confusion.confused) {
        openLeadForm(q, replyText, confusion.reason || 'ai_confused');
      }
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      console.error('[AI Chat] Request failed', { brand: brand.id, code, message: (err as Error)?.message });
      setProvider('fallback_error');
      const errReply = code.includes('resource-exhausted') ? t.busy! : t.fail!;
      reply(errReply, `err_${Date.now()}`, true, true);
      if (!code.includes('resource-exhausted')) {
        openLeadForm(q, errReply, 'ai_unavailable');
      }
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };

  const setField = (field: AiLeadField, value: string) => {
    setLeadDraft((cur) => ({ ...cur, [field]: value }));
    if (leadSubmitError) setLeadSubmitError('');
  };

  const markTouched = (field: AiLeadField) => {
    setLeadTouched((cur) => (cur[field] ? cur : { ...cur, [field]: true }));
  };

  const fieldError = (field: AiLeadField): string | undefined => {
    if (!leadTouched[field] && !leadAttempted) return undefined;
    return validateAiLeadField(field, leadDraft[field], lang);
  };

  const onLeadSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!leadCapture || submittingLead) return;
    setLeadAttempted(true);
    setLeadSubmitError('');

    const errors: AiLeadErrors = validateAiLeadForm(leadDraft, lang);
    if (errors.name || errors.phone || errors.notes) {
      if (errors.name) leadNameRef.current?.focus();
      else if (errors.phone) leadPhoneRef.current?.focus();
      else if (errors.notes) leadNotesRef.current?.focus();
      return;
    }

    setSubmittingLead(true);
    try {
      const payload = buildAiLeadSubmission({
        brandId: brand.id,
        draft: leadDraft,
        email: customer?.email,
        lang,
        aiQuestion: leadCapture.question,
        aiReply: leadCapture.reply,
        reason: leadCapture.reason,
        tripContext,
        pagePath: typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : undefined,
        messages: messages.filter((m) => m.id !== 'welcome').map((m) => ({ role: m.role, content: m.content })),
        website: honeypot,
      });
      const res = await callFunction<typeof payload, { id: string }>('submitSupportRequest', payload);
      const refCode = res?.id ? res.id.slice(0, 8).toUpperCase() : '';
      const confirmation =
        lang === 'ta'
          ? `நன்றி **${leadDraft.name.trim()}**! உங்கள் தகவல்${refCode ? ` (#${refCode})` : ''} எங்கள் உதவி குழுவுக்கு அனுப்பப்பட்டது. **${leadDraft.phone.trim()}** எண்ணில் விரைவில் அழைப்போம்.`
          : `Thank you, **${leadDraft.name.trim()}**! Your request${refCode ? ` (#${refCode})` : ''} has been sent to our support desk. Our team will reach out on **${leadDraft.phone.trim()}** shortly.`;
      setLeadCapture(null);
      setLeadDraft((cur) => ({ ...cur, notes: '' }));
      setLeadTouched({});
      setLeadAttempted(false);
      reply(confirmation, `lead_ok_${Date.now()}`, true);
      inputRef.current?.focus({ preventScroll: true });
    } catch (err) {
      const message = (err as Error)?.message?.trim() || t.leadFail!;
      setLeadSubmitError(message);
    } finally {
      setSubmittingLead(false);
    }
  };

  const nameErr = fieldError('name');
  const phoneErr = fieldError('phone');
  const notesErr = fieldError('notes');
  const latestUserQuestion = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const latestAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <>
      {hideLauncher ? null : (
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
      )}

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
                <div className="chat-bubble__meta">
                  <span className="chat-bubble__time">{m.time}</span>
                  {m.canOfferLead && m.id === latestAssistantId && !leadCapture && (
                    <button
                      type="button"
                      className="ai-lead-trigger"
                      onClick={() => openLeadForm(latestUserQuestion || m.content, m.content, 'human_requested')}
                    >
                      {t.leadAskHuman}
                    </button>
                  )}
                </div>
              </div>
            ))}

            {leadCapture && (
              <form className="ai-lead-card" onSubmit={onLeadSubmit} noValidate aria-labelledby={leadTitleId}>
                <div className="ai-lead-card__head">
                  <div>
                    <strong id={leadTitleId} className="ai-lead-card__title">{t.leadTitle}</strong>
                    <p className="ai-lead-card__sub">{t.leadSub}</p>
                  </div>
                  <button
                    type="button"
                    className="ai-lead-card__dismiss"
                    onClick={() => setLeadCapture(null)}
                    aria-label={t.leadDismiss}
                    title={t.leadDismiss}
                  >
                    <Icon name={closeIcon} size={15} />
                  </button>
                </div>

                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  className="ai-lead-honeypot"
                  aria-hidden="true"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                />

                {leadSubmitError && (
                  <div className="ai-lead-alert" role="alert" aria-live="assertive">
                    <span className="ai-lead-alert__mark" aria-hidden="true">!</span>
                    <span>{leadSubmitError}</span>
                  </div>
                )}

                <div className="ai-lead-field">
                  <label htmlFor={leadNameId} className="ai-lead-label">{t.leadName}</label>
                  <input
                    id={leadNameId}
                    ref={leadNameRef}
                    type="text"
                    name="leadName"
                    autoComplete="name"
                    required
                    minLength={2}
                    maxLength={80}
                    className={`ai-lead-control ${nameErr ? 'is-invalid' : ''}`}
                    value={leadDraft.name}
                    placeholder={t.leadNamePh}
                    onChange={(e) => setField('name', e.target.value)}
                    onBlur={() => markTouched('name')}
                    aria-invalid={nameErr ? true : undefined}
                    aria-describedby={nameErr ? `${leadNameId}-err` : undefined}
                    aria-errormessage={nameErr ? `${leadNameId}-err` : undefined}
                  />
                  {nameErr && (
                    <p id={`${leadNameId}-err`} className="ai-lead-error" role="alert">
                      <span aria-hidden="true">!</span> {nameErr}
                    </p>
                  )}
                </div>

                <div className="ai-lead-field">
                  <label htmlFor={leadPhoneId} className="ai-lead-label">{t.leadPhone}</label>
                  <input
                    id={leadPhoneId}
                    ref={leadPhoneRef}
                    type="tel"
                    inputMode="tel"
                    name="leadPhone"
                    autoComplete="tel"
                    required
                    pattern="[+0-9\s()-]{10,18}"
                    maxLength={20}
                    className={`ai-lead-control ${phoneErr ? 'is-invalid' : ''}`}
                    value={leadDraft.phone}
                    placeholder={t.leadPhonePh}
                    onChange={(e) => setField('phone', e.target.value)}
                    onBlur={() => markTouched('phone')}
                    aria-invalid={phoneErr ? true : undefined}
                    aria-describedby={phoneErr ? `${leadPhoneId}-err` : undefined}
                    aria-errormessage={phoneErr ? `${leadPhoneId}-err` : undefined}
                  />
                  {phoneErr && (
                    <p id={`${leadPhoneId}-err`} className="ai-lead-error" role="alert">
                      <span aria-hidden="true">!</span> {phoneErr}
                    </p>
                  )}
                </div>

                <div className="ai-lead-field">
                  <label htmlFor={leadNotesId} className="ai-lead-label">{t.leadNotes}</label>
                  <textarea
                    id={leadNotesId}
                    ref={leadNotesRef}
                    name="leadNotes"
                    rows={2}
                    required
                    minLength={4}
                    maxLength={600}
                    className={`ai-lead-control ai-lead-control--area ${notesErr ? 'is-invalid' : ''}`}
                    value={leadDraft.notes}
                    placeholder={t.leadNotesPh}
                    onChange={(e) => setField('notes', e.target.value)}
                    onBlur={() => markTouched('notes')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                    aria-invalid={notesErr ? true : undefined}
                    aria-describedby={notesErr ? `${leadNotesId}-err` : undefined}
                    aria-errormessage={notesErr ? `${leadNotesId}-err` : undefined}
                  />
                  {notesErr && (
                    <p id={`${leadNotesId}-err`} className="ai-lead-error" role="alert">
                      <span aria-hidden="true">!</span> {notesErr}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  className="ai-lead-submit"
                  disabled={submittingLead}
                  aria-busy={submittingLead || undefined}
                >
                  {submittingLead ? t.leadSending : t.leadSubmit}
                </button>
              </form>
            )}

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
