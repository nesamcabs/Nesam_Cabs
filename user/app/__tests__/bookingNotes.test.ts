import { NOTES_MAX, composeBookingNotes } from '../src/utils/bookingRules';

describe('composeBookingNotes', () => {
  it('returns the customer notes unchanged when there is nothing else', () => {
    expect(composeBookingNotes({ notes: '  Near the temple gate ' })).toBe('Near the temple gate');
    expect(composeBookingNotes({})).toBe('');
  });

  it('puts the flight and a different passenger before the customer notes', () => {
    expect(composeBookingNotes({ flight: '6E 562', passengerName: 'Anil', passengerMobile: '98765 43210', notes: '2 large bags' })).toBe(
      'Flight: 6E 562 | Travelling passenger: Anil, 9876543210 | 2 large bags',
    );
  });

  it('never exceeds the server limit and only shortens the customer’s own words', () => {
    const out = composeBookingNotes({ flight: 'AI 101', passengerName: 'Anil Kumar', passengerMobile: '9876543210', notes: 'x'.repeat(500) });
    expect(out.length).toBe(NOTES_MAX);
    expect(out.startsWith('Flight: AI 101 | Travelling passenger: Anil Kumar, 9876543210 | x')).toBe(true);
  });
});
