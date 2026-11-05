import { useState } from 'react';
import type { TripRecord, UserProfile } from '@core/types';
import { rateTrip } from '@core/services/rideService';
import { describeError } from '@core/utils/retry';
import { Button, Notice } from '@/components/ui';

const LABELS = ['', 'Terrible', 'Bad', 'Okay', 'Good', 'Excellent'];
const TAGS: Record<'low' | 'high', string[]> = {
  low: ['Late pickup', 'Rash driving', 'Unclean car', 'Rude behaviour', 'Wrong route', 'Asked for extra money'],
  high: ['Safe driving', 'Clean car', 'Polite driver', 'On time', 'Smooth ride', 'Helped with luggage'],
};

export function RatingCard({ trip, profile }: { trip: TripRecord; profile: UserProfile }) {
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (trip.rating != null) {
    return (
      <section className="card rating rating--done">
        <p className="rating__stars" aria-label={`You rated this trip ${trip.rating} out of 5`}>
          {'★'.repeat(trip.rating)}
          <span>{'★'.repeat(5 - trip.rating)}</span>
        </p>
        <p className="muted">Thanks for rating your trip.</p>
      </section>
    );
  }

  const submit = async () => {
    if (!stars) return setError('Tap a star to rate your driver.');
    setBusy(true);
    setError('');
    try {
      await rateTrip(trip, profile, stars, [tags.join(', '), comment.trim()].filter(Boolean).join(' — '));
    } catch (e) {
      setError(describeError(e, 'We couldn’t save your rating. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const tagSet = stars && stars <= 3 ? TAGS.low : TAGS.high;
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
            onClick={() => {
              setStars(s);
              setTags([]);
              setError('');
            }}
          >
            ★
          </button>
        ))}
      </div>
      <p className="muted small rating__label" aria-live="polite">
        {LABELS[stars]}
      </p>
      {stars > 0 ? (
        <>
          <div className="rating__tags">
            {tagSet.map((t) => (
              <button key={t} type="button" className="chip" aria-pressed={tags.includes(t)} onClick={() => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}>
                {t}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="rating-comment">
            Anything else? (optional)
          </label>
          <textarea id="rating-comment" className="textarea" value={comment} onChange={(e) => setComment(e.target.value.slice(0, 400))} placeholder="Anything else? (optional)" />
        </>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button block loading={busy} disabled={!stars} onClick={() => void submit()}>
        Submit rating
      </Button>
    </section>
  );
}
