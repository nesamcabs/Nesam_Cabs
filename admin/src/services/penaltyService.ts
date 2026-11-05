import { callFunction, ActionError } from "./callables";
import { issuePenalty, transitionPenalty as transitionPenaltyCall, type IssuePenaltyInput } from "./bookingOpsService";
import { toDate } from "./paymentService";
import { parseAmount } from "../utils/analytics";
import { penaltyNext, penaltyStatusOf, type PenaltyStatusName } from "../domain/bookingFlow";
import type { Booking, PenaltyRecord } from "../types";

export { ActionError as PenaltyActionError };

export type PenaltyParty = "Driver" | "Vendor";
export type PenaltyStatus = PenaltyStatusName;

export const PENALTY_CATEGORIES = [
  "Trip Cancellation",
  "No Show at Pickup",
  "Late Arrival",
  "Misconduct / Complaint",
  "Document / Insurance Lapse",
  "Vehicle Condition",
  "Other",
  "Assignment deadline missed",
  "Accepted duty not fulfilled",
  "Cancellation after driver arrival",
  "Service / conduct issue",
] as const;
/** The reasons the Master Admin "Apply penalty" sheet offers. */
export const REFERENCE_REASONS = ["Assignment deadline missed", "Accepted duty not fulfilled", "Cancellation after driver arrival", "Service / conduct issue", "Other"] as const;

export const PENALTY_STATUSES: PenaltyStatus[] = ["Pending", "Acknowledged", "Paid", "Deducted", "Waived", "Disputed"];
/** Owed by the partner until paid, deducted or waived. */
export const OUTSTANDING_STATUSES: PenaltyStatus[] = ["Pending", "Acknowledged", "Disputed"];
export const MAX_PENALTY = 100000;

export interface PenaltyHistoryEntry { status: string; byName?: string; at?: unknown; note?: string; reference?: string }

