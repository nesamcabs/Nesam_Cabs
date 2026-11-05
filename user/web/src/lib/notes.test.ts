import { describe, expect, it } from 'vitest';
import { NOTES_MAX, composeNotes, notesRoom } from './notes';

describe('composeNotes', () => {
  it('keeps the rider’s note alone when there are no extras', () => {
    expect(composeNotes({ notes: '  Gate 2  ' })).toBe('Gate 2');
  });
  it('puts flight and passenger first', () => {
    expect(composeNotes({ flight: '6E 123', passengerName: 'Anu', passengerMobile: '98765 43210', notes: 'Two bags' })).toBe('Flight: 6E 123 | Travelling passenger: Anu, 9876543210 | Two bags');
  });
  it('never exceeds the server limit', () => {
    const out = composeNotes({ passengerName: 'A', notes: 'x'.repeat(400) });
    expect(out.length).toBe(NOTES_MAX);
    expect(out.startsWith('Travelling passenger: A | ')).toBe(true);
  });
  it('reports the room left for the note', () => {
    expect(notesRoom({})).toBe(NOTES_MAX);
    expect(notesRoom({ flight: 'AI 1' })).toBe(NOTES_MAX - 'Flight: AI 1'.length - 3);
  });
});
