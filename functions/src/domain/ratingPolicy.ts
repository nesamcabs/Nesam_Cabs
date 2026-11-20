// What a customer sends when they rate the driver at the end of a trip, and what makes it valid.
//
// A low rating (LOW_RATING_MAX stars or fewer) must say WHY and WHAT went wrong, so the office can follow up with
// the driver. The server is the authority; the customer apps carry the same constants only to ask the right questions.
// Keep this file free of Firebase imports so it can be unit-tested and mirrored by the clients.

/** Ratings up to and including this many stars ask the customer for a reason and feedback. */
export const LOW_RATING_MAX = 2;

export const RATING_REASONS = [
  'Rash or unsafe driving',
  'Rude or unprofessional behaviour',
  'Late pickup or late arrival',
  'Vehicle was not clean',
  'Vehicle condition or breakdown',
  'Wrong or longer route taken',
  'Asked for extra money',
  'Did not follow the booking details',
  'Other',
] as const;
export type RatingReason = (typeof RATING_REASONS)[number];

export const MIN_FEEDBACK_CHARS = 5;
const MAX_TAGS = 8;

export class RatingProblem extends Error {}

export interface CleanRating {
  stars: number;
  /** Quick tags the customer tapped (good or bad). */
  tags: string[];
  /** One of RATING_REASONS; only for a low rating. */
  reason: string;
  /** What went wrong, in the customer's words; required for a low rating. */
  feedback: string;
  /** What the customer thinks should be improved; optional. */
  improvements: string;
  /** Free comment on a good rating. */
  comment: string;
  low: boolean;
}

const clean = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '';

export const isLowRating = (stars: number): boolean => Number.isInteger(stars) && stars >= 1 && stars <= LOW_RATING_MAX;

/** Validates and normalises a rating. Throws RatingProblem with a message the customer can act on. */
export function cleanRating(raw: unknown): CleanRating {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const stars = r.stars ?? r.rating;
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) throw new RatingProblem('Choose between 1 and 5 stars.');
  const tags = Array.isArray(r.tags)
    ? Array.from(new Set(r.tags.map((t) => clean(t, 40)).filter(Boolean))).slice(0, MAX_TAGS)
    : [];
  const low = isLowRating(stars);
  if (!low) {
    return { stars, tags, reason: '', feedback: '', improvements: '', comment: clean(r.comment, 400), low };
  }
  const reason = clean(r.reason, 60);
  if (!(RATING_REASONS as readonly string[]).includes(reason)) throw new RatingProblem('Please tell us what went wrong: choose a reason.');
  const feedback = clean(r.feedback, 600);
  if (feedback.length < MIN_FEEDBACK_CHARS) throw new RatingProblem('Please describe what happened so we can put it right.');
  return { stars, tags, reason, feedback, improvements: clean(r.improvements, 600), comment: '', low };
}

/** The single comment line stored on the booking (kept for the older review screens and receipts). */
export function summaryText(c: CleanRating): string {
  const parts = c.low
    ? [c.reason, c.feedback, c.improvements ? `Improve: ${c.improvements}` : '']
    : [c.tags.join(', '), c.comment];
  return parts.filter(Boolean).join(' — ').slice(0, 1200);
}

/** New running average after one more rating (two decimals), as the driver profile shows it. */
export function nextAverage(avg: unknown, count: unknown, stars: number): { rating: number; ratingCount: number } {
  const c = Number(count) > 0 ? Number(count) : 0;
  const a = Number(avg) > 0 ? Number(avg) : 0;
  return { rating: Math.round(((a * c + stars) / (c + 1)) * 100) / 100, ratingCount: c + 1 };
}

export const FOLLOW_UP_STATUSES = ['New', 'In review', 'Resolved', 'Dismissed'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];
