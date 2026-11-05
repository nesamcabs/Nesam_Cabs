import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, loadDraft, saveDraft } from './draft';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

const place = (name: string, lat: number, lng: number) => ({ id: name, name, address: `${name}, India`, type: 'other' as const, lat, lng });

describe('booking draft persistence', () => {
  beforeEach(() => {
    (globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage = new MemoryStorage();
  });
  afterEach(() => {
    delete (globalThis as unknown as { sessionStorage?: MemoryStorage }).sessionStorage;
  });

  it('starts empty and keeps what the rider entered across a reload', () => {
    expect(loadDraft()).toEqual(EMPTY_DRAFT);
    const later = new Date(Date.now() + 3 * 3600000);
    saveDraft({ ...EMPTY_DRAFT, pickup: place('Theni', 10.01, 77.47), drop: place('Madurai', 9.92, 78.12), tripType: 'Round Trip', scheduledAt: later, categoryId: 'sedan', payment: 'UPI', promoCode: 'WELCOME50', notes: 'Gate 2' });
    const back = loadDraft();
    expect(back.pickup?.name).toBe('Theni');
    expect(back.drop?.lat).toBeCloseTo(9.92);
    expect(back.tripType).toBe('Round Trip');
    expect(back.scheduledAt?.getTime()).toBe(later.getTime());
    expect(back.payment).toBe('UPI');
    expect(back.promoCode).toBe('WELCOME50');
    expect(back.notes).toBe('Gate 2');

    saveDraft({ ...EMPTY_DRAFT, tripType: 'Local Rental' });
    expect(loadDraft().tripType).toBe('Local Rental');

    saveDraft({ ...EMPTY_DRAFT, tripType: 'Airport Taxi' });
    expect(loadDraft().tripType).toBe('Airport Taxi');
  });

  it('drops a schedule that has already passed and places without coordinates', () => {
    sessionStorage.setItem(
      'nesam.booking.v1',
      JSON.stringify({ scheduledAt: new Date(Date.now() - 60000).toISOString(), pickup: { name: 'Nowhere', lat: 0, lng: 0 }, drop: { name: 'Bad' }, payment: 'Card' }),
    );
    const d = loadDraft();
    expect(d.scheduledAt).toBeNull();
    expect(d.pickup).toBeNull();
    expect(d.drop).toBeNull();
    // Only Cash and UPI are recorded by the booking server.
    expect(d.payment).toBe('Cash');
  });

  it('survives corrupt storage', () => {
    sessionStorage.setItem('nesam.booking.v1', '{not json');
    expect(loadDraft()).toEqual(EMPTY_DRAFT);
  });
});
