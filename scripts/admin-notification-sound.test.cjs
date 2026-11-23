// Focused checks for uploaded notification sounds: direct Blob loading (no fetch / object URL),
// cancellation while loading or decoding, missing / undecodable files, and the shared alert context.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../admin/node_modules/typescript');

const transpile = (rel) => ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../admin/src', rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const source = transpile('utils/notificationSound.ts');
const reminderSource = transpile('utils/followUpReminders.ts');
/** A fresh copy of the module per test, so its shared context and active preview never leak between tests. */
function loadModule(code) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(() => { throw Error('sound utilities must not import anything'); }, module, module.exports);
  return module.exports;
}
const loadSound = () => loadModule(source);

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

/** Minimal IndexedDB: records live in a Map; `gate` (optional) holds each get() until released. */
function installIndexedDB(records, gate) {
  const log = { opened: [], stores: [], gets: [] };
  globalThis.indexedDB = {
    open(name) {
      log.opened.push(name);
      const req = {};
      setTimeout(() => {
        req.result = {
          transaction(store) {
            log.stores.push(store);
            return { objectStore: (s) => ({ get(id) {
              log.gets.push({ store: s, id });
              const r = {};
              Promise.resolve(gate && gate.promise).then(() => { r.result = records.get(id); r.onsuccess(); });
              return r;
            } }) };
          },
        };
        req.onsuccess();
      });
      return req;
    },
  };
  return log;
}

let contexts = [];
let decodeImpl = async () => ({ duration: 3 });
class FakeAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; this.closed = false; this.sources = []; this.gains = []; this.decoded = []; this.oscillators = 0; contexts.push(this); }
  resume() { return Promise.resolve(); }
  close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  createGain() { const g = { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n) => n, disconnect() {} }; this.gains.push(g); return g; }
  createBufferSource() { const s = { started: 0, stops: [], connect: (n) => n, disconnect() {}, start() { this.started++; }, stop(t) { this.stops.push(t); } }; this.sources.push(s); return s; }
  createOscillator() { this.oscillators++; return { type: '', frequency: { value: 0 }, connect: (n) => n, start() {}, stop() {} }; }
  decodeAudioData(bytes) { this.decoded.push(bytes); return decodeImpl(bytes, this); }
}

const store = new Map();
test.beforeEach(() => {
  contexts = [];
  decodeImpl = async () => ({ duration: 3 });
  globalThis.window = { AudioContext: FakeAudioContext };
  store.clear();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  // Any network-style loading of the saved sound is a failure: the Blob must be read directly.
  globalThis.fetch = () => { throw Error('fetch must not be used for uploaded sounds'); };
  globalThis.URL.createObjectURL = () => { throw Error('object URLs must not be used for uploaded sounds'); };
});

const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
const saved = () => new Map([['s1', { name: 'office.wav', blob: new Blob([wav], { type: 'audio/wav' }) }]]);

test('loads the saved Blob straight from nesam_sounds/sounds and decodes its bytes', async () => {
  const sound = loadSound();
  const log = installIndexedDB(saved());
  const ctx = new FakeAudioContext();
  const buffer = await sound.loadCustomSoundBuffer('s1', ctx);
  assert.deepEqual(buffer, { duration: 3 });
  assert.deepEqual(log.opened, ['nesam_sounds']);
  assert.deepEqual(log.gets, [{ store: 'sounds', id: 's1' }]);
  assert.equal(ctx.decoded.length, 1);
  assert.ok(ctx.decoded[0] instanceof ArrayBuffer);
  assert.deepEqual([...new Uint8Array(ctx.decoded[0])], [...wav]);
});

test('a missing saved file and an undecodable file give clear errors', async () => {
  const sound = loadSound();
  installIndexedDB(new Map());
  await assert.rejects(sound.loadCustomSoundBuffer('gone', new FakeAudioContext()), { message: sound.MISSING_SOUND_MESSAGE });
  installIndexedDB(saved());
  decodeImpl = async () => { throw new DOMException('bad data', 'EncodingError'); };
  await assert.rejects(sound.loadCustomSoundBuffer('s1', new FakeAudioContext()), { message: sound.UNDECODABLE_SOUND_MESSAGE });
});