export interface Penalty {
  id: string;
  party: PenaltyParty;
  partyId: string;
  partyName: string;
  category: string;
  reason: string;
  description: string;
  amount: number;
  customerCompensation: number;
  bookingId: string;
  bookingCode: string;
  incidentDate: string;
  status: PenaltyStatus;
  /** The status as stored (an older spelling such as "Applied" is shown as its current equivalent). */
  storedStatus: string;
  issuedByName: string;
  acknowledged: boolean;
  acknowledgedAt: Date | null;
  acknowledgedByName: string;
  acknowledgementText: string;
  disputeNote: string;
  resolutionNote: string;
  paymentReference: string;
  history: PenaltyHistoryEntry[];
  createdAt: Date | null;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Reads new and earlier-era penalty documents into one shape. */
export function mapPenalty(raw: PenaltyRecord & Record<string, unknown>): Penalty {
  const party: PenaltyParty = (raw.entityType || raw.type) === "Vendor" || raw.vendorId ? "Vendor" : "Driver";
  return {
    id: raw.id,
    party,
    partyId: text(raw.driverId) || text(raw.vendorId) || text(raw.entityId),
    partyName: text(raw.entityName) || text(raw.entity),
    category: text(raw.category) || text(raw.violationType) || "Other",
    reason: text(raw.reason),
    description: text(raw.description) || text(raw.notes),
    amount: parseAmount(raw.amount),
    customerCompensation: parseAmount((raw.customerCompensation as number) ?? raw.custCompensation),
    bookingId: text(raw.bookingDocumentId) || text(raw.bookingId),
    bookingCode: text(raw.bookingCode) || text(raw.bookingId),
    incidentDate: text(raw.incidentDate) || text(raw.date),
    status: penaltyStatusOf(raw.status),
    storedStatus: text(raw.status),
    issuedByName: text(raw.issuedByName),
    acknowledged: raw.acknowledged === true,
    acknowledgedAt: toDate(raw.acknowledgedAt),
    acknowledgedByName: text(raw.acknowledgedByName),
    acknowledgementText: text(raw.acknowledgementText),
    disputeNote: text(raw.disputeNote),
    resolutionNote: text(raw.resolutionNote),
    paymentReference: text(raw.paymentReference) || text(raw.recoveryReference),
    history: Array.isArray(raw.history) ? (raw.history as PenaltyHistoryEntry[]) : [],
    createdAt: toDate(raw.issuedAt) ?? toDate(raw.createdAt) ?? toDate(raw.date),
  };
}

export interface PenaltyInput {
  party: PenaltyParty;
  partyId: string;
  partyName: string;
  category: string;
  reason: string;
  description: string;
  amount: string;
  customerCompensation: string;
  bookingId: string;
  incidentDate: string;
}

export type PenaltyErrors = Partial<Record<keyof PenaltyInput, string>>;

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function validatePenalty(input: PenaltyInput, bookings: Booking[]): PenaltyErrors {
  const e: PenaltyErrors = {};
  if (!input.partyId) e.partyId = `Choose the ${input.party.toLowerCase()}.`;
  if (!(PENALTY_CATEGORIES as readonly string[]).includes(input.category)) e.category = "Choose a violation category.";
  if (input.reason.trim().length < 10) e.reason = "Describe the violation (at least 10 characters).";
  const amount = Number(input.amount);
  if (!input.amount.trim() || !Number.isFinite(amount) || amount <= 0) e.amount = "Enter a penalty amount greater than zero.";
  else if (!Number.isInteger(amount)) e.amount = "Use whole rupees.";
  else if (amount > MAX_PENALTY) e.amount = `Penalty cannot exceed ₹${MAX_PENALTY.toLocaleString("en-IN")}.`;
  if (input.customerCompensation.trim()) {
    const comp = Number(input.customerCompensation);
    if (!Number.isFinite(comp) || comp < 0 || !Number.isInteger(comp)) e.customerCompensation = "Enter whole rupees (0 or more).";
    else if (!e.amount && comp > amount) e.customerCompensation = "Compensation cannot exceed the penalty.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.incidentDate)) e.incidentDate = "Enter the incident date.";
  else if (input.incidentDate > todayIso()) e.incidentDate = "The incident date cannot be in the future.";
  if (input.bookingId) {
    const b = bookings.find((x) => x.id === input.bookingId);
    if (!b) e.bookingId = "Booking not found.";
    else {
      const owner = input.party === "Driver" ? b.assignedDriverId : b.assignedVendorId;
      // A reassigned trip may be penalised against a previous driver; the server checks the assignment history.
      if (owner !== input.partyId && !(b.lastAssignment && input.party === "Driver")) e.bookingId = `This booking was not handled by the selected ${input.party.toLowerCase()}.`;
    }
  }
  return e;
}

/** Issues the penalty on the server (audited) and notifies the partner. */
export async function createPenalty(input: PenaltyInput, bookings: Booking[]): Promise<string> {
  const errors = validatePenalty(input, bookings);
  if (Object.keys(errors).length) throw new ActionError(Object.values(errors)[0]!);
  const req: IssuePenaltyInput = {
    party: input.party,
    partyId: input.partyId,
    category: input.category,
    reason: input.reason.trim(),
    description: input.description.trim(),
    amount: Number(input.amount),
    ...(input.customerCompensation.trim() ? { customerCompensation: Number(input.customerCompensation) } : {}),
    ...(input.bookingId ? { bookingId: input.bookingId } : {}),
    incidentDate: input.incidentDate,
  };
  return (await issuePenalty(req)).id;
}

export type PenaltyAction = "Paid" | "Deducted" | "Waived" | "Pending";

export const ACTIONS: Record<PenaltyAction, { label: string; noteLabel: string; needsNote: boolean; needsReference: boolean; help: string }> = {
  Paid: { label: "Mark paid", noteLabel: "Note (optional)", needsNote: false, needsReference: true, help: "The partner paid this penalty. Enter the payment reference." },
  Deducted: { label: "Deduct from payout", noteLabel: "Note (optional)", needsNote: false, needsReference: false, help: "Debits the amount from the partner’s wallet balance." },
  Waived: { label: "Waive", noteLabel: "Reason for waiver", needsNote: true, needsReference: false, help: "No amount is collected." },
  Pending: { label: "Uphold penalty", noteLabel: "Decision note", needsNote: true, needsReference: false, help: "Rejects the dispute; the penalty stands and the partner is told." },
};

export const availableActions = (p: Penalty): PenaltyAction[] => penaltyNext(p.status).filter((s): s is PenaltyAction => s in ACTIONS);

export async function transitionPenalty(p: Penalty, action: PenaltyAction, note: string, reference: string): Promise<void> {
  const spec = ACTIONS[action];
  if (spec.needsNote && note.trim().length < 5) throw new ActionError(`${spec.noteLabel} is required.`);
  if (spec.needsReference && reference.trim().length < 3) throw new ActionError("Enter the payment reference.");
  await transitionPenaltyCall(p.id, action, note.trim(), reference.trim());
}

/** Outstanding (pending / acknowledged / disputed) penalty total for a partner. */
export const outstandingFor = (penalties: Penalty[], party: PenaltyParty, partyId: string) =>
  penalties
    .filter((p) => p.party === party && p.partyId === partyId && OUTSTANDING_STATUSES.includes(p.status))
    .reduce((s, p) => s + p.amount, 0);

// Re-exported for screens that only need the call helper.
export { callFunction };
