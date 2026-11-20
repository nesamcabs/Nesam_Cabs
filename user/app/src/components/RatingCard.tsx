// End-of-trip driver rating: stars, then either quick tags + an optional comment (3–5 stars) or, for a low rating
// (LOW_RATING_MAX stars or fewer), what went wrong: a reason, what happened and what should be improved.
// The server stores it on the driver's profile and opens a follow-up for the office.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TripRecord, UserProfile } from '../types';
import { rateTrip } from '../services/rideService';
import { describeError } from '../utils/retry';
import { Button, Card, Chip, Notice } from './ui';
import { colors, fonts, radius, space, type } from '../theme';
import { RATING_LABELS, RATING_REASONS, RATING_TAGS, emptyRatingForm, isLowRating, ratingPayload, ratingProblem, type RatingForm } from '../data/ratingPolicy';

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
    const stars = trip.rating ?? form.stars;
    return (
      <Card style={{ alignItems: 'center' }}>
        <Text style={styles.stars} accessibilityLabel={`${stars} stars`}>
          {'★'.repeat(stars)}
          <Text style={{ color: colors.border }}>{'★'.repeat(5 - stars)}</Text>
        </Text>
        <Text style={type.small}>{isLowRating(stars) ? 'Thank you. We are sorry about this trip and will look into it.' : 'Thanks for rating your trip!'}</Text>
      </Card>
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
    <Card>
      <Text style={[type.h3, { textAlign: 'center' }]}>How was your ride{trip.driver ? ` with ${trip.driver.name}` : ''}?</Text>
      <View style={styles.starRow} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map((s) => (
          <Pressable
            key={s}
            onPress={() => set({ stars: s, tags: [], reason: '', feedback: '', improvements: '', comment: '' })}
            accessibilityRole="radio"
            accessibilityLabel={`${s} star${s > 1 ? 's' : ''}`}
            accessibilityState={{ selected: stars === s }}
            hitSlop={6}
          >
            <Text style={[styles.star, { color: s <= stars ? '#F59E0B' : colors.border }]}>★</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[type.small, { textAlign: 'center', minHeight: 16 }]}>{RATING_LABELS[stars]}</Text>

      {low ? (
        <>
          <Text style={styles.lead}>We’re sorry your ride wasn’t good. Please tell us what went wrong so we can put it right.</Text>
          <Text style={styles.label}>What went wrong? *</Text>
          <View style={styles.tags} accessibilityRole="radiogroup">
            {RATING_REASONS.map((r) => (
              <Chip key={r} label={r} active={form.reason === r} onPress={() => set({ reason: r })} />
            ))}
          </View>
          <Text style={styles.label}>Tell us what happened *</Text>
          <TextInput
            value={form.feedback}
            onChangeText={(v) => set({ feedback: v.slice(0, 600) })}
            placeholder="What happened on this trip?"
            placeholderTextColor={colors.faint}
            multiline
            accessibilityLabel="What happened on this trip"
            style={styles.comment}
          />
          <Text style={styles.label}>What should we improve? (optional)</Text>
          <TextInput
            value={form.improvements}
            onChangeText={(v) => set({ improvements: v.slice(0, 600) })}
            placeholder="How could the driver or NESAM do better?"
            placeholderTextColor={colors.faint}
            multiline
            accessibilityLabel="What should we improve"
            style={styles.comment}
          />
        </>
      ) : stars > 0 ? (
        <>
          <View style={styles.tags}>
            {tagSet.map((t) => (
              <Chip key={t} label={t} active={form.tags.includes(t)} onPress={() => set({ tags: form.tags.includes(t) ? form.tags.filter((x) => x !== t) : [...form.tags, t] })} />
            ))}
          </View>
          <TextInput
            value={form.comment}
            onChangeText={(v) => set({ comment: v.slice(0, 400) })}
            placeholder="Anything else? (optional)"
            placeholderTextColor={colors.faint}
            multiline
            style={styles.comment}
          />
        </>
      ) : null}
      <Notice message={error} />
      <Button title={busy ? 'Submitting…' : 'Submit rating'} loading={busy} disabled={!stars || (low && !!problem)} onPress={() => void submit()} />
    </Card>
  );
}

const styles = StyleSheet.create({
  stars: { fontSize: 26, color: '#F59E0B' },
  starRow: { flexDirection: 'row', justifyContent: 'center', gap: space.sm, marginVertical: space.sm },
  star: { fontSize: 40 },
  lead: { fontFamily: fonts.regular, color: colors.ink, textAlign: 'center', marginVertical: space.sm },
  label: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.ink, marginTop: space.sm },
  tags: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: space.sm },
  comment: {
    fontFamily: fonts.regular,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 60,
    textAlignVertical: 'top',
    color: colors.ink,
    marginVertical: space.sm,
  },
});
