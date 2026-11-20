// What the rate-your-driver form asks. The server (functions/src/domain/ratingPolicy.ts) is the authority and checks
// the same rules; these constants only let the form ask the right questions and explain what is missing.
// Keep the two files in step. The People Taxi and One Way sites carry a copy of this file in src/core/data.

/** A rating this low (or lower) must say what went wrong. */
export const LOW_RATING_MAX = 2;

export const RATING_LABELS = ['', 'Terrible', 'Bad', 'Okay', 'Good', 'Excellent'];

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

export const RATING_TAGS = {
  mid: ['Late pickup', 'Rash driving', 'Unclean car', 'Rude behaviour', 'Wrong route', 'Asked for extra money'],
  high: ['Safe driving', 'Clean car', 'Polite driver', 'On time', 'Smooth ride', 'Helped with luggage'],
} as const;

export const MIN_FEEDBACK_CHARS = 5;

export const isLowRating = (stars: number): boolean => stars >= 1 && stars <= LOW_RATING_MAX;

export interface RatingForm {
  stars: number;
  tags: string[];
  reason: string;
  feedback: string;
  improvements: string;
  comment: string;
}

export const emptyRatingForm = (): RatingForm => ({ stars: 0, tags: [], reason: '', feedback: '', improvements: '', comment: '' });

/** What is still missing before the rating can be sent, in the order the form asks; '' when it is ready. */
export function ratingProblem(f: RatingForm): string {
  if (!f.stars) return 'Tap a star to rate your driver.';
  if (!isLowRating(f.stars)) return '';
  if (!f.reason) return 'Please choose what went wrong.';
  if (f.feedback.trim().length < MIN_FEEDBACK_CHARS) return 'Please tell us what happened so we can put it right.';
  return '';
}

/** The fields sent to the server; a good rating never carries a reason or feedback. */
export function ratingPayload(f: RatingForm) {
  const low = isLowRating(f.stars);
  return {
    stars: f.stars,
    tags: low ? [] : f.tags,
    reason: low ? f.reason : '',
    feedback: low ? f.feedback.trim() : '',
    improvements: low ? f.improvements.trim() : '',
    comment: low ? '' : f.comment.trim(),
  };
}
