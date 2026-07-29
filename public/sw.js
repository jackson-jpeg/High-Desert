/// <reference lib="webworker" />

/**
 * Cache name is derived from the ?v= build id the page registers us with
 * (see src/components/ServiceWorkerRegistration.tsx). Every deploy therefore
 * gets a fresh cache and the activate handler below purges the previous one.
 *
 * Without this, a single hardcoded name meant the purge never ran and stale
 * HTML — referencing _next/static chunks deleted by the next deploy — could be
 * served forever.
 */
const BUILD_ID = new URL(self.location).searchParams.get("v") || "dev";
const CACHE_NAME = `hd-shell-${BUILD_ID}`;

const STATIC_ASSETS = [
  "/",
  "/library",
  "/radio",
  "/scanner",
  "/search",
  "/stats",
  "/manifest.json",
  "/fonts/W95FA.woff2",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

const OFFLINE_RESPONSE = () =>
  new Response("", { status: 504, statusText: "Offline" });

// Install: pre-cache app shell. Individual failures must not fail the install.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(STATIC_ASSETS.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

// Activate: drop every cache that isn't this build's
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Kill switch: lets the app remotely disable a misbehaving worker.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "hd:unregister") return;
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
  );
});

function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => OFFLINE_RESPONSE());
  });
}

function networkFirst(request) {
  return fetch(request)
    .catch(() => caches.match(request))
    .then((r) => r || OFFLINE_RESPONSE());
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Media never goes through the worker.
  //
  // This used to fall through to the catch-all networkFirst below, which was
  // pure downside: networkFirst only ever *reads* the cache, so audio was never
  // stored and respondWith() bought us nothing. What it cost was real. Media
  // elements fetch audio as a series of Range requests and expect 206s; routing
  // those through a worker defeats the browser's native byte-range machinery,
  // which is exactly the interaction iOS Safari handles worst. And when a fetch
  // did fail, networkFirst returned a body-less 504, which the element reports
  // as MediaError code 4 — so a network problem surfaced to the user as "audio
  // source not supported", and sent us to check archive.org's health for no
  // reason.
  //
  // Returning without calling respondWith() hands the request back to the
  // browser untouched. Offline audio lives in OPFS (src/audio/cache.ts) and is
  // unaffected by any of this.
  if (
    event.request.headers.has("range") ||
    event.request.destination === "audio" ||
    url.hostname === "archive.org" ||
    url.hostname.endsWith(".archive.org") ||
    /\.(mp3|m4a|aac|ogg|opus|flac|wav)$/i.test(url.pathname)
  ) {
    return;
  }

  // API routes: always network-first, fall back to cache only if offline
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Static assets are content-hashed, so cache-first is safe
  if (
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.match(/\.(woff2?|png|jpg|svg|ico|js|css)$/)
  ) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Navigations: network-first with NO timeout.
  //
  // A timeout here was actively harmful: a slow-but-working connection lost the
  // race and got served stale HTML pointing at chunks that no longer exist,
  // producing a chunk-load error for a user who was actually online. A genuinely
  // offline fetch rejects immediately, so the cache fallback still works.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Never cache errors — a transient 500 would otherwise be served
          // from cache indefinitely.
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          self.clients.matchAll({ type: "window" }).then((clients) => {
            clients.forEach((client) => client.postMessage({ type: "hd:offline-fallback" }));
          });
          return caches
            .match(event.request)
            .then((r) => r || caches.match("/library"))
            .then((r) => r || caches.match("/"))
            .then((r) => r || OFFLINE_RESPONSE());
        })
    );
    return;
  }

  event.respondWith(networkFirst(event.request));
});
