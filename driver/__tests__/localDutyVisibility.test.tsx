/* eslint-disable import/first -- jest.mock() calls must precede the imports they replace */
// How a driver gets onto riders' maps: "Start Local Duty" asks the server for a planned duty (never a direct database write),
// and every refresh of a running duty sends the position with that duty's id.
import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockCall = jest.fn();
const mockSetDoc = jest.fn();
const mockUpdateDoc = jest.fn();

jest.mock('../src/services/callables', () => ({
  callFunction: (...args: unknown[]) => mockCall(...args),
  ActionError: class ActionError extends Error {},
}));
jest.mock('../src/config/firebase', () => ({ auth: { currentUser: { uid: 'drv1' } }, db: {} }));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(), doc: jest.fn(), limit: jest.fn(), onSnapshot: jest.fn(), orderBy: jest.fn(), query: jest.fn(), where: jest.fn(),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  getDoc: jest.fn(() => Promise.resolve({ data: () => ({ cityName: 'Theni' }), exists: () => true })),
  getDocs: jest.fn(() => Promise.resolve({ docs: [], empty: true, forEach: () => undefined })),
  serverTimestamp: jest.fn(), Timestamp: { fromMillis: jest.fn() },
}));
jest.mock('../src/context/DriverData', () => ({ useDriverData: () => ({ account: { driver: { id: 'drv1', city: 'Theni' }, vehicle: {} } }) }));
jest.mock('expo-font', () => ({ useFonts: () => [true, null], isLoaded: () => true, isLoading: () => false, loadAsync: jest.fn(), processFontFamily: (f: string) => f }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

import { StartDutyDialog } from '../src/components/nx/StartDutyDialog';
import { endLocalShift, fetchBoard, localShiftAction, releaseLocalOrder } from '../src/services/localDutyService';
import { ActionError } from '../src/services/callables';

beforeEach(() => {
  mockCall.mockReset();
  mockSetDoc.mockReset();
  mockUpdateDoc.mockReset();
});

function openDialog() {
  const onClose = jest.fn();
  const onCreated = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<StartDutyDialog onClose={onClose} onCreated={onCreated} />);
  });
  const press = async () => {
    const button = tree.root.findAll((n) => n.props.title === 'Continue to photo check' && typeof n.props.onPress === 'function')[0]!;
    await act(async () => {
      button.props.onPress();
    });
  };
  return { tree, press, onClose, onCreated };
}

describe('Start Local Duty', () => {
  it('asks the server for a duty from now, for the town and both order types', async () => {
    mockCall.mockResolvedValue({ ok: true, shiftId: 's1' });
    const before = Date.now();
    const { tree, press, onClose, onCreated } = openDialog();
    await press();
    expect(mockCall).toHaveBeenCalledTimes(1);
    const [name, data] = mockCall.mock.calls[0] as [string, { cityName: string; services: string[]; startsAt: string; endsAt: number }];
    expect(name).toBe('createLocalShift');
    expect(data).toMatchObject({ cityName: 'Theni', services: ['pickup_drop', 'rental'], startsAt: 'now' });
    expect(data.endsAt - before).toBeGreaterThanOrEqual(8 * 3600000);
    expect(data.endsAt - before).toBeLessThan(8 * 3600000 + 5000);
    expect(onClose).toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('shows the server’s reason and writes nothing itself when the server refuses', async () => {
    mockCall.mockRejectedValue(new ActionError('Attach an approved vehicle to your profile first.'));
    const { tree, press, onClose, onCreated } = openDialog();
    await press();
    expect(JSON.stringify(tree.toJSON())).toContain('Attach an approved vehicle to your profile first.');
    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});

describe('running duty position', () => {
  it('sends the position with the duty id on each board refresh', async () => {
    mockCall.mockResolvedValue({ ok: true });
    const location = { lat: 10.0104, lng: 77.4768, accuracy: 12 };
    await expect(fetchBoard('shift-42', location)).resolves.toMatchObject({ shareProblem: '' });
    expect(mockCall).toHaveBeenCalledWith('localShiftPing', { shiftId: 'shift-42', location }, 15000);
  });

  it('reports a position the server did not save, refused or ignored', async () => {
    const location = { lat: 10.0104, lng: 77.4768, accuracy: 12 };
    mockCall.mockRejectedValue(new ActionError('This local duty is not assigned to you.'));
    await expect(fetchBoard('shift-42', location)).resolves.toMatchObject({ shareProblem: 'This local duty is not assigned to you.' });
    mockCall.mockResolvedValue({ ok: false });
    await expect(fetchBoard('shift-42', location)).resolves.toMatchObject({ shareProblem: 'The server did not save your position.' });
  });

  it('sends nothing when there is no position', async () => {
    await fetchBoard('shift-42', null);
    expect(mockCall).not.toHaveBeenCalled();
  });
});

describe('duty status changes', () => {
  const changes: [string, () => Promise<unknown>, string, object][] = [
    ['start', () => localShiftAction('s1', 'start', null), 'localShiftAction', { shiftId: 's1', action: 'start' }],
    ['break', () => localShiftAction('s1', 'pause'), 'localShiftAction', { shiftId: 's1', action: 'pause' }],
    ['resume', () => localShiftAction('s1', 'resume'), 'localShiftAction', { shiftId: 's1', action: 'resume' }],
    ['end', () => endLocalShift('s1', 'done'), 'endLocalShift', { shiftId: 's1', reason: 'done' }],
    ['hand back', () => releaseLocalOrder('s1', 'b1', 'Too far'), 'releaseLocalOrder', { shiftId: 's1', bookingId: 'b1', reason: 'Too far' }],
  ];

  it.each(changes)('%s asks the server and returns its answer', async (_label, run, name, data) => {
    mockCall.mockResolvedValue({ ok: true });
    await expect(run()).resolves.toEqual({ ok: true });
    expect(mockCall).toHaveBeenCalledWith(name, expect.objectContaining(data));
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it.each(changes)('%s refused: the server’s reason reaches the screen and nothing is written', async (_label, run) => {
    mockCall.mockRejectedValue(new ActionError('The server says no.'));
    await expect(run()).rejects.toThrow('The server says no.');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});