test('Live Test of an uploaded sound plays once at the selected volume; Stop closes only the preview context', async () => {
  const sound = loadSound();
  installIndexedDB(saved());
  sound.unlockSound(); // creates the shared real-notification context
  const shared = contexts[0];
  const preview = sound.startSoundPreview('custom:s1', 80, 5);
  await flush();
  const own = contexts[1];
  assert.notEqual(own, shared);
  assert.equal(own.sources.length, 1);
  assert.equal(own.sources[0].started, 1);
  assert.equal(own.gains[0].gain.value, 0.8);
  preview.stop();
  await preview.finished;
  assert.equal(own.closed, true);
  assert.equal(shared.closed, false, 'preview cleanup must not close the shared alert context');
});

test('Stop while the IndexedDB read is pending prevents decoding and playback', async () => {
  const sound = loadSound();
  const gate = deferred();
  installIndexedDB(saved(), gate);
  const preview = sound.startSoundPreview('custom:s1', 80, 5);
  await flush();
  preview.stop();
  gate.resolve();
  await flush();
  await preview.finished;
  const own = contexts[0];
  assert.equal(own.decoded.length, 0);
  assert.equal(own.sources.length, 0);
  assert.equal(own.closed, true);
});

test('Stop while decoding prevents delayed playback when decoding finishes', async () => {
  const sound = loadSound();
  installIndexedDB(saved());
  const decoding = deferred();
  decodeImpl = () => decoding.promise;
  const preview = sound.startSoundPreview('custom:s1', 80, 10);
  await flush();
  const own = contexts[0];
  assert.equal(own.decoded.length, 1, 'decode started');
  preview.stop();
  decoding.resolve({ duration: 3 });
  await flush();
  await preview.finished;
  assert.equal(own.sources.length, 0, 'no source is created after Stop');
});

test('starting a new Live Test cancels the previous one that is still loading', async () => {
  const sound = loadSound();
  const gate = deferred();
  installIndexedDB(saved(), gate);
  const first = sound.startSoundPreview('custom:s1', 80, 5);
  await flush();
  const second = sound.startSoundPreview('Clean Bell', 80, 5);
  await first.finished;
  gate.resolve();
  await flush();
  assert.equal(contexts[0].sources.length, 0);
  assert.equal(contexts[0].closed, true);
  second.stop();
  await second.finished;
});

test('Live Test of a missing uploaded sound reports the clear error', async () => {
  const sound = loadSound();
  installIndexedDB(new Map());
  const preview = sound.startSoundPreview('custom:gone', 80, 5);
  await assert.rejects(preview.finished, { message: sound.MISSING_SOUND_MESSAGE });
});

test('a real alert with a saved uploaded tone plays it on the shared context, bounded to the alert duration', async () => {
  const sound = loadSound();
  installIndexedDB(saved());
  sound.saveSoundConfig({ ...sound.DEFAULT_SOUNDS, 'Urgent booking': { tone: 'custom:s1', volume: 50, on: true, repeat: 'Every 1 min' } });
  sound.unlockSound();
  const shared = contexts[0];
  sound.playAlert('Urgent booking');
  await flush();
  assert.equal(shared.sources.length, 1);
  assert.equal(shared.sources[0].started, 1);
  assert.deepEqual(shared.sources[0].stops, [10]);
  assert.equal(shared.gains[0].gain.value, 0.5);
  assert.equal(shared.closed, false);
  // Real alerts keep priority: a Live Test during the alert is refused rather than overlapping it.
  const preview = sound.startSoundPreview('Clean Bell', 80, 5);
  await assert.rejects(preview.finished, /live alert is playing/);
});

test('a real alert whose uploaded file is missing falls back to the default preset instead of staying silent', async () => {
  const sound = loadSound();
  installIndexedDB(new Map());
  sound.saveSoundConfig({ ...sound.DEFAULT_SOUNDS, 'New booking': { tone: 'custom:gone', volume: 80, on: true, repeat: 'Once only' } });
  sound.unlockSound();
  const warn = console.warn; console.warn = () => {};
  try {
    sound.playAlert('New booking');
    await flush();
  } finally { console.warn = warn; }
  assert.ok(contexts[0].oscillators > 0, 'default preset tone played');
});

test('a real alert stops an in-progress Live Test that is still loading', async () => {
  const sound = loadSound();
  const gate = deferred();
  installIndexedDB(saved(), gate);
  sound.unlockSound();
  const preview = sound.startSoundPreview('custom:s1', 80, 5);
  await flush();
  sound.playAlert('New booking'); // default preset tone
  await preview.finished;
  gate.resolve();
  await flush();
  assert.equal(contexts[1].sources.length, 0);
  assert.equal(contexts[1].closed, true);
  assert.equal(contexts[0].closed, false);
});

