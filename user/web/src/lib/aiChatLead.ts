export type ChatLang = 'en' | 'ta';

export type BrandVariantId = 'nesam' | 'onewaycarrentals' | 'people_taxi';

export interface AiLeadCustomer {
  name?: string;
  phone?: string;
  email?: string;
}

export interface AiLeadTripContext {
  pickup?: string;
  drop?: string;
  service?: string;
}

export interface AiChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiLeadFormDraft {
  name: string;
  phone: string;
  notes: string;
}

export type AiLeadField = keyof AiLeadFormDraft;
export type AiLeadErrors = Partial<Record<AiLeadField, string>>;

const CLIENT_HUMAN_REQUEST_RE = /\b(human|agent|representative|executive|manager|support team|travel desk|call ?back|call me|speak to|talk to (?:someone|a person)|contact office|cust(?:omer)? ?care)\b|கால்|பேச|தொடர்பு/i;
const CLIENT_UNCERTAIN_REPLY_RE = /\b(couldn'?t(?: quite)? understand|could not understand|can'?t understand|unable to (?:verify|confirm|answer|help with that)|not sure|unsure|don'?t have(?: access to)? live|do not have live|don'?t know|do not know|cannot check|cannot confirm|ask (?:the |our )?travel desk|contact (?:our |the )?(?:travel desk|team|support|office)|call us on|share your (?:contact |)details|puriyala|theriyala|purinjuka)\b|புரிந்துகொள்ள முடியவில்லை|தெரியவில்லை|உறுதிப்படுத்த|தொடர்பு கொள்ள/i;

export function detectClientConfusion(opts: {
  serverConfused?: boolean;
  confusionReason?: string;
  replyText: string;
  userQuery: string;
  requestFailed?: boolean;
}): { confused: boolean; reason?: string } {
  if (opts.requestFailed) return { confused: true, reason: 'ai_unavailable' };
  if (typeof opts.serverConfused === 'boolean') {
    return opts.serverConfused
      ? { confused: true, reason: opts.confusionReason || 'ai_escalated' }
      : { confused: false };
  }
  if (CLIENT_HUMAN_REQUEST_RE.test(opts.userQuery)) {
    return { confused: true, reason: 'human_requested' };
  }
  if (CLIENT_UNCERTAIN_REPLY_RE.test(opts.replyText)) {
    return { confused: true, reason: 'ai_uncertain' };
  }
  return { confused: false };
}

export function isValidLeadPhone(raw: string): boolean {
  const cleaned = raw.trim();
  if (!/^\+?[0-9\s()-]{10,18}$/.test(cleaned)) return false;
  const digits = cleaned.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

const VALIDATION_TEXT: Record<ChatLang, Record<'name' | 'phone' | 'notes', string>> = {
  en: {
    name: 'Enter your name (at least 2 characters).',
    phone: 'Enter a valid 10-digit mobile number.',
    notes: 'Tell us briefly what you need help with (at least 4 characters).',
  },
  ta: {
    name: 'உங்கள் பெயரை உள்ளிடவும் (குறைந்தது 2 எழுத்துகள்).',
    phone: 'சரியான 10 இலக்க மொபைல் எண்ணை உள்ளிடவும்.',
    notes: 'என்ன உதவி வேண்டும் என்பதைச் சுருக்கமாக உள்ளிடவும் (குறைந்தது 4 எழுத்துகள்).',
  },
};

export function validateAiLeadField(field: AiLeadField, value: string, lang: ChatLang): string | undefined {
  const msg = VALIDATION_TEXT[lang];
  const trimmed = value.trim();
  if (field === 'name') return trimmed.length >= 2 ? undefined : msg.name;
  if (field === 'phone') return isValidLeadPhone(trimmed) ? undefined : msg.phone;
  return trimmed.length >= 4 ? undefined : msg.notes;
}

export function validateAiLeadForm(draft: AiLeadFormDraft, lang: ChatLang): AiLeadErrors {
  const errors: AiLeadErrors = {};
  for (const field of ['name', 'phone', 'notes'] as const) {
    const err = validateAiLeadField(field, draft[field], lang);
    if (err) errors[field] = err;
  }
  return errors;
}

export function compactTripContext(ctx?: AiLeadTripContext): AiLeadTripContext | undefined {
  if (!ctx) return undefined;
  const pickup = ctx.pickup?.trim().slice(0, 150) || '';
  const drop = ctx.drop?.trim().slice(0, 150) || '';
  const service = ctx.service?.trim().slice(0, 80) || '';
  if (!pickup && !drop && !service) return undefined;
  return {
    ...(service ? { service } : {}),
    ...(pickup ? { pickup } : {}),
    ...(drop ? { drop } : {}),
  };
}

export function buildAiLeadSubmission(opts: {
  brandId: BrandVariantId;
  draft: AiLeadFormDraft;
  email?: string;
  lang: ChatLang;
  aiQuestion: string;
  aiReply: string;
  reason?: string;
  tripContext?: AiLeadTripContext;
  pagePath?: string;
  messages: AiChatHistoryMessage[];
  website?: string;
}) {
  const tripContext = compactTripContext(opts.tripContext);
  const question = opts.aiQuestion.trim().slice(0, 600);
  const reply = opts.aiReply.trim().slice(0, 800);
  const notes = opts.draft.notes.trim() || question;

  return {
    brand: opts.brandId,
    name: opts.draft.name.trim().slice(0, 80),
    phone: opts.draft.phone.trim().slice(0, 20),
    ...(opts.email?.trim() ? { email: opts.email.trim().slice(0, 120) } : {}),
    category: 'AI assistant lead',
    source: 'ai-chat',
    message: notes.slice(0, 2000),
    ...(opts.website ? { website: opts.website } : {}),
    aiLead: {
      ...(question ? { question } : {}),
      ...(reply ? { reply } : {}),
      reason: opts.reason || 'ai_confused',
      language: opts.lang,
      ...(opts.pagePath ? { pagePath: opts.pagePath.slice(0, 160) } : {}),
      ...(tripContext ? { tripContext } : {}),
      messages: opts.messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content.trim().slice(0, 500),
      })),
    },
  };
}
