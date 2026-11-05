// Star rating + tags + comment (port of user/web RatingForm.tsx).
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TripRecord, UserProfile } from '../types';
import { rateTrip } from '../services/rideService';
import { describeError } from '../utils/retry';
import { Button, Card, Chip, Notice } from './ui';
import { colors, fonts, radius, space, type } from '../theme';

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
      <Card style={{ alignItems: 'center' }}>
        <Text style={styles.stars} accessibilityLabel={`${trip.rating} stars`}>
          {'★'.repeat(trip.rating)}
          <Text style={{ color: colors.border }}>{'★'.repeat(5 - trip.rating)}</Text>
        </Text>
        <Text style={type.small}>Thanks for rating your trip!</Text>
      </Card>
    );
  }

  const submit = async () => {
    if (!stars) return setError('Tap a star to rate your driver.');
    setBusy(true);
    setError('');
    try {
      const text = [tags.join(', '), comment.trim()].filter(Boolean).join(' — ');
      await rateTrip(trip, profile, stars, text);
    } catch (e) {
      setError(describeError(e, 'We couldn’t save your rating. Please try again.'));
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const tagSet = stars && stars <= 3 ? TAGS.low : TAGS.high;
  return (
    <Card>
      <Text style={[type.h3, { textAlign: 'center' }]}>How was your ride{trip.driver ? ` with ${trip.driver.name}` : ''}?</Text>
      <View style={styles.starRow} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map((s) => (
          <Pressable
            key={s}
            onPress={() => {
              setStars(s);
              setTags([]);
              setError('');
            }}
            accessibilityRole="radio"
            accessibilityLabel={`${s} star${s > 1 ? 's' : ''}`}
            accessibilityState={{ selected: stars === s }}
            hitSlop={6}
          >
            <Text style={[styles.star, { color: s <= stars ? '#F59E0B' : colors.border }]}>★</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[type.small, { textAlign: 'center', minHeight: 16 }]}>{LABELS[stars]}</Text>
      {stars > 0 ? (
        <>
          <View style={styles.tags}>
            {tagSet.map((t) => (
              <Chip key={t} label={t} active={tags.includes(t)} onPress={() => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))} />
            ))}
          </View>
          <TextInput
            value={comment}
            onChangeText={(v) => setComment(v.slice(0, 400))}
            placeholder="Anything else? (optional)"
            placeholderTextColor={colors.faint}
            multiline
            style={styles.comment}
          />
        </>
      ) : null}
      <Notice message={error} />
      <Button title={busy ? 'Submitting…' : 'Submit rating'} loading={busy} disabled={!stars} onPress={() => void submit()} />
    </Card>
  );
}

const styles = StyleSheet.create({
  stars: { fontSize: 26, color: '#F59E0B' },
  starRow: { flexDirection: 'row', justifyContent: 'center', gap: space.sm, marginVertical: space.sm },
  star: { fontSize: 40 },
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
    marginVertical: space.md,
  },
});