// ── Follow-up reminder category ───────────────────────────────────────────

test('Follow-up reminder is the fourth category with its defaults; the other three are unchanged', () => {
  const sound = loadSound();
  assert.deepEqual([...sound.ALERT_KINDS], ['New booking', 'Urgent booking', 'Unassigned booking', 'Follow-up reminder']);
  assert.deepEqual(sound.DEFAULT_SOUNDS['Follow-up reminder'], { tone: 'Soft Chime', volume: 80, on: true, repeat: 'Once only' });
  assert.deepEqual(sound.ALERT_SECONDS, { 'New booking': 5, 'Urgent booking': 10, 'Unassigned booking': 5, 'Follow-up reminder': 2 });
  assert.deepEqual(sound.loadSoundConfig(), sound.DEFAULT_SOUNDS); // nothing saved yet
});

test('a saved three-category configuration keeps its choices and gains the follow-up default; saving round-trips', () => {
  const sound = loadSound();
  const old = {
    'New booking': { tone: 'custom:s1', volume: 35, on: false, repeat: 'Once only' },
    'Urgent booking': { tone: 'Quick Ring', volume: 90, on: true, repeat: 'Every 30 sec' },
    'Unassigned booking': { tone: 'Soft Chime', volume: 10, on: true, repeat: 'Every 10 min' },
  };
  store.set('nesam_alert_sounds', JSON.stringify(old));
  const cfg = sound.loadSoundConfig();
  for (const k of Object.keys(old)) assert.deepEqual(cfg[k], old[k]);
  assert.deepEqual(cfg['Follow-up reminder'], sound.DEFAULT_SOUNDS['Follow-up reminder']);
  const changed = { ...cfg, 'Follow-up reminder': { tone: 'custom:s1', volume: 40, on: false, repeat: 'Every 2 min' } };
  sound.saveSoundConfig(changed);
  assert.deepEqual(sound.loadSoundConfig(), changed);
  // A damaged field falls back to its default without losing the rest.
  store.set('nesam_alert_sounds', JSON.stringify({ ...old, 'Follow-up reminder': { tone: 'Clean Bell', volume: 'loud', repeat: 'Hourly' } }));
  assert.deepEqual(sound.loadSoundConfig()['Follow-up reminder'], { tone: 'Clean Bell', volume: 80, on: true, repeat: 'Once only' });
  assert.equal(sound.repeatIntervalMs('Every 2 min'), 120000);
  assert.equal(sound.repeatIntervalMs('Once only'), null);
});

test('follow-up alerts use the saved tone and volume, and obey global and per-alert sound off', async () => {
  const sound = loadSound();
  installIndexedDB(saved());
  sound.unlockSound();
  const shared = contexts[0];
  sound.saveSoundConfig({ ...sound.DEFAULT_SOUNDS, 'Follow-up reminder': { tone: 'custom:s1', volume: 30, on: true, repeat: 'Once only' } });
  sound.playAlert('Follow-up reminder');
  await flush();
  assert.equal(shared.sources.length, 1, 'uploaded tone played from its saved Blob');
  assert.deepEqual(shared.sources[0].stops, [2], 'bounded to 2 seconds');
  assert.equal(shared.gains[0].gain.value, 0.3);
  await new Promise((r) => setTimeout(r, 2100)); // let the 2 s alert finish

  sound.saveSoundConfig({ ...sound.DEFAULT_SOUNDS, 'Follow-up reminder': { ...sound.DEFAULT_SOUNDS['Follow-up reminder'], on: false } });
  sound.playAlert('Follow-up reminder');
  await flush();
  assert.equal(shared.sources.length, 1);
  assert.equal(shared.oscillators, 0, 'per-alert off mutes the follow-up');
  sound.playAlert('New booking'); // other alerts keep playing
  assert.ok(shared.oscillators > 0);

  const before = shared.oscillators;
  await new Promise((r) => setTimeout(r, 5100));
  sound.saveSoundConfig(sound.DEFAULT_SOUNDS);
  sound.setSoundEnabled(false);
  sound.playAlert('Follow-up reminder');
  await flush();
  assert.equal(shared.oscillators, before, 'global sound off mutes the follow-up');
});

