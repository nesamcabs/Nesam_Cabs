/*
 * NESAM Cabs — device cache for fast loads and offline use.
 *
 * What it keeps on the device:
 *   - the site's own scripts, styles and fonts (/assets/…: file names change with every release, so they never go stale),
 *   - car pictures (Firebase Storage) and the site's own images (/vehicles, /art, /brand, /website-images, /icons),
 *   - map tiles already seen,
 *   - the last page shell, used only when the network is slow or offline.
 *
 * What it never touches: sign-in, Firestore, Cloud Functions, Google Maps and every other API call,
 * and any request that is not a plain GET. Prices, bookings and login always come live from the server.
 *
 * Bump VERSION to drop every cache this file created.
 */
const VERSION = 'v1';
const PREFIX = 'nesamcabs';
const STATIC = `${PREFIX}-static-${VERSION}`;
const IMAGES = `${PREFIX}-img-${VERSION}`;
const STORAGE = `${PREFIX}-photos-${VERSION}`;
const TILES = `${PREFIX}-tiles-${VERSION}`;
const PAGES = `${PREFIX}-pages-${VERSION}`;
const CURRENT = [STATIC, IMAGES, STORAGE, TILES, PAGES];

const MAX_IMAGES = 80;
/** Pictures from Firebase Storage cannot be read cross-origin, so the browser stores them as "opaque" entries, which
 *  count extra against storage. A site shows about ten cars, so this cap is generous while staying safe on small phones. */
const MAX_STORAGE_IMAGES = 40;
const MAX_TILES = 300;
/** A page that takes longer than this to answer is replaced by the saved one. */
const PAGE_TIMEOUT_MS = 3000;
const STORAGE_HOSTS = ['firebasestorage.googleapis.com', 'storage.googleapis.com'];
const TILE_HOST = /^[a-c]?\.?tile\.openstreetmap\.org$/;
const OWN_IMAGE_DIRS = /^\/(?:vehicles|art|brand|website-images|icons|nesam)\//;

self.addEventListener('install', (event) => {
  // The shell is saved up front so even the very first offline visit has something to show.
  event.waitUntil(
    caches.open(PAGES).then((cache) => cache.add(new Request('/', { cache: 'reload' }))).catch(() => undefined).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(`${PREFIX}-`) && !CURRENT.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i += 1) await cache.delete(keys[i]);
}

/** Hashed files: saved once, served from the device forever. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') await cache.put(request, res.clone());
  return res;
}

/** Pictures on our own site: shown from the device at once, refreshed quietly in the background. */
async function staleWhileRevalidate(event, request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then(async (res) => {
      if (res.ok && res.type === 'basic') {
        await cache.put(request, res.clone());
        await trim(cache, max);
      }
      return res;
    })
    .catch(() => undefined);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  return (await refresh) || Response.error();
}

/**
 * Car pictures from Firebase Storage. The file name changes with every upload, so a saved picture is never out of
 * date: it is served from the device at once. (These answers cannot be inspected, so a saved one is also quietly
 * re-checked in the background and replaced, which heals an entry that was saved while the picture was not ready.)
 */
async function storageImage(event, request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request.url);
  const refresh = () =>
    fetch(request).then(async (res) => {
      if (res.ok || res.type === 'opaque') {
        await cache.put(request.url, res.clone());
        await trim(cache, max);
      }
      return res;
    });
  if (hit) {
    if (hit.type === 'opaque') event.waitUntil(refresh().catch(() => undefined));
    return hit;
  }
  return refresh();
}

/** Map tiles: the tile server allows cross-origin reads, so real (small) responses can be saved. */
async function tileImage(event, request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  try {
    const res = await fetch(request.url, { mode: 'cors', credentials: 'omit' });
    if (res.ok) {
      event.waitUntil(cache.put(request.url, res.clone()).then(() => trim(cache, max)));
      return res;
    }
  } catch {
    /* fall through to the plain request */
  }
  return fetch(request);
}

/** Pages: always the live one; the saved one only when the network is slow or gone. */
async function page(event, request) {
  const cache = await caches.open(PAGES);
  const fallback = async () => (await cache.match(request)) || (await cache.match('/')) || Response.error();
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), PAGE_TIMEOUT_MS)),
    ]);
    if (res.ok && res.type === 'basic') {
      const url = new URL(request.url);
      event.waitUntil(cache.put(url.pathname === '/' ? '/' : request, res.clone()));
    }
    return res;
  } catch {
    return fallback();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    // Firebase sign-in helper pages and anything outside this site go straight to the network.
    if (url.origin === self.location.origin && !url.pathname.startsWith('/__/')) event.respondWith(page(event, request));
    return;
  }

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/assets/') || /\.woff2?$/i.test(url.pathname)) {
      event.respondWith(cacheFirst(request, STATIC));
    } else if (OWN_IMAGE_DIRS.test(url.pathname) && request.destination === 'image') {
      event.respondWith(staleWhileRevalidate(event, request, IMAGES, MAX_IMAGES));
    }
    return;
  }

  if (request.destination !== 'image') return;
  if (STORAGE_HOSTS.includes(url.hostname)) event.respondWith(storageImage(event, request, STORAGE, MAX_STORAGE_IMAGES));
  else if (TILE_HOST.test(url.hostname)) event.respondWith(tileImage(event, request, TILES, MAX_TILES));
});
