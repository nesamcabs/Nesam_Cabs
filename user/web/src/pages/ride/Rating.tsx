import { useState } from 'react';
import type { TripRecord, UserProfile } from '@core/types';
import { rateTrip } from '@core/services/rideService';
import { describeError } from '@core/utils/retry';
import { RATING_LABELS, RATING_REASONS, RATING_TAGS, emptyRatingForm, isLowRating, ratingPayload, ratingProblem, type RatingForm } from '@core/data/ratingPolicy';
import { Button, Notice } from '@/components/ui';

/**
 * End-of-trip driver rating. A low rating (2 stars or fewer) asks what went wrong, what happened and what should be
 * improved; the server keeps it on the driver's profile and opens a follow-up for the office.
 */
export function RatingCard({ trip, profile }: { trip: TripRecord; profile: UserProfile }) {
  const [form, setForm] = useState<RatingForm>(emptyRatingForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const set = (patch: Partial<RatingForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setError('');
  };

  if (trip.rating != null || sent) {
    const done = trip.rating ?? form.stars;
    return (
      <section className="card rating rating--done">
        <p className="rating__stars" aria-label={`You rated this trip ${done} out of 5`}>
          {'★'.repeat(done)}
          <span>{'★'.repeat(5 - done)}</span>
        </p>
        <p className="muted">{isLowRating(done) ? 'Thank you. We are sorry about this trip and will look into it.' : 'Thanks for rating your trip.'}</p>
      </section>
    );
  }

  const stars = form.stars;
  const low = isLowRating(stars);
  const problem = ratingProblem(form);

  const submit = async () => {
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      await rateTrip(trip, profile, ratingPayload(form));
      setSent(true);
    } catch (e) {
      setError(describeError(e, 'We couldn’t save your rating. Please try again.'));
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const tagSet = stars <= 3 ? RATING_TAGS.mid : RATING_TAGS.high;
  return (
    <section className="card rating" aria-labelledby="rate-title">
      <h2 id="rate-title">How was your ride{trip.driver ? ` with ${trip.driver.name}` : ''}?</h2>
      <div className="rating__row" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={stars === s}
            aria-label={`${s} star${s > 1 ? 's' : ''}`}
            className={`rating__star ${s <= stars ? 'is-on' : ''}`}
            onClick={() => set({ stars: s, tags: [], reason: '', feedback: '', improvements: '', comment: '' })}
          >
            ★
          </button>
        ))}
      </div>
      <p className="muted small rating__label" aria-live="polite">
        {RATING_LABELS[stars]}
      </p>

      {low ? (
        <>
          <p className="rating__lead">We’re sorry your ride wasn’t good. Please tell us what went wrong so we can put it right.</p>
          <p className="rating__q" id="rating-reason-label">What went wrong? <span aria-hidden="true">*</span></p>
          <div className="rating__tags" role="radiogroup" aria-labelledby="rating-reason-label">
            {RATING_REASONS.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={form.reason === r} className="chip" aria-pressed={form.reason === r} onClick={() => set({ reason: r })}>
                {r}
              </button>
            ))}
          </div>
          <label className="rating__q" htmlFor="rating-feedback">Tell us what happened <span aria-hidden="true">*</span></label>
          <textarea
            id="rating-feedback"
            className="textarea"
            required
            value={form.feedback}
            onChange={(e) => set({ feedback: e.target.value.slice(0, 600) })}
            placeholder="What happened on this trip?"
          />
          <label className="rating__q" htmlFor="rating-improve">What should we improve? <span className="muted">(optional)</span></label>
          <textarea
            id="rating-improve"
            className="textarea"
            value={form.improvements}
            onChange={(e) => set({ improvements: e.target.value.slice(0, 600) })}
            placeholder="How could the driver or NESAM do better?"
          />
        </>
      ) : stars > 0 ? (
        <>
          <div className="rating__tags">
            {tagSet.map((t) => (
              <button key={t} type="button" className="chip" aria-pressed={form.tags.includes(t)} onClick={() => set({ tags: form.tags.includes(t) ? form.tags.filter((x) => x !== t) : [...form.tags, t] })}>
                {t}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="rating-comment">
            Anything else? (optional)
          </label>
          <textarea id="rating-comment" className="textarea" value={form.comment} onChange={(e) => set({ comment: e.target.value.slice(0, 400) })} placeholder="Anything else? (optional)" />
        </>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button block loading={busy} disabled={!stars || (low && !!problem)} onClick={() => void submit()}>
        Submit rating
      </Button>
    </section>
  );
}
