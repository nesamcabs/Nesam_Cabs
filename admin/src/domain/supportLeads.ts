import type { BadgeTone } from "../components/ui/Badge";

export type CustomerBrandId = "nesam" | "people_taxi" | "onewaycarrentals";

export interface SupportBrandMeta {
  id: CustomerBrandId;
  label: string;
  tone: BadgeTone;
}

export interface ParsedAiLead {
  question: string;
  reply: string;
  reason: string;
  tripLabel: string;
  pagePath: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Normalise the customer website/brand for a support ticket or AI chat lead. */
export function brandMetaOfTicket(raw: Record<string, unknown>): SupportBrandMeta {
  const token = `${str(raw.brand)} ${str(raw.bookingSource)}`.toLowerCase();
  if (token.includes("people")) return { id: "people_taxi", label: "People Taxi", tone: "blue" };
  if (token.includes("oneway") || token.includes("one_way") || token.includes("one way")) {
    return { id: "onewaycarrentals", label: "One Way Car Rentals", tone: "green" };
  }
  return { id: "nesam", label: "NESAM Cabs", tone: "red" };
}

/** True when a support ticket originated from an AI chatbot escalation or callback request. */
export function isAiLeadTicket(raw: Record<string, unknown>): boolean {
  if (str(raw.source).toLowerCase() === "ai-chat") return true;
  if (str(raw.category) === "AI assistant lead") return true;
  return Boolean(raw.aiLead && typeof raw.aiLead === "object");
}

/** Extract optional AI conversation context and route details attached to an AI chat lead. */
export function parseTicketAiLead(raw: Record<string, unknown>): ParsedAiLead | null {
  const ai = raw.aiLead && typeof raw.aiLead === "object" ? (raw.aiLead as Record<string, unknown>) : {};
  const question = str(ai.question ?? raw.aiQuestion);
  const reply = str(ai.reply ?? raw.aiReply);
  const reason = str(ai.reason ?? raw.aiConfusionReason);
  const pagePath = str(ai.pagePath);

  const trip = ai.tripContext && typeof ai.tripContext === "object" ? (ai.tripContext as Record<string, unknown>) : {};
  const pickup = str(trip.pickup);
  const drop = str(trip.drop);
  const service = str(trip.service);
  const routePart = pickup && drop ? `${pickup} → ${drop}` : pickup || drop;
  const tripLabel = [service, routePart].filter(Boolean).join(" · ");

  const messages = Array.isArray(ai.messages)
    ? ai.messages
        .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === "object"))
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: str(m.content) }))
        .filter((m) => m.content)
    : [];

  if (!question && !reply && !reason && !tripLabel && !messages.length) return null;
  return { question, reply, reason, tripLabel, pagePath, messages };
}

/** Build a clean clickable tel: URI from a stored Indian/international mobile number. */
export function telHref(rawPhone: string): string {
  const clean = rawPhone.replace(/[^+\d]/g, "");
  if (!clean) return "";
  return `tel:${clean.startsWith("+") || clean.length !== 10 ? clean : `+91${clean}`}`;
}

export const AI_REASON_LABELS: Record<string, string> = {
  ai_escalated: "AI requested human follow-up",
  ai_uncertain: "AI was unsure",
  ai_unavailable: "AI service unavailable",
  unrecognized_intent: "AI could not understand query",
  human_requested: "Customer requested callback",
  offline: "Offline fallback",
  ai_confused: "AI escalated",
};
