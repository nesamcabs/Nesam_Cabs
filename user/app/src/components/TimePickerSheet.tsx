// The 12-hour time picker: three scrolling wheels — hour 1–12, every minute 00–59 and AM/PM.
// Past or out-of-window times are shown faded and can't be confirmed; the choice is re-checked on confirm.
import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Button, Notice, Sheet } from './ui';
import { colors, fonts, space } from '../theme';

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const PERIODS: Period[] = ['AM', 'PM'];
type Period = 'AM' | 'PM';
const ITEM_H = 44;
/** Rows above (and below) the centre band, so the first and last values can reach it. */
const PAD_ROWS = 2;

const pad = (n: number) => String(n).padStart(2, '0');

function compose(day: Date, hour12: number, minute: number, period: Period): Date {
  const d = new Date(day);
  d.setHours((hour12 % 12) + (period === 'PM' ? 12 : 0), minute, 0, 0);
  return d;
}

/**
 * The time a fresh picker opens on, from the same rule that validates the choice (`problemOf`): today starts at the next
 * 5-minute mark that is allowed; a later day starts at 9:00 AM. If that is not allowed the next allowed time of that day is used.
 * null when no time of the day can be chosen.
 */
export function defaultTimeFor(day: Date, problemOf: (at: Date) => string, now = new Date()): Date | null {
  const at = (minutes: number) => {
    const d = new Date(day);
    d.setHours(0, minutes, 0, 0);
    return d;
  };
  const today = day.toDateString() === now.toDateString();
  const first = today ? Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 5) * 5 : 9 * 60;
  for (let m = Math.min(first, 1439); m < 1440; m += 5) if (!problemOf(at(m))) return at(m);
  for (let m = 0; m < Math.min(first, 1440); m += 5) if (!problemOf(at(m))) return at(m);
  for (let m = 0; m < 1440; m++) if (!problemOf(at(m))) return at(m);
  return null;
}

function zoneLabel(d: Date): string {
  return -d.getTimezoneOffset() === 330 ? 'Indian Standard Time' : 'Your phone’s time zone';
}

/** Mount it only while open (`{open ? <TimePickerSheet … /> : null}`) so it starts from the current value each time. */
export function TimePickerSheet({
  visible,
  title,
  day,
  value,
  problemOf,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  /** The calendar day the time applies to. */
  day: Date;
  value: Date | null;
  /** Why an instant can't be chosen ('' when it can) — e.g. the booking window or “after pickup”. */
  problemOf: (at: Date) => string;
  onClose: () => void;
  onConfirm: (at: Date) => void;
}) {
  // An existing choice is kept when the sheet reopens; otherwise open on a time that is allowed for this day.
  const kept = value && !Number.isNaN(value.getTime()) ? value : null;
  const [auto] = useState(() => (kept ? null : defaultTimeFor(day, problemOf)));
  const noTimes = !kept && !auto;
  const initial = kept ?? auto ?? compose(day, 12, 0, 'AM');
  const [hour, setHour] = useState(() => initial.getHours() % 12 || 12);
  const [minute, setMinute] = useState(() => initial.getMinutes());
  const [period, setPeriod] = useState<Period>(() => (initial.getHours() >= 12 ? 'PM' : 'AM'));
  const [error, setError] = useState('');

  const ok = (h: number, m: number, p: Period) => !problemOf(compose(day, h, m, p));
  const current = useMemo(() => compose(day, hour, minute, period), [day, hour, minute, period]);
  const currentProblem = noTimes ? `No pickup time is available on ${day.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}. Please choose another date.` : problemOf(current);
  const dayText = day.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  const choose = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setError('');
  };

  const confirm = () => {
    // Re-checked now: a time can become past while the sheet is open.
    const p = problemOf(current);
    if (p) {
      setError(p);
      return;
    }
    onConfirm(current);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={`${dayText} · ${zoneLabel(day)}`}>
      {noTimes ? null : (
        <Text style={styles.value} accessibilityLiveRegion="polite">
          {hour}:{pad(minute)} {period}
        </Text>
      )}
      <View style={noTimes ? styles.hidden : styles.wheels}>
        <View pointerEvents="none" style={styles.band} />
        <Wheel label="Hour" items={HOURS} value={hour} format={String} isDisabled={(h) => !MINUTES.some((m) => ok(h, m, period))} onChange={choose(setHour)} />
        <Wheel label="Minute" items={MINUTES} value={minute} format={pad} isDisabled={(m) => !ok(hour, m, period)} onChange={choose(setMinute)} />
        <Wheel label="AM or PM" items={PERIODS} value={period} format={String} isDisabled={(p) => !HOURS.some((h) => MINUTES.some((m) => ok(h, m, p)))} onChange={choose(setPeriod)} />
      </View>
      {currentProblem || error ? <Notice tone="warning" message={error || currentProblem} /> : null}
      {noTimes ? <Button title="Choose another date" variant="secondary" onPress={onClose} style={{ marginTop: space.md }} /> : null}
      <Text style={styles.note}>Past times are unavailable. The time is checked again before your booking is confirmed.</Text>
      <Button title="Confirm time" icon="check" onPress={confirm} disabled={!!currentProblem || noTimes} style={{ marginTop: space.lg }} />
    </Sheet>
  );
}