test('a follow-up reminder waits for a sounding booking alert instead of cutting it off', async () => {
  const sound = loadSound();
  installIndexedDB(saved());
  sound.saveSoundConfig({ ...sound.DEFAULT_SOUNDS, 'New booking': { tone: 'custom:s1', volume: 80, on: true, repeat: 'Once only' } });
  sound.unlockSound();
  const shared = contexts[0];
  sound.playAlert('New booking');
  await flush();
  const booking = shared.sources[0];
  sound.playAlert('Follow-up reminder');
  sound.playAlert('Follow-up reminder'); // a duplicate request while waiting is not queued twice
  await flush();
  assert.deepEqual(booking.stops, [5], 'the booking alert was not stopped early');
  assert.equal(shared.oscillators, 0);
  await new Promise((r) => setTimeout(r, 3300)); // the uploaded sound is 3 s long
  const chime = shared.oscillators;
  assert.ok(chime > 0, 'the follow-up plays once the booking alert ends');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(shared.oscillators, chime, 'played only once');
});

test('Live Test previews an unsaved follow-up selection for 2 seconds at most', async () => {
  const sound = loadSound();
  installIndexedDB(saved());
  const preview = sound.startSoundPreview('custom:s1', 55, sound.ALERT_SECONDS['Follow-up reminder']);
  await flush();
  assert.equal(contexts[0].gains[0].gain.value, 0.55);
  const started = Date.now();
  await preview.finished;
  const took = Date.now() - started;
  assert.ok(took >= 1900 && took < 2600, `stopped after ~2 s (took ${took} ms)`);
  assert.equal(contexts[0].closed, true);
});

test('follow-up scheduler: alerts once when due, repeats at the interval, no duplicates on re-render', () => {
  const { stepFollowUpReminders } = loadModule(reminderSource);
  const a = { id: 'a', dueAtMs: 1000 };
  let s = stepFollowUpReminders(null, [], 0, null);
  assert.equal(s.sound, false);
  s = stepFollowUpReminders(s.state, [a], 1000, null);
  assert.deepEqual([s.sound, s.fresh.map((r) => r.id)], [true, ['a']]);
  // The same queue again (re-render / StrictMode double effect): nothing new.
  const again = stepFollowUpReminders(s.state, [a], 1000, null);
  assert.deepEqual([again.sound, again.fresh.length], [false, 0]);
  // "Once only": still due a long time later, still silent.
  assert.equal(stepFollowUpReminders(s.state, [a], 999999, null).sound, false);
  // Every 1 min: silent before, rings at the interval, then waits another interval.
  let r = stepFollowUpReminders(s.state, [a], 1000 + 45000, 60000);
  assert.equal(r.sound, false);
  r = stepFollowUpReminders(r.state, [a], 1000 + 60000, 60000);
  assert.deepEqual([r.sound, r.repeated, r.fresh.length], [true, true, 0]);
  assert.equal(stepFollowUpReminders(r.state, [a], 1000 + 75000, 60000).sound, false);
});

test('follow-up scheduler: snooze pauses until the new due time; booked / lost follow-ups stop repeating', () => {
  const { stepFollowUpReminders } = loadModule(reminderSource);
  const rep = 30000;
  let s = stepFollowUpReminders(new Map(), [{ id: 'a', dueAtMs: 0 }, { id: 'b', dueAtMs: 0 }], 0, rep);
  assert.equal(s.fresh.length, 2);
  // "a" snoozed +15m: it is upcoming, so not in the due list; "b" is booked / lost: also not due.
  s = stepFollowUpReminders(s.state, [], 60000, rep);
  assert.equal(s.sound, false);
  assert.equal(s.state.size, 0, 'nothing left to repeat');
  s = stepFollowUpReminders(s.state, [], 600000, rep);
  assert.equal(s.sound, false, 'silent while snoozed');
  // At the new due time it alerts afresh.
  s = stepFollowUpReminders(s.state, [{ id: 'a', dueAtMs: 900000 }], 900000, rep);
  assert.deepEqual([s.sound, s.fresh.map((r) => r.id)], [true, ['a']]);
  // A due time moved while it stays in the list (rescheduled) also counts as a new alert.
  s = stepFollowUpReminders(s.state, [{ id: 'a', dueAtMs: 905000 }], 905000, rep);
  assert.equal(s.fresh.length, 1);
});

test('follow-up scheduler: follow-ups already due when the desk opens do not alert at once, but do repeat', () => {
  const { stepFollowUpReminders } = loadModule(reminderSource);
  const a = { id: 'a', dueAtMs: 0 };
  let s = stepFollowUpReminders(null, [a], 10000, 60000);
  assert.deepEqual([s.sound, s.fresh.length], [false, 0]);
  s = stepFollowUpReminders(s.state, [a], 70000, 60000);
  assert.equal(s.sound, true);
});
