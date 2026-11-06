const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.e2e');
const { initializeApp, deleteApp } = require('../../admin/node_modules/firebase/app');
const { getStorage, connectStorageEmulator, ref, uploadBytes, getMetadata, getDownloadURL } = require('../../admin/node_modules/firebase/storage');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6WQAAAAASUVORK5CYII=', 'base64');
const apps = [];
let pricing, viewer, guest;
async function client(uid) {
  const app = initializeApp({ projectId: H.PROJECT, apiKey: 'fake', storageBucket: `${H.PROJECT}.appspot.com` }, `media-${uid || 'guest'}`);
  apps.push(app);
  const storage = getStorage(app);
  connectStorageEmulator(storage, '127.0.0.1', 9299, uid ? { mockUserToken: await H.tokenFor(uid) } : undefined);
  storage.maxUploadRetryTime = 2000;
  storage.maxOperationRetryTime = 2000;
  return storage;
}
test.before(async () => {
  await H.db.doc('admins/media-pricing').set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Media test admin' });
  await H.db.doc('admins/media-viewer').set({ role: 'admin', status: 'active', staffRole: 'staff', permissions: [], name: 'Read-only test admin' });
  pricing = await client('media-pricing');
  viewer = await client('media-viewer');
  guest = await client('');
});
test.after(async () => { await Promise.all(apps.map(app => deleteApp(app))); });

test('pricing admin uploads separate icon and car images; signed-out customers can read them', async () => {
  for (const kind of ['icon', 'car']) {
    const path = `category-media/media-test/${kind}-valid.png`;
    await uploadBytes(ref(pricing, path), png, { contentType: 'image/png' });
    const metadata = await getMetadata(ref(guest, path));
    assert.equal(metadata.contentType, 'image/png');
    const url = await getDownloadURL(ref(guest, path));
    const download = await fetch(url);
    assert.equal(download.status, 200);
    assert.equal((await download.arrayBuffer()).byteLength, png.length);
  }
});

test('staff without pricing permission and guests cannot upload category media', async () => {
  for (const storage of [viewer, guest]) {
    await assert.rejects(uploadBytes(ref(storage, 'category-media/media-test/car-forbidden.png'), png, { contentType: 'image/png' }), e => e.code === 'storage/unauthorized');
  }
});

test('unsupported files, oversized images and overwrites are refused', async () => {
  await assert.rejects(uploadBytes(ref(pricing, 'category-media/media-test/icon-svg.png'), png, { contentType: 'image/svg+xml' }), e => e.code === 'storage/unauthorized');
  await assert.rejects(uploadBytes(ref(pricing, 'category-media/media-test/car-large.png'), Buffer.alloc(5 * 1024 * 1024 + 1), { contentType: 'image/png' }), e => e.code === 'storage/unauthorized');
  const target = ref(pricing, 'category-media/media-test/car-immutable.png');
  await uploadBytes(target, png, { contentType: 'image/png' });
  await assert.rejects(uploadBytes(target, png, { contentType: 'image/png' }), e => e.code === 'storage/unauthorized');
});

test('the saved category exposes its icon and car image to every signed-out customer brand', async () => {
  const imageUrl = await getDownloadURL(ref(pricing, 'category-media/media-test/car-valid.png'));
  const iconUrl = await getDownloadURL(ref(pricing, 'category-media/media-test/icon-valid.png'));
  const saved = await H.clientCreate('media-pricing', 'vehicle_categories', 'media-category', { name: 'SUV', status: 'Active', iconUrl, imageUrl });
  assert.equal(saved.ok, true);
  const read = await fetch(`${H.FS}/vehicle_categories/media-category`);
  assert.equal(read.status, 200);
  const category = await read.json();
  assert.equal(category.fields.imageUrl.stringValue, imageUrl);
  assert.equal(category.fields.iconUrl.stringValue, iconUrl);
});