/** One scrolling column; the row that settles in the centre band is the selected value. */
function Wheel<T extends string | number>({
  label,
  items,
  value,
  format,
  isDisabled,
  onChange,
}: {
  label: string;
  items: T[];
  value: T;
  format: (item: T) => string;
  isDisabled: (item: T) => boolean;
  onChange: (item: T) => void;
}) {
  const ref = useRef<ScrollView>(null);
  const placed = useRef(false);
  const index = Math.max(0, items.indexOf(value));
  const clamp = (i: number) => Math.min(items.length - 1, Math.max(0, i));

  const go = (i: number, animated = true) => {
    const at = clamp(i);
    ref.current?.scrollTo({ y: at * ITEM_H, animated });
    if (items[at] !== value) onChange(items[at] as T);
  };
  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const at = clamp(Math.round(e.nativeEvent.contentOffset.y / ITEM_H));
    if (items[at] !== value) onChange(items[at] as T);
  };

  return (
    <View
      style={styles.wheel}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: format(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => go(index + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}
    >
      <ScrollView
        ref={ref}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: ITEM_H * PAD_ROWS }}
        onContentSizeChange={() => {
          // Start on the current value once the rows have been laid out; afterwards the wheel keeps its own position.
          if (placed.current) return;
          placed.current = true;
          ref.current?.scrollTo({ y: index * ITEM_H, animated: false });
        }}
        onMomentumScrollEnd={settle}
        onScrollEndDrag={settle}
      >
        {items.map((item, i) => {
          const on = item === value;
          const off = isDisabled(item);
          return (
            <Pressable key={String(item)} onPress={() => go(i)} style={styles.item} importantForAccessibility="no">
              <Text style={[styles.itemText, on && styles.itemTextOn, off && !on && styles.itemTextOff]}>{format(item)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  value: { fontFamily: fonts.semiBold, fontSize: 28, letterSpacing: -0.6, color: colors.ink, textAlign: 'center', marginBottom: space.md },
  wheels: { flexDirection: 'row', gap: 8, height: ITEM_H * (PAD_ROWS * 2 + 1), marginBottom: space.md },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: ITEM_H * PAD_ROWS,
    height: ITEM_H,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: '#FFF6F5',
  },
  hidden: { height: 0, overflow: 'hidden' },
  wheel: { flex: 1 },
  item: { height: ITEM_H, alignItems: 'center', justifyContent: 'center' },
  itemText: { fontFamily: fonts.medium, fontSize: 17, color: colors.muted },
  itemTextOn: { fontFamily: fonts.semiBold, fontSize: 21, color: colors.primary },
  itemTextOff: { color: '#C3C9D1' },
  note: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, color: colors.muted },
});
