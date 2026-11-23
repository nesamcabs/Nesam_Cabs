// Staff & Access Control rules (admin/src/domain/staffAccess.ts, utils/phone.ts): run with `npm run test:staff` in admin/.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require(path.resolve(__dirname, '../functions/test/adminServiceLoader.cjs'))({});
const S = load('src/domain/staffAccess.ts');
const P = load('src/config/permissions.ts');
const { parseIndianMobile } = load('src/utils/phone.ts');

const at = (iso) => new Date(iso);
const session = (start, end, extra = {}) => ({ status: end ? 'Ended' : 'Online', startedAt: at(start), lastActiveAt: at(end ?? start), endedAt: end ? at(end) : null, ...extra });
const H = 3_600_000;

test('worked time adds real session durations on the India day, with no assumed session length', () => {
  const day = '2026-11-23';
  const now = Date.parse('2026-11-24T12:00:00+05:30');
  const r = S.attendanceOnDay([
    session('2026-11-23T09:00:00+05:30', '2026-11-23T13:00:00+05:30'),
    session('2026-11-23T14:00:00+05:30', '2026-11-23T18:30:00+05:30'),
  ], day, now);
  assert.equal(r.workedMs, 8.5 * H, 'lunch break is not counted');
  assert.equal(r.sessions, 2);
  assert.equal(r.firstAt.toISOString(), at('2026-11-23T09:00:00+05:30').toISOString());
  assert.equal(r.lastAt.toISOString(), at('2026-11-23T18:30:00+05:30').toISOString());
  assert.equal(S.formatDuration(r.workedMs), '8h 30m');
  // A session that ended without a logout ends at its last activity, not at a guessed +30 minutes.
  const noLogout = S.attendanceOnDay([{ status: 'Online', startedAt: at('2026-11-23T10:00:00+05:30'), lastActiveAt: at('2026-11-23T10:20:00+05:30'), endedAt: null }], day, now);
  assert.equal(noLogout.workedMs, 20 * 60_000);
  assert.equal(noLogout.online, false);
});

test('overnight shifts split at India midnight; overlapping sessions (two devices) count once', () => {
  const now = Date.parse('2026-11-25T12:00:00+05:30');
  const night = [session('2026-11-23T22:00:00+05:30', '2026-11-24T06:00:00+05:30')];
  assert.equal(S.attendanceOnDay(night, '2026-11-23', now).workedMs, 2 * H);
  assert.equal(S.attendanceOnDay(night, '2026-11-24', now).workedMs, 6 * H);
  assert.equal(S.attendanceOnDay(night, '2026-11-24', now).firstAt.toISOString(), at('2026-11-24T00:00:00+05:30').toISOString());
  const twoDevices = [session('2026-11-24T09:00:00+05:30', '2026-11-24T12:00:00+05:30'), session('2026-11-24T11:00:00+05:30', '2026-11-24T13:00:00+05:30')];
  assert.equal(S.attendanceOnDay(twoDevices, '2026-11-24', now).workedMs, 4 * H);
  assert.equal(S.attendanceOnDay(twoDevices, '2026-11-25', now).workedMs, 0);
});

test('a live session counts up to now and shows online; a stale heartbeat does not', () => {
  const now = Date.parse('2026-11-23T11:00:00+05:30');
  const live = { status: 'Online', startedAt: at('2026-11-23T09:00:00+05:30'), lastActiveAt: at('2026-11-23T10:55:00+05:30'), endedAt: null };
  const r = S.attendanceOnDay([live], '2026-11-23', now);
  assert.equal(r.workedMs, 2 * H);
  assert.equal(r.online, true);
  assert.equal(S.isLive({ ...live, lastActiveAt: at('2026-11-23T10:00:00+05:30') }, now), false);
});

test('Off / View / Edit / Full map onto the permission registry and respect Master-only and limited modules', () => {
  assert.deepEqual(S.levelActions('Bookings', 'Off'), []);
  assert.deepEqual(S.levelActions('Bookings', 'View'), ['view']);
  assert.deepEqual(S.levelActions('Bookings', 'Edit'), ['view', 'create', 'edit']);
  assert.deepEqual(S.levelActions('Bookings', 'Full'), [...P.MODULE_ACTIONS]);
  assert.deepEqual(S.levelActions('Settings', 'Full'), ['view', 'export'], 'limited module');
  assert.deepEqual(S.levelActions('Staff & Access', 'Full'), [], 'Master-only module');
  const m = P.normalizeMatrix({ modules: { Bookings: ['view', 'approve'], Customers: ['view'] } });
  assert.equal(S.moduleLevel(m, 'Bookings'), 'Custom', 'an individual override is shown as Custom');
  assert.equal(S.moduleLevel(m, 'Customers'), 'View');
  assert.equal(S.moduleLevel(m, 'Accounts'), 'Off');
  const c = S.moduleCounts(m);
  assert.equal(c.enabled, 2);
  assert.equal(c.available, P.STAFF_MODULES.length - P.MASTER_ONLY_MODULES.length, 'counts come from the registry, not a fixed 17');
});

test('login ID suggestions skip IDs already in use; taken IDs include staff sign-in emails', () => {
  const taken = S.takenUsernames([{ username: 'booking.rajesh' }, { email: 'booking.rajesh2@staff.nesam.invalid' }, { email: 'owner@gmail.com' }]);
  assert.ok(taken.has('booking.rajesh') && taken.has('booking.rajesh2') && !taken.has('owner'));
  assert.equal(S.suggestUsername('Rajesh Kumar', 'booking', taken), 'booking.rajesh3');
  assert.equal(S.suggestUsername('  ', 'dispatch', taken), 'dispatch.staff');
  assert.ok(S.USERNAME_RULE.test(S.suggestUsername('Ñandu-Ü', 'night', new Set())));
});

test('one-time passwords are long, mixed and not repeated', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const p = S.strongPassword();
    assert.equal(p.length, 14);
    assert.ok(/[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[@#$%&*!?]/.test(p), p);
    seen.add(p);
  }
  assert.equal(seen.size, 200);
});

test('hub and shift round-trip through branch without truncating long names', () => {
  const b = S.joinBranch('Chennai Airport Desk', 'Night Shift / After-Hours (10:00 PM – 06:00 AM)');
  assert.deepEqual(S.splitBranch(b), { hub: 'Chennai Airport Desk', shift: 'Night Shift / After-Hours (10:00 PM – 06:00 AM)' });
  assert.deepEqual(S.splitBranch('Main Office'), { hub: 'Main Office', shift: '' }, 'older free-text branch is kept as the hub');
});

test('staff mobile numbers: supported spellings only, never the last ten of a longer number', () => {
  for (const v of ['9876543210', '+91 98765 43210', '098765-43210', '0091 9876543210']) assert.equal(parseIndianMobile(v), '9876543210', v);
  for (const v of ['19876543210', '12349876543210', '5876543210', 'abc9876543210']) assert.equal(parseIndianMobile(v), null, v);
});
