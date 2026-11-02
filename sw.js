/* Tetralogy offline worker.
   Opens the app instantly from the copy saved on the phone, then quietly checks GitHub for a newer
   copy. When one arrives, the page shows "A new version is ready · tap to refresh".
   Study data from Supabase is never stored here; the app saves its own copy separately. */
"use strict";
const CACHE = "tetralogy-v7";
const SHELL = ["./", "index.html", "style.css", "scripts.js", "tetralogy-mark.svg", "manifest.json", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
const LIBRARY = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(path => cache.add(new Request(path, { cache: "reload" })).catch(() => {})));
    await cache.add(new Request(LIBRARY, { mode: "cors" })).catch(() => {});
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener("message", event => { if (event.data === "skip-waiting") self.skipWaiting(); });

async function notifyUpdate() {
  for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage("tetralogy-updated");
}
/* Serve the saved copy at once; refresh it in the background and say so if it changed. */
async function shellResponse(event, cacheKey) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(cacheKey, { ignoreSearch: true });
  const network = fetch(event.request.mode === "navigate" ? new Request(cacheKey, { cache: "no-cache" }) : new Request(event.request, { cache: "no-cache" }))
    .then(async response => {
      if (response && response.ok && response.type === "basic") {
        const fresh = response.clone();
        if (cached) {
          const [a, b] = await Promise.all([cached.clone().text(), fresh.clone().text()]);
          if (a !== b) { await cache.put(cacheKey, fresh); await notifyUpdate(); }
        } else await cache.put(cacheKey, fresh);
      }
      return response;
    });
  if (cached) { event.waitUntil(network.catch(() => {})); return cached; }
  return network.catch(() => caches.match("index.html"));
}
self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    const scope = new URL(self.registration.scope);
    if (!url.pathname.startsWith(scope.pathname)) return;
    if (req.mode === "navigate") { event.respondWith(shellResponse(event, new URL("index.html", scope).href)); return; }
    const rel = url.pathname.slice(scope.pathname.length);
    if (SHELL.includes(rel)) { event.respondWith(shellResponse(event, url.origin + url.pathname)); return; }
    return;
  }
  // The pinned database library and the fonts never change at the same address: keep them once fetched.
  if (req.url === LIBRARY || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
  }
});
