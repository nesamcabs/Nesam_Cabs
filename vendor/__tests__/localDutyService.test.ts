/* eslint-disable import/first -- jest.mock() calls must precede the imports they replace */
// Fleet local duty changes: every one is a server call, and a refusal reaches the screen without any direct database write.
const mockCall = jest.fn();
const mockWrite = jest.fn();

jest.mock('../src/services/callables', () => ({ callFunction: (...args: unknown[]) => mockCall(...args) }));
jest.mock('../src/config/firebase', () => ({ auth: { currentUser: { uid: 'ven1' } }, db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), doc: jest.fn(), getDoc: jest.fn(), getDocs: jest.fn(), limit: jest.fn(), onSnapshot: jest.fn(), orderBy: jest.fn(), query: jest.fn(), where: jest.fn(),
  serverTimestamp: jest.fn(), Timestamp: { fromMillis: jest.fn() },
  addDoc: (...args: unknown[]) => mockWrite(...args),
  setDoc: (...args: unknown[]) => mockWrite(...args),
  updateDoc: (...args: unknown[]) => mockWrite(...args),
}));

import { DEFAULT_DUTY_CITIES, createLocalShift, endLocalShift, masterCityId, updateLocalShift } from '../src/services/localDutyService';

const input = { driverId: 'drv1', vehicleId: 'veh1', cityId: '', cityName: 'Theni', services: ['pickup_drop' as const], startsAt: 'now' as const, endsAt: 1, radiusKm: 15, note: '' };
const changes: [string, () => Promise<unknown>, string, object][] = [
  ['create', () => createLocalShift(input), 'createLocalShift', input],
  ['change', () => updateLocalShift({ shiftId: 's1', radiusKm: 20 }), 'updateLocalShift', { shiftId: 's1', radiusKm: 20 }],
  ['end', () => endLocalShift('s1', 'closing'), 'endLocalShift', { shiftId: 's1', reason: 'closing' }],
];

beforeEach(() => {
  mockCall.mockReset();
  mockWrite.mockReset();
});

describe('fleet local duty changes', () => {
  it.each(changes)('%s asks the server and returns its answer', async (_label, run, name, data) => {
    mockCall.mockResolvedValue({ ok: true });
    await expect(run()).resolves.toEqual({ ok: true });
    expect(mockCall).toHaveBeenCalledWith(name, data);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it.each(changes)('%s refused: the server’s reason reaches the screen and nothing is written', async (_label, run) => {
    mockCall.mockRejectedValue(new Error('The server says no.'));
    await expect(run()).rejects.toThrow('The server says no.');
    expect(mockWrite).not.toHaveBeenCalled();
  });
});

describe('the city sent with a new duty', () => {
  it('sends the id of a server city only; a built-in city goes by name, as the server refuses unknown ids', () => {
    expect(masterCityId({ id: 'loc_8812', name: 'Theni', state: 'Tamil Nadu', hasCentre: true })).toBe('loc_8812');
    for (const city of DEFAULT_DUTY_CITIES) expect(masterCityId(city)).toBe('');
    expect(masterCityId(null)).toBe('');
  });
});
