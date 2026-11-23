// Focused checks for uploaded notification sounds: direct Blob loading (no fetch / object URL),
// cancellation while loading or decoding, missing / undecodable files, and the shared alert context.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../admin/node_modules/typescript');

const file = path.resolve(__dirname, '../admin/src/utils/notificationSound.ts');
const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
/** A fresh copy of the module per test, so its shared context and active preview never leak between tests. */
function loadSound() {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', source)(() => { throw Error('notificationSound.ts must not import anything'); }, module, module.exports);
  return module.exports;
}

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
