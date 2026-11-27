// Admin-chosen notification sounds: an event the office never changed keeps the sound it always had, a choice only
// reaches its own audience's real events, and a save is checked and listed change by change.
// Run: npm run build && node --test test/notificationSounds.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../lib/domain/soundEvents');
const { noticeFromRequest } = require('../lib/notificationTriggers');

test('without any saved choice every notification keeps its own sound', () => {
  for (const sound of S.APP_SOUNDS) {
    assert.equal(S.resolveSound({ recipientType: 'driver', event: 'new_duty', sound }, null), sound);
    assert.equal(S.resolveSound({ recipientType: 'driver', event: 'new_duty', sound }, {}), sound);
  }
  assert.equal(S.resolveSound({ recipientType: 'customer' }, { customer: { offers: 'approval' } }), 'general');
});

test('a choice changes only its own audience and event', () => {
  const o = { driver: { new_duty: 'approval' }, customer: { offers: 'new_booking' } };
  assert.equal(S.resolveSound({ recipientType: 'driver', event: 'new_duty', sound: 'new_booking' }, o), 'approval');
  assert.equal(S.resolveSound({ recipientType: 'vendor', event: 'new_duty', sound: 'new_booking' }, o), 'new_booking');
  assert.equal(S.resolveSound({ recipientType: 'customer', event: 'offers', sound: 'general' }, o), 'new_booking');
  // A notice to a driver also carries event "offers", but drivers have no such setting.
  assert.equal(S.resolveSound({ recipientType: 'driver', event: 'offers', sound: 'general' }, { driver: { offers: 'approval' } }), 'general');
  // Vendors have no "reassigned" setting; the office inbox never changes.
  assert.equal(S.resolveSound({ recipientType: 'vendor', event: 'reassigned', sound: 'general' }, { vendor: { reassigned: 'approval' } }), 'general');
  assert.equal(S.resolveSound({ recipientType: 'admin', event: 'new_duty', sound: 'new_booking' }, o), 'new_booking');
  // An event the server does not send cannot be changed, even by a damaged document.
  assert.equal(S.resolveSound({ recipientType: 'driver', event: 'payment', sound: 'general' }, { driver: { payment: 'approval' } }), 'general');
  assert.equal(S.resolveSound({ recipientType: 'driver', event: 'new_duty', sound: 'new_booking' }, { driver: { new_duty: 'loud' } }), 'new_booking');
});

test('stored choices are cleaned: unknown audiences, events, sounds and defaults are dropped', () => {
  assert.deepEqual(S.cleanOverrides({ driver: { new_duty: 'approval', penalty: 'general', payment: 'approval', made_up: 'general' }, admin: { x: 'general' }, vendor: 'x' }), { driver: { new_duty: 'approval' } });
  assert.deepEqual(S.cleanOverrides(null), {});
});

test('every event the server sends has a call site, and each call site keeps the default listed for it', () => {
  const src = path.join(__dirname, '../src');
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts') && !p.endsWith('soundEvents.ts')) files.push(p); } })(src);
  const used = new Set();
  for (const f of files) {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      for (const m of line.matchAll(/event: '([a-z_]+)'/g)) {
        const key = m[1];
        used.add(key);
        const listed = S.SOUND_AUDIENCES.flatMap((a) => S.SOUND_EVENTS[a].filter((e) => e.key === key));
        assert.ok(listed.length, `${path.basename(f)} uses event "${key}", which no app lists`);
        const sound = line.match(/sound: '([a-z_]+)'/)?.[1];
        if (sound) for (const e of listed) assert.equal(sound, e.defaultSound, `${path.basename(f)}: "${key}" plays ${sound} but its default is ${e.defaultSound}`);
      }
    }
  }
  for (const a of S.SOUND_AUDIENCES) for (const e of S.SOUND_EVENTS[a]) if (e.sent) assert.ok(used.has(e.key), `${a} · ${e.label} has no call site`);
});

