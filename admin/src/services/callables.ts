import { callBackend } from "./backend";

/** Error carrying a message that is safe to show to an operator. */
export class ActionError extends Error {
  details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.details = details;
  }
}

/** Firebase callable errors carry the server's user-safe message for these codes. */
export function describeCallError(err: unknown): string {
  const code = (err as { code?: string }).code || "";
  const message = (err as { message?: string }).message || "";
  if (/^functions\/(invalid-argument|failed-precondition|permission-denied|not-found|unavailable|unauthenticated|already-exists|resource-exhausted)$/.test(code) && message) {
    return message;
  }
  if (code === "functions/deadline-exceeded") return "The server took too long to respond. Please try again.";
  return "The server could not complete the request. Check your connection and try again.";
}

/** Calls a booking-server function and turns any failure into an ActionError with a readable message. */
export async function callFunction<Req, Res>(name: string, data: Req, timeout = 60000): Promise<Res> {
  try {
    return await callBackend<Req, Res>(name, data, timeout);
  } catch (err) {
    throw new ActionError(describeCallError(err), (err as { details?: unknown }).details);
  }
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