test('staff approvals are "Documents approved"; rejections keep their sound with no setting', () => {
  const req = { audience: 'driver', recipientId: 'd1', title: "You're approved", message: 'ok', severity: 'success', sentBy: 's' };
  assert.equal(noticeFromRequest('r1', req).event, 'documents_approved');
  assert.equal(noticeFromRequest('r1', req).sound, 'approval');
  assert.equal(noticeFromRequest('r2', { ...req, title: 'Application rejected', severity: 'warning' }).event, undefined);
});

test('saving app sounds stores only what differs from the default and lists each change', () => {
  const before = { apps: { driver: { new_duty: 'approval' } }, office: null };
  const plan = S.planSoundSave(before, { apps: { driver: { new_duty: 'new_booking', bid_selected: 'general', payment: 'general' }, vendor: { penalty: 'new_booking' } } });
  assert.deepEqual(plan.apps, { driver: { bid_selected: 'general' }, vendor: { penalty: 'new_booking' } });
  assert.deepEqual(plan.changes.map((c) => `${c.audience}:${c.event}:${c.from}>${c.to}`).sort(), [
    'driver:bid_selected:Approval>General', 'driver:new_duty:Approval>New booking', 'vendor:penalty:General>New booking',
  ]);
  assert.equal(plan.office, null, 'the office setting is untouched when it is not sent');
  // An audience left out keeps its choices.
  assert.deepEqual(S.planSoundSave(plan, { apps: { customer: { offers: 'approval' } } }).apps.vendor, { penalty: 'new_booking' });
});

test('a save is refused for anything that is not a real choice', () => {
  const before = { apps: {}, office: null };
  assert.throws(() => S.planSoundSave(before, { apps: { admin: {} } }), S.SoundSettingsError);
  assert.throws(() => S.planSoundSave(before, { apps: { driver: { made_up: 'general' } } }), /not a driver notification/);
  assert.throws(() => S.planSoundSave(before, { apps: { driver: { new_duty: 'siren' } } }), /New booking, Approval or General/);
  assert.throws(() => S.planSoundSave(before, { apps: { vendor: { payment: 'approval' } } }), /sends no such notification/);
  assert.throws(() => S.planSoundSave(before, { office: { ...S.OFFICE_DEFAULTS, 'New booking': { tone: 'Siren', volume: 80, on: true, repeat: 'Once only' } } }), /preset tones/);
  assert.throws(() => S.planSoundSave(before, { office: { ...S.OFFICE_DEFAULTS, 'Urgent booking': { tone: 'Classic Ring', volume: 101, on: true, repeat: 'Every 1 min' } } }), /volume/);
  assert.throws(() => S.planSoundSave(before, { office: { ...S.OFFICE_DEFAULTS, 'Urgent booking': { tone: 'Classic Ring', volume: 80, on: true, repeat: 'Hourly' } } }), /repeats/);
});

test('office alerts: the first shared save is recorded, later saves list each setting that changed', () => {
  const first = S.planSoundSave({ apps: {}, office: null }, { office: S.OFFICE_DEFAULTS });
  assert.deepEqual(first.office, S.OFFICE_DEFAULTS);
  assert.equal(first.changes.length, 1);
  assert.equal(first.changes[0].to, 'Shared (defaults)');
  const next = { ...S.OFFICE_DEFAULTS, 'Urgent booking': { tone: 'custom:s123', volume: 60, on: false, repeat: 'Every 2 min' } };
  const plan = S.planSoundSave({ apps: {}, office: first.office }, { office: next });
  assert.deepEqual(plan.changes.map((c) => `${c.event}:${c.field}:${c.from}>${c.to}`), [
    'Urgent booking:tone:Classic Ring>Uploaded sound', 'Urgent booking:volume:80%>60%', 'Urgent booking:on:On>Off', 'Urgent booking:repeat:Every 1 min>Every 2 min',
  ]);
  assert.deepEqual(S.cleanOffice({ 'New booking': { tone: 'Soft Chime', volume: 50, on: true, repeat: 'Once only' } })['Urgent booking'], S.OFFICE_DEFAULTS['Urgent booking']);
});
